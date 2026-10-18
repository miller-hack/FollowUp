import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownUp, CalendarClock, ChevronDown, CircleDot, Eye, Flag, Layers, Search, Tag, X } from 'lucide-react'
import { PRIORITIES, type DueFilter, type GroupBy, type SortBy, type Status, type ViewConfig } from '@shared/types'
import { useTags } from '@/lib/hooks'
import { cn, PRIORITY_META } from '@/lib/utils'
import { Dot, MenuItem, MenuSeparator, Popover } from '@/components/ui'
import { PriorityIcon, TagChip } from '../tasks/pickers'

function Chip({ icon, label, active, onClear }: { icon: ReactNode; label: string; active?: boolean; onClear?: () => void }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs',
        active ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'
      )}
    >
      {icon}
      {label}
      {active && onClear ? (
        <span
          role="button"
          aria-label="Clear filter"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
        >
          <X size={12} />
        </span>
      ) : (
        <ChevronDown size={12} />
      )}
    </span>
  )
}

const toggleIn = <T,>(arr: T[] | undefined, v: T): T[] => (arr?.includes(v) ? arr.filter((x) => x !== v) : [...(arr ?? []), v])

const DUE_LABEL: Record<DueFilter, string> = { overdue: 'Overdue', today: 'Due today', week: 'Next 7 days', none: 'No due date' }
const SORT_LABEL: Record<SortBy, string> = { position: 'Manual', title: 'Name', due_date: 'Due date', priority: 'Priority', created_at: 'Created' }
const GROUP_LABEL: Record<GroupBy, string> = { status: 'Status', priority: 'Priority', due: 'Due date' }

export function FilterBar({ config, onChange, statuses }: { config: ViewConfig; onChange: (p: Partial<ViewConfig>) => void; statuses: Status[] }) {
  const { data: tags = [] } = useTags()
  const f = config.filter
  const setFilter = (patch: Partial<ViewConfig['filter']>) => onChange({ filter: { ...f, ...patch } })
  const [search, setSearch] = useState(f.search ?? '')
  useEffect(() => setSearch(f.search ?? ''), [f.search])
  useEffect(() => {
    const h = setTimeout(() => (search || '') !== (f.search || '') && setFilter({ search }), 250)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // statuses can repeat by name across spaces ("Everything" view) — show unique names, filter by all matching ids
  const statusGroups = [...new Map(statuses.map((s) => [s.name.toLowerCase(), s])).values()].map((s) => ({
    ...s,
    ids: statuses.filter((x) => x.name.toLowerCase() === s.name.toLowerCase()).map((x) => x.id)
  }))

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-6 py-2">
      <label className="flex h-7 w-52 items-center gap-1.5 rounded-md border border-line px-2 text-muted focus-within:border-accent">
        <Search size={13} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-muted"
        />
      </label>

      <Popover trigger={<Chip icon={<CircleDot size={13} />} label={f.statusIds?.length ? `Status (${statusGroups.filter((g) => g.ids.some((id) => f.statusIds!.includes(id))).length})` : 'Status'} active={!!f.statusIds?.length} onClear={() => setFilter({ statusIds: [] })} />}>
        {statusGroups.map((s) => {
          const on = s.ids.some((id) => f.statusIds?.includes(id))
          return (
            <MenuItem
              key={s.id}
              active={on}
              icon={<Dot color={s.color} />}
              onClick={() => setFilter({ statusIds: on ? (f.statusIds ?? []).filter((id) => !s.ids.includes(id)) : [...(f.statusIds ?? []), ...s.ids] })}
            >
              {s.name}
            </MenuItem>
          )
        })}
      </Popover>

      <Popover trigger={<Chip icon={<Flag size={13} />} label={f.priorities?.length ? `Priority (${f.priorities.length})` : 'Priority'} active={!!f.priorities?.length} onClear={() => setFilter({ priorities: [] })} />}>
        {PRIORITIES.map((p) => (
          <MenuItem key={p} active={f.priorities?.includes(p)} icon={<PriorityIcon priority={p} />} onClick={() => setFilter({ priorities: toggleIn(f.priorities, p) })}>
            {PRIORITY_META[p].label}
          </MenuItem>
        ))}
      </Popover>

      <Popover trigger={<Chip icon={<Tag size={13} />} label={f.tagIds?.length ? `Tags (${f.tagIds.length})` : 'Tags'} active={!!f.tagIds?.length} onClear={() => setFilter({ tagIds: [] })} />}>
        <div className="max-h-72 overflow-auto">
          {tags.length === 0 && <div className="p-2 text-xs text-muted">No tags yet</div>}
          {tags.map((t) => (
            <MenuItem key={t.id} active={f.tagIds?.includes(t.id)} onClick={() => setFilter({ tagIds: toggleIn(f.tagIds, t.id) })}>
              <TagChip tag={t} />
            </MenuItem>
          ))}
        </div>
      </Popover>

      <Popover trigger={<Chip icon={<CalendarClock size={13} />} label={f.due ? DUE_LABEL[f.due] : 'Due'} active={!!f.due} onClear={() => setFilter({ due: null })} />}>
        {(close) =>
          (Object.keys(DUE_LABEL) as DueFilter[]).map((d) => (
            <MenuItem key={d} active={f.due === d} onClick={() => (setFilter({ due: f.due === d ? null : d }), close())}>
              {DUE_LABEL[d]}
            </MenuItem>
          ))
        }
      </Popover>

      <div className="flex-1" />

      {config.view === 'list' && (
        <Popover align="end" trigger={<Chip icon={<Layers size={13} />} label={`Group: ${GROUP_LABEL[config.groupBy]}`} />}>
          {(close) =>
            (Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
              <MenuItem key={g} active={config.groupBy === g} onClick={() => (onChange({ groupBy: g }), close())}>
                {GROUP_LABEL[g]}
              </MenuItem>
            ))
          }
        </Popover>
      )}
      {(config.view === 'list' || config.view === 'board') && (
        <Popover align="end" trigger={<Chip icon={<ArrowDownUp size={13} />} label={`Sort: ${SORT_LABEL[config.sortBy]}`} />}>
          {(close) => (
            <>
              {(Object.keys(SORT_LABEL) as SortBy[]).map((s) => (
                <MenuItem key={s} active={config.sortBy === s} onClick={() => (onChange({ sortBy: s }), close())}>
                  {SORT_LABEL[s]}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem active={config.sortDir === 'asc'} onClick={() => onChange({ sortDir: 'asc' })}>Ascending</MenuItem>
              <MenuItem active={config.sortDir === 'desc'} onClick={() => onChange({ sortDir: 'desc' })}>Descending</MenuItem>
            </>
          )}
        </Popover>
      )}
      {config.view !== 'board' && (
        <Popover align="end" trigger={<Chip icon={<Eye size={13} />} label="Show" />}>
          <MenuItem active={!!f.includeClosed} onClick={() => setFilter({ includeClosed: !f.includeClosed })}>Closed tasks</MenuItem>
          {config.view === 'list' && (
            <MenuItem active={config.showSubtasks} onClick={() => onChange({ showSubtasks: !config.showSubtasks })}>Subtasks</MenuItem>
          )}
        </Popover>
      )}
    </div>
  )
}
