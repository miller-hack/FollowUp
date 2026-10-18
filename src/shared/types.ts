export type Priority = 'urgent' | 'high' | 'normal' | 'low' | 'none'
export const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low', 'none']

export type StatusType = 'open' | 'active' | 'done'

export interface Space {
  id: string
  name: string
  color: string
  position: number
}

export interface Folder {
  id: string
  space_id: string
  name: string
  position: number
}

export interface List {
  id: string
  space_id: string
  folder_id: string | null
  name: string
  color: string | null
  position: number
}

export interface Status {
  id: string
  space_id: string
  name: string
  color: string
  type: StatusType
  position: number
}

export interface Tree {
  spaces: Space[]
  folders: Folder[]
  lists: List[]
  statuses: Status[]
  sprints: Sprint[]
}

export type SprintStatus = 'planned' | 'active' | 'closed'

export interface Sprint {
  id: string
  space_id: string
  name: string
  start_date: string
  end_date: string
  status: SprintStatus
  goal: string
}

export interface SprintStats {
  sprint: Sprint
  total: number
  done: number
  estimate_min: number
  /** remaining open tasks at the end of each day; `null` for future days */
  days: { date: string; remaining: number | null; ideal: number }[]
}

export interface Tag {
  id: string
  name: string
  color: string
}

export type FieldType =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'dropdown'
  | 'labels'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'

export interface FieldOption {
  id: string
  label: string
  color: string
}

export interface CustomField {
  id: string
  space_id: string
  name: string
  type: FieldType
  options: FieldOption[]
  position: number
}

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
}

/** Dates are ISO strings: `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:mm` (with time, local). */
export interface Task {
  id: string
  list_id: string
  parent_id: string | null
  title: string
  description: string
  status_id: string
  priority: Priority
  start_date: string | null
  due_date: string | null
  time_estimate_min: number | null
  position: number
  completed_at: string | null
  recurrence: Recurrence | null
  sprint_id: string | null
  created_at: string
  updated_at: string
  /** finished time entries, in minutes */
  time_spent_min: number
  tag_ids: string[]
  fields: Record<string, unknown>
  subtask_count: number
  subtask_done: number
  checklist_total: number
  checklist_done: number
  blocked_by: string[]
}

export interface TaskRef {
  id: string
  title: string
  status_id: string
  list_id: string
}

export interface ChecklistItem {
  id: string
  checklist_id: string
  text: string
  done: boolean
  position: number
}

export interface Checklist {
  id: string
  task_id: string
  name: string
  items: ChecklistItem[]
}

export interface Comment {
  id: string
  task_id: string
  body: string
  author: 'me' | 'ai' | 'automation'
  created_at: string
}

export interface Attachment {
  id: string
  task_id: string
  file_name: string
  mime: string
  size: number
  created_at: string
}

export interface Activity {
  id: string
  action: string
  detail: string
  created_at: string
}

export interface TaskDetail extends Task {
  parent: TaskRef | null
  subtasks: Task[]
  checklists: Checklist[]
  comments: Comment[]
  attachments: Attachment[]
  activity: Activity[]
  blocking: TaskRef[]
  blockers: TaskRef[]
  time_entries: TimeEntry[]
  reminders: Reminder[]
  /** linked email threads */
  emails: { id: string; subject: string; last_message_at: string }[]
  /** calendar events linked to this task */
  events: { id: string; title: string; start: string; end: string; all_day: boolean }[]
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'list_id'
    | 'parent_id'
    | 'title'
    | 'description'
    | 'status_id'
    | 'priority'
    | 'start_date'
    | 'due_date'
    | 'time_estimate_min'
    | 'position'
    | 'recurrence'
    | 'tag_ids'
    | 'sprint_id'
  >
> & { fields?: Record<string, unknown> }

export type NewTask = TaskPatch & { list_id: string; title: string }

export interface Location {
  kind: 'space' | 'folder' | 'list' | 'sprint'
  id: string
}

export type DueFilter = 'overdue' | 'today' | 'week' | 'none'

export interface TaskFilter {
  location?: Location
  search?: string
  statusIds?: string[]
  priorities?: Priority[]
  tagIds?: string[]
  due?: DueFilter | null
  includeClosed?: boolean
}

export type ViewType = 'list' | 'board' | 'calendar' | 'gantt'
export type GroupBy = 'status' | 'priority' | 'due'
export type SortBy = 'position' | 'title' | 'due_date' | 'priority' | 'created_at'

export interface ViewConfig {
  view: ViewType
  filter: Omit<TaskFilter, 'location'>
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  showSubtasks: boolean
  hiddenFields: string[]
  ganttZoom: 'day' | 'week' | 'month'
}

export interface SearchResult {
  tasks: TaskRef[]
  lists: List[]
}

export interface MyWork {
  overdue: Task[]
  today: Task[]
  upcoming: Task[]
  unscheduled: Task[]
  recent: Task[]
}

export interface NotificationSettings {
  /** notify when tasks become due */
  dueEnabled: boolean
  /** minutes before a timed due date */
  dueLeadMin: number
  /** time of day (HH:mm) to notify about date-only due dates */
  dueDayTime: string
  digestEnabled: boolean
  digestTime: string
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  weekStart: 0 | 1
  lastBackupAt: string | null
  notifications: NotificationSettings
  closeToTray: boolean
  /** the user has answered the first-close question (keep running vs quit) */
  closeAsked: boolean
  startAtLogin: boolean
  mail: {
    /** minutes between background syncs */
    syncIntervalMin: number
    /** load images from the internet in emails (they can reveal that you opened the mail) */
    loadRemoteImages: boolean
  }
  followups: {
    /** what to do with follow-ups that were due while the PC was off for more than a day */
    missedPolicy: 'send' | 'skip'
  }
  ai: AiSettings
  updates: {
    /** check for and download updates automatically (installed app only) */
    auto: boolean
    /** overrides the update server built into the installer (a folder served over HTTPS with latest.yml) */
    feedUrl: string
  }
  /** OAuth client ids for `Sign in with Google / Microsoft` (bring your own; a build may include defaults) */
  oauth: {
    googleClientId: string
    microsoftClientId: string
  }
}

import type { AiSettings } from './ai'

// ---------------------------------------------------------------- time tracking

export interface TimeEntry {
  id: string
  task_id: string
  started_at: string
  ended_at: string | null
  duration_sec: number | null
  note: string
  billable: boolean
}

export interface TimeEntryRow extends TimeEntry {
  task_title: string
  list_id: string
}

export interface RunningTimer {
  entry: TimeEntry
  task: TaskRef
}

// ---------------------------------------------------------------- goals

export type KeyResultType = 'number' | 'percent' | 'currency' | 'boolean' | 'tasks'

export interface KeyResult {
  id: string
  goal_id: string
  name: string
  type: KeyResultType
  start_value: number
  target_value: number
  current_value: number
  unit: string
  task_ids: string[]
  tasks_done: number
  /** 0..1 */
  progress: number
}

export interface Goal {
  id: string
  name: string
  description: string
  color: string
  due_date: string | null
  key_results: KeyResult[]
  /** 0..1, average of key results */
  progress: number
}

export type KeyResultInput = Pick<KeyResult, 'name' | 'type'> & Partial<Pick<KeyResult, 'start_value' | 'target_value' | 'current_value' | 'unit'>>

// ---------------------------------------------------------------- reminders & notifications

export interface Reminder {
  id: string
  task_id: string | null
  title: string
  remind_at: string
  done_at: string | null
  notified_at: string | null
}

export interface AppNotification {
  id: string
  kind: 'due' | 'reminder' | 'digest' | 'info' | 'automation'
  title: string
  body: string
  task_id: string | null
  read_at: string | null
  created_at: string
}

// ---------------------------------------------------------------- dashboards

export type WidgetType =
  | 'counter'
  | 'tasks_by_status'
  | 'tasks_by_priority'
  | 'completed_trend'
  | 'time_by_list'
  | 'time_by_tag'
  | 'goals'
  | 'task_list'
  | 'sprint_burndown'

export interface WidgetConfig {
  location?: Location | null
  /** look-back window for trends and time widgets */
  days?: number
  metric?: 'open' | 'overdue' | 'done_week' | 'time_week' | 'due_today'
  list?: 'overdue' | 'due_soon' | 'recently_done'
  sprint_id?: string | null
}

export interface Widget {
  id: string
  dashboard_id: string
  type: WidgetType
  title: string
  config: WidgetConfig
  /** columns spanned (1-3) */
  size: number
  position: number
}

export interface Dashboard {
  id: string
  name: string
  widgets: Widget[]
}

export interface BreakdownItem {
  key: string
  label: string
  value: number
  /** entity color when the entity has one (status, priority); otherwise the renderer assigns palette slots */
  color: string | null
}

export type WidgetData =
  | { kind: 'counter'; value: number; unit: 'tasks' | 'minutes'; caption: string }
  | { kind: 'breakdown'; unit: 'tasks' | 'minutes'; items: BreakdownItem[] }
  | { kind: 'series'; points: { date: string; value: number }[] }
  | { kind: 'tasks'; tasks: Task[] }
  | { kind: 'goals'; goals: Goal[] }
  | { kind: 'burndown'; stats: SprintStats | null }

export interface BackupInfo {
  file: string
  size: number
  created_at: string
}

export interface StatusInput {
  id?: string
  name: string
  color: string
  type: StatusType
}
