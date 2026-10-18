import type {
  Activity,
  Attachment,
  Checklist,
  ChecklistItem,
  Comment,
  MyWork,
  NewTask,
  Location,
  Priority,
  Recurrence,
  Reminder,
  Status,
  Task,
  TaskDetail,
  TaskFilter,
  TaskPatch,
  TaskRef,
  TimeEntry
} from '@shared/types'
import { addDays, addInterval, isAppDate, localDate } from '@shared/dates'
import { all, get, marks, now, run, tx, uuid } from '../db'
import { remapStatuses, spaceOfList } from './hierarchy'
import { emit, type DomainEvent } from './events'
import { rmSync, rmdirSync } from 'node:fs'
import { dirname } from 'node:path'

interface TaskRow {
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
  recurrence: string | null
  sprint_id: string | null
  created_at: string
  updated_at: string
}

const TASK_COLS = `t.id, t.list_id, t.parent_id, t.title, t.description, t.status_id, t.priority, t.start_date,
  t.due_date, t.time_estimate_min, t.position, t.completed_at, t.recurrence, t.sprint_id, t.created_at, t.updated_at`

/** SQL condition (on aliases `t` = tasks, `l` = lists) restricting tasks to a location. */
export function locationWhere(loc: Location | null | undefined): { sql: string; params: unknown[] } {
  if (!loc) return { sql: '1=1', params: [] }
  switch (loc.kind) {
    case 'list':
      return { sql: 't.list_id = ?', params: [loc.id] }
    case 'folder':
      return { sql: 'l.folder_id = ?', params: [loc.id] }
    case 'space':
      return { sql: 'l.space_id = ?', params: [loc.id] }
    case 'sprint':
      return { sql: 't.sprint_id = ?', params: [loc.id] }
  }
}

// ---------------------------------------------------------------- hydration

function hydrate(rows: TaskRow[]): Task[] {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const tags = new Map<string, string[]>()
  const fields = new Map<string, Record<string, unknown>>()
  const subs = new Map<string, { total: number; done: number }>()
  const checks = new Map<string, { total: number; done: number }>()
  const blocked = new Map<string, string[]>()
  const spent = new Map<string, number>()

  // chunk to stay well below SQLite's parameter limit
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const m = marks(chunk.length)
    for (const r of all<{ task_id: string; tag_id: string }>(`SELECT task_id, tag_id FROM task_tags WHERE task_id IN (${m})`, ...chunk)) {
      tags.set(r.task_id, [...(tags.get(r.task_id) ?? []), r.tag_id])
    }
    for (const r of all<{ task_id: string; field_id: string; value: string }>(
      `SELECT task_id, field_id, value FROM custom_field_values WHERE task_id IN (${m})`,
      ...chunk
    )) {
      const f = fields.get(r.task_id) ?? {}
      f[r.field_id] = JSON.parse(r.value)
      fields.set(r.task_id, f)
    }
    for (const r of all<{ parent_id: string; total: number; done: number }>(
      `SELECT t.parent_id, COUNT(*) total, SUM(CASE WHEN s.type = 'done' THEN 1 ELSE 0 END) done
       FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.parent_id IN (${m}) GROUP BY t.parent_id`,
      ...chunk
    )) {
      subs.set(r.parent_id, { total: r.total, done: r.done })
    }
    for (const r of all<{ task_id: string; total: number; done: number }>(
      `SELECT c.task_id, COUNT(i.id) total, COALESCE(SUM(i.done), 0) done
       FROM checklists c JOIN checklist_items i ON i.checklist_id = c.id WHERE c.task_id IN (${m}) GROUP BY c.task_id`,
      ...chunk
    )) {
      checks.set(r.task_id, { total: r.total, done: r.done })
    }
    for (const r of all<{ task_id: string; blocked_by_id: string }>(
      `SELECT d.task_id, d.blocked_by_id FROM task_dependencies d
       JOIN tasks b ON b.id = d.blocked_by_id JOIN statuses s ON s.id = b.status_id
       WHERE d.task_id IN (${m}) AND s.type <> 'done'`,
      ...chunk
    )) {
      blocked.set(r.task_id, [...(blocked.get(r.task_id) ?? []), r.blocked_by_id])
    }
    for (const r of all<{ task_id: string; sec: number }>(
      `SELECT task_id, SUM(duration_sec) sec FROM time_entries WHERE duration_sec IS NOT NULL AND task_id IN (${m}) GROUP BY task_id`,
      ...chunk
    )) {
      spent.set(r.task_id, Math.round(r.sec / 60))
    }
  }

  return rows.map((r) => ({
    ...r,
    recurrence: r.recurrence ? (JSON.parse(r.recurrence) as Recurrence) : null,
    tag_ids: tags.get(r.id) ?? [],
    fields: fields.get(r.id) ?? {},
    subtask_count: subs.get(r.id)?.total ?? 0,
    subtask_done: subs.get(r.id)?.done ?? 0,
    checklist_total: checks.get(r.id)?.total ?? 0,
    checklist_done: checks.get(r.id)?.done ?? 0,
    blocked_by: blocked.get(r.id) ?? [],
    time_spent_min: spent.get(r.id) ?? 0
  }))
}

function rowById(id: string): TaskRow | undefined {
  return get<TaskRow>(`SELECT ${TASK_COLS} FROM tasks t WHERE t.id = ?`, id)
}

function taskById(id: string): Task {
  const row = rowById(id)
  if (!row) throw new Error('Task not found')
  return hydrate([row])[0]
}

const ref = (where: string, ...params: unknown[]): TaskRef[] =>
  all<TaskRef>(`SELECT t.id, t.title, t.status_id, t.list_id FROM tasks t WHERE ${where} ORDER BY t.position`, ...params)

// ---------------------------------------------------------------- search index

const stripHtml = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

function indexTask(id: string): void {
  const row = get<{ title: string; description: string }>('SELECT title, description FROM tasks WHERE id = ?', id)
  run('DELETE FROM tasks_fts WHERE task_id = ?', id)
  if (row) run('INSERT INTO tasks_fts (task_id, title, body) VALUES (?, ?, ?)', id, row.title, stripHtml(row.description))
}

/** Turn free text into a safe FTS5 prefix query: `"foo"* "bar"*`. */
export function ftsQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean)
  return terms.length ? terms.map((t) => `"${t}"*`).join(' ') : null
}

// ---------------------------------------------------------------- activity

function log(taskId: string, action: string, detail = ''): void {
  run('INSERT INTO activity_log (id, entity_type, entity_id, action, detail) VALUES (?, ?, ?, ?, ?)', uuid(), 'task', taskId, action, detail)
}

const statusName = (id: string): string => get<{ name: string }>('SELECT name FROM statuses WHERE id = ?', id)?.name ?? '?'

// ---------------------------------------------------------------- queries

export function queryTasks(filter: TaskFilter): Task[] {
  const loc = locationWhere(filter.location)
  const where: string[] = [loc.sql]
  const params: unknown[] = [...loc.params]
  if (!filter.includeClosed) where.push("s.type <> 'done'")
  if (filter.statusIds?.length) {
    where.push(`t.status_id IN (${marks(filter.statusIds.length)})`)
    params.push(...filter.statusIds)
  }
  if (filter.priorities?.length) {
    where.push(`t.priority IN (${marks(filter.priorities.length)})`)
    params.push(...filter.priorities)
  }
  if (filter.tagIds?.length) {
    where.push(`EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag_id IN (${marks(filter.tagIds.length)}))`)
    params.push(...filter.tagIds)
  }
  const today = localDate()
  switch (filter.due) {
    case 'overdue':
      where.push("t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) < ? AND s.type <> 'done'")
      params.push(today)
      break
    case 'today':
      where.push('substr(t.due_date, 1, 10) = ?')
      params.push(today)
      break
    case 'week':
      where.push('substr(t.due_date, 1, 10) BETWEEN ? AND ?')
      params.push(today, addDays(today, 7))
      break
    case 'none':
      where.push('t.due_date IS NULL')
      break
  }
  const q = filter.search ? ftsQuery(filter.search) : null
  if (q) {
    where.push('t.id IN (SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?)')
    params.push(q)
  }
  const rows = all<TaskRow>(
    `SELECT ${TASK_COLS} FROM tasks t
     JOIN lists l ON l.id = t.list_id
     JOIN statuses s ON s.id = t.status_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.position`,
    ...params
  )
  return hydrate(rows)
}

export function getTask(id: string): TaskDetail | null {
  const row = rowById(id)
  if (!row) return null
  const [task] = hydrate([row])
  const checklists = all<Omit<Checklist, 'items'>>('SELECT id, task_id, name FROM checklists WHERE task_id = ? ORDER BY position', id)
  const items = all<ChecklistItem & { done: number | boolean }>(
    `SELECT i.id, i.checklist_id, i.text, i.done, i.position FROM checklist_items i
     JOIN checklists c ON c.id = i.checklist_id WHERE c.task_id = ? ORDER BY i.position`,
    id
  )
  return {
    ...task,
    parent: task.parent_id ? (ref('t.id = ?', task.parent_id)[0] ?? null) : null,
    subtasks: hydrate(all<TaskRow>(`SELECT ${TASK_COLS} FROM tasks t WHERE t.parent_id = ? ORDER BY t.position`, id)),
    checklists: checklists.map((c) => ({
      ...c,
      items: items.filter((i) => i.checklist_id === c.id).map((i) => ({ ...i, done: !!i.done }))
    })),
    comments: all<Comment>('SELECT id, task_id, body, author, created_at FROM comments WHERE task_id = ? ORDER BY created_at', id),
    attachments: all<Attachment>('SELECT id, task_id, file_name, mime, size, created_at FROM attachments WHERE task_id = ? ORDER BY created_at', id),
    activity: all<Activity>(
      "SELECT id, action, detail, created_at FROM activity_log WHERE entity_type = 'task' AND entity_id = ? ORDER BY created_at DESC LIMIT 50",
      id
    ),
    blockers: ref('t.id IN (SELECT blocked_by_id FROM task_dependencies WHERE task_id = ?)', id),
    blocking: ref('t.id IN (SELECT task_id FROM task_dependencies WHERE blocked_by_id = ?)', id),
    time_entries: all<TimeEntry & { billable: number | boolean }>(
      'SELECT id, task_id, started_at, ended_at, duration_sec, note, billable FROM time_entries WHERE task_id = ? ORDER BY started_at DESC',
      id
    ).map((e) => ({ ...e, billable: !!e.billable })),
    reminders: all<Reminder>(
      'SELECT id, task_id, title, remind_at, done_at, notified_at FROM reminders WHERE task_id = ? AND done_at IS NULL ORDER BY remind_at',
      id
    ),
    emails: all(
      `SELECT th.id, th.subject, th.last_message_at FROM email_task_links l JOIN mail_threads th ON th.id = l.thread_id
       WHERE l.task_id = ? ORDER BY th.last_message_at DESC`,
      id
    ),
    events: all<{ id: string; title: string; start: string; end: string; all_day: number }>(
      'SELECT id, title, start, end, all_day FROM calendar_events WHERE task_id = ? AND pending_delete = 0 ORDER BY start',
      id
    ).map((e) => ({ ...e, all_day: !!e.all_day }))
  }
}

export function getMyWork(): MyWork {
  const today = localDate()
  const open = (extra: string, order: string, limit: number, ...params: unknown[]): Task[] =>
    hydrate(
      all<TaskRow>(
        `SELECT ${TASK_COLS} FROM tasks t JOIN statuses s ON s.id = t.status_id
         WHERE s.type <> 'done' AND ${extra} ORDER BY ${order} LIMIT ${limit}`,
        ...params
      )
    )
  return {
    overdue: open('t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) < ?', 't.due_date', 100, today),
    today: open('substr(t.due_date, 1, 10) = ?', 't.due_date', 100, today),
    upcoming: open('substr(t.due_date, 1, 10) > ? AND substr(t.due_date, 1, 10) <= ?', 't.due_date', 100, today, addDays(today, 7)),
    unscheduled: open('t.due_date IS NULL AND t.parent_id IS NULL', 't.created_at DESC', 15),
    recent: hydrate(all<TaskRow>(`SELECT ${TASK_COLS} FROM tasks t ORDER BY t.updated_at DESC LIMIT 10`))
  }
}

// ---------------------------------------------------------------- mutations

function firstStatus(spaceId: string, type?: string): Status {
  const s =
    (type ? get<Status>('SELECT * FROM statuses WHERE space_id = ? AND type = ? ORDER BY position', spaceId, type) : undefined) ??
    get<Status>('SELECT * FROM statuses WHERE space_id = ? ORDER BY position', spaceId)
  if (!s) throw new Error('Space has no statuses')
  return s
}

/** The sprint id if it belongs to the given space, else null. */
function sprintInSpace(sprintId: string | null | undefined, spaceId: string): string | null {
  if (!sprintId) return null
  return get('SELECT 1 FROM sprints WHERE id = ? AND space_id = ?', sprintId, spaceId) ? sprintId : null
}

function statusType(id: string): string | undefined {
  return get<{ type: string }>('SELECT type FROM statuses WHERE id = ?', id)?.type
}

/** Reject anything that isn't `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` (null clears the date). */
export function assertDate(label: string, value: string | null | undefined): void {
  if (value === null || value === undefined) return
  if (!isAppDate(value)) throw new Error(`${label} must be a date like ${localDate()} or ${localDate()}T14:30 (got “${String(value).slice(0, 40)}”)`)
}

/** A status of `spaceId` for `statusId`: itself if it belongs there, else the same name, the same type, or the first status. */
function statusInSpace(statusId: string, spaceId: string): string {
  const s = get<Status>('SELECT * FROM statuses WHERE id = ?', statusId)
  if (!s) throw new Error('Status not found')
  if (s.space_id === spaceId) return s.id
  return (
    get<{ id: string }>('SELECT id FROM statuses WHERE space_id = ? AND lower(name) = lower(?) ORDER BY position', spaceId, s.name)?.id ??
    firstStatus(spaceId, s.type).id
  )
}

/** Replace a task's tags; returns the ids that were newly added. */
function setTags(taskId: string, tagIds: string[]): string[] {
  const before = new Set(all<{ tag_id: string }>('SELECT tag_id FROM task_tags WHERE task_id = ?', taskId).map((r) => r.tag_id))
  run('DELETE FROM task_tags WHERE task_id = ?', taskId)
  for (const tagId of new Set(tagIds)) run('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)', taskId, tagId)
  return [...new Set(tagIds)].filter((t) => !before.has(t))
}

function setFields(taskId: string, fields: Record<string, unknown>): void {
  for (const [fieldId, value] of Object.entries(fields)) {
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    if (empty) run('DELETE FROM custom_field_values WHERE task_id = ? AND field_id = ?', taskId, fieldId)
    else
      run(
        `INSERT INTO custom_field_values (task_id, field_id, value) VALUES (?, ?, ?)
         ON CONFLICT(task_id, field_id) DO UPDATE SET value = excluded.value`,
        taskId,
        fieldId,
        JSON.stringify(value)
      )
  }
}

export function createTask(input: NewTask, opts: { source?: string } = {}): Task {
  assertDate('Start date', input.start_date)
  assertDate('Due date', input.due_date)
  return tx(() => {
    let listId = input.list_id
    if (input.parent_id) {
      const parent = rowById(input.parent_id)
      if (!parent) throw new Error('Parent task not found')
      listId = parent.list_id
    }
    const spaceId = spaceOfList(listId)
    const statusId =
      input.status_id && get('SELECT 1 FROM statuses WHERE id = ? AND space_id = ?', input.status_id, spaceId)
        ? input.status_id
        : firstStatus(spaceId).id
    const position =
      input.position ??
      (get<{ p: number | null }>(
        'SELECT MAX(position) p FROM tasks WHERE list_id = ? AND parent_id IS ?',
        listId,
        input.parent_id ?? null
      )?.p ?? 0) + 1
    const id = uuid()
    run(
      `INSERT INTO tasks (id, list_id, parent_id, title, description, status_id, priority, start_date, due_date,
        time_estimate_min, position, completed_at, recurrence, source, sprint_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      listId,
      input.parent_id ?? null,
      input.title.trim() || 'Untitled task',
      input.description ?? '',
      statusId,
      input.priority ?? 'none',
      input.start_date ?? null,
      input.due_date ?? null,
      input.time_estimate_min ?? null,
      position,
      statusType(statusId) === 'done' ? now() : null,
      input.recurrence ?? null,
      opts.source ?? 'manual',
      sprintInSpace(input.sprint_id, spaceId)
    )
    if (input.tag_ids) setTags(id, input.tag_ids)
    if (input.fields) setFields(id, input.fields)
    indexTask(id)
    log(id, 'created')
    emit({ type: 'task.created', taskId: id })
    return taskById(id)
  })
}

export function updateTask(id: string, input: TaskPatch): Task {
  assertDate('Start date', input.start_date)
  assertDate('Due date', input.due_date)
  return tx(() => {
    const before = rowById(id)
    if (!before) throw new Error('Task not found')
    const patch: TaskPatch = { ...input }
    if (patch.parent_id !== undefined && patch.parent_id !== before.parent_id && patch.parent_id) {
      if (patch.parent_id === id) throw new Error('A task cannot be its own parent')
      const parent = rowById(patch.parent_id)
      if (!parent) throw new Error('Parent task not found')
      const ownSubtask = get(
        `WITH RECURSIVE d(id) AS (SELECT id FROM tasks WHERE parent_id = ? UNION SELECT t.id FROM tasks t JOIN d ON t.parent_id = d.id)
         SELECT 1 FROM d WHERE id = ?`,
        id,
        patch.parent_id
      )
      if (ownSubtask) throw new Error('A task cannot be moved under one of its own subtasks')
      // subtasks live in their parent's list
      if (parent.list_id !== before.list_id) patch.list_id = parent.list_id
    }
    if (patch.status_id !== undefined) patch.status_id = statusInSpace(patch.status_id, spaceOfList(patch.list_id ?? before.list_id))
    const events: DomainEvent[] = []
    const sets: string[] = []
    const params: unknown[] = []
    const set = (col: string, value: unknown): void => {
      sets.push(`${col} = ?`)
      params.push(value)
    }

    if (patch.title !== undefined && patch.title !== before.title) {
      set('title', patch.title.trim() || before.title)
      log(id, 'renamed', patch.title)
    }
    if (patch.description !== undefined) set('description', patch.description)
    if (patch.priority !== undefined && patch.priority !== before.priority) {
      set('priority', patch.priority)
      log(id, 'priority', `${before.priority} → ${patch.priority}`)
      events.push({ type: 'task.priority_changed', taskId: id, from: before.priority, to: patch.priority })
    }
    if (patch.start_date !== undefined) set('start_date', patch.start_date)
    if (patch.due_date !== undefined && patch.due_date !== before.due_date) {
      set('due_date', patch.due_date)
      log(id, 'due date', patch.due_date ?? 'cleared')
    }
    if (patch.time_estimate_min !== undefined) set('time_estimate_min', patch.time_estimate_min)
    if (patch.position !== undefined) set('position', patch.position)
    if (patch.recurrence !== undefined) set('recurrence', patch.recurrence)
    if (patch.sprint_id !== undefined && patch.sprint_id !== before.sprint_id) {
      const sid = sprintInSpace(patch.sprint_id, spaceOfList(patch.list_id ?? before.list_id))
      set('sprint_id', sid)
      log(id, 'sprint', sid ? (get<{ name: string }>('SELECT name FROM sprints WHERE id = ?', sid)?.name ?? '') : 'removed')
    }
    if (patch.parent_id !== undefined && patch.parent_id !== before.parent_id) {
      if (patch.parent_id === id) throw new Error('A task cannot be its own parent')
      set('parent_id', patch.parent_id)
    }

    let movedSpace: string | null = null
    if (patch.list_id !== undefined && patch.list_id !== before.list_id) {
      set('list_id', patch.list_id)
      const from = spaceOfList(before.list_id)
      const to = spaceOfList(patch.list_id)
      if (from !== to) movedSpace = to
      log(id, 'moved')
      events.push({ type: 'task.moved', taskId: id, fromList: before.list_id, toList: patch.list_id })
    }

    let completed = false
    if (patch.status_id !== undefined && patch.status_id !== before.status_id) {
      set('status_id', patch.status_id)
      const wasDone = statusType(before.status_id) === 'done'
      const isDone = statusType(patch.status_id) === 'done'
      if (isDone && !wasDone) {
        set('completed_at', now())
        completed = true
      }
      if (!isDone && wasDone) set('completed_at', null)
      log(id, 'status', `${statusName(before.status_id)} → ${statusName(patch.status_id)}`)
      events.push({ type: 'task.status_changed', taskId: id, from: before.status_id, to: patch.status_id })
    }

    if (sets.length) {
      set('updated_at', now())
      run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...params, id)
    } else {
      run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), id)
    }

    if (patch.list_id !== undefined && patch.list_id !== before.list_id) {
      // subtasks always live in their parent's list
      run(
        `WITH RECURSIVE d(id) AS (SELECT id FROM tasks WHERE parent_id = ? UNION SELECT t.id FROM tasks t JOIN d ON t.parent_id = d.id)
         UPDATE tasks SET list_id = ? WHERE id IN (SELECT id FROM d)`,
        id,
        patch.list_id
      )
      if (patch.parent_id === undefined && before.parent_id) run('UPDATE tasks SET parent_id = NULL WHERE id = ?', id)
    }
    if (movedSpace) {
      // sprints belong to a space
      if (patch.sprint_id === undefined) run('UPDATE tasks SET sprint_id = NULL WHERE id = ?', id)
      remapStatuses(
        `t.id IN (WITH RECURSIVE d(id) AS (SELECT ? UNION SELECT t2.id FROM tasks t2 JOIN d ON t2.parent_id = d.id) SELECT id FROM d)`,
        [id],
        movedSpace
      )
    }
    if (patch.tag_ids) for (const tagId of setTags(id, patch.tag_ids)) events.push({ type: 'task.tag_added', taskId: id, tagId })
    if (patch.fields) setFields(id, patch.fields)
    if (patch.title !== undefined || patch.description !== undefined) indexTask(id)

    if (completed) {
      const rec = patch.recurrence !== undefined ? patch.recurrence : before.recurrence ? (JSON.parse(before.recurrence) as Recurrence) : null
      if (rec) spawnRecurrence(id, rec)
    }
    events.forEach(emit)
    return taskById(id)
  })
}

/** When a recurring task is completed, create the next occurrence with shifted dates. */
function spawnRecurrence(id: string, rec: Recurrence): void {
  const t = taskById(id)
  const base = t.due_date ?? t.start_date ?? localDate()
  const next = createTask({
    list_id: t.list_id,
    parent_id: t.parent_id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    time_estimate_min: t.time_estimate_min,
    recurrence: rec,
    tag_ids: t.tag_ids,
    fields: t.fields,
    start_date: t.start_date ? addInterval(t.start_date, rec) : null,
    due_date: addInterval(base, rec)
  })
  run('UPDATE tasks SET recurrence = NULL WHERE id = ?', id)
  log(next.id, 'recurring', 'Created from completed occurrence')
}

export function bulkUpdateTasks(ids: string[], patch: TaskPatch): void {
  tx(() => ids.forEach((id) => updateTask(id, patch)))
}

/** Attachment files of the tasks matched by `where` (on alias `t`) and all their subtasks. */
export function attachmentFilesOf(where: string, ...params: unknown[]): string[] {
  return all<{ p: string }>(
    `WITH RECURSIVE d(id) AS (SELECT t.id FROM tasks t LEFT JOIN lists l ON l.id = t.list_id WHERE ${where}
       UNION SELECT c.id FROM tasks c JOIN d ON c.parent_id = d.id)
     SELECT stored_path p FROM attachments WHERE task_id IN (SELECT id FROM d)`,
    ...params
  ).map((r) => r.p)
}

/** Remove attachment files (and their now-empty task folders) after the rows are gone. */
export function removeFiles(paths: string[]): void {
  for (const p of paths) {
    try {
      rmSync(p, { force: true })
      rmdirSync(dirname(p))
    } catch {
      /* folder not empty or already gone */
    }
  }
}

export function deleteTasks(ids: string[]): void {
  if (!ids.length) return
  const files = attachmentFilesOf(`t.id IN (${marks(ids.length)})`, ...ids)
  tx(() => {
    run(
      `WITH RECURSIVE d(id) AS (SELECT id FROM tasks WHERE id IN (${marks(ids.length)})
         UNION SELECT t.id FROM tasks t JOIN d ON t.parent_id = d.id)
       DELETE FROM tasks_fts WHERE task_id IN (SELECT id FROM d)`,
      ...ids
    )
    run(`DELETE FROM tasks WHERE id IN (${marks(ids.length)})`, ...ids)
  })
  removeFiles(files)
}

/** Board drag & drop: change status/list and place the task before `beforeId` (or at the end). */
export function moveTask(id: string, target: { status_id?: string; list_id?: string; beforeId?: string | null }): void {
  tx(() => {
    const patch: TaskPatch = {}
    if (target.status_id) patch.status_id = target.status_id
    if (target.list_id) patch.list_id = target.list_id
    const task = updateTask(id, patch)
    let position: number
    const before = target.beforeId ? rowById(target.beforeId) : undefined
    if (before && before.id !== id) {
      const prev = get<{ p: number | null }>(
        'SELECT MAX(position) p FROM tasks WHERE position < ? AND id <> ? AND list_id = ? AND parent_id IS ?',
        before.position,
        id,
        task.list_id,
        task.parent_id
      )?.p
      position = prev != null ? (prev + before.position) / 2 : before.position - 1
    } else {
      position =
        (get<{ p: number | null }>('SELECT MAX(position) p FROM tasks WHERE list_id = ? AND parent_id IS ? AND id <> ?', task.list_id, task.parent_id, id)
          ?.p ?? 0) + 1
    }
    run('UPDATE tasks SET position = ? WHERE id = ?', position, id)
  })
}

export function duplicateTask(id: string): Task {
  return tx(() => {
    const src = getTask(id)
    if (!src) throw new Error('Task not found')
    const copy = createTask({
      list_id: src.list_id,
      parent_id: src.parent_id,
      title: `${src.title} (copy)`,
      description: src.description,
      status_id: src.status_id,
      priority: src.priority,
      start_date: src.start_date,
      due_date: src.due_date,
      time_estimate_min: src.time_estimate_min,
      recurrence: src.recurrence,
      sprint_id: src.sprint_id,
      tag_ids: src.tag_ids,
      fields: src.fields,
      position: src.position + 0.5
    })
    for (const c of src.checklists) {
      const cl = addChecklist(copy.id, c.name)
      for (const item of c.items) addChecklistItem(cl.id, item.text)
    }
    return taskById(copy.id)
  })
}

// ---------------------------------------------------------------- checklists, comments, dependencies

export function addChecklist(taskId: string, name: string): Checklist {
  const id = uuid()
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM checklists WHERE task_id = ?', taskId)?.p ?? 0) + 1
  run('INSERT INTO checklists (id, task_id, name, position) VALUES (?, ?, ?, ?)', id, taskId, name.trim() || 'Checklist', pos)
  return { id, task_id: taskId, name, items: [] }
}

export function updateChecklist(id: string, name: string): void {
  run('UPDATE checklists SET name = ?, updated_at = ? WHERE id = ?', name, now(), id)
}

export function deleteChecklist(id: string): void {
  run('DELETE FROM checklists WHERE id = ?', id)
}

export function addChecklistItem(checklistId: string, text: string): ChecklistItem {
  const id = uuid()
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM checklist_items WHERE checklist_id = ?', checklistId)?.p ?? 0) + 1
  run('INSERT INTO checklist_items (id, checklist_id, text, position) VALUES (?, ?, ?, ?)', id, checklistId, text, pos)
  return { id, checklist_id: checklistId, text, done: false, position: pos }
}

export function updateChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, 'text' | 'done'>>): void {
  tx(() => {
    if (patch.text !== undefined) run('UPDATE checklist_items SET text = ?, updated_at = ? WHERE id = ?', patch.text, now(), id)
    if (patch.done !== undefined) {
      run('UPDATE checklist_items SET done = ?, updated_at = ? WHERE id = ?', patch.done, now(), id)
      const c = get<{ checklist_id: string; task_id: string; open: number }>(
        `SELECT i.checklist_id, c.task_id, (SELECT COUNT(*) FROM checklist_items x WHERE x.checklist_id = i.checklist_id AND x.done = 0) open
         FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id WHERE i.id = ?`,
        id
      )
      if (patch.done && c && c.open === 0) emit({ type: 'task.checklist_completed', taskId: c.task_id, checklistId: c.checklist_id })
    }
  })
}

export function deleteChecklistItem(id: string): void {
  run('DELETE FROM checklist_items WHERE id = ?', id)
}

export function addComment(taskId: string, body: string, author: Comment['author'] = 'me'): Comment {
  const c: Comment = { id: uuid(), task_id: taskId, body, author, created_at: now() }
  tx(() => {
    run('INSERT INTO comments (id, task_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)', c.id, taskId, body, author, c.created_at)
    run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), taskId)
    emit({ type: 'task.comment_added', taskId, commentId: c.id, author })
  })
  return c
}

export function deleteComment(id: string): void {
  run('DELETE FROM comments WHERE id = ?', id)
}

export function addDependency(taskId: string, blockedById: string): void {
  if (taskId === blockedById) throw new Error('A task cannot block itself')
  const cycle = get(
    `WITH RECURSIVE up(id) AS (SELECT blocked_by_id FROM task_dependencies WHERE task_id = ?
       UNION SELECT d.blocked_by_id FROM task_dependencies d JOIN up ON d.task_id = up.id)
     SELECT 1 FROM up WHERE id = ?`,
    blockedById,
    taskId
  )
  if (cycle) throw new Error('That dependency would create a cycle')
  run('INSERT OR IGNORE INTO task_dependencies (task_id, blocked_by_id) VALUES (?, ?)', taskId, blockedById)
}

export function removeDependency(taskId: string, blockedById: string): void {
  run('DELETE FROM task_dependencies WHERE task_id = ? AND blocked_by_id = ?', taskId, blockedById)
}
