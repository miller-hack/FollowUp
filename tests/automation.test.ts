import { beforeEach, describe, expect, it } from 'vitest'
import type { AutomationInput } from '@shared/automation'
import { addDays, localDate, localDateTime } from '@shared/dates'
import { all, closeDb, get, openDb, run } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as time from '../src/main/services/time'
import * as meta from '../src/main/services/meta'
import * as auto from '../src/main/services/automation'
import { backoffMs, enqueue, processJobs, registerJobHandler } from '../src/main/services/jobs'
import { listNotifications } from '../src/main/services/notify'

function setup() {
  const space = h.createSpace({ name: 'S' })
  const list = h.createList({ space_id: space.id, name: 'L' })
  const other = h.createList({ space_id: space.id, name: 'Archive' })
  return { space, list, other }
}

const rule = (p: Partial<AutomationInput>): AutomationInput => ({
  name: 'Rule',
  enabled: true,
  scope: null,
  trigger: { type: 'task_created' },
  conditions: [],
  actions: [],
  ...p
})

const statusOf = (taskId: string) => get<{ name: string }>('SELECT s.name FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.id = ?', taskId)!.name

beforeEach(() => {
  closeDb()
  openDb(':memory:')
})

describe('event triggers', () => {
  it('runs actions when a task is created, respecting conditions', async () => {
    const { list } = setup()
    auto.createAutomation(
      rule({
        trigger: { type: 'task_created' },
        conditions: [{ field: 'due_date', op: 'is_not_set' }],
        actions: [{ type: 'set_due_date', days_from_now: 7 }, { type: 'add_comment', text: 'Auto-dated: {{task.title}} in {{task.list}}' }]
      })
    )
    const a = t.createTask({ list_id: list.id, title: 'No date' })
    const b = t.createTask({ list_id: list.id, title: 'Has date', due_date: localDate() })
    await processJobs()

    const ta = t.getTask(a.id)!
    expect(ta.due_date).toBe(addDays(localDate(), 7))
    expect(ta.comments[0].body).toBe('Auto-dated: No date in L')
    expect(ta.comments[0].author).toBe('automation')
    expect(t.getTask(b.id)!.due_date).toBe(localDate())

    const runs = auto.listAutomationRuns()
    expect(runs.map((r) => r.status).sort()).toEqual(['skipped', 'success'])
    expect(runs.find((r) => r.status === 'skipped')!.detail[0]).toContain('Has no due date')
  })

  it('matches status changes by name and scope', async () => {
    const { list, other, space } = setup()
    const statuses = h.getTree().statuses.filter((s) => s.space_id === space.id)
    auto.createAutomation(
      rule({
        scope: { kind: 'list', id: list.id },
        trigger: { type: 'status_changed', to: 'done' },
        actions: [{ type: 'move_to_list', list_id: other.id }, { type: 'set_priority', priority: 'low' }]
      })
    )
    const x = t.createTask({ list_id: list.id, title: 'x' })
    const y = t.createTask({ list_id: other.id, title: 'y' })
    t.updateTask(x.id, { status_id: statuses[1].id }) // In Progress: no match
    t.updateTask(x.id, { status_id: statuses[3].id }) // Done
    t.updateTask(y.id, { status_id: statuses[3].id }) // out of scope
    await processJobs()
    expect(t.getTask(x.id)).toMatchObject({ list_id: other.id, priority: 'low' })
    expect(t.getTask(y.id)!.priority).toBe('none')
  })

  it('fires on tags, checklists and time over estimate', async () => {
    const { list } = setup()
    const urgent = meta.createTag({ name: 'urgent' })
    auto.createAutomation(rule({ trigger: { type: 'tag_added', tag_id: urgent.id }, actions: [{ type: 'set_priority', priority: 'urgent' }] }))
    auto.createAutomation(rule({ trigger: { type: 'checklist_completed' }, actions: [{ type: 'set_status', status: 'Review' }] }))
    auto.createAutomation(rule({ trigger: { type: 'time_over_estimate' }, actions: [{ type: 'notify', title: 'Over budget: {{task.title}}' }] }))

    const task = t.createTask({ list_id: list.id, title: 'Work', time_estimate_min: 60 })
    t.updateTask(task.id, { tag_ids: [urgent.id] })
    const cl = t.addChecklist(task.id, 'c')
    const i1 = t.addChecklistItem(cl.id, 'one')
    const i2 = t.addChecklistItem(cl.id, 'two')
    t.updateChecklistItem(i1.id, { done: true })
    t.updateChecklistItem(i2.id, { done: true })
    time.addTimeEntry({ task_id: task.id, started_at: new Date().toISOString(), duration_min: 45 })
    time.addTimeEntry({ task_id: task.id, started_at: new Date().toISOString(), duration_min: 30 })
    time.addTimeEntry({ task_id: task.id, started_at: new Date().toISOString(), duration_min: 10 })
    await processJobs()

    expect(t.getTask(task.id)!.priority).toBe('urgent')
    expect(statusOf(task.id)).toBe('Review')
    const notes = listNotifications().filter((n) => n.kind === 'automation')
    expect(notes.map((n) => n.title)).toEqual(['Over budget: Work']) // only once
  })
})

describe('safety', () => {
  it('stops infinite loops at the chain depth limit', async () => {
    const { list } = setup()
    // every created task creates another task: an infinite chain without protection
    auto.createAutomation(rule({ trigger: { type: 'task_created' }, actions: [{ type: 'create_task', list_id: list.id, title: 'child' }] }))
    t.createTask({ list_id: list.id, title: 'root' })
    await processJobs()
    expect(t.queryTasks({}).length).toBe(6) // root + 5 generations
    expect(auto.listAutomationRuns().some((r) => r.status === 'skipped' && r.detail[0].includes('loop protection'))).toBe(true)
  })

  it('rolls back all actions of a failed run and retries with backoff', async () => {
    const { list, space } = setup()
    const a = auto.createAutomation(
      rule({ trigger: { type: 'task_created' }, actions: [{ type: 'set_priority', priority: 'high' }, { type: 'set_status', status: 'Review' }] })
    )
    h.saveStatuses(space.id, [{ name: 'To Do', color: '#999', type: 'open' }, { name: 'Done', color: '#0f0', type: 'done' }]) // "Review" no longer exists
    const task = t.createTask({ list_id: list.id, title: 'x' })
    await processJobs()
    expect(t.getTask(task.id)!.priority).toBe('none') // first action rolled back
    const job = get<{ status: string; attempts: number; last_error: string }>("SELECT status, attempts, last_error FROM jobs WHERE type = 'automation'")!
    expect(job).toMatchObject({ status: 'pending', attempts: 1 })
    expect(job.last_error).toContain('Review')

    // exhaust retries
    await processJobs(new Date(Date.now() + 3600_000))
    await processJobs(new Date(Date.now() + 7200_000))
    expect(get<{ status: string }>("SELECT status FROM jobs WHERE type = 'automation'")!.status).toBe('failed')
    expect(auto.listAutomationRuns(a.id)[0]).toMatchObject({ status: 'failed' })
  })

  it('validates rules', () => {
    setup()
    expect(() => auto.createAutomation(rule({ actions: [] }))).toThrow(/at least one action/)
    expect(() =>
      auto.createAutomation(rule({ trigger: { type: 'schedule', every: 'day', at: '09:00' }, actions: [{ type: 'set_priority', priority: 'high' }] }))
    ).toThrow(/needs a task/)
  })
})

describe('time-based triggers', () => {
  it('fires due-date, overdue and schedule triggers once', async () => {
    const { list } = setup()
    const at = new Date()
    at.setHours(10, 0, 0, 0)
    const today = localDate(at)
    const dueTomorrow = t.createTask({ list_id: list.id, title: 'tomorrow', due_date: addDays(today, 1) })
    const late = t.createTask({ list_id: list.id, title: 'late', due_date: addDays(today, -3) })
    t.createTask({ list_id: list.id, title: 'later', due_date: localDateTime(new Date(at.getTime() + 3 * 3600_000)) })

    auto.createAutomation(rule({ trigger: { type: 'due_date_arrives', days_before: 1 }, actions: [{ type: 'add_comment', text: 'Due tomorrow!' }] }))
    auto.createAutomation(rule({ trigger: { type: 'task_overdue' }, actions: [{ type: 'set_priority', priority: 'urgent' }] }))
    const sched = auto.createAutomation(
      rule({ trigger: { type: 'schedule', every: 'day', at: '09:00' }, actions: [{ type: 'create_task', list_id: list.id, title: 'Daily standup {{date.today}}' }] })
    )
    // pretend the schedule rule existed since yesterday
    run('UPDATE automations SET created_at = ? WHERE id = ?', new Date(at.getTime() - 86_400_000).toISOString(), sched.id)

    expect(auto.automationTick(at)).toBe(3)
    expect(auto.automationTick(at)).toBe(0) // fire once
    await processJobs()

    expect(t.getTask(dueTomorrow.id)!.comments.map((c) => c.body)).toEqual(['Due tomorrow!'])
    expect(t.getTask(late.id)!.priority).toBe('urgent')
    expect(t.queryTasks({ search: 'standup' })[0].title).toBe(`Daily standup ${today}`)
  })

  it('does not fire a schedule for a time that passed before the rule was created', () => {
    const { list } = setup()
    const at = new Date()
    at.setHours(23, 59, 0, 0)
    auto.createAutomation(rule({ trigger: { type: 'schedule', every: 'day', at: '00:00' }, actions: [{ type: 'create_task', list_id: list.id, title: 'x' }] }))
    expect(auto.automationTick(at)).toBe(0)
  })
})

describe('jobs & dry run', () => {
  it('retries generic jobs with exponential backoff', async () => {
    let calls = 0
    registerJobHandler('flaky', () => {
      calls++
      if (calls < 2) throw new Error('boom')
    })
    setup()
    enqueue('flaky', {})
    const start = new Date()
    await processJobs(start)
    expect(calls).toBe(1)
    await processJobs(start) // not due yet
    expect(calls).toBe(1)
    await processJobs(new Date(start.getTime() + backoffMs(1)))
    expect(calls).toBe(2)
    expect(all<{ status: string }>("SELECT status FROM jobs WHERE type = 'flaky'")[0].status).toBe('done')
  })

  it('explains which conditions pass', () => {
    const { list } = setup()
    const task = t.createTask({ list_id: list.id, title: 'Invoice ACME', priority: 'high' })
    const res = auto.testAutomation(
      rule({
        conditions: [
          { field: 'title', op: 'contains', value: 'invoice' },
          { field: 'priority', op: 'is', value: 'low' }
        ],
        actions: [{ type: 'add_comment', text: 'x' }]
      }),
      task.id
    )
    expect(res.matches).toBe(false)
    expect(res.checks.map((c) => c.pass)).toEqual([true, false, true])
  })
})
