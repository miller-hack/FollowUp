import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ListTree, Plus, Trash2, X } from 'lucide-react'
import { addDays, isAppDate, localDate } from '@shared/dates'
import { sortTasks } from '@shared/sort'
import { PRIORITIES, type CustomField, type Location, type Priority, type SortBy, type Status, type Task, type ViewConfig } from '@shared/types'
import { api } from '@/lib/api'
import { optimisticPatch, useRunningTimer, useTreeMaps } from '@/lib/hooks'
import { ResizeHandle, useWidths } from '@/components/Resizable'
import { cn, formatMinutes, PRIORITY_META } from '@/lib/utils'
import { TimerButton } from '../time/timer'
import { useUi } from '@/stores/ui'
import { Button, Dot, Empty, MenuItem, Popover } from '@/components/ui'
import { DateField, FieldEditor, ListPicker, PriorityPicker, StatusBadge, StatusCircle, StatusPicker, TagList, TagPicker } from '../tasks/pickers'

interface Group {
  key: string
  label: string
  color: string
  tasks: Task[]
  /** defaults for tasks created inside this group */
  defaults: { statusName?: string; priority?: Priority; due_date?: string | null }
}

function dueBucket(t: Task): string {
  if (!t.due_date) return 'none'
  const d = t.due_date.slice(0, 10)
  const today = localDate()
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d <= addDays(today, 7)) return 'week'
  return 'later'
}

const DUE_GROUPS: [string, string, string][] = [
  ['overdue', 'Overdue', '#ef4444'],
  ['today', 'Today', '#f59e0b'],
  ['week', 'Next 7 days', '#3b82f6'],
  ['later', 'Later', '#8b5cf6'],
  ['none', 'No due date', '#87909e']
]

/** One line of the virtualised list: a group header, a task (at any subtask depth) or a group's add-row. */
type Row =
  | { kind: 'group'; key: string; group: Group; collapsed: boolean }
  | { kind: 'task'; key: string; task: Task; depth: number }
  | { kind: 'add'; key: string; group: Group }

const ROW_HEIGHT = { group: 44, task: 36, add: 32 }
/** pt-3 + the sticky column header above the first row */
const LIST_OFFSET = 12 + 32

interface Props {
  tasks: Task[]
  config: ViewConfig
  onConfig: (p: Partial<ViewConfig>) => void
  statuses: Status[]
  fields: CustomField[]
  location?: Location
  defaultListId?: string
  sprintId?: string
}

export function ListView({ tasks, config, onConfig, statuses, fields, location, defaultListId, sprintId }: Props) {
  const maps = useTreeMaps()
  const { data: timer } = useRunningTimer()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const ids = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const children = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) if (t.parent_id && ids.has(t.parent_id)) m.set(t.parent_id, [...(m.get(t.parent_id) ?? []), t])
    return m
  }, [tasks, ids])
  const roots = useMemo(
    () => sortTasks(tasks.filter((t) => (config.showSubtasks ? !t.parent_id || !ids.has(t.parent_id) : !t.parent_id)), config.sortBy, config.sortDir),
    [tasks, ids, config.showSubtasks, config.sortBy, config.sortDir]
  )

  const groups = useMemo<Group[]>(() => {
    if (!maps) return []
    if (config.groupBy === 'priority')
      return PRIORITIES.map((p) => ({
        key: p,
        label: PRIORITY_META[p].label,
        color: p === 'none' ? '#87909e' : PRIORITY_META[p].color,
        tasks: roots.filter((t) => t.priority === p),
        defaults: { priority: p }
      })).filter((g) => g.tasks.length)
    if (config.groupBy === 'due')
      return DUE_GROUPS.map(([key, label, color]) => ({
        key,
        label,
        color,
        tasks: roots.filter((t) => dueBucket(t) === key),
        defaults: { due_date: key === 'today' ? localDate() : key === 'none' ? null : undefined }
      })).filter((g) => g.tasks.length)
    // by status — merge same-named statuses across spaces
    const byName = new Map<string, Group>()
    for (const s of statuses) {
      const k = s.name.toLowerCase()
      if (!byName.has(k)) byName.set(k, { key: k, label: s.name, color: s.color, tasks: [], defaults: { statusName: s.name } })
    }
    for (const t of roots) {
      const s = maps.status.get(t.status_id)
      if (s) byName.get(s.name.toLowerCase())?.tasks.push(t)
    }
    return [...byName.values()].filter(
      (g) => g.tasks.length || (!!location && statuses.find((s) => s.name.toLowerCase() === g.key)?.type !== 'done')
    )
  }, [maps, config.groupBy, roots, statuses, location])

  // flatten groups, expanded subtasks and add-rows so only the rows on screen are rendered (ADR-011)
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const pushTask = (t: Task, depth: number) => {
      out.push({ kind: 'task', key: `t:${t.id}`, task: t, depth })
      if (expanded.has(t.id)) for (const k of sortTasks(children.get(t.id) ?? [], config.sortBy, config.sortDir)) pushTask(k, depth + 1)
    }
    for (const g of groups) {
      const collapsed = collapsedGroups.has(g.key)
      out.push({ kind: 'group', key: `g:${g.key}`, group: g, collapsed })
      if (collapsed) continue
      for (const t of g.tasks) pushTask(t, 0)
      if (defaultListId) out.push({ kind: 'add', key: `a:${g.key}`, group: g })
    }
    return out
  }, [groups, collapsedGroups, expanded, children, config.sortBy, config.sortDir, defaultListId])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_HEIGHT[rows[i].kind],
    getItemKey: (i) => rows[i].key,
    overscan: 12,
    scrollMargin: LIST_OFFSET,
    initialRect: { width: 1200, height: 800 }
  })

  // resizable columns: widths remembered per column (ADR-011 list view; drag the header edge)
  const { widths: W, load: loadWidths, set: setWidth } = useWidths()
  useEffect(() => void loadWidths(), [loadWidths])

  if (!maps) return null
  const showList = location?.kind !== 'list'
  const visibleFields = fields.filter((f) => !config.hiddenFields.includes(f.id))
  const colW = (key: string, def: number) => Math.min(900, Math.max(60, W[`list.col.${key}`] ?? def))
  const nameW = W['list.col.name']
  const gridCols = [
    '28px',
    nameW ? `${colW('name', 320)}px` : 'minmax(260px, 1fr)',
    showList ? `${colW('list', 140)}px` : null,
    `${colW('status', 130)}px`,
    `${colW('due', 110)}px`,
    `${colW('priority', 80)}px`,
    `${colW('time', 130)}px`,
    `${colW('tags', 170)}px`,
    ...visibleFields.map((f) => `${colW(`field.${f.id}`, 140)}px`)
  ]
    .filter(Boolean)
    .join(' ')
  const resizer = (key: string, def: number, label: string) => (
    <ResizeHandle
      width={colW(key, def)}
      onResize={(w, persist) => setWidth(`list.col.${key}`, w === null ? null : Math.min(900, Math.max(60, Math.round(w))), persist)}
      label={`Resize the ${label} column`}
      className="absolute top-0 -right-[3px] h-full"
    />
  )

  const sortHeader = (label: string, by: SortBy) => (
    <button
      type="button"
      className="flex items-center gap-1 text-left uppercase hover:text-fg"
      onClick={() => onConfig(config.sortBy === by ? { sortDir: config.sortDir === 'asc' ? 'desc' : 'asc' } : { sortBy: by, sortDir: 'asc' })}
    >
      {label}
      {config.sortBy === by && (config.sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  )

  const toggleSel = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const renderRow = (t: Task, depth: number): React.ReactNode => {
    const list = maps.list.get(t.list_id)
    const taskStatuses = list ? maps.statusesOf(list.space_id) : []
    const status = maps.status.get(t.status_id)
    const kids = children.get(t.id) ?? []
    const open = expanded.has(t.id)
    const update = (patch: Parameters<typeof api.updateTask>[1]) => {
      optimisticPatch(t.id, patch)
      void api.updateTask(t.id, patch)
    }
    return (
      <>
        <div
          className={cn('group grid min-h-9 items-center border-b border-line text-[13px] hover:bg-hover/60', selected.has(t.id) && 'bg-accent/10')}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="flex justify-center">
            <input
              type="checkbox"
              aria-label="Select task"
              checked={selected.has(t.id)}
              onChange={() => toggleSel(t.id)}
              className={cn('opacity-0 group-hover:opacity-100', selected.size > 0 && 'opacity-100')}
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 pr-3" style={{ paddingLeft: depth * 22 }}>
            <button
              type="button"
              aria-label={open ? 'Collapse subtasks' : 'Expand subtasks'}
              onClick={() => {
                const next = new Set(expanded)
                if (open) next.delete(t.id)
                else next.add(t.id)
                setExpanded(next)
              }}
              className={cn('flex w-4 justify-center text-muted', kids.length === 0 && 'invisible')}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <StatusCircle statuses={taskStatuses} value={t.status_id} onChange={(status_id) => update({ status_id })} />
            <button
              type="button"
              onClick={() => useUi.getState().openTask(t.id)}
              className={cn('truncate text-left hover:underline', status?.type === 'done' && 'text-muted line-through')}
            >
              {t.title}
            </button>
            {t.subtask_count > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted" title="Subtasks">
                <ListTree size={12} /> {t.subtask_done}/{t.subtask_count}
              </span>
            )}
            {t.checklist_total > 0 && (
              <span className="shrink-0 text-[11px] text-muted" title="Checklist">
                ☑ {t.checklist_done}/{t.checklist_total}
              </span>
            )}
            {t.blocked_by.length > 0 && <span className="shrink-0 text-[11px] text-amber-500" title="Waiting on other tasks">⛔</span>}
          </div>
          {showList && (
            <div className="truncate pr-2 text-xs text-muted">
              <ListPicker value={t.list_id} onChange={(list_id) => update({ list_id })} trigger={<button type="button" className="truncate hover:text-fg">{list?.name}</button>} />
            </div>
          )}
          <div>
            <StatusPicker statuses={taskStatuses} value={t.status_id} onChange={(status_id) => update({ status_id })} />
          </div>
          <div className="text-xs">
            <DateField value={t.due_date} status={status} onChange={(due_date) => update({ due_date })} placeholder="" className="h-6" />
          </div>
          <div>
            <PriorityPicker value={t.priority} onChange={(priority) => update({ priority })} />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className={cn('group-hover:opacity-100', timer?.task.id === t.id ? 'opacity-100' : 'opacity-0')}>
              <TimerButton taskId={t.id} compact />
            </span>
            <span className={cn('tabular-nums', t.time_estimate_min && t.time_spent_min > t.time_estimate_min ? 'text-amber-500' : 'text-muted')}>
              {t.time_spent_min || t.time_estimate_min
                ? `${formatMinutes(t.time_spent_min) || '0m'}${t.time_estimate_min ? ` / ${formatMinutes(t.time_estimate_min)}` : ''}`
                : ''}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1 overflow-hidden pr-2">
            <TagList ids={t.tag_ids} />
            <span className="opacity-0 group-hover:opacity-100">
              <TagPicker value={t.tag_ids} onChange={(tag_ids) => update({ tag_ids })} />
            </span>
          </div>
          {visibleFields.map((f) => (
            <div key={f.id} className="min-w-0 truncate pr-2 text-xs">
              <FieldEditor field={f} value={t.fields[f.id]} onChange={(v) => update({ fields: { [f.id]: v } })} />
            </div>
          ))}
        </div>
      </>
    )
  }

  const createIn = async (g: Group, title: string) => {
    if (!defaultListId) return
    const list = maps.list.get(defaultListId)!
    const status = g.defaults.statusName
      ? maps.statusesOf(list.space_id).find((s) => s.name.toLowerCase() === g.defaults.statusName!.toLowerCase())
      : undefined
    await api.createTask({
      list_id: defaultListId,
      title,
      status_id: status?.id,
      priority: g.defaults.priority,
      due_date: g.defaults.due_date ?? undefined,
      sprint_id: sprintId
    })
  }

  const toggleGroup = (key: string) => {
    const next = new Set(collapsedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsedGroups(next)
  }

  const renderItem = (row: Row): React.ReactNode => {
    if (row.kind === 'task') return renderRow(row.task, row.depth)
    if (row.kind === 'add') return <AddRow onAdd={(title) => createIn(row.group, title)} />
    const g = row.group
    return (
      <div className="pt-4 pb-1">
        <button type="button" className="flex items-center gap-2" onClick={() => toggleGroup(g.key)}>
          {row.collapsed ? <ChevronRight size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
          {config.groupBy === 'status' ? (
            <StatusBadge status={{ id: g.key, space_id: '', name: g.label, color: g.color, type: 'open', position: 0 }} />
          ) : (
            <span className="flex items-center gap-1.5 font-semibold"><Dot color={g.color} />{g.label}</span>
          )}
          <span className="text-xs text-muted">{g.tasks.length}</span>
        </button>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  const margin = virtualizer.options.scrollMargin
  const padTop = items.length ? items[0].start - margin : 0
  const padBottom = items.length ? Math.max(0, virtualizer.getTotalSize() - (items[items.length - 1].end - margin)) : 0

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto">
      <div className="min-w-fit px-6 pt-3 pb-24">
        <div className="sticky top-0 z-10 grid h-8 items-center border-b border-line bg-bg text-[11px] font-medium uppercase tracking-wide text-muted" style={{ gridTemplateColumns: gridCols }}>
          <div className="flex justify-center">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={selected.size > 0 && selected.size === tasks.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(tasks.map((t) => t.id)) : new Set())}
            />
          </div>
          <div className="relative h-full pl-6 leading-8">{sortHeader('Name', 'title')}{resizer('name', 320, 'Name')}</div>
          {showList && <div className="relative h-full leading-8">List{resizer('list', 140, 'List')}</div>}
          <div className="relative h-full leading-8">Status{resizer('status', 130, 'Status')}</div>
          <div className="relative h-full leading-8">{sortHeader('Due', 'due_date')}{resizer('due', 110, 'Due')}</div>
          <div className="relative h-full leading-8">{sortHeader('Priority', 'priority')}{resizer('priority', 80, 'Priority')}</div>
          <div className="relative h-full leading-8">Time{resizer('time', 130, 'Time')}</div>
          <div className="relative h-full leading-8">Tags{resizer('tags', 170, 'Tags')}</div>
          {visibleFields.map((f) => (
            <div key={f.id} className="relative h-full truncate pr-2 leading-8">
              {f.name}
              {resizer(`field.${f.id}`, 140, f.name)}
            </div>
          ))}
        </div>

        {groups.length === 0 && <Empty>No tasks match. Press Ctrl+N to create one.</Empty>}
        {/* in-flow spacers keep the sticky header and horizontal scrolling of a normal list */}
        <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {items.map((vi) => (
            <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement}>
              {renderItem(rows[vi.index])}
            </div>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          statuses={statuses}
          onDone={() => setSelected(new Set())}
        />
      )}
    </div>
  )
}

function AddRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)} className="flex h-8 items-center gap-1.5 pl-[58px] text-xs text-muted hover:text-fg">
        <Plus size={13} /> New task
      </button>
    )
  return (
    <div className="flex h-9 items-center gap-2 border-b border-line pl-[58px]">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Task name, Enter to save"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            onAdd(text.trim())
            setText('')
          }
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => !text && setEditing(false)}
        className="flex-1 bg-transparent outline-none"
      />
    </div>
  )
}

function BulkBar({ ids, statuses, onDone }: { ids: string[]; statuses: Status[]; onDone: () => void }) {
  const maps = useTreeMaps()
  const uniqueStatuses = [...new Map(statuses.map((s) => [s.name.toLowerCase(), s])).values()]
  return (
    <div className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-2xl">
      <span className="px-1 font-medium">{ids.length} selected</span>
      <Popover trigger={<Button size="sm">Status</Button>}>
        {(close) =>
          uniqueStatuses.map((s) => (
            <MenuItem
              key={s.id}
              icon={<Dot color={s.color} />}
              onClick={async () => {
                close()
                // map the chosen status name to each task's own space
                for (const id of ids) {
                  const listId = (await api.getTask(id))?.list_id
                  const spaceId = listId ? maps?.list.get(listId)?.space_id : undefined
                  const target = spaceId ? maps?.statusesOf(spaceId).find((x) => x.name.toLowerCase() === s.name.toLowerCase()) : undefined
                  if (target) await api.updateTask(id, { status_id: target.id })
                }
                onDone()
              }}
            >
              {s.name}
            </MenuItem>
          ))
        }
      </Popover>
      <Popover trigger={<Button size="sm">Priority</Button>}>
        {(close) =>
          PRIORITIES.map((p) => (
            <MenuItem key={p} onClick={async () => (close(), await api.bulkUpdateTasks(ids, { priority: p }), onDone())}>
              {PRIORITY_META[p].label}
            </MenuItem>
          ))
        }
      </Popover>
      <Popover trigger={<Button size="sm">Due date</Button>}>
        {(close) => (
          <div className="p-1">
            <input
              type="date"
              autoFocus
              aria-label="New due date"
              className="h-8 rounded-md border border-line bg-panel px-2"
              // save once the date is complete (blur / Enter), not on every keystroke
              onBlur={async (e) => {
                if (!isAppDate(e.target.value)) return
                close()
                await api.bulkUpdateTasks(ids, { due_date: e.target.value })
                onDone()
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={async () => (close(), await api.bulkUpdateTasks(ids, { due_date: null }), onDone())}>
              Clear due date
            </Button>
          </div>
        )}
      </Popover>
      <ListPicker onChange={async (list_id) => (await api.bulkUpdateTasks(ids, { list_id }), onDone())} trigger={<Button size="sm">Move</Button>} />
      <Button
        size="sm"
        variant="danger"
        onClick={async () => {
          if (window.confirm(`Delete ${ids.length} task(s)?`)) {
            await api.deleteTasks(ids)
            onDone()
          }
        }}
      >
        <Trash2 size={13} /> Delete
      </Button>
      <button type="button" aria-label="Clear selection" className="ml-1 text-muted hover:text-fg" onClick={onDone}>
        <X size={16} />
      </button>
    </div>
  )
}
