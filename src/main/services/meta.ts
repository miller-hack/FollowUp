import type { CustomField, FieldOption, FieldType, List, SearchResult, Settings, Tag, TaskRef, ViewConfig } from '@shared/types'
import { all, get, now, run, uuid } from '../db'
import { ftsQuery } from './tasks'
import { decryptSecret, encryptSecret } from './mail/secrets'

// ---------------------------------------------------------------- tags

const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']

export function listTags(): Tag[] {
  return all<Tag>('SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE')
}

export function createTag(input: { name: string; color?: string }): Tag {
  const name = input.name.trim()
  if (!name) throw new Error('Give the tag a name')
  const existing = get<Tag>('SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE', name)
  if (existing) return existing
  const count = get<{ n: number }>('SELECT COUNT(*) n FROM tags')?.n ?? 0
  const tag: Tag = { id: uuid(), name, color: input.color ?? TAG_COLORS[count % TAG_COLORS.length] }
  run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', tag.id, tag.name, tag.color)
  return tag
}

export function updateTag(id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>): void {
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('Give the tag a name')
    run('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?', patch.name.trim(), now(), id)
  }
  if (patch.color !== undefined) run('UPDATE tags SET color = ?, updated_at = ? WHERE id = ?', patch.color, now(), id)
}

export function deleteTag(id: string): void {
  run('DELETE FROM tags WHERE id = ?', id)
}

// ---------------------------------------------------------------- custom fields

export function listFields(spaceId?: string): CustomField[] {
  const rows = spaceId
    ? all<CustomField & { options: string }>('SELECT id, space_id, name, type, options, position FROM custom_fields WHERE space_id = ? ORDER BY position', spaceId)
    : all<CustomField & { options: string }>('SELECT id, space_id, name, type, options, position FROM custom_fields ORDER BY position')
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as FieldOption[] }))
}

export function createField(input: { space_id: string; name: string; type: FieldType; options?: FieldOption[] }): CustomField {
  const position = (get<{ p: number | null }>('SELECT MAX(position) p FROM custom_fields WHERE space_id = ?', input.space_id)?.p ?? 0) + 1
  const field: CustomField = {
    id: uuid(),
    space_id: input.space_id,
    name: input.name.trim() || 'Field',
    type: input.type,
    options: input.options ?? [],
    position
  }
  run(
    'INSERT INTO custom_fields (id, space_id, name, type, options, position) VALUES (?, ?, ?, ?, ?, ?)',
    field.id, field.space_id, field.name, field.type, field.options, field.position
  )
  return field
}

export function updateField(id: string, patch: Partial<Pick<CustomField, 'name' | 'options'>>): void {
  if (patch.name !== undefined) run('UPDATE custom_fields SET name = ?, updated_at = ? WHERE id = ?', patch.name, now(), id)
  if (patch.options !== undefined) run('UPDATE custom_fields SET options = ?, updated_at = ? WHERE id = ?', patch.options, now(), id)
}

export function deleteField(id: string): void {
  run('DELETE FROM custom_fields WHERE id = ?', id)
}

// ---------------------------------------------------------------- settings & saved views

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStart: 1,
  lastBackupAt: null,
  notifications: { dueEnabled: true, dueLeadMin: 15, dueDayTime: '09:00', digestEnabled: true, digestTime: '08:30' },
  closeToTray: true,
  closeAsked: false,
  startAtLogin: false,
  mail: { syncIntervalMin: 2, loadRemoteImages: false },
  followups: { missedPolicy: 'send' },
  ai: {
    provider: 'anthropic',
    anthropicModel: 'claude-opus-5-5',
    openaiModel: 'gpt-5',
    ollamaModel: 'llama3.1',
    ollamaUrl: 'http://localhost:11434',
    effort: 'medium',
    autoTriage: false
  },
  updates: { auto: true, feedUrl: '' },
  oauth: { googleClientId: '', microsoftClientId: '' }
}

const NESTED = ['notifications', 'mail', 'followups', 'ai', 'updates', 'oauth'] as const

function getKey<T>(key: string): T | null {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
  return row ? (JSON.parse(row.value) as T) : null
}

function setKey(key: string, value: unknown): void {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
}

export function getSettings(): Settings {
  const stored = getKey<Partial<Settings>>('app') ?? {}
  const out = { ...DEFAULT_SETTINGS, ...stored } as Settings
  for (const k of NESTED) Object.assign(out, { [k]: { ...DEFAULT_SETTINGS[k], ...(stored[k] ?? {}) } })
  return out
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings()
  const next = { ...cur, ...patch } as Settings
  for (const k of NESTED) Object.assign(next, { [k]: { ...cur[k], ...(patch[k] ?? {}) } })
  setKey('app', next)
  return next
}

/** Encrypted values kept in the settings table (never part of `Settings`, never sent to the renderer). */
export function getSecretSetting(name: string): string {
  const v = getKey<string>(`secret:${name}`)
  return v ? decryptSecret(v) : ''
}

export function setSecretSetting(name: string, value: string | null): void {
  if (!value) run('DELETE FROM settings WHERE key = ?', `secret:${name}`)
  else setKey(`secret:${name}`, encryptSecret(value))
}

export function getViewConfig(key: string): ViewConfig | null {
  return getKey<ViewConfig>(`view:${key}`)
}

export function setViewConfig(key: string, config: ViewConfig): void {
  setKey(`view:${key}`, config)
}

// ---------------------------------------------------------------- global search

export function search(query: string): SearchResult {
  const q = ftsQuery(query)
  if (!q) return { tasks: [], lists: [] }
  const tasks = all<TaskRef>(
    `SELECT t.id, t.title, t.status_id, t.list_id FROM tasks_fts f JOIN tasks t ON t.id = f.task_id
     WHERE tasks_fts MATCH ? ORDER BY rank LIMIT 30`,
    q
  )
  const like = `%${query.trim().replace(/[%_]/g, '')}%`
  const lists = all<List>('SELECT id, space_id, folder_id, name, color, position FROM lists WHERE name LIKE ? ORDER BY name LIMIT 10', like)
  return { tasks, lists }
}
