import type { Location, Priority } from './types'

// ---------------------------------------------------------------- triggers

export type Trigger =
  | { type: 'task_created' }
  /** `from` / `to` are status names (case-insensitive) so a rule works across spaces */
  | { type: 'status_changed'; from?: string | null; to?: string | null }
  | { type: 'priority_changed'; to?: Priority | null }
  | { type: 'task_moved'; to_list_id?: string | null }
  | { type: 'tag_added'; tag_id?: string | null }
  | { type: 'comment_added' }
  | { type: 'checklist_completed' }
  /** fires once per task when its due date is `days_before` days away (0 = on the day / at the time) */
  | { type: 'due_date_arrives'; days_before?: number }
  | { type: 'task_overdue' }
  | { type: 'time_over_estimate' }
  /** time-based, not tied to a task */
  | { type: 'schedule'; every: 'day' | 'weekday' | 'week' | 'month'; at: string; weekday?: number; monthday?: number }
  /** new inbound email (after the first sync of an account) */
  | { type: 'email_received'; account_id?: string | null }
  /** an email you sent got no reply within `days` (fires once per sent email) */
  | { type: 'email_no_reply'; days: number }
  /** a conversation enters Follow-up: they're waiting for our reply, or we're waiting for theirs (ADR-015) */
  | { type: 'email_needs_follow_up'; kind?: 'reply' | 'nudge' | null }
  /** a calendar event starts in `minutes_before` minutes */
  | { type: 'event_starts'; minutes_before: number }
  /** AI triage classified a new email (needs auto-triage on) */
  | { type: 'email_triaged'; category?: string | null }

export type TriggerType = Trigger['type']

/** What a rule's actions can work on. */
export type TriggerContext = 'task' | 'email' | 'none'

export const TRIGGER_CONTEXT: Record<TriggerType, TriggerContext> = {
  task_created: 'task',
  status_changed: 'task',
  priority_changed: 'task',
  task_moved: 'task',
  tag_added: 'task',
  comment_added: 'task',
  checklist_completed: 'task',
  due_date_arrives: 'task',
  task_overdue: 'task',
  time_over_estimate: 'task',
  schedule: 'none',
  email_received: 'email',
  email_no_reply: 'email',
  email_needs_follow_up: 'email',
  event_starts: 'none',
  email_triaged: 'email'
}

/** Triggers that run without a task in context. */
export const TASKLESS_TRIGGERS: TriggerType[] = (Object.keys(TRIGGER_CONTEXT) as TriggerType[]).filter((t) => TRIGGER_CONTEXT[t] !== 'task')

// ---------------------------------------------------------------- conditions

export type ConditionField =
  | 'status'
  | 'priority'
  | 'list'
  | 'tag'
  | 'title'
  | 'due_date'
  | 'custom_field'
  | 'sprint'
  | 'email_from'
  | 'email_to'
  | 'email_subject'
  | 'email_body'

export const EMAIL_FIELDS: ConditionField[] = ['email_from', 'email_to', 'email_subject', 'email_body']
export type ConditionOp = 'is' | 'is_not' | 'contains' | 'not_contains' | 'is_set' | 'is_not_set' | 'gt' | 'lt'

export interface Condition {
  field: ConditionField
  op: ConditionOp
  value?: unknown
  /** for custom_field */
  field_id?: string
}

// ---------------------------------------------------------------- actions

export type Action =
  | { type: 'set_status'; status: string }
  | { type: 'set_priority'; priority: Priority }
  | { type: 'set_due_date'; days_from_now: number | null }
  | { type: 'add_tag'; tag_id: string }
  | { type: 'remove_tag'; tag_id: string }
  | { type: 'move_to_list'; list_id: string }
  | { type: 'add_comment'; text: string }
  | { type: 'create_subtask'; title: string }
  | { type: 'add_checklist'; name: string; items: string[] }
  | { type: 'create_task'; list_id: string; title: string; due_days?: number | null; priority?: Priority }
  | { type: 'create_reminder'; minutes_from_now: number; title?: string }
  | { type: 'notify'; title: string; body?: string }
  | { type: 'set_custom_field'; field_id: string; value: unknown }
  | { type: 'send_email'; account_id?: string | null; to: string; subject: string; body: string }
  | { type: 'create_task_from_email'; list_id: string }
  | { type: 'reply_to_email'; body: string }
  /** removed in 1.1 (sequences were replaced by Follow-up); kept so old rules still load */
  | { type: 'start_sequence'; sequence_id: string }
  | { type: 'mark_email_read' }
  /** ask the AI (task + comments + linked email as context) and add its answer as a comment */
  | { type: 'ai_prompt'; prompt: string }
  /** post a message to a Slack / Teams integration */
  | { type: 'post_message'; integration_id: string; text: string }

export type ActionType = Action['type']

/** Actions that need a task in context. */
export const TASK_ACTIONS: ActionType[] = [
  'set_status', 'set_priority', 'set_due_date', 'add_tag', 'remove_tag', 'move_to_list',
  'add_comment', 'create_subtask', 'add_checklist', 'create_reminder', 'set_custom_field', 'ai_prompt'
]

/** Actions that need an email in context. */
export const EMAIL_ACTIONS: ActionType[] = ['create_task_from_email', 'reply_to_email', 'start_sequence', 'mark_email_read']

/** Actions that can no longer be added (old rules that use them are switched off). */
export const RETIRED_ACTIONS: ActionType[] = ['start_sequence']

/** Whether an action can run for a trigger context. */
export function actionAllowed(action: ActionType, ctx: TriggerContext): boolean {
  if (TASK_ACTIONS.includes(action)) return ctx === 'task'
  if (EMAIL_ACTIONS.includes(action)) return ctx === 'email'
  return true
}

// ---------------------------------------------------------------- rules & runs

export interface AutomationInput {
  name: string
  enabled: boolean
  scope: Location | null
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
}

export interface Automation extends AutomationInput {
  id: string
  run_count: number
  last_run_at: string | null
  created_at: string
}

export interface AutomationRun {
  id: string
  automation_id: string
  status: 'success' | 'skipped' | 'failed'
  task_id: string | null
  task_title: string | null
  trigger: string
  /** one line per action / condition outcome */
  detail: string[]
  error: string | null
  created_at: string
}

export interface TestResult {
  /** would the rule run for this task right now */
  matches: boolean
  checks: { label: string; pass: boolean }[]
}

/** Text substitutions available in comments, titles and notifications. */
export const TEMPLATE_VARS: Record<TriggerContext, string[]> = {
  task: ['{{task.title}}', '{{task.status}}', '{{task.priority}}', '{{task.due_date}}', '{{task.list}}', '{{date.today}}'],
  email: ['{{email.from}}', '{{email.from_name}}', '{{email.to}}', '{{email.subject}}', '{{email.snippet}}', '{{date.today}}'],
  none: ['{{event.title}}', '{{event.start}}', '{{date.today}}']
}

export const MAX_CHAIN_DEPTH = 5
