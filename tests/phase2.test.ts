import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, localDate, localDateTime } from '@shared/dates'
import { closeDb, openDb, run } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as time from '../src/main/services/time'
import * as plan from '../src/main/services/planning'
import * as dash from '../src/main/services/dashboards'
import * as notify from '../src/main/services/notify'
import { DEFAULT_SETTINGS } from '../src/main/services/meta'

function setup() {
  const space = h.createSpace({ name: 'S' })
  const list = h.createList({ space_id: space.id, name: 'L' })
  const statuses = h.getTree().statuses.filter((s) => s.space_id === space.id)
  return { space, list, todo: statuses[0], done: statuses.find((s) => s.type === 'done')! }
}

beforeEach(() => {
  closeDb()
  openDb(':memory:')
})

describe('time tracking', () => {
  it('runs one timer at a time and sums finished entries', () => {
    const { list } = setup()
    const a = t.createTask({ list_id: list.id, title: 'a' })
    const b = t.createTask({ list_id: list.id, title: 'b' })
    const e1 = time.startTimer(a.id)
    // backdate so the stop keeps it (stops < 5s are discarded)
    run('UPDATE time_entries SET started_at = ? WHERE id = ?', new Date(Date.now() - 30 * 60_000).toISOString(), e1.id)
    time.startTimer(b.id) // stops a
    expect(time.getRunningTimer()!.task.id).toBe(b.id)
    expect(t.getTask(a.id)!.time_spent_min).toBe(30)
    time.addTimeEntry({ task_id: a.id, started_at: new Date().toISOString(), duration_min: 45, note: 'manual' })
    expect(t.getTask(a.id)!.time_spent_min).toBe(75)
    expect(time.stopTimer()).toBeNull() // b ran < 5s → discarded
    expect(time.getRunningTimer()).toBeNull()
    const csv = time.timeEntriesCsv(new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString())
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('manual')
  })
})

describe('goals', () => {
  it('computes key result and goal progress', () => {
    const { list, done } = setup()
    const g = plan.createGoal({ name: 'Ship v1' })
    plan.addKeyResult(g.id, { name: 'Signups', type: 'number', start_value: 0, target_value: 200, current_value: 50 })
    plan.addKeyResult(g.id, { name: 'Launch', type: 'boolean' })
    plan.addKeyResult(g.id, { name: 'Tasks', type: 'tasks' })
    const krTasks = plan.listGoals()[0].key_results[2]
    const x = t.createTask({ list_id: list.id, title: 'x' })
    const y = t.createTask({ list_id: list.id, title: 'y' })
    plan.linkKeyResultTask(krTasks.id, x.id)
    plan.linkKeyResultTask(krTasks.id, y.id)
    t.updateTask(x.id, { status_id: done.id })
    const goal = plan.listGoals()[0]
    expect(goal.key_results.map((k) => k.progress)).toEqual([0.25, 0, 0.5])
    expect(goal.progress).toBeCloseTo(0.25)
  })
})

describe('sprints', () => {
  it('carries unfinished tasks to the next sprint and builds a burndown', () => {
    const { space, list, done } = setup()
    const today = localDate()
    const s1 = plan.createSprint({ space_id: space.id, start_date: addDays(today, -3), end_date: addDays(today, 3) })
    const a = t.createTask({ list_id: list.id, title: 'a', sprint_id: s1.id })
    t.createTask({ list_id: list.id, title: 'b', sprint_id: s1.id })
    t.updateTask(a.id, { status_id: done.id })

    const stats = plan.getSprintStats(s1.id)!
    expect(stats.total).toBe(2)
    expect(stats.done).toBe(1)
    expect(stats.days).toHaveLength(7)
    expect(stats.days[3].remaining).toBe(1) // today
    expect(stats.days[6].remaining).toBeNull() // future

    const { next, moved } = plan.completeSprint(s1.id)
    expect(moved).toBe(1)
    expect(next.status).toBe('active')
    expect(next.start_date).toBe(addDays(today, 4))
    expect(t.queryTasks({ location: { kind: 'sprint', id: next.id } }).map((x) => x.title)).toEqual(['b'])
  })

  it('drops the sprint when a task moves to another space', () => {
    const a = setup()
    const b = setup()
    const s = plan.createSprint({ space_id: a.space.id })
    const task = t.createTask({ list_id: a.list.id, title: 'x', sprint_id: s.id })
    expect(task.sprint_id).toBe(s.id)
    t.updateTask(task.id, { list_id: b.list.id })
    expect(t.getTask(task.id)!.sprint_id).toBeNull()
  })
})

describe('dashboards', () => {
  it('creates a default dashboard and computes widget data', () => {
    const { list, done } = setup()
    t.createTask({ list_id: list.id, title: 'late', due_date: addDays(localDate(), -2), priority: 'high' })
    const finished = t.createTask({ list_id: list.id, title: 'finished' })
    t.updateTask(finished.id, { status_id: done.id })

    const [d] = dash.listDashboards()
    const full = dash.getDashboard(d.id)!
    expect(full.widgets.length).toBeGreaterThan(5)
    const data = (type: string) => dash.getWidgetData(full.widgets.find((w) => w.type === type)!.id)

    expect(dash.computeWidget({ type: 'counter', config: { metric: 'overdue' } })).toMatchObject({ value: 1 })
    expect(dash.computeWidget({ type: 'counter', config: { metric: 'done_week' } })).toMatchObject({ value: 1 })
    const trend = data('completed_trend')
    expect(trend.kind === 'series' && trend.points.at(-1)!.value).toBe(1)
    const prio = data('tasks_by_priority')
    expect(prio.kind === 'breakdown' && prio.items.map((i) => i.key)).toEqual(['high'])
    const overdue = data('task_list')
    expect(overdue.kind === 'tasks' && overdue.tasks.map((x) => x.title)).toEqual(['late'])
  })
})

describe('notifications', () => {
  it('fires reminders, due dates and the digest once', () => {
    const { list } = setup()
    const at = new Date()
    at.setHours(10, 0, 0, 0)
    const today = localDate(at)
    const task = t.createTask({ list_id: list.id, title: 'Call Ana', due_date: today })
    t.createTask({ list_id: list.id, title: 'Timed', due_date: localDateTime(new Date(at.getTime() + 10 * 60_000)) })
    t.createTask({ list_id: list.id, title: 'Later', due_date: localDateTime(new Date(at.getTime() + 60 * 60_000)) })
    notify.createReminder({ task_id: task.id, remind_at: localDateTime(new Date(at.getTime() - 60_000)) })
    notify.createReminder({ title: 'Future', remind_at: localDateTime(new Date(at.getTime() + 3600_000)) })

    const first = notify.collectDue(at, DEFAULT_SETTINGS)
    expect(first.map((n) => n.kind).sort()).toEqual(['digest', 'due', 'due', 'reminder'])
    expect(first.find((n) => n.kind === 'reminder')!.body).toBe('Call Ana')
    expect(first.filter((n) => n.kind === 'due').map((n) => n.title).sort()).toEqual(['Call Ana', 'Timed'])
    expect(notify.collectDue(at, DEFAULT_SETTINGS)).toHaveLength(0)
    expect(notify.listNotifications()).toHaveLength(4)
    notify.markNotificationsRead()
    expect(notify.listNotifications().every((n) => n.read_at)).toBe(true)
  })
})
