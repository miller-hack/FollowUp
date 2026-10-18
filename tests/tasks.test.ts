import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, addInterval, localDate } from '@shared/dates'
import { closeDb, openDb } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as meta from '../src/main/services/meta'
import * as t from '../src/main/services/tasks'
import { seedIfEmpty } from '../src/main/services/seed'

function setup() {
  const space = h.createSpace({ name: 'S' })
  const list = h.createList({ space_id: space.id, name: 'L' })
  const statuses = h.getTree().statuses.filter((s) => s.space_id === space.id)
  return { space, list, statuses, todo: statuses[0], done: statuses.find((s) => s.type === 'done')! }
}

beforeEach(() => {
  closeDb()
  openDb(':memory:')
})

describe('hierarchy', () => {
  it('creates a space with default statuses', () => {
    const { statuses } = setup()
    expect(statuses.map((s) => s.name)).toEqual(['To Do', 'In Progress', 'Review', 'Done'])
  })

  it('remaps tasks when a status is removed', () => {
    const { space, list, statuses } = setup()
    const task = t.createTask({ list_id: list.id, title: 'x', status_id: statuses[2].id })
    h.saveStatuses(space.id, statuses.filter((s) => s.id !== statuses[2].id))
    expect(t.getTask(task.id)!.status_id).toBe(statuses[1].id) // same type ('active')
  })

  it('seeds an empty database once', () => {
    seedIfEmpty()
    seedIfEmpty()
    expect(h.getTree().spaces).toHaveLength(2)
  })
})

describe('tasks', () => {
  it('creates, filters and searches', () => {
    const { list, done } = setup()
    const tag = meta.createTag({ name: 'Urgent stuff' })
    t.createTask({ list_id: list.id, title: 'Write quarterly report', priority: 'high', tag_ids: [tag.id], due_date: localDate() })
    t.createTask({ list_id: list.id, title: 'Buy milk', status_id: done.id })

    expect(t.queryTasks({ location: { kind: 'list', id: list.id } })).toHaveLength(1)
    expect(t.queryTasks({ location: { kind: 'list', id: list.id }, includeClosed: true })).toHaveLength(2)
    expect(t.queryTasks({ tagIds: [tag.id] })[0].title).toBe('Write quarterly report')
    expect(t.queryTasks({ due: 'today' })).toHaveLength(1)
    expect(t.queryTasks({ search: 'quart' })).toHaveLength(1)
    expect(meta.search('repo').tasks[0].title).toBe('Write quarterly report')
  })

  it('tracks subtasks, checklists and completion', () => {
    const { list, done } = setup()
    const parent = t.createTask({ list_id: list.id, title: 'Parent' })
    const child = t.createTask({ list_id: list.id, parent_id: parent.id, title: 'Child' })
    const cl = t.addChecklist(parent.id, 'Steps')
    const item = t.addChecklistItem(cl.id, 'one')
    t.addChecklistItem(cl.id, 'two')
    t.updateChecklistItem(item.id, { done: true })
    t.updateTask(child.id, { status_id: done.id })

    const p = t.getTask(parent.id)!
    expect(p.subtask_count).toBe(1)
    expect(p.subtask_done).toBe(1)
    expect(p.checklist_total).toBe(2)
    expect(p.checklist_done).toBe(1)
    expect(t.getTask(child.id)!.completed_at).not.toBeNull()
  })

  it('spawns the next occurrence of a recurring task', () => {
    const { list, done } = setup()
    const due = '2026-01-31'
    const task = t.createTask({ list_id: list.id, title: 'Pay rent', due_date: due, recurrence: { freq: 'monthly', interval: 1 } })
    t.updateTask(task.id, { status_id: done.id })
    const open = t.queryTasks({ location: { kind: 'list', id: list.id } })
    expect(open).toHaveLength(1)
    expect(open[0].due_date).toBe('2026-02-28')
    expect(open[0].recurrence).toEqual({ freq: 'monthly', interval: 1 })
  })

  it('moves tasks between spaces and remaps status', () => {
    const a = setup()
    const b = setup()
    const task = t.createTask({ list_id: a.list.id, title: 'x', status_id: a.done.id })
    const sub = t.createTask({ list_id: a.list.id, parent_id: task.id, title: 'sub' })
    t.updateTask(task.id, { list_id: b.list.id })
    expect(t.getTask(task.id)!.status_id).toBe(b.done.id)
    expect(t.getTask(sub.id)!.list_id).toBe(b.list.id)
    expect(t.getTask(sub.id)!.status_id).toBe(b.todo.id)
  })

  it('orders tasks via moveTask', () => {
    const { list, statuses } = setup()
    const one = t.createTask({ list_id: list.id, title: '1' })
    const two = t.createTask({ list_id: list.id, title: '2' })
    const three = t.createTask({ list_id: list.id, title: '3' })
    t.moveTask(three.id, { status_id: statuses[1].id, beforeId: two.id })
    const order = t.queryTasks({ location: { kind: 'list', id: list.id } }).map((x) => x.title)
    expect(order).toEqual(['1', '3', '2'])
    expect(t.getTask(three.id)!.status_id).toBe(statuses[1].id)
    expect(one.position).toBe(1)
  })

  it('stores custom field values and prevents dependency cycles', () => {
    const { space, list } = setup()
    const f = meta.createField({ space_id: space.id, name: 'Budget', type: 'money' })
    const a = t.createTask({ list_id: list.id, title: 'a', fields: { [f.id]: 120 } })
    const b = t.createTask({ list_id: list.id, title: 'b' })
    expect(t.getTask(a.id)!.fields[f.id]).toBe(120)
    t.addDependency(b.id, a.id)
    expect(t.getTask(b.id)!.blocked_by).toEqual([a.id])
    expect(() => t.addDependency(a.id, b.id)).toThrow(/cycle/)
  })

  it('deletes tasks with their subtasks', () => {
    const { list } = setup()
    const p = t.createTask({ list_id: list.id, title: 'p' })
    t.createTask({ list_id: list.id, parent_id: p.id, title: 'c' })
    t.deleteTasks([p.id])
    expect(t.queryTasks({ includeClosed: true })).toHaveLength(0)
    expect(meta.search('c').tasks).toHaveLength(0)
  })
})

describe('dates', () => {
  it('adds intervals', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addInterval('2026-03-10T09:30', { freq: 'weekly', interval: 2 })).toBe('2026-03-24T09:30')
    expect(addInterval('2024-02-29', { freq: 'yearly', interval: 1 })).toBe('2025-03-01')
  })
})
