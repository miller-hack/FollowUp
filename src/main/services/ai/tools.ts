import { z } from 'zod'
import { addDays, localDate } from '@shared/dates'
import type { Priority } from '@shared/types'
import { get } from '../../db'
import { getTree } from '../hierarchy'
import { addComment, createTask, getMyWork, getTask, queryTasks, updateTask } from '../tasks'
import { listTimeEntries } from '../time'
import { listGoals } from '../planning'
import { createEvent, listCalendars, listEvents } from '../calendar'
import { createReminder } from '../notify'
import { getThread, listThreads } from '../mail/store'
import { enrollThread, listSequences } from '../mail/sequences'
import type { ToolSpec } from './providers'

/** UI-side effects requested by tools (e.g. open a compose window). */
let uiAction: (a: { type: 'compose'; to: string; subject: string; body: string; reply_to: string | null; account_id: string | null }) => void = () => {}
export function setToolUiHandler(fn: typeof uiAction): void {
  uiAction = fn
}

// ---------------------------------------------------------------- tiny schema DSL (JSON Schema for the model + zod for validation)

interface Field {
  json: Record<string, unknown>
  zod: z.ZodTypeAny
  optional: boolean
}
const str = (description: string): Field => ({ json: { type: 'string', description }, zod: z.string(), optional: false })
const num = (description: string): Field => ({ json: { type: 'integer', description }, zod: z.number().int(), optional: false })
const bool = (description: string): Field => ({ json: { type: 'boolean', description }, zod: z.boolean(), optional: false })
const oneOf = <T extends string>(values: readonly [T, ...T[]], description: string): Field => ({
  json: { type: 'string', enum: values, description },
  zod: z.enum(values),
  optional: false
})
const opt = (f: Field): Field => ({ ...f, zod: f.zod.optional().nullable(), optional: true })

function object(props: Record<string, Field>) {
  const required = Object.entries(props).filter(([, f]) => !f.optional).map(([k]) => k)
  return {
    json: { type: 'object', properties: Object.fromEntries(Object.entries(props).map(([k, f]) => [k, f.json])), required, additionalProperties: false },
    zod: z.object(Object.fromEntries(Object.entries(props).map(([k, f]) => [k, f.zod]))).strict()
  }
}

const PRIORITIES = ['urgent', 'high', 'normal', 'low', 'none'] as const
const DATE = 'Date as YYYY-MM-DD, or YYYY-MM-DDTHH:mm for a specific local time'

// ---------------------------------------------------------------- helpers

const clip = (s: string, n = 2500) => (s.length > n ? `${s.slice(0, n)}…` : s)
const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

function names() {
  const tree = getTree()
  const lists = new Map(tree.lists.map((l) => [l.id, l]))
  const statuses = new Map(tree.statuses.map((s) => [s.id, s]))
  return { tree, lists, statuses }
}

type Names = ReturnType<typeof names>

/** One-line view of a task; pass `n` from a single `names()` call (it reads the whole tree). */
function taskLine(t: { id: string; title: string; status_id: string; priority: string; due_date: string | null; list_id: string }, n: Names = names()) {
  const { lists, statuses } = n
  return { id: t.id, title: t.title, status: statuses.get(t.status_id)?.name, priority: t.priority, due: t.due_date, list: lists.get(t.list_id)?.name }
}

function listName(id: string): string {
  return get<{ name: string }>('SELECT name FROM lists WHERE id = ?', id)?.name ?? 'an unknown list'
}

// ---------------------------------------------------------------- tool table

export interface AssistantTool extends ToolSpec {
  /** write actions pause for the user's approval */
  needsApproval: boolean
  validate: (input: unknown) => { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
  run: (input: Record<string, unknown>) => unknown
  summarize: (input: Record<string, unknown>) => string
}

function tool(
  name: string,
  description: string,
  props: Record<string, Field>,
  needsApproval: boolean,
  run: (input: Record<string, unknown>) => unknown,
  summarize: (input: Record<string, unknown>) => string
): AssistantTool {
  const schema = object(props)
  return {
    name,
    description,
    jsonSchema: schema.json,
    needsApproval,
    run,
    summarize,
    validate: (input) => {
      const r = schema.zod.safeParse(input)
      return r.success ? { ok: true, data: r.data as Record<string, unknown> } : { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
    }
  }
}

export const TOOLS: AssistantTool[] = [
  // ---------------- read
  tool(
    'list_workspace',
    'List spaces, folders and lists (with ids) and the status names of each space. Call this before creating tasks to find the right list id.',
    {},
    false,
    () => {
      const { tree } = names()
      return tree.spaces.map((s) => ({
        space: s.name,
        statuses: tree.statuses.filter((x) => x.space_id === s.id).map((x) => x.name),
        lists: tree.lists
          .filter((l) => l.space_id === s.id)
          .map((l) => ({ id: l.id, name: l.name, folder: tree.folders.find((f) => f.id === l.folder_id)?.name ?? null }))
      }))
    },
    () => 'Look at your spaces and lists'
  ),
  tool(
    'search_tasks',
    'Find tasks. All filters are optional; without filters returns open tasks ordered by position. Returns up to `limit` tasks (default 25).',
    {
      query: opt(str('Words to search in task titles and descriptions')),
      list_id: opt(str('Only tasks in this list')),
      due: opt(oneOf(['overdue', 'today', 'week', 'none'], 'Due date filter')),
      include_done: opt(bool('Include completed tasks')),
      limit: opt(num('Max results (1-100)'))
    },
    false,
    (i) => {
      const tasks = queryTasks({
        search: (i.query as string) || undefined,
        location: i.list_id ? { kind: 'list', id: i.list_id as string } : undefined,
        due: (i.due as 'overdue') ?? null,
        includeClosed: !!i.include_done
      })
      const n = names()
      return tasks.slice(0, Math.min(100, Math.max(1, (i.limit as number) ?? 25))).map((t) => taskLine(t, n))
    },
    (i) => `Search tasks${i.query ? ` for “${i.query}”` : ''}`
  ),
  tool(
    'get_task',
    'Full details of one task: description, subtasks, checklists, comments, linked emails, time tracked.',
    { task_id: str('Task id') },
    false,
    (i) => {
      const t = getTask(i.task_id as string)
      if (!t) throw new Error('Task not found')
      const n = names()
      return {
        ...taskLine(t, n),
        start: t.start_date,
        description: clip(strip(t.description), 3000),
        estimate_min: t.time_estimate_min,
        time_spent_min: t.time_spent_min,
        subtasks: t.subtasks.map((s) => taskLine(s, n)),
        checklists: t.checklists.map((c) => ({ name: c.name, items: c.items.map((x) => `${x.done ? '[x]' : '[ ]'} ${x.text}`) })),
        comments: t.comments.slice(-10).map((c) => ({ by: c.author, at: c.created_at, text: clip(c.body, 800) })),
        emails: t.emails.map((e) => ({ thread_id: e.id, subject: e.subject }))
      }
    },
    () => 'Read a task'
  ),
  tool(
    'my_work',
    "The user's overdue tasks, tasks due today and in the next 7 days.",
    {},
    false,
    () => {
      const w = getMyWork()
      const n = names()
      return { today: localDate(), overdue: w.overdue.map((t) => taskLine(t, n)), due_today: w.today.map((t) => taskLine(t, n)), next_7_days: w.upcoming.map((t) => taskLine(t, n)) }
    },
    () => 'Check what is due'
  ),
  tool(
    'search_emails',
    'Search synced email threads (subject, sender, body). Empty query returns the latest inbox threads.',
    { query: opt(str('Search words')), limit: opt(num('Max results (default 15)')) },
    false,
    (i) =>
      listThreads({ folder: i.query ? 'all' : 'inbox', search: (i.query as string) || undefined, limit: Math.min(50, (i.limit as number) ?? 15) }).map((t) => ({
        thread_id: t.id,
        subject: t.subject,
        with: t.participants.filter((p) => p.name !== 'me').map((p) => p.address),
        last_message_at: t.last_message_at,
        unread: t.unread_count > 0,
        snippet: t.snippet
      })),
    (i) => `Search email${i.query ? ` for “${i.query}”` : ''}`
  ),
  tool(
    'get_email_thread',
    'Read the messages of an email thread.',
    { thread_id: str('Thread id') },
    false,
    (i) => {
      const t = getThread(i.thread_id as string)
      if (!t) throw new Error('Thread not found')
      return {
        subject: t.subject,
        messages: t.messages.slice(-8).map((m) => ({
          from: `${m.from.name} <${m.from.address}>`,
          to: m.to.map((x) => x.address),
          date: m.date,
          sent_by_user: m.is_outbound,
          text: clip(m.body_text, 3000)
        }))
      }
    },
    () => 'Read an email thread'
  ),
  tool(
    'list_events',
    'Calendar events between two dates (inclusive start, exclusive end).',
    { from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD') },
    false,
    (i) => listEvents(i.from as string, i.to as string).map((e) => ({ title: e.title, start: e.start, end: e.end, all_day: e.all_day, location: e.location })),
    (i) => `Check your calendar ${i.from}–${i.to}`
  ),
  tool(
    'time_report',
    'Time tracked between two dates, per task, in minutes.',
    { from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD (exclusive)') },
    false,
    (i) => {
      const entries = listTimeEntries({ from: new Date(`${i.from}T00:00`).toISOString(), to: new Date(`${i.to}T00:00`).toISOString() })
      const per = new Map<string, number>()
      for (const e of entries) per.set(e.task_title, (per.get(e.task_title) ?? 0) + Math.round((e.duration_sec ?? 0) / 60))
      return { total_min: [...per.values()].reduce((a, b) => a + b, 0), by_task: [...per].map(([task, minutes]) => ({ task, minutes })) }
    },
    () => 'Look at tracked time'
  ),
  tool(
    'list_goals',
    'Goals with key results and progress (0-1).',
    {},
    false,
    () => listGoals().map((g) => ({ goal: g.name, due: g.due_date, progress: Math.round(g.progress * 100) / 100, key_results: g.key_results.map((k) => ({ name: k.name, progress: k.progress })) })),
    () => 'Check your goals'
  ),
  tool(
    'list_follow_up_sequences',
    'Email follow-up sequences the user has set up (ids and names).',
    {},
    false,
    () => listSequences().map((s) => ({ id: s.id, name: s.name, emails: s.steps.length })),
    () => 'Look at follow-up sequences'
  ),

  // ---------------- write (approval)
  tool(
    'create_task',
    'Create a task (or a subtask when parent_task_id is given). Use list_workspace first to get a list id.',
    {
      list_id: str('List id'),
      title: str('Task title'),
      description: opt(str('Plain-text description')),
      due_date: opt(str(DATE)),
      priority: opt(oneOf(PRIORITIES, 'Priority')),
      parent_task_id: opt(str('Make it a subtask of this task'))
    },
    true,
    (i) => {
      const desc = i.description ? `<p>${String(i.description).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>` : ''
      const t = createTask(
        {
          list_id: i.list_id as string,
          title: i.title as string,
          description: desc,
          due_date: (i.due_date as string) ?? null,
          priority: (i.priority as Priority) ?? 'none',
          parent_id: (i.parent_task_id as string) ?? null
        },
        { source: 'ai' }
      )
      return { created_task_id: t.id }
    },
    (i) => `Create task “${i.title}” in ${listName(i.list_id as string)}${i.due_date ? `, due ${i.due_date}` : ''}${i.priority && i.priority !== 'none' ? `, ${i.priority} priority` : ''}`
  ),
  tool(
    'update_task',
    'Change a task. Only the given fields change. status is a status name of the task\'s space (see list_workspace). Use an empty string for due_date to clear it.',
    {
      task_id: str('Task id'),
      title: opt(str('New title')),
      status: opt(str('Status name, e.g. "Done"')),
      priority: opt(oneOf(PRIORITIES, 'Priority')),
      due_date: opt(str(`${DATE}; empty string clears it`))
    },
    true,
    (i) => {
      const t = getTask(i.task_id as string)
      if (!t) throw new Error('Task not found')
      const patch: Record<string, unknown> = {}
      if (i.title) patch.title = i.title
      if (i.priority) patch.priority = i.priority
      if (typeof i.due_date === 'string') patch.due_date = i.due_date || null
      if (i.status) {
        const s = get<{ id: string }>(
          'SELECT s.id FROM statuses s JOIN lists l ON l.space_id = s.space_id WHERE l.id = ? AND lower(s.name) = lower(?)',
          t.list_id,
          i.status
        )
        if (!s) throw new Error(`No status named “${i.status}” in this task's space`)
        patch.status_id = s.id
      }
      updateTask(t.id, patch)
      return { updated: true }
    },
    (i) => {
      const t = get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', i.task_id)
      const parts = [i.title && `rename to “${i.title}”`, i.status && `status → ${i.status}`, i.priority && `priority → ${i.priority}`, typeof i.due_date === 'string' && (i.due_date ? `due → ${i.due_date}` : 'clear due date')].filter(Boolean)
      return `Update “${t?.title ?? 'task'}”: ${parts.join(', ') || 'no changes'}`
    }
  ),
  tool(
    'add_comment',
    'Add a comment to a task.',
    { task_id: str('Task id'), text: str('Comment text') },
    true,
    (i) => {
      addComment(i.task_id as string, i.text as string, 'ai')
      return { added: true }
    },
    (i) => `Comment on “${get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', i.task_id)?.title ?? 'task'}”: “${clip(String(i.text), 120)}”`
  ),
  tool(
    'create_event',
    'Add an event to the calendar.',
    {
      title: str('Event title'),
      start: str(DATE),
      end: str(DATE),
      all_day: opt(bool('All-day event (dates without times)')),
      location: opt(str('Location')),
      task_id: opt(str('Link the event to this task'))
    },
    true,
    (i) => {
      const cal = listCalendars().find((c) => c.enabled && !c.read_only)
      if (!cal) throw new Error('No writable calendar')
      const e = createEvent({
        calendar_id: cal.id,
        title: i.title as string,
        start: i.start as string,
        end: i.end as string,
        all_day: !!i.all_day,
        location: (i.location as string) ?? '',
        task_id: (i.task_id as string) ?? null
      })
      return { created_event_id: e.event_id, calendar: cal.name }
    },
    (i) => `Add “${i.title}” to your calendar, ${String(i.start).replace('T', ' ')} – ${String(i.end).replace('T', ' ')}`
  ),
  tool(
    'create_reminder',
    'Set a reminder notification.',
    { title: str('What to remind about'), remind_at: str('YYYY-MM-DDTHH:mm local time'), task_id: opt(str('Related task id')) },
    true,
    (i) => {
      const r = createReminder({ title: i.title as string, remind_at: i.remind_at as string, task_id: (i.task_id as string) ?? null })
      return { reminder_id: r.id }
    },
    (i) => `Remind you “${i.title}” at ${String(i.remind_at).replace('T', ' ')}`
  ),
  tool(
    'start_follow_up',
    'Start an automatic follow-up sequence on an email thread (sends reminder emails until someone replies).',
    { thread_id: str('Email thread id'), sequence_id: str('Sequence id from list_follow_up_sequences') },
    true,
    (i) => {
      const e = enrollThread(i.thread_id as string, i.sequence_id as string)
      return { started: e.sequence_name, next_email_at: e.next_run_at }
    },
    (i) => {
      const th = get<{ subject: string }>('SELECT subject FROM mail_threads WHERE id = ?', i.thread_id)
      const s = get<{ name: string }>('SELECT name FROM sequences WHERE id = ?', i.sequence_id)
      return `Start follow-up “${s?.name ?? '?'}” on “${th?.subject ?? 'email'}” (sends emails automatically)`
    }
  ),

  // ---------------- UI (the user reviews before anything is sent)
  tool(
    'draft_email',
    'Open a draft email for the user to review and send. Nothing is sent automatically. For replies pass reply_to_thread_id.',
    {
      to: str('Recipient address(es), comma separated'),
      subject: str('Subject'),
      body: str('Plain-text body'),
      reply_to_thread_id: opt(str('Thread id when replying'))
    },
    false,
    (i) => {
      let replyTo: string | null = null
      let accountId: string | null = null
      if (i.reply_to_thread_id) {
        const last = get<{ id: string; account_id: string }>(
          'SELECT id, account_id FROM mail_messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1',
          i.reply_to_thread_id
        )
        replyTo = last?.id ?? null
        accountId = last?.account_id ?? null
      }
      uiAction({ type: 'compose', to: i.to as string, subject: i.subject as string, body: i.body as string, reply_to: replyTo, account_id: accountId })
      return { status: 'Draft opened for the user to review and send.' }
    },
    (i) => `Draft an email to ${i.to}: “${i.subject}”`
  )
]

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/** Context line prepended to each user message (keeps the system prompt frozen). */
export function nowContext(): string {
  const d = new Date()
  const day = d.toLocaleDateString('en-US', { weekday: 'long' })
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `<context>Now: ${day} ${localDate(d)} ${time} (local time). Tomorrow is ${addDays(localDate(d), 1)}.</context>`
}
