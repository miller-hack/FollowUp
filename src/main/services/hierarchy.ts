import type { Folder, List, Space, Sprint, Status, StatusInput, Tree } from '@shared/types'
import { all, get, marks, now, run, tx, uuid } from '../db'
import { attachmentFilesOf, removeFiles } from './tasks'

export const DEFAULT_STATUSES: StatusInput[] = [
  { name: 'To Do', color: '#87909e', type: 'open' },
  { name: 'In Progress', color: '#3b82f6', type: 'active' },
  { name: 'Review', color: '#a855f7', type: 'active' },
  { name: 'Done', color: '#22c55e', type: 'done' }
]

const nextPos = (table: string, where = '1=1', ...params: unknown[]): number =>
  (get<{ p: number | null }>(`SELECT MAX(position) p FROM ${table} WHERE ${where}`, ...params)?.p ?? 0) + 1

export function getTree(): Tree {
  return {
    spaces: all<Space>('SELECT id, name, color, position FROM spaces ORDER BY position'),
    folders: all<Folder>('SELECT id, space_id, name, position FROM folders ORDER BY position'),
    lists: all<List>('SELECT id, space_id, folder_id, name, color, position FROM lists ORDER BY position'),
    statuses: all<Status>('SELECT id, space_id, name, color, type, position FROM statuses ORDER BY position'),
    sprints: all<Sprint>('SELECT id, space_id, name, start_date, end_date, status, goal FROM sprints ORDER BY start_date')
  }
}

export function createSpace(input: { name: string; color?: string }): Space {
  return tx(() => {
    const space: Space = {
      id: uuid(),
      name: input.name.trim() || 'New Space',
      color: input.color ?? '#7b68ee',
      position: nextPos('spaces')
    }
    run('INSERT INTO spaces (id, name, color, position) VALUES (?, ?, ?, ?)', space.id, space.name, space.color, space.position)
    saveStatuses(space.id, DEFAULT_STATUSES)
    return space
  })
}

export function updateSpace(id: string, patch: Partial<Pick<Space, 'name' | 'color'>>): void {
  if (patch.name !== undefined) run('UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?', patch.name, now(), id)
  if (patch.color !== undefined) run('UPDATE spaces SET color = ?, updated_at = ? WHERE id = ?', patch.color, now(), id)
}

export function deleteSpace(id: string): void {
  const files = attachmentFilesOf('l.space_id = ?', id)
  tx(() => {
    // tasks reference statuses without cascade, so remove tasks first
    run('DELETE FROM tasks_fts WHERE task_id IN (SELECT t.id FROM tasks t JOIN lists l ON l.id = t.list_id WHERE l.space_id = ?)', id)
    run('DELETE FROM tasks WHERE list_id IN (SELECT id FROM lists WHERE space_id = ?)', id)
    run('DELETE FROM spaces WHERE id = ?', id)
  })
  removeFiles(files)
}

export function createFolder(input: { space_id: string; name: string }): Folder {
  const folder: Folder = {
    id: uuid(),
    space_id: input.space_id,
    name: input.name.trim() || 'New Folder',
    position: nextPos('folders', 'space_id = ?', input.space_id)
  }
  run('INSERT INTO folders (id, space_id, name, position) VALUES (?, ?, ?, ?)', folder.id, folder.space_id, folder.name, folder.position)
  return folder
}

export function updateFolder(id: string, patch: Partial<Pick<Folder, 'name'>>): void {
  if (patch.name !== undefined) run('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?', patch.name, now(), id)
}

export function deleteFolder(id: string): void {
  const files = attachmentFilesOf('l.folder_id = ?', id)
  tx(() => {
    run('DELETE FROM tasks_fts WHERE task_id IN (SELECT t.id FROM tasks t JOIN lists l ON l.id = t.list_id WHERE l.folder_id = ?)', id)
    run('DELETE FROM folders WHERE id = ?', id)
  })
  removeFiles(files)
}

export function createList(input: { space_id: string; folder_id?: string | null; name: string }): List {
  const list: List = {
    id: uuid(),
    space_id: input.space_id,
    folder_id: input.folder_id ?? null,
    name: input.name.trim() || 'New List',
    color: null,
    position: nextPos('lists', 'space_id = ?', input.space_id)
  }
  run(
    'INSERT INTO lists (id, space_id, folder_id, name, position) VALUES (?, ?, ?, ?, ?)',
    list.id, list.space_id, list.folder_id, list.name, list.position
  )
  return list
}

export function updateList(id: string, patch: Partial<Pick<List, 'name' | 'color' | 'folder_id' | 'space_id'>>): void {
  tx(() => {
    const list = get<List>('SELECT * FROM lists WHERE id = ?', id)
    if (!list) throw new Error('List not found')
    if (patch.name !== undefined) run('UPDATE lists SET name = ? WHERE id = ?', patch.name, id)
    if (patch.color !== undefined) run('UPDATE lists SET color = ? WHERE id = ?', patch.color, id)
    if (patch.folder_id !== undefined) run('UPDATE lists SET folder_id = ? WHERE id = ?', patch.folder_id, id)
    if (patch.space_id !== undefined && patch.space_id !== list.space_id) {
      run('UPDATE lists SET space_id = ?, folder_id = ? WHERE id = ?', patch.space_id, patch.folder_id ?? null, id)
      remapStatuses(`list_id = ?`, [id], patch.space_id)
    }
    run('UPDATE lists SET updated_at = ? WHERE id = ?', now(), id)
  })
}

export function deleteList(id: string): void {
  const files = attachmentFilesOf('t.list_id = ?', id)
  tx(() => {
    run('DELETE FROM tasks_fts WHERE task_id IN (SELECT id FROM tasks WHERE list_id = ?)', id)
    run('DELETE FROM lists WHERE id = ?', id)
  })
  removeFiles(files)
}

export function reorder(kind: 'space' | 'folder' | 'list', ids: string[]): void {
  const table = { space: 'spaces', folder: 'folders', list: 'lists' }[kind]
  tx(() => ids.forEach((id, i) => run(`UPDATE ${table} SET position = ? WHERE id = ?`, i + 1, id)))
}

/**
 * Replace the status set of a space. Existing statuses keep their id when passed;
 * tasks on removed statuses move to the first remaining status of the same type
 * (or the first status overall).
 */
export function saveStatuses(spaceId: string, statuses: StatusInput[]): void {
  if (statuses.length === 0) throw new Error('A space needs at least one status')
  tx(() => {
    const keep: string[] = []
    statuses.forEach((s, i) => {
      if (s.id && get('SELECT id FROM statuses WHERE id = ? AND space_id = ?', s.id, spaceId)) {
        run('UPDATE statuses SET name = ?, color = ?, type = ?, position = ?, updated_at = ? WHERE id = ?', s.name, s.color, s.type, i + 1, now(), s.id)
        keep.push(s.id)
      } else {
        const id = uuid()
        run('INSERT INTO statuses (id, space_id, name, color, type, position) VALUES (?, ?, ?, ?, ?, ?)', id, spaceId, s.name, s.color, s.type, i + 1)
        keep.push(id)
      }
    })
    const removed = all<Status>(`SELECT * FROM statuses WHERE space_id = ? AND id NOT IN (${marks(keep.length)})`, spaceId, ...keep)
    for (const r of removed) {
      const target =
        get<{ id: string }>('SELECT id FROM statuses WHERE space_id = ? AND type = ? AND id IN (' + marks(keep.length) + ') ORDER BY position', spaceId, r.type, ...keep)?.id ??
        keep[0]
      run('UPDATE tasks SET status_id = ? WHERE status_id = ?', target, r.id)
      run('DELETE FROM statuses WHERE id = ?', r.id)
    }
  })
}

/** After tasks move to another space, map their status to the same-named (or same-type) status there. */
export function remapStatuses(where: string, params: unknown[], spaceId: string): void {
  const target = all<Status>('SELECT * FROM statuses WHERE space_id = ? ORDER BY position', spaceId)
  const tasks = all<{ id: string; name: string; type: string }>(
    `SELECT t.id, s.name, s.type FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE ${where} AND s.space_id <> ?`,
    ...params,
    spaceId
  )
  for (const t of tasks) {
    const match =
      target.find((s) => s.name.toLowerCase() === t.name.toLowerCase()) ?? target.find((s) => s.type === t.type) ?? target[0]
    run('UPDATE tasks SET status_id = ? WHERE id = ?', match.id, t.id)
  }
}

export function spaceOfList(listId: string): string {
  const row = get<{ space_id: string }>('SELECT space_id FROM lists WHERE id = ?', listId)
  if (!row) throw new Error('List not found')
  return row.space_id
}
