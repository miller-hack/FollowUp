import type { Goal, KeyResult, KeyResultInput, Sprint, SprintStats } from '@shared/types'
import { addDays, diffDays, localDate } from '@shared/dates'
import { all, get, marks, now, run, tx, uuid } from '../db'

// ---------------------------------------------------------------- goals

type KrRow = Omit<KeyResult, 'task_ids' | 'tasks_done' | 'progress'>

export function krProgress(kr: Pick<KeyResult, 'type' | 'start_value' | 'target_value' | 'current_value' | 'task_ids' | 'tasks_done'>): number {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
  switch (kr.type) {
    case 'boolean':
      return kr.current_value >= 1 ? 1 : 0
    case 'tasks':
      return kr.task_ids.length ? kr.tasks_done / kr.task_ids.length : 0
    default: {
      const span = kr.target_value - kr.start_value
      return span === 0 ? (kr.current_value >= kr.target_value ? 1 : 0) : clamp((kr.current_value - kr.start_value) / span)
    }
  }
}

export function listGoals(ids?: string[]): Goal[] {
  const goals = ids
    ? all<Omit<Goal, 'key_results' | 'progress'>>(`SELECT id, name, description, color, due_date FROM goals WHERE id IN (${marks(ids.length)}) ORDER BY position`, ...ids)
    : all<Omit<Goal, 'key_results' | 'progress'>>('SELECT id, name, description, color, due_date FROM goals ORDER BY position')
  if (!goals.length) return []
  const krs = all<KrRow>(
    `SELECT id, goal_id, name, type, start_value, target_value, current_value, unit FROM key_results
     WHERE goal_id IN (${marks(goals.length)}) ORDER BY position`,
    ...goals.map((g) => g.id)
  )
  const links = krs.length
    ? all<{ key_result_id: string; task_id: string; done: number }>(
        `SELECT k.key_result_id, k.task_id, CASE WHEN s.type = 'done' THEN 1 ELSE 0 END done
         FROM key_result_tasks k JOIN tasks t ON t.id = k.task_id JOIN statuses s ON s.id = t.status_id
         WHERE k.key_result_id IN (${marks(krs.length)})`,
        ...krs.map((k) => k.id)
      )
    : []
  return goals.map((g) => {
    const key_results = krs
      .filter((k) => k.goal_id === g.id)
      .map((k) => {
        const mine = links.filter((l) => l.key_result_id === k.id)
        const kr = { ...k, task_ids: mine.map((l) => l.task_id), tasks_done: mine.filter((l) => l.done).length }
        return { ...kr, progress: krProgress(kr) }
      })
    const progress = key_results.length ? key_results.reduce((a, k) => a + k.progress, 0) / key_results.length : 0
    return { ...g, key_results, progress }
  })
}

export function createGoal(input: { name: string; color?: string; due_date?: string | null; description?: string }): Goal {
  const id = uuid()
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM goals')?.p ?? 0) + 1
  run(
    'INSERT INTO goals (id, name, description, color, due_date, position) VALUES (?, ?, ?, ?, ?, ?)',
    id, input.name.trim() || 'New goal', input.description ?? '', input.color ?? '#7b68ee', input.due_date ?? null, pos
  )
  return listGoals([id])[0]
}

export function updateGoal(id: string, patch: Partial<Pick<Goal, 'name' | 'description' | 'color' | 'due_date'>>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (['name', 'description', 'color', 'due_date'].includes(k)) run(`UPDATE goals SET ${k} = ?, updated_at = ? WHERE id = ?`, v, now(), id)
  }
}

export function deleteGoal(id: string): void {
  run('DELETE FROM goals WHERE id = ?', id)
}

export function addKeyResult(goalId: string, input: KeyResultInput): void {
  const defaults: Record<string, [number, number]> = { percent: [0, 100], boolean: [0, 1], tasks: [0, 0] }
  const [s, t] = defaults[input.type] ?? [0, 10]
  const pos = (get<{ p: number | null }>('SELECT MAX(position) p FROM key_results WHERE goal_id = ?', goalId)?.p ?? 0) + 1
  run(
    `INSERT INTO key_results (id, goal_id, name, type, start_value, target_value, current_value, unit, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uuid(), goalId, input.name.trim() || 'Key result', input.type,
    input.start_value ?? s, input.target_value ?? t, input.current_value ?? input.start_value ?? s, input.unit ?? '', pos
  )
}

export function updateKeyResult(id: string, patch: Partial<Pick<KeyResult, 'name' | 'start_value' | 'target_value' | 'current_value' | 'unit'>>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (['name', 'start_value', 'target_value', 'current_value', 'unit'].includes(k)) run(`UPDATE key_results SET ${k} = ?, updated_at = ? WHERE id = ?`, v, now(), id)
  }
}

export function deleteKeyResult(id: string): void {
  run('DELETE FROM key_results WHERE id = ?', id)
}

export function linkKeyResultTask(krId: string, taskId: string): void {
  run('INSERT OR IGNORE INTO key_result_tasks (key_result_id, task_id) VALUES (?, ?)', krId, taskId)
}

export function unlinkKeyResultTask(krId: string, taskId: string): void {
  run('DELETE FROM key_result_tasks WHERE key_result_id = ? AND task_id = ?', krId, taskId)
}

// ---------------------------------------------------------------- sprints

const SPRINT_COLS = 'id, space_id, name, start_date, end_date, status, goal'
const sprintById = (id: string) => get<Sprint>(`SELECT ${SPRINT_COLS} FROM sprints WHERE id = ?`, id)

export function createSprint(input: { space_id: string; name?: string; start_date?: string; end_date?: string; goal?: string }): Sprint {
  const last = get<Sprint>(`SELECT ${SPRINT_COLS} FROM sprints WHERE space_id = ? ORDER BY end_date DESC LIMIT 1`, input.space_id)
  const count = get<{ n: number }>('SELECT COUNT(*) n FROM sprints WHERE space_id = ?', input.space_id)?.n ?? 0
  const length = last ? diffDays(last.start_date, last.end_date) : 13
  const start = input.start_date ?? (last ? addDays(last.end_date, 1) : localDate())
  const end = input.end_date ?? addDays(start, length)
  if (end < start) throw new Error('Sprint must end after it starts')
  const s: Sprint = {
    id: uuid(),
    space_id: input.space_id,
    name: input.name?.trim() || `Sprint ${count + 1}`,
    start_date: start,
    end_date: end,
    status: 'planned',
    goal: input.goal ?? ''
  }
  run(
    'INSERT INTO sprints (id, space_id, name, start_date, end_date, status, goal) VALUES (?, ?, ?, ?, ?, ?, ?)',
    s.id, s.space_id, s.name, s.start_date, s.end_date, s.status, s.goal
  )
  return s
}

export function updateSprint(id: string, patch: Partial<Pick<Sprint, 'name' | 'start_date' | 'end_date' | 'status' | 'goal'>>): void {
  tx(() => {
    const s = sprintById(id)
    if (!s) throw new Error('Sprint not found')
    const next = { ...s, ...patch }
    if (next.end_date < next.start_date) throw new Error('Sprint must end after it starts')
    if (patch.status === 'active') {
      // one active sprint per space
      run("UPDATE sprints SET status = 'planned' WHERE space_id = ? AND status = 'active' AND id <> ?", s.space_id, id)
    }
    run(
      'UPDATE sprints SET name = ?, start_date = ?, end_date = ?, status = ?, goal = ?, updated_at = ? WHERE id = ?',
      next.name, next.start_date, next.end_date, next.status, next.goal, now(), id
    )
  })
}

export function deleteSprint(id: string): void {
  run('DELETE FROM sprints WHERE id = ?', id)
}

/**
 * Close a sprint and carry its unfinished top-level tasks over to the next
 * planned sprint in the space (created if none exists). Returns the target.
 */
export function completeSprint(id: string): { next: Sprint; moved: number } {
  return tx(() => {
    const s = sprintById(id)
    if (!s) throw new Error('Sprint not found')
    run("UPDATE sprints SET status = 'closed', updated_at = ? WHERE id = ?", now(), id)
    const next =
      get<Sprint>(
        `SELECT ${SPRINT_COLS} FROM sprints WHERE space_id = ? AND status = 'planned' AND id <> ? AND start_date >= ? ORDER BY start_date LIMIT 1`,
        s.space_id,
        id,
        s.start_date
      ) ?? createSprint({ space_id: s.space_id })
    const moved = run(
      `UPDATE tasks SET sprint_id = ?, updated_at = ?
       WHERE sprint_id = ? AND status_id IN (SELECT id FROM statuses WHERE type <> 'done')`,
      next.id,
      now(),
      id
    )
    updateSprint(next.id, { status: 'active' })
    return { next: sprintById(next.id)!, moved }
  })
}

export function getSprintStats(id: string): SprintStats | null {
  const sprint = sprintById(id)
  if (!sprint) return null
  const tasks = all<{ completed_at: string | null; done: number; est: number | null }>(
    `SELECT t.completed_at, CASE WHEN s.type = 'done' THEN 1 ELSE 0 END done, t.time_estimate_min est
     FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.sprint_id = ?`,
    id
  )
  const total = tasks.length
  const length = diffDays(sprint.start_date, sprint.end_date)
  const today = localDate()
  const days: SprintStats['days'] = []
  for (let i = 0; i <= length; i++) {
    const date = addDays(sprint.start_date, i)
    // remaining = tasks not completed by the end of that day
    const remaining =
      date > today
        ? null
        : tasks.filter((t) => !t.done || !t.completed_at || localDate(new Date(t.completed_at)) > date).length
    days.push({ date, remaining, ideal: length === 0 ? 0 : Math.round(total * (1 - i / length) * 100) / 100 })
  }
  return {
    sprint,
    total,
    done: tasks.filter((t) => t.done).length,
    estimate_min: tasks.reduce((a, t) => a + (t.est ?? 0), 0),
    days
  }
}
