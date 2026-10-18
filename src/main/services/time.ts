import type { RunningTimer, TaskRef, TimeEntry, TimeEntryRow } from '@shared/types'
import { all, get, now, run, tx, uuid } from '../db'
import { emit } from './events'

/** Time entry instants are stored as UTC ISO strings. */

type Row = TimeEntry & { billable: number | boolean }
const COLS = 'e.id, e.task_id, e.started_at, e.ended_at, e.duration_sec, e.note, e.billable'
const fix = <T extends Row>(r: T): T => ({ ...r, billable: !!r.billable })

const secondsBetween = (a: string, b: string): number => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))

export function getRunningTimer(): RunningTimer | null {
  const entry = get<Row>(`SELECT ${COLS} FROM time_entries e WHERE e.ended_at IS NULL ORDER BY e.started_at DESC LIMIT 1`)
  if (!entry) return null
  const task = get<TaskRef>('SELECT id, title, status_id, list_id FROM tasks WHERE id = ?', entry.task_id)
  return task ? { entry: fix(entry), task } : null
}

/** Stop whatever is running; returns the finished entry. */
export function stopTimer(): TimeEntry | null {
  const running = getRunningTimer()
  if (!running) return null
  const end = now()
  const sec = secondsBetween(running.entry.started_at, end)
  if (sec < 5) {
    // accidental start/stop: don't keep noise
    run('DELETE FROM time_entries WHERE id = ?', running.entry.id)
    return null
  }
  run('UPDATE time_entries SET ended_at = ?, duration_sec = ?, updated_at = ? WHERE id = ?', end, sec, end, running.entry.id)
  emit({ type: 'time.logged', taskId: running.entry.task_id })
  return { ...running.entry, ended_at: end, duration_sec: sec }
}

/** Start a timer on a task (only one runs at a time; the previous one is stopped). */
export function startTimer(taskId: string): TimeEntry {
  return tx(() => {
    stopTimer()
    const e: TimeEntry = { id: uuid(), task_id: taskId, started_at: now(), ended_at: null, duration_sec: null, note: '', billable: false }
    run('INSERT INTO time_entries (id, task_id, started_at) VALUES (?, ?, ?)', e.id, e.task_id, e.started_at)
    return e
  })
}

export function addTimeEntry(input: { task_id: string; started_at: string; duration_min: number; note?: string; billable?: boolean }): TimeEntry {
  if (!(input.duration_min > 0)) throw new Error('Duration must be greater than zero')
  if (Number.isNaN(Date.parse(input.started_at))) throw new Error('The start time is not a valid date')
  const sec = Math.round(input.duration_min * 60)
  const ended = new Date(Date.parse(input.started_at) + sec * 1000).toISOString()
  const e: TimeEntry = {
    id: uuid(),
    task_id: input.task_id,
    started_at: new Date(input.started_at).toISOString(),
    ended_at: ended,
    duration_sec: sec,
    note: input.note ?? '',
    billable: !!input.billable
  }
  run(
    'INSERT INTO time_entries (id, task_id, started_at, ended_at, duration_sec, note, billable) VALUES (?, ?, ?, ?, ?, ?, ?)',
    e.id, e.task_id, e.started_at, e.ended_at, e.duration_sec, e.note, e.billable
  )
  emit({ type: 'time.logged', taskId: e.task_id })
  return e
}

export function updateTimeEntry(id: string, patch: { started_at?: string; duration_min?: number; note?: string; billable?: boolean }): void {
  tx(() => {
    const e = get<Row>(`SELECT ${COLS} FROM time_entries e WHERE e.id = ?`, id)
    if (!e) throw new Error('Time entry not found')
    if (patch.started_at && Number.isNaN(Date.parse(patch.started_at))) throw new Error('The start time is not a valid date')
    const start = patch.started_at ? new Date(patch.started_at).toISOString() : e.started_at
    if (e.ended_at === null) {
      // running entry: only the start and note can change
      run('UPDATE time_entries SET started_at = ?, note = ?, updated_at = ? WHERE id = ?', start, patch.note ?? e.note, now(), id)
      return
    }
    const sec = patch.duration_min !== undefined ? Math.round(patch.duration_min * 60) : (e.duration_sec ?? 0)
    if (sec <= 0) throw new Error('Duration must be greater than zero')
    run(
      'UPDATE time_entries SET started_at = ?, ended_at = ?, duration_sec = ?, note = ?, billable = ?, updated_at = ? WHERE id = ?',
      start,
      new Date(Date.parse(start) + sec * 1000).toISOString(),
      sec,
      patch.note ?? e.note,
      patch.billable ?? e.billable,
      now(),
      id
    )
    emit({ type: 'time.logged', taskId: e.task_id })
  })
}

export function deleteTimeEntry(id: string): void {
  run('DELETE FROM time_entries WHERE id = ?', id)
}

/** Entries starting within [from, to) (ISO instants), newest first. */
export function listTimeEntries(q: { from: string; to: string; taskId?: string }): TimeEntryRow[] {
  return all<TimeEntryRow & { billable: number | boolean }>(
    `SELECT ${COLS}, t.title task_title, t.list_id FROM time_entries e JOIN tasks t ON t.id = e.task_id
     WHERE e.started_at >= ? AND e.started_at < ? ${q.taskId ? 'AND e.task_id = ?' : ''}
     ORDER BY e.started_at DESC`,
    new Date(q.from).toISOString(),
    new Date(q.to).toISOString(),
    ...(q.taskId ? [q.taskId] : [])
  ).map(fix)
}

/** CSV text for entries in a range. */
export function timeEntriesCsv(from: string, to: string): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = all<{ started_at: string; ended_at: string | null; duration_sec: number | null; note: string; billable: number; task: string; list: string; space: string }>(
    `SELECT e.started_at, e.ended_at, e.duration_sec, e.note, e.billable, t.title task, l.name list, s.name space
     FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN lists l ON l.id = t.list_id JOIN spaces s ON s.id = l.space_id
     WHERE e.started_at >= ? AND e.started_at < ? AND e.duration_sec IS NOT NULL ORDER BY e.started_at`,
    new Date(from).toISOString(),
    new Date(to).toISOString()
  )
  const header = ['Start', 'End', 'Hours', 'Task', 'List', 'Space', 'Note', 'Billable']
  const lines = rows.map((r) =>
    [r.started_at, r.ended_at, ((r.duration_sec ?? 0) / 3600).toFixed(2), r.task, r.list, r.space, r.note, r.billable ? 'yes' : 'no']
      .map(esc)
      .join(',')
  )
  return [header.join(','), ...lines].join('\r\n')
}
