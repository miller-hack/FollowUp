import {
  EMAIL_ACTIONS,
  EMAIL_FIELDS,
  MAX_CHAIN_DEPTH,
  TRIGGER_CONTEXT,
  actionAllowed,
  type Action,
  type Automation,
  type AutomationInput,
  type AutomationRun,
  type Condition,
  type TestResult,
  type Trigger
} from '@shared/automation'
import { addDays, hasTime, localDate, localDateTime, parseLocal } from '@shared/dates'
import type { AppNotification, Location, Task } from '@shared/types'
import { all, get, now, run, tx, uuid } from '../db'
import { onEvent, withDepth, type EmittedEvent } from './events'
import { enqueue, registerJobHandler, type Job } from './jobs'
import { addNotification, createReminder, deliverNotification } from './notify'
import { postToIntegration } from './integrations'
import { addChecklist, addChecklistItem, addComment, createTask, getTask, updateTask } from './tasks'
import { listEvents } from './calendar'
import { createTaskFromThread } from './mail/index'
import { markThreadRead } from './mail/accounts'
import { queueEmail } from './mail/send'
import { DUE_SQL, isOurs, ourIdentity } from './mail/followups'
import type { MailAddress } from '@shared/mail'

// ---------------------------------------------------------------- storage

interface Row {
  id: string
  name: string
  enabled: number
  scope: string | null
  trigger: string
  conditions: string
  actions: string
  run_count: number
  last_run_at: string | null
  created_at: string
}

const COLS = 'id, name, enabled, scope, trigger, conditions, actions, run_count, last_run_at, created_at'

const toAutomation = (r: Row): Automation => ({
  id: r.id,
  name: r.name,
  enabled: !!r.enabled,
  scope: r.scope ? (JSON.parse(r.scope) as Location) : null,
  trigger: JSON.parse(r.trigger) as Trigger,
  conditions: JSON.parse(r.conditions) as Condition[],
  actions: JSON.parse(r.actions) as Action[],
  run_count: r.run_count,
  last_run_at: r.last_run_at,
  created_at: r.created_at
})

export function listAutomations(): Automation[] {
  return all<Row>(`SELECT ${COLS} FROM automations ORDER BY position`).map(toAutomation)
}

export function getAutomation(id: string): Automation | null {
  const r = get<Row>(`SELECT ${COLS} FROM automations WHERE id = ?`, id)
  return r ? toAutomation(r) : null
}

/** Throws a readable error if the rule can't work. */
export function validateAutomation(a: AutomationInput): void {
  if (!a.name.trim()) throw new Error('Give the automation a name')
  if (!a.actions.length) throw new Error('Add at least one action')
  const ctx = TRIGGER_CONTEXT[a.trigger.type]
  for (const act of a.actions) {
    if (!actionAllowed(act.type, ctx))
      throw new Error(`“${act.type.replace(/_/g, ' ')}” needs ${EMAIL_ACTIONS.includes(act.type) ? 'an email' : 'a task'}, so it can't run for this trigger`)
    if (act.type === 'send_email' && (!act.to?.trim() || !act.subject?.trim())) throw new Error('Fill in the recipient and subject of the email')
    if ((act.type === 'send_email' || act.type === 'reply_to_email') && !act.body?.trim()) throw new Error('Write the email text')
    if (act.type === 'create_task_from_email' && !get('SELECT 1 FROM lists WHERE id = ?', act.list_id)) throw new Error('Choose a list')
    if (act.type === 'start_sequence') throw new Error('Automatic follow-up sequences were removed in FollowUp 1.1. Use the Follow-up view in the Inbox, or the “Email needs follow-up” trigger.')
    if (act.type === 'set_status' && !act.status?.trim()) throw new Error('Choose a status')
    if ((act.type === 'move_to_list' || act.type === 'create_task') && !get('SELECT 1 FROM lists WHERE id = ?', act.list_id))
      throw new Error('Choose a list')
    if ((act.type === 'add_tag' || act.type === 'remove_tag') && !get('SELECT 1 FROM tags WHERE id = ?', act.tag_id)) throw new Error('Choose a tag')
    if ((act.type === 'create_task' || act.type === 'create_subtask') && !act.title?.trim()) throw new Error('Give the new task a title')
    if (act.type === 'notify' && !act.title?.trim()) throw new Error('Give the notification a title')
    if (act.type === 'add_comment' && !act.text?.trim()) throw new Error('Write the comment text')
    if (act.type === 'ai_prompt' && !act.prompt?.trim()) throw new Error('Write what to ask the AI')
    if (act.type === 'post_message' && !get('SELECT 1 FROM integrations WHERE id = ?', act.integration_id)) throw new Error('Choose where to post the message')
    if (act.type === 'post_message' && !act.text?.trim()) throw new Error('Write the message')
  }
  if (a.trigger.type === 'schedule' && !/^\d{2}:\d{2}$/.test(a.trigger.at)) throw new Error('Pick a time for the schedule')
  if (a.trigger.type === 'email_no_reply' && !(a.trigger.days > 0)) throw new Error('Wait at least one day for a reply')
  if (ctx !== 'email' && a.conditions.some((c) => EMAIL_FIELDS.includes(c.field))) throw new Error('Email conditions only work with email triggers')
  if (ctx === 'email' && a.conditions.some((c) => !EMAIL_FIELDS.includes(c.field))) throw new Error('Email triggers can only check email fields')
}

export function createAutomation(input: AutomationInput): Automation {
  validateAutomation(input)
  const id = uuid()
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM automations')?.p ?? 0) + 1
  run(
    'INSERT INTO automations (id, name, enabled, scope, trigger, conditions, actions, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.name.trim(), input.enabled, input.scope, input.trigger, input.conditions, input.actions, pos
  )
  return getAutomation(id)!
}

export function updateAutomation(id: string, patch: Partial<AutomationInput>): Automation {
  const cur = getAutomation(id)
  if (!cur) throw new Error('Automation not found')
  const next = { ...cur, ...patch }
  if (patch.name !== undefined || patch.trigger || patch.actions || patch.conditions) validateAutomation(next)
  run(
    'UPDATE automations SET name = ?, enabled = ?, scope = ?, trigger = ?, conditions = ?, actions = ?, updated_at = ? WHERE id = ?',
    next.name.trim(), next.enabled, next.scope, next.trigger, next.conditions, next.actions, now(), id
  )
  return getAutomation(id)!
}

export function deleteAutomation(id: string): void {
  run('DELETE FROM automations WHERE id = ?', id)
}

export function duplicateAutomation(id: string): Automation {
  const a = getAutomation(id)
  if (!a) throw new Error('Automation not found')
  return createAutomation({ ...a, name: `${a.name} (copy)`, enabled: false })
}

export function listAutomationRuns(automationId?: string, limit = 100): AutomationRun[] {
  const rows = all<Omit<AutomationRun, 'detail'> & { detail: string }>(
    `SELECT r.id, r.automation_id, r.status, r.task_id, t.title task_title, r.trigger, r.detail, r.error, r.created_at
     FROM automation_runs r LEFT JOIN tasks t ON t.id = r.task_id
     ${automationId ? 'WHERE r.automation_id = ?' : ''} ORDER BY r.created_at DESC LIMIT ${Math.max(1, Math.min(500, limit))}`,
    ...(automationId ? [automationId] : [])
  )
  return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) as string[] }))
}

function recordRun(automationId: string, status: AutomationRun['status'], taskId: string | null, trigger: string, detail: string[], error: string | null = null): void {
  run(
    'INSERT INTO automation_runs (id, automation_id, status, task_id, trigger, detail, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uuid(), automationId, status, taskId, trigger, detail, error
  )
  // keep the newest 100 runs per rule
  run(
    `DELETE FROM automation_runs WHERE automation_id = ? AND id NOT IN
     (SELECT id FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT 100)`,
    automationId,
    automationId
  )
}

// ---------------------------------------------------------------- matching

const statusName = (id: string) => get<{ name: string }>('SELECT name FROM statuses WHERE id = ?', id)?.name.toLowerCase() ?? ''
const sameName = (want: string | null | undefined, statusId: string) => !want || want.toLowerCase() === statusName(statusId)

function triggerMatches(t: Trigger, e: EmittedEvent): boolean {
  switch (t.type) {
    case 'task_created':
      return e.type === 'task.created'
    case 'status_changed':
      return e.type === 'task.status_changed' && sameName(t.from, e.from) && sameName(t.to, e.to)
    case 'priority_changed':
      return e.type === 'task.priority_changed' && (!t.to || t.to === e.to)
    case 'task_moved':
      return e.type === 'task.moved' && (!t.to_list_id || t.to_list_id === e.toList)
    case 'tag_added':
      return e.type === 'task.tag_added' && (!t.tag_id || t.tag_id === e.tagId)
    case 'comment_added':
      // comments written by automations never trigger comment rules
      return e.type === 'task.comment_added' && e.author !== 'automation'
    case 'checklist_completed':
      return e.type === 'task.checklist_completed'
    case 'time_over_estimate':
      return e.type === 'time.logged'
    case 'email_triaged':
      return e.type === 'mail.triaged' && (!t.category || t.category === e.category)
    case 'email_received':
      return (
        e.type === 'mail.received' &&
        (!t.account_id || get<{ account_id: string }>('SELECT account_id FROM mail_threads WHERE id = ?', e.threadId)?.account_id === t.account_id)
      )
    default:
      return false
  }
}

export function inScope(scope: Location | null, taskId: string): boolean {
  if (!scope) return true
  const t = get<{ list_id: string; folder_id: string | null; space_id: string; sprint_id: string | null }>(
    'SELECT t.list_id, l.folder_id, l.space_id, t.sprint_id FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = ?',
    taskId
  )
  if (!t) return false
  return { list: t.list_id, folder: t.folder_id, space: t.space_id, sprint: t.sprint_id }[scope.kind] === scope.id
}

/** Record a fire-once key; false if it already fired. */
function fireOnce(key: string): boolean {
  return run('INSERT OR IGNORE INTO automation_fired (key, created_at) VALUES (?, ?)', key, now()) > 0
}

const triggerLabel = (t: Trigger): string => t.type.replace(/_/g, ' ')

function handleEvent(e: EmittedEvent): void {
  const rules = all<Row>(`SELECT ${COLS} FROM automations WHERE enabled = 1`).map(toAutomation)
  for (const rule of rules) {
    if (!triggerMatches(rule.trigger, e)) continue
    if (e.type === 'mail.received' || e.type === 'mail.triaged') {
      const label = e.type === 'mail.received' ? 'email received' : `email classified as ${e.category}`
      enqueue('automation', { ruleId: rule.id, taskId: null, threadId: e.threadId, messageId: e.messageId, trigger: label, depth: e.depth } satisfies Payload)
      continue
    }
    if (!inScope(rule.scope, e.taskId)) continue
    if (rule.trigger.type === 'time_over_estimate') {
      const t = get<{ est: number | null; sec: number | null }>(
        'SELECT t.time_estimate_min est, (SELECT SUM(duration_sec) FROM time_entries WHERE task_id = t.id) sec FROM tasks t WHERE t.id = ?',
        e.taskId
      )
      if (!t?.est || (t.sec ?? 0) / 60 <= t.est) continue
      if (!fireOnce(`${rule.id}:overestimate:${e.taskId}:${t.est}`)) continue
    }
    enqueue('automation', { ruleId: rule.id, taskId: e.taskId, trigger: triggerLabel(rule.trigger), depth: e.depth } satisfies Payload)
  }
}

// ---------------------------------------------------------------- conditions

interface EmailCtx {
  rowId: string
  threadId: string
  accountId: string
  from: string
  fromName: string
  to: string
  subject: string
  snippet: string
  body: string
  /** auto-reply, list or robot mail: never replied to automatically (ADR-008) */
  auto: boolean
}

interface Ctx {
  /** rule being run (for per-rule send limits); empty in dry runs */
  ruleId: string
  task: Task | null
  listName: string
  statusName: string
  email: EmailCtx | null
  event: { title: string; start: string } | null
}

function emailContext(messageRowId: string | null | undefined): EmailCtx | null {
  if (!messageRowId) return null
  const m = get<{ id: string; thread_id: string; account_id: string; from_addr: string; from_name: string; to_addrs: string; subject: string; snippet: string; body_text: string; is_auto: number }>(
    'SELECT id, thread_id, account_id, from_addr, from_name, to_addrs, subject, snippet, body_text, is_auto FROM mail_messages WHERE id = ?',
    messageRowId
  )
  if (!m) return null
  return {
    rowId: m.id,
    threadId: m.thread_id,
    accountId: m.account_id,
    from: m.from_addr,
    fromName: m.from_name || m.from_addr,
    to: (JSON.parse(m.to_addrs) as MailAddress[]).map((a) => a.address).join(', '),
    subject: m.subject,
    snippet: m.snippet,
    body: m.body_text,
    auto: !!m.is_auto
  }
}

function context(task: Task | null, extra: Partial<Pick<Ctx, 'email' | 'event' | 'ruleId'>> = {}): Ctx {
  return {
    ruleId: extra.ruleId ?? '',
    task,
    listName: task ? (get<{ name: string }>('SELECT name FROM lists WHERE id = ?', task.list_id)?.name ?? '') : '',
    statusName: task ? (get<{ name: string }>('SELECT name FROM statuses WHERE id = ?', task.status_id)?.name ?? '') : '',
    email: extra.email ?? null,
    event: extra.event ?? null
  }
}

function evalCondition(c: Condition, ctx: Ctx): { pass: boolean; label: string } {
  const eq = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
  if (EMAIL_FIELDS.includes(c.field)) {
    const m = ctx.email
    if (!m) return { pass: false, label: 'No email' }
    const actual = { email_from: `${m.fromName} ${m.from}`, email_to: m.to, email_subject: m.subject, email_body: m.body }[c.field as 'email_from']
    const label = `${c.field.replace('email_', '').replace(/^\w/, (x) => x.toUpperCase())} ${c.op.replace(/_/g, ' ')} “${c.value ?? ''}”`
    const has = String(actual).toLowerCase().includes(String(c.value ?? '').toLowerCase())
    const pass =
      c.op === 'contains' ? has : c.op === 'not_contains' ? !has : c.op === 'is' ? eq(c.field === 'email_from' ? m.from : actual, c.value) : c.op === 'is_not' ? !eq(c.field === 'email_from' ? m.from : actual, c.value) : false
    return { pass, label }
  }
  const t = ctx.task
  if (!t) return { pass: false, label: 'No task' }
  const name = (sql: string, id: unknown) => get<{ name: string }>(sql, id)?.name ?? String(id ?? '')
  let actual: unknown
  let label = ''
  switch (c.field) {
    case 'status':
      actual = ctx.statusName
      label = `Status ${c.op.replace('_', ' ')} “${c.value}”`
      break
    case 'priority':
      actual = t.priority
      label = `Priority ${c.op.replace('_', ' ')} ${c.value}`
      break
    case 'list':
      actual = t.list_id
      label = `List ${c.op.replace('_', ' ')} “${name('SELECT name FROM lists WHERE id = ?', c.value)}”`
      break
    case 'sprint':
      actual = t.sprint_id
      label = c.op === 'is_set' ? 'Task is in a sprint' : c.op === 'is_not_set' ? 'Task is not in a sprint' : `Sprint ${c.op.replace('_', ' ')} “${name('SELECT name FROM sprints WHERE id = ?', c.value)}”`
      break
    case 'title':
      actual = t.title
      label = `Title ${c.op.replace('_', ' ')} “${c.value ?? ''}”`
      break
    case 'due_date':
      actual = t.due_date
      label = c.op === 'is_set' ? 'Has a due date' : c.op === 'is_not_set' ? 'Has no due date' : `Due date ${c.op} ${c.value}`
      break
    case 'tag': {
      const has = t.tag_ids.includes(String(c.value))
      const tag = name('SELECT name FROM tags WHERE id = ?', c.value)
      return c.op === 'is_not' ? { pass: !has, label: `Doesn't have tag “${tag}”` } : { pass: has, label: `Has tag “${tag}”` }
    }
    case 'custom_field':
      actual = c.field_id ? t.fields[c.field_id] : undefined
      label = `${name('SELECT name FROM custom_fields WHERE id = ?', c.field_id)} ${c.op.replace('_', ' ')} ${c.value ?? ''}`
      break
  }
  const empty = actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0)
  let pass: boolean
  switch (c.op) {
    case 'is':
      pass = Array.isArray(actual) ? actual.includes(c.value) : eq(actual, c.value)
      break
    case 'is_not':
      pass = Array.isArray(actual) ? !actual.includes(c.value) : !eq(actual, c.value)
      break
    case 'contains':
      pass = String(actual ?? '').toLowerCase().includes(String(c.value ?? '').toLowerCase())
      break
    case 'not_contains':
      pass = !String(actual ?? '').toLowerCase().includes(String(c.value ?? '').toLowerCase())
      break
    case 'is_set':
      pass = !empty
      break
    case 'is_not_set':
      pass = empty
      break
    case 'gt':
      pass = !empty && (typeof actual === 'number' ? actual > Number(c.value) : String(actual) > String(c.value))
      break
    case 'lt':
      pass = !empty && (typeof actual === 'number' ? actual < Number(c.value) : String(actual) < String(c.value))
      break
  }
  return { pass, label }
}

// ---------------------------------------------------------------- actions

export function renderTemplate(text: string, ctx: Ctx): string {
  const t = ctx.task
  const vars: Record<string, string> = {
    'task.title': t?.title ?? '',
    'task.status': ctx.statusName,
    'task.priority': t?.priority ?? '',
    'task.due_date': t?.due_date ?? '',
    'task.list': ctx.listName,
    'date.today': localDate(),
    'email.from': ctx.email?.from ?? '',
    'email.from_name': ctx.email?.fromName ?? '',
    'email.to': ctx.email?.to ?? '',
    'email.subject': ctx.email?.subject ?? '',
    'email.snippet': ctx.email?.snippet ?? '',
    'event.title': ctx.event?.title ?? '',
    'event.start': ctx.event?.start.replace('T', ' ') ?? ''
  }
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m)
}

/**
 * Loop protection for emails sent by email-triggered rules (ADR-008): never answer
 * auto-replies, lists or robots, and email each recipient at most once per rule per day.
 * Returns the reason to skip, or null.
 */
function automatedSendBlocked(ctx: Ctx, to: string): string | null {
  const m = ctx.email
  if (!m) return null
  if (m.auto) return `Skipped: “${m.subject}” is an automated message (auto-reply, mailing list or robot)`
  if (ctx.ruleId && !fireOnce(`${ctx.ruleId}:send:${to.trim().toLowerCase()}:${localDate()}`)) return `Skipped: this rule already emailed ${to} today`
  return null
}

function executeAction(a: Action, ctx: Ctx, toasts: AppNotification[]): string {
  const t = ctx.task
  const need = (): Task => {
    if (!t) throw new Error(`“${a.type}” needs a task`)
    return t
  }
  const needEmail = (): EmailCtx => {
    if (!ctx.email) throw new Error(`“${a.type}” needs an email`)
    return ctx.email
  }
  switch (a.type) {
    case 'set_status': {
      const task = need()
      const status = get<{ id: string; name: string }>(
        'SELECT s.id, s.name FROM statuses s JOIN lists l ON l.space_id = s.space_id WHERE l.id = ? AND lower(s.name) = lower(?)',
        task.list_id,
        a.status
      )
      if (!status) throw new Error(`Status “${a.status}” doesn't exist in this task's space`)
      updateTask(task.id, { status_id: status.id })
      return `Set status to ${status.name}`
    }
    case 'set_priority':
      updateTask(need().id, { priority: a.priority })
      return `Set priority to ${a.priority}`
    case 'set_due_date': {
      const due = a.days_from_now === null ? null : addDays(localDate(), a.days_from_now)
      updateTask(need().id, { due_date: due })
      return due ? `Set due date to ${due}` : 'Cleared due date'
    }
    case 'add_tag': {
      const task = need()
      if (!task.tag_ids.includes(a.tag_id)) updateTask(task.id, { tag_ids: [...task.tag_ids, a.tag_id] })
      return `Added tag ${get<{ name: string }>('SELECT name FROM tags WHERE id = ?', a.tag_id)?.name ?? ''}`
    }
    case 'remove_tag': {
      const task = need()
      updateTask(task.id, { tag_ids: task.tag_ids.filter((x) => x !== a.tag_id) })
      return `Removed tag ${get<{ name: string }>('SELECT name FROM tags WHERE id = ?', a.tag_id)?.name ?? ''}`
    }
    case 'move_to_list': {
      const list = get<{ name: string }>('SELECT name FROM lists WHERE id = ?', a.list_id)
      if (!list) throw new Error('Target list no longer exists')
      updateTask(need().id, { list_id: a.list_id })
      return `Moved to ${list.name}`
    }
    case 'add_comment':
      addComment(need().id, renderTemplate(a.text, ctx), 'automation')
      return 'Added a comment'
    case 'create_subtask': {
      const task = need()
      const sub = createTask({ list_id: task.list_id, parent_id: task.id, title: renderTemplate(a.title, ctx) }, { source: 'automation' })
      return `Created subtask “${sub.title}”`
    }
    case 'add_checklist': {
      const cl = addChecklist(need().id, renderTemplate(a.name, ctx))
      for (const item of a.items.filter((x) => x.trim())) addChecklistItem(cl.id, renderTemplate(item, ctx))
      return `Added checklist “${cl.name}”`
    }
    case 'create_task': {
      if (!get('SELECT 1 FROM lists WHERE id = ?', a.list_id)) throw new Error('Target list no longer exists')
      const created = createTask(
        {
          list_id: a.list_id,
          title: renderTemplate(a.title, ctx),
          priority: a.priority,
          due_date: a.due_days === null || a.due_days === undefined ? null : addDays(localDate(), a.due_days)
        },
        { source: 'automation' }
      )
      return `Created task “${created.title}”`
    }
    case 'create_reminder': {
      const r = createReminder({
        task_id: t?.id ?? null,
        title: a.title ? renderTemplate(a.title, ctx) : undefined,
        remind_at: localDateTime(new Date(Date.now() + a.minutes_from_now * 60_000))
      })
      return `Created reminder for ${r.remind_at.replace('T', ' ')}`
    }
    case 'notify': {
      const n = addNotification({ kind: 'automation', title: renderTemplate(a.title, ctx), body: renderTemplate(a.body ?? '', ctx), task_id: t?.id ?? null })
      toasts.push(n)
      return `Sent notification “${n.title}”`
    }
    case 'set_custom_field': {
      const f = get<{ name: string }>('SELECT name FROM custom_fields WHERE id = ?', a.field_id)
      if (!f) throw new Error('Custom field no longer exists')
      updateTask(need().id, { fields: { [a.field_id]: a.value } })
      return `Set ${f.name}`
    }
    case 'send_email': {
      const to = renderTemplate(a.to, ctx)
      if (ctx.email) {
        const skip = automatedSendBlocked(ctx, to)
        if (skip) return skip
      }
      const accountId =
        a.account_id ?? ctx.email?.accountId ?? get<{ id: string }>("SELECT id FROM accounts WHERE kind = 'mail' AND enabled = 1 ORDER BY created_at LIMIT 1")?.id
      if (!accountId) throw new Error('No email account to send from')
      const o = queueEmail(
        { account_id: accountId, to, subject: renderTemplate(a.subject, ctx), body: renderTemplate(a.body, ctx) },
        { source: 'automation' }
      )
      return `Queued email to ${o.to}`
    }
    case 'create_task_from_email': {
      const m = needEmail()
      const created = createTaskFromThread(m.threadId, a.list_id, { source: 'automation' })
      return `Created task “${created.title}”`
    }
    case 'reply_to_email': {
      const m = needEmail()
      // our own email (a "no answer" follow-up): write to the people it went to, not to ourselves
      const to = isOurs(m.from, ourIdentity()) ? m.to : m.from
      if (!to) return 'Skipped: nobody to write to'
      const skip = automatedSendBlocked(ctx, to)
      if (skip) return skip
      const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`
      queueEmail({ account_id: m.accountId, to, subject, body: renderTemplate(a.body, ctx), reply_to: m.rowId }, { source: 'automation' })
      return `Queued reply to ${to}`
    }
    case 'start_sequence':
      throw new Error('Automatic follow-up sequences were removed in FollowUp 1.1 — remove this action')
    case 'mark_email_read':
      markThreadRead(needEmail().threadId, true)
      return 'Marked as read'
    case 'ai_prompt': {
      // AI calls are slow and can fail: run them as their own retried job after this commit
      enqueue('ai_prompt', { taskId: need().id, prompt: renderTemplate(a.prompt, ctx) }, { maxAttempts: 3 })
      return 'Asked the AI (the answer arrives as a comment)'
    }
    case 'post_message': {
      const i = get<{ name: string }>('SELECT name FROM integrations WHERE id = ?', a.integration_id)
      if (!i) throw new Error('The Slack / Teams integration was removed')
      postToIntegration(a.integration_id, { title: '', body: renderTemplate(a.text, ctx) })
      return `Posted to ${i.name}`
    }
  }
}

// ---------------------------------------------------------------- execution

interface Payload {
  ruleId: string
  taskId: string | null
  /** email-triggered rules */
  threadId?: string | null
  messageId?: string | null
  /** event-triggered rules */
  event?: { title: string; start: string } | null
  trigger: string
  depth: number
  /** run even if the rule is disabled (manual "Run now") */
  manual?: boolean
}

function runRule(job: Job<Payload>): void {
  const { ruleId, taskId, trigger, depth, manual, messageId, event } = job.payload
  const rule = getAutomation(ruleId)
  if (!rule || (!rule.enabled && !manual)) return
  if (depth >= MAX_CHAIN_DEPTH) {
    recordRun(rule.id, 'skipped', taskId, trigger, [`Stopped: ${MAX_CHAIN_DEPTH} automations already ran in a chain (loop protection)`])
    return
  }
  const task = taskId ? getTask(taskId) : null
  if (taskId && !task) return // task deleted meanwhile
  const email = emailContext(messageId)
  if (messageId && !email) return // email deleted meanwhile
  const ctx = context(task, { email, event: event ?? null })

  const checks = rule.conditions.map((c) => evalCondition(c, ctx))
  const failed = checks.find((c) => !c.pass)
  if (failed) {
    recordRun(rule.id, 'skipped', taskId, trigger, [`Condition not met: ${failed.label}`])
    return
  }

  const toasts: AppNotification[] = []
  const detail = tx(() =>
    withDepth(depth + 1, () => {
      const lines: string[] = []
      for (const a of rule.actions) {
        // refresh the task between actions so later ones see earlier changes
        const fresh = taskId ? getTask(taskId) : null
        lines.push(executeAction(a, context(fresh, { email, event: event ?? null, ruleId: rule.id }), toasts))
      }
      return lines
    })
  )
  run('UPDATE automations SET run_count = run_count + 1, last_run_at = ? WHERE id = ?', now(), rule.id)
  if (taskId) run("INSERT INTO activity_log (id, entity_type, entity_id, action, detail) VALUES (?, 'task', ?, 'automation', ?)", uuid(), taskId, rule.name)
  recordRun(rule.id, 'success', taskId, trigger, email ? [`Email: “${email.subject}” from ${email.from}`, ...detail] : detail)
  toasts.forEach(deliverNotification)
}

registerJobHandler<Payload>('automation', runRule, (job, error) => {
  if (get('SELECT 1 FROM automations WHERE id = ?', job.payload.ruleId))
    recordRun(job.payload.ruleId, 'failed', job.payload.taskId, job.payload.trigger, [], error)
})

onEvent(handleEvent)

/** Latest inbound message of a thread (email rules act on it). */
const lastInbound = (threadId: string) =>
  get<{ id: string }>('SELECT id FROM mail_messages WHERE thread_id = ? AND is_outbound = 0 ORDER BY date DESC LIMIT 1', threadId)?.id ??
  get<{ id: string }>('SELECT id FROM mail_messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1', threadId)?.id ??
  null

/**
 * Queue a rule to run right now. `targetId` is a task id for task rules, an email
 * thread id for email rules, and ignored for schedule / event rules.
 */
export function runAutomationNow(id: string, targetId: string | null): void {
  const rule = getAutomation(id)
  if (!rule) throw new Error('Automation not found')
  const kind = TRIGGER_CONTEXT[rule.trigger.type]
  if (kind !== 'none' && !targetId) throw new Error(kind === 'task' ? 'Pick a task to run this automation on' : 'Pick an email to run this automation on')
  const payload: Payload =
    kind === 'email'
      ? { ruleId: id, taskId: null, threadId: targetId, messageId: lastInbound(targetId!), trigger: 'run manually', depth: 0, manual: true }
      : { ruleId: id, taskId: kind === 'task' ? targetId : null, trigger: 'run manually', depth: 0, manual: true }
  enqueue('automation', payload, { maxAttempts: 1 })
}

/** Dry run against a task (task rules) or an email thread (email rules), without changing anything. */
export function testAutomation(input: AutomationInput, targetId: string | null): TestResult {
  const checks: TestResult['checks'] = []
  const kind = TRIGGER_CONTEXT[input.trigger.type]
  if (targetId && kind === 'task') {
    const task = getTask(targetId)
    if (!task) throw new Error('Task not found')
    if (input.scope) checks.push({ label: 'Task is inside the automation’s location', pass: inScope(input.scope, targetId) })
    const ctx = context(task)
    for (const c of input.conditions) checks.push(evalCondition(c, ctx))
  } else if (targetId && kind === 'email') {
    const ctx = context(null, { email: emailContext(lastInbound(targetId)) })
    if (!ctx.email) throw new Error('Email not found')
    for (const c of input.conditions) checks.push(evalCondition(c, ctx))
  }
  try {
    validateAutomation({ ...input, name: input.name || 'test' })
    checks.push({ label: `${input.actions.length} action(s) ready to run`, pass: true })
  } catch (e) {
    checks.push({ label: (e as Error).message, pass: false })
  }
  return { matches: checks.every((c) => c.pass), checks }
}

// ---------------------------------------------------------------- time-based triggers

const hm = (d: Date) => localDateTime(d).slice(11, 16)

function scheduleDue(t: Extract<Trigger, { type: 'schedule' }>, at: Date, createdAt: string): boolean {
  const today = localDate(at)
  if (hm(at) < t.at) return false
  // don't fire for a moment that passed before the rule existed
  if (parseLocal(`${today}T${t.at}`).getTime() < Date.parse(createdAt)) return false
  const wd = at.getDay()
  switch (t.every) {
    case 'day':
      return true
    case 'weekday':
      return wd >= 1 && wd <= 5
    case 'week':
      return wd === (t.weekday ?? 1)
    case 'month': {
      const last = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate()
      return at.getDate() === Math.min(t.monthday ?? 1, last)
    }
  }
}

/** Check due-date, overdue and schedule triggers; queue jobs for whatever fires. Returns how many. */
export function automationTick(at: Date = new Date()): number {
  const rules = all<Row>(`SELECT ${COLS} FROM automations WHERE enabled = 1`)
    .map(toAutomation)
    .filter((r) => ['due_date_arrives', 'task_overdue', 'schedule', 'email_no_reply', 'email_needs_follow_up', 'event_starts'].includes(r.trigger.type))
  if (!rules.length) return 0
  const today = localDate(at)
  let queued = 0
  return tx(() => {
    const open = rules.some((r) => r.trigger.type === 'due_date_arrives' || r.trigger.type === 'task_overdue')
      ? all<{ id: string; due_date: string }>(
          `SELECT t.id, t.due_date FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE s.type <> 'done' AND t.due_date IS NOT NULL`
        )
      : []
    for (const rule of rules) {
      const t = rule.trigger
      const fire = (taskId: string | null, key: string) => {
        if (taskId && !inScope(rule.scope, taskId)) return
        if (!fireOnce(`${rule.id}:${key}`)) return
        enqueue('automation', { ruleId: rule.id, taskId, trigger: triggerLabel(t), depth: 0 } satisfies Payload)
        queued++
      }
      if (t.type === 'schedule') {
        if (scheduleDue(t, at, rule.created_at)) fire(null, `schedule:${today}`)
        continue
      }
      if (t.type === 'email_no_reply') {
        // our latest email in a thread, older than N days (but not ancient), with nothing after it
        const cutoff = new Date(at.getTime() - t.days * 86_400_000).toISOString()
        const floor = new Date(Math.max(Date.parse(rule.created_at) - t.days * 86_400_000, at.getTime() - (t.days + 14) * 86_400_000)).toISOString()
        const waiting = all<{ id: string; thread_id: string }>(
          `SELECT m.id, m.thread_id FROM mail_messages m
           WHERE m.is_outbound = 1 AND m.date <= ? AND m.date >= ?
             AND m.date = (SELECT MAX(x.date) FROM mail_messages x WHERE x.thread_id = m.thread_id)`,
          cutoff,
          floor
        )
        for (const m of waiting) {
          if (!fireOnce(`${rule.id}:noreply:${m.id}`)) continue
          enqueue('automation', { ruleId: rule.id, taskId: null, threadId: m.thread_id, messageId: m.id, trigger: `no reply in ${t.days} days`, depth: 0 } satisfies Payload)
          queued++
        }
        continue
      }
      if (t.type === 'email_needs_follow_up') {
        // conversations that just became due in Follow-up (once per waiting message)
        const iso = at.toISOString()
        const due = all<{ thread_id: string; anchor: string; kind: string }>(
          `SELECT th.id thread_id, th.followup_anchor anchor, th.followup_kind kind FROM mail_threads th
           WHERE ${DUE_SQL} AND th.followup_due_at >= ?${t.kind ? ' AND th.followup_kind = ?' : ''}`,
          iso,
          iso,
          // don't fire for everything that was already waiting when the rule was made
          rule.created_at,
          ...(t.kind ? [t.kind] : [])
        )
        for (const d of due) {
          if (!fireOnce(`${rule.id}:followup:${d.anchor}`)) continue
          const label = d.kind === 'reply' ? 'email needs your reply' : 'no answer to your email'
          enqueue('automation', { ruleId: rule.id, taskId: null, threadId: d.thread_id, messageId: d.anchor, trigger: label, depth: 0 } satisfies Payload)
          queued++
        }
        continue
      }
      if (t.type === 'event_starts') {
        const soon = listEvents(today, addDays(today, 2)).filter((e) => !e.all_day)
        for (const e of soon) {
          const start = parseLocal(e.start).getTime()
          const target = start - t.minutes_before * 60_000
          if (at.getTime() >= target && at.getTime() < start && fireOnce(`${rule.id}:event:${e.id}`)) {
            enqueue('automation', { ruleId: rule.id, taskId: e.task_id, event: { title: e.title, start: e.start }, trigger: `event starts in ${t.minutes_before} min`, depth: 0 } satisfies Payload)
            queued++
          }
        }
        continue
      }
      for (const task of open) {
        if (t.type === 'due_date_arrives') {
          const before = t.days_before ?? 0
          if (hasTime(task.due_date)) {
            const target = parseLocal(task.due_date).getTime() - before * 86_400_000
            if (at.getTime() >= target && at.getTime() - target < 12 * 3600_000) fire(task.id, `due:${task.id}:${task.due_date}`)
          } else if (addDays(task.due_date, -before) === today) {
            fire(task.id, `due:${task.id}:${task.due_date}`)
          }
        } else if (t.type === 'task_overdue') {
          const overdue = hasTime(task.due_date) ? parseLocal(task.due_date).getTime() < at.getTime() : task.due_date < today
          if (overdue) fire(task.id, `overdue:${task.id}:${task.due_date}`)
        }
      }
    }
    return queued
  })
}
