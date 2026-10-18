import { addDays, localDate } from '@shared/dates'
import { PRIORITY_ORDER } from '@shared/sort'
import type { BreakdownItem, Dashboard, Priority, Widget, WidgetConfig, WidgetData, WidgetType } from '@shared/types'
import { all, get, now, run, tx, uuid } from '../db'
import { getSprintStats, listGoals } from './planning'
import { locationWhere, queryTasks } from './tasks'

const PRIORITY_COLOR: Record<Priority, string> = { urgent: '#ef4444', high: '#f59e0b', normal: '#3b82f6', low: '#94a3b8', none: '#cbd5e1' }
const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low', none: 'No priority' }

type WidgetRow = Omit<Widget, 'config'> & { config: string }
const toWidget = (r: WidgetRow): Widget => ({ ...r, config: JSON.parse(r.config) as WidgetConfig })

// ---------------------------------------------------------------- CRUD

export function listDashboards(): { id: string; name: string }[] {
  ensureDefaultDashboard()
  return all('SELECT id, name FROM dashboards ORDER BY position')
}

export function getDashboard(id: string): Dashboard | null {
  const d = get<{ id: string; name: string }>('SELECT id, name FROM dashboards WHERE id = ?', id)
  if (!d) return null
  const widgets = all<WidgetRow>(
    'SELECT id, dashboard_id, type, title, config, size, position FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY position',
    id
  ).map(toWidget)
  return { ...d, widgets }
}

export function createDashboard(name: string): { id: string; name: string } {
  const id = uuid()
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM dashboards')?.p ?? 0) + 1
  run('INSERT INTO dashboards (id, name, position) VALUES (?, ?, ?)', id, name.trim() || 'Dashboard', pos)
  return { id, name }
}

export function updateDashboard(id: string, patch: { name?: string }): void {
  if (patch.name !== undefined) run('UPDATE dashboards SET name = ?, updated_at = ? WHERE id = ?', patch.name, now(), id)
}

export function deleteDashboard(id: string): void {
  run('DELETE FROM dashboards WHERE id = ?', id)
}

export function addWidget(dashboardId: string, input: { type: WidgetType; title: string; config?: WidgetConfig; size?: number }): Widget {
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM dashboard_widgets WHERE dashboard_id = ?', dashboardId)?.p ?? 0) + 1
  const w: Widget = {
    id: uuid(),
    dashboard_id: dashboardId,
    type: input.type,
    title: input.title,
    config: input.config ?? {},
    size: Math.min(4, Math.max(1, input.size ?? 2)),
    position: pos
  }
  run(
    'INSERT INTO dashboard_widgets (id, dashboard_id, type, title, config, size, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    w.id, w.dashboard_id, w.type, w.title, w.config, w.size, w.position
  )
  return w
}

export function updateWidget(id: string, patch: Partial<Pick<Widget, 'title' | 'config' | 'size'>>): void {
  if (patch.title !== undefined) run('UPDATE dashboard_widgets SET title = ? WHERE id = ?', patch.title, id)
  if (patch.config !== undefined) run('UPDATE dashboard_widgets SET config = ? WHERE id = ?', patch.config, id)
  if (patch.size !== undefined) run('UPDATE dashboard_widgets SET size = ? WHERE id = ?', Math.min(4, Math.max(1, patch.size)), id)
}

export function deleteWidget(id: string): void {
  run('DELETE FROM dashboard_widgets WHERE id = ?', id)
}

export function reorderWidgets(ids: string[]): void {
  tx(() => ids.forEach((id, i) => run('UPDATE dashboard_widgets SET position = ? WHERE id = ?', i + 1, id)))
}

function ensureDefaultDashboard(): void {
  if (get('SELECT 1 FROM dashboards LIMIT 1')) return
  tx(() => {
    const d = createDashboard('Overview')
    const add = (type: WidgetType, title: string, size: number, config: WidgetConfig = {}) => addWidget(d.id, { type, title, size, config })
    add('counter', 'Open tasks', 1, { metric: 'open' })
    add('counter', 'Overdue', 1, { metric: 'overdue' })
    add('counter', 'Completed this week', 1, { metric: 'done_week' })
    add('counter', 'Time tracked this week', 1, { metric: 'time_week' })
    add('completed_trend', 'Tasks completed', 2, { days: 14 })
    add('tasks_by_status', 'Tasks by status', 2)
    add('time_by_list', 'Time by list (7 days)', 2, { days: 7 })
    add('tasks_by_priority', 'Open tasks by priority', 2)
    add('task_list', 'Overdue tasks', 2, { list: 'overdue' })
    add('goals', 'Goals', 2)
  })
}

// ---------------------------------------------------------------- data

const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

export function getWidgetData(widgetId: string): WidgetData {
  const row = get<WidgetRow>('SELECT id, dashboard_id, type, title, config, size, position FROM dashboard_widgets WHERE id = ?', widgetId)
  if (!row) throw new Error('Widget not found')
  return computeWidget(toWidget(row))
}

export function computeWidget(w: Pick<Widget, 'type' | 'config'>): WidgetData {
  const loc = locationWhere(w.config.location)
  const today = localDate()
  const from = `FROM tasks t JOIN lists l ON l.id = t.list_id JOIN statuses s ON s.id = t.status_id WHERE ${loc.sql}`

  switch (w.type) {
    case 'counter': {
      const metric = w.config.metric ?? 'open'
      if (metric === 'time_week') {
        const sec =
          get<{ sec: number | null }>(
            `SELECT SUM(e.duration_sec) sec FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN lists l ON l.id = t.list_id
             WHERE ${loc.sql} AND e.started_at >= ?`,
            ...loc.params,
            daysAgoIso(7)
          )?.sec ?? 0
        return { kind: 'counter', value: Math.round(sec / 60), unit: 'minutes', caption: 'last 7 days' }
      }
      const cond: Record<string, [string, unknown[], string]> = {
        open: ["s.type <> 'done'", [], 'not done'],
        overdue: ["s.type <> 'done' AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) < ?", [today], 'past their due date'],
        due_today: ["s.type <> 'done' AND substr(t.due_date, 1, 10) = ?", [today], 'due today'],
        done_week: ["s.type = 'done' AND t.completed_at >= ?", [daysAgoIso(7)], 'last 7 days']
      }
      const [sql, params, caption] = cond[metric]
      const n = get<{ n: number }>(`SELECT COUNT(*) n ${from} AND ${sql}`, ...loc.params, ...params)?.n ?? 0
      return { kind: 'counter', value: n, unit: 'tasks', caption }
    }

    case 'tasks_by_status': {
      const rows = all<{ name: string; color: string; n: number; type: string; pos: number }>(
        `SELECT s.name, MIN(s.color) color, MIN(s.type) type, MIN(s.position) pos, COUNT(*) n ${from}
         GROUP BY lower(s.name) ORDER BY pos`,
        ...loc.params
      )
      return {
        kind: 'breakdown',
        unit: 'tasks',
        items: rows.map((r) => ({ key: r.name.toLowerCase(), label: r.name, value: r.n, color: r.color }))
      }
    }

    case 'tasks_by_priority': {
      const rows = all<{ priority: Priority; n: number }>(`SELECT t.priority, COUNT(*) n ${from} AND s.type <> 'done' GROUP BY t.priority`, ...loc.params)
      return {
        kind: 'breakdown',
        unit: 'tasks',
        items: rows
          .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
          .map((r) => ({ key: r.priority, label: PRIORITY_LABEL[r.priority], value: r.n, color: PRIORITY_COLOR[r.priority] }))
      }
    }

    case 'completed_trend': {
      const days = w.config.days ?? 14
      const start = addDays(today, -(days - 1))
      const rows = all<{ completed_at: string }>(
        `SELECT t.completed_at ${from} AND s.type = 'done' AND t.completed_at >= ?`,
        ...loc.params,
        daysAgoIso(days + 1)
      )
      const counts = new Map<string, number>()
      for (const r of rows) {
        const d = localDate(new Date(r.completed_at))
        counts.set(d, (counts.get(d) ?? 0) + 1)
      }
      return {
        kind: 'series',
        points: Array.from({ length: days }, (_, i) => {
          const date = addDays(start, i)
          return { date, value: counts.get(date) ?? 0 }
        })
      }
    }

    case 'time_by_list':
    case 'time_by_tag': {
      const since = daysAgoIso(w.config.days ?? 7)
      const rows =
        w.type === 'time_by_list'
          ? all<{ key: string; label: string; color: string | null; sec: number }>(
              `SELECT l.id key, l.name label, NULL color, SUM(e.duration_sec) sec
               FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN lists l ON l.id = t.list_id
               WHERE ${loc.sql} AND e.started_at >= ? AND e.duration_sec IS NOT NULL GROUP BY l.id ORDER BY sec DESC`,
              ...loc.params,
              since
            )
          : all<{ key: string; label: string; color: string | null; sec: number }>(
              `SELECT COALESCE(g.id, 'none') key, COALESCE(g.name, 'No tag') label, g.color color, SUM(e.duration_sec) sec
               FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN lists l ON l.id = t.list_id
               LEFT JOIN task_tags tt ON tt.task_id = t.id LEFT JOIN tags g ON g.id = tt.tag_id
               WHERE ${loc.sql} AND e.started_at >= ? AND e.duration_sec IS NOT NULL GROUP BY g.id ORDER BY sec DESC`,
              ...loc.params,
              since
            )
      return { kind: 'breakdown', unit: 'minutes', items: foldOther(rows.map((r) => ({ key: r.key, label: r.label, value: Math.round(r.sec / 60), color: r.color }))) }
    }

    case 'goals':
      return { kind: 'goals', goals: listGoals() }

    case 'task_list': {
      const location = w.config.location ?? undefined
      const list = w.config.list ?? 'overdue'
      let tasks =
        list === 'recently_done'
          ? queryTasks({ location, includeClosed: true }).filter((t) => t.completed_at).sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))
          : queryTasks({ location, due: list === 'overdue' ? 'overdue' : 'week' }).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      tasks = tasks.slice(0, 15)
      return { kind: 'tasks', tasks }
    }

    case 'sprint_burndown': {
      const id =
        w.config.sprint_id ??
        get<{ id: string }>("SELECT id FROM sprints WHERE status = 'active' ORDER BY start_date DESC LIMIT 1")?.id ??
        get<{ id: string }>("SELECT id FROM sprints WHERE status <> 'closed' ORDER BY start_date LIMIT 1")?.id
      return { kind: 'burndown', stats: id ? getSprintStats(id) : null }
    }
  }
}

/** Keep the categorical palette at ≤8 slots: the 8th onward becomes "Other". */
function foldOther(items: BreakdownItem[]): BreakdownItem[] {
  if (items.length <= 8) return items
  const rest = items.slice(7)
  return [...items.slice(0, 7), { key: 'other', label: `Other (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0), color: null }]
}
