import type { Action, Condition, Trigger } from '@shared/automation'
import type { CustomField, Location, Tag } from '@shared/types'
import type { Account, Sequence } from '@shared/mail'
import type { Integration } from '@shared/integrations'
import { EMAIL_CATEGORY_LABEL, type EmailCategory } from '@shared/ai'
import type { TreeMaps } from '@/lib/hooks'
import { PRIORITY_META } from '@/lib/utils'

export interface Names {
  maps: TreeMaps
  tags: Tag[]
  fields: CustomField[]
  accounts?: Account[]
  sequences?: Sequence[]
  integrations?: Integration[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const listName = (n: Names, id?: string | null) => (id ? (n.maps.list.get(id)?.name ?? 'a deleted list') : '')
const tagName = (n: Names, id?: string | null) => (id ? (n.tags.find((t) => t.id === id)?.name ?? 'a deleted tag') : '')
const fieldName = (n: Names, id?: string | null) => n.fields.find((f) => f.id === id)?.name ?? 'a field'

export const TRIGGER_LABELS: Record<Trigger['type'], string> = {
  task_created: 'A task is created',
  status_changed: 'Status changes',
  priority_changed: 'Priority changes',
  task_moved: 'A task is moved to a list',
  tag_added: 'A tag is added',
  comment_added: 'A comment is added',
  checklist_completed: 'A checklist is completed',
  due_date_arrives: 'Due date arrives',
  task_overdue: 'A task becomes overdue',
  time_over_estimate: 'Tracked time exceeds the estimate',
  schedule: 'On a schedule',
  email_received: 'An email arrives',
  email_no_reply: 'A sent email gets no reply',
  event_starts: 'A calendar event is about to start',
  email_triaged: 'AI classifies a new email'
}

export const ACTION_LABELS: Record<Action['type'], string> = {
  set_status: 'Change status',
  set_priority: 'Change priority',
  set_due_date: 'Set due date',
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  move_to_list: 'Move to list',
  add_comment: 'Add comment',
  create_subtask: 'Create subtask',
  add_checklist: 'Add checklist',
  create_task: 'Create task',
  create_reminder: 'Create reminder',
  notify: 'Send me a notification',
  set_custom_field: 'Set custom field',
  send_email: 'Send an email',
  create_task_from_email: 'Create task from the email',
  reply_to_email: 'Reply to the email',
  start_sequence: 'Start a follow-up sequence',
  mark_email_read: 'Mark the email as read',
  ai_prompt: 'Ask AI (answer as comment)',
  post_message: 'Post to Slack / Teams'
}

export function describeTrigger(t: Trigger, n: Names): string {
  switch (t.type) {
    case 'status_changed':
      return `Status changes${t.from ? ` from ${t.from}` : ''}${t.to ? ` to ${t.to}` : ''}`
    case 'priority_changed':
      return `Priority changes${t.to ? ` to ${PRIORITY_META[t.to].label}` : ''}`
    case 'task_moved':
      return t.to_list_id ? `A task is moved to ${listName(n, t.to_list_id)}` : 'A task is moved'
    case 'tag_added':
      return t.tag_id ? `Tag “${tagName(n, t.tag_id)}” is added` : 'A tag is added'
    case 'due_date_arrives': {
      const d = t.days_before ?? 0
      return d === 0 ? 'A task is due' : `${d} day${d === 1 ? '' : 's'} before a task is due`
    }
    case 'schedule': {
      const when =
        t.every === 'day' ? 'Every day' : t.every === 'weekday' ? 'Every weekday' : t.every === 'week' ? `Every ${WEEKDAYS[t.weekday ?? 1]}` : `Monthly on day ${t.monthday ?? 1}`
      return `${when} at ${t.at}`
    }
    case 'email_received':
      return t.account_id ? `An email arrives in ${n.accounts?.find((a) => a.id === t.account_id)?.email ?? 'a removed account'}` : 'An email arrives'
    case 'email_no_reply':
      return `No reply ${t.days} day${t.days === 1 ? '' : 's'} after I send an email`
    case 'event_starts':
      return `${t.minutes_before} minutes before a calendar event`
    case 'email_triaged':
      return t.category ? `AI sorts a new email as “${EMAIL_CATEGORY_LABEL[t.category as EmailCategory] ?? t.category}”` : 'AI sorts a new email'
    default:
      return TRIGGER_LABELS[t.type]
  }
}

export function describeScope(scope: Location | null, n: Names): string {
  if (!scope) return 'anywhere'
  const name =
    scope.kind === 'space'
      ? n.maps.space.get(scope.id)?.name
      : scope.kind === 'folder'
        ? n.maps.folder.get(scope.id)?.name
        : scope.kind === 'sprint'
          ? n.maps.sprint.get(scope.id)?.name
          : n.maps.list.get(scope.id)?.name
  return `in ${name ?? 'a deleted location'}`
}

export function describeCondition(c: Condition, n: Names): string {
  const neg = c.op === 'is_not' || c.op === 'not_contains'
  switch (c.field) {
    case 'status':
      return `status ${neg ? 'is not' : 'is'} ${c.value}`
    case 'priority':
      return `priority ${neg ? 'is not' : 'is'} ${PRIORITY_META[c.value as keyof typeof PRIORITY_META]?.label ?? c.value}`
    case 'list':
      return `list ${neg ? 'is not' : 'is'} ${listName(n, c.value as string)}`
    case 'tag':
      return `${neg ? 'does not have' : 'has'} tag “${tagName(n, c.value as string)}”`
    case 'title':
      return `title ${c.op.replace('_', ' ')} “${c.value}”`
    case 'due_date':
      return c.op === 'is_set' ? 'has a due date' : 'has no due date'
    case 'sprint':
      return c.op === 'is_set' ? 'is in a sprint' : 'is not in a sprint'
    case 'custom_field':
      return `${fieldName(n, c.field_id)} ${c.op.replace(/_/g, ' ')}${c.value !== undefined && c.value !== '' ? ` ${c.value}` : ''}`
    case 'email_from':
    case 'email_to':
    case 'email_subject':
    case 'email_body':
      return `${c.field.replace('email_', '')} ${c.op.replace(/_/g, ' ')} “${c.value ?? ''}”`
  }
}

export function describeAction(a: Action, n: Names): string {
  switch (a.type) {
    case 'set_status':
      return `Set status to ${a.status}`
    case 'set_priority':
      return `Set priority to ${PRIORITY_META[a.priority].label}`
    case 'set_due_date':
      return a.days_from_now === null ? 'Clear the due date' : a.days_from_now === 0 ? 'Set due date to today' : `Set due date ${a.days_from_now} days out`
    case 'add_tag':
      return `Add tag “${tagName(n, a.tag_id)}”`
    case 'remove_tag':
      return `Remove tag “${tagName(n, a.tag_id)}”`
    case 'move_to_list':
      return `Move to ${listName(n, a.list_id)}`
    case 'add_comment':
      return `Comment “${a.text.slice(0, 40)}${a.text.length > 40 ? '…' : ''}”`
    case 'create_subtask':
      return `Create subtask “${a.title}”`
    case 'add_checklist':
      return `Add checklist “${a.name}” (${a.items.filter(Boolean).length} items)`
    case 'create_task':
      return `Create “${a.title}” in ${listName(n, a.list_id)}`
    case 'create_reminder':
      return `Remind me in ${a.minutes_from_now >= 60 ? `${a.minutes_from_now / 60}h` : `${a.minutes_from_now}m`}`
    case 'notify':
      return `Notify me: “${a.title}”`
    case 'set_custom_field':
      return `Set ${fieldName(n, a.field_id)}`
    case 'send_email':
      return `Email ${a.to}: “${a.subject}”`
    case 'create_task_from_email':
      return `Create a task in ${listName(n, a.list_id)}`
    case 'reply_to_email':
      return `Reply “${a.body.slice(0, 30)}${a.body.length > 30 ? '…' : ''}”`
    case 'start_sequence':
      return `Start follow-up “${n.sequences?.find((s) => s.id === a.sequence_id)?.name ?? 'a deleted sequence'}”`
    case 'mark_email_read':
      return 'Mark as read'
    case 'ai_prompt':
      return `Ask AI: “${a.prompt.slice(0, 40)}${a.prompt.length > 40 ? '…' : ''}”`
    case 'post_message':
      return `Post to ${n.integrations?.find((i) => i.id === a.integration_id)?.name ?? 'Slack / Teams'}: “${a.text.slice(0, 30)}${a.text.length > 30 ? '…' : ''}”`
  }
}
