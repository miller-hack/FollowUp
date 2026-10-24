import { all, now } from '../db'

/**
 * Everything the user created, for "Export JSON" (ADR-007). Secrets, account
 * credentials and synced mail are left out: they belong to the providers and are
 * restored by signing in again.
 */
const USER_TABLES = [
  'spaces', 'folders', 'lists', 'statuses', 'tasks', 'tags', 'task_tags', 'custom_fields', 'custom_field_values',
  'checklists', 'checklist_items', 'comments', 'attachments', 'task_dependencies', 'activity_log',
  'sprints', 'time_entries', 'goals', 'key_results', 'key_result_tasks', 'dashboards', 'dashboard_widgets', 'reminders',
  'automations', 'email_templates',
  'team_members', 'crm_stages', 'companies', 'people', 'interactions', 'interaction_people', 'interaction_members', 'crm_ignored'
]

export interface ExportFile {
  app: 'FollowUp'
  version: 2
  exported_at: string
  data: Record<string, unknown[]>
}

export function buildExport(): ExportFile {
  const data: Record<string, unknown[]> = {}
  for (const t of USER_TABLES) data[t] = all(`SELECT * FROM ${t}`)
  data.settings = all("SELECT key, value FROM settings WHERE key NOT LIKE 'secret:%'")
  // the local calendar only: synced calendars come back from their server
  data.calendars = all('SELECT id, name, color, enabled FROM calendars WHERE account_id IS NULL')
  data.calendar_events = all(
    `SELECT e.id, e.calendar_id, e.uid, e.title, e.description, e.location, e.start, e.end, e.all_day, e.rrule, e.task_id
     FROM calendar_events e JOIN calendars c ON c.id = e.calendar_id WHERE c.account_id IS NULL AND e.pending_delete = 0`
  )
  // webhook URLs / tokens are credentials
  data.integrations = all('SELECT id, kind, name, config, enabled, created_at FROM integrations')
  return { app: 'FollowUp', version: 2, exported_at: now(), data }
}
