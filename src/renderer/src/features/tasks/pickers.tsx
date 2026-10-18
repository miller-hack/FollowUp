import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Calendar, Flag, Plus, Star, Tag as TagIcon, X } from 'lucide-react'
import { addDays, hasTime, isAppDate, localDate } from '@shared/dates'
import { PRIORITIES, type CustomField, type Priority, type Status, type Tag } from '@shared/types'
import { api } from '@/lib/api'
import { useTags, useTreeMaps } from '@/lib/hooks'
import { cn, dueTone, formatDue, PRIORITY_META } from '@/lib/utils'
import { Button, Dot, Input, MenuItem, MenuSeparator, Popover } from '@/components/ui'

// ---------------------------------------------------------------- status

export function StatusBadge({ status, compact }: { status?: Status; compact?: boolean }) {
  if (!status) return null
  if (compact) return <Dot color={status.color} size={10} />
  return (
    <span
      className="inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold uppercase tracking-wide text-white"
      style={{ background: status.color }}
    >
      {status.name}
    </span>
  )
}

export function StatusPicker({
  statuses,
  value,
  onChange,
  trigger
}: {
  statuses: Status[]
  value: string
  onChange: (id: string) => void
  trigger?: ReactNode
}) {
  const current = statuses.find((s) => s.id === value)
  return (
    <Popover trigger={trigger ?? <button type="button"><StatusBadge status={current} /></button>}>
      {(close) =>
        statuses.map((s) => (
          <MenuItem key={s.id} active={s.id === value} icon={<Dot color={s.color} />} onClick={() => (onChange(s.id), close())}>
            {s.name}
          </MenuItem>
        ))
      }
    </Popover>
  )
}

/** Round button that completes a task (or reopens it). */
export function StatusCircle({ statuses, value, onChange }: { statuses: Status[]; value: string; onChange: (id: string) => void }) {
  const current = statuses.find((s) => s.id === value)
  const done = current?.type === 'done'
  const target = done ? statuses.find((s) => s.type === 'open') : statuses.find((s) => s.type === 'done')
  return (
    <button
      type="button"
      title={done ? 'Reopen' : 'Complete'}
      onClick={(e) => {
        e.stopPropagation()
        if (target) onChange(target.id)
      }}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[9px] text-white"
      style={{ borderColor: current?.color, background: done ? current?.color : 'transparent' }}
    >
      {done && '✓'}
    </button>
  )
}

// ---------------------------------------------------------------- priority

export function PriorityIcon({ priority, showLabel }: { priority: Priority; showLabel?: boolean }) {
  const meta = PRIORITY_META[priority]
  if (priority === 'none')
    return showLabel ? <span className="text-muted">—</span> : <Flag size={14} className="text-muted opacity-40" />
  return (
    <span className="inline-flex items-center gap-1">
      <Flag size={14} fill={meta.color} color={meta.color} />
      {showLabel && <span>{meta.label}</span>}
    </span>
  )
}

export function PriorityPicker({ value, onChange, showLabel }: { value: Priority; onChange: (p: Priority) => void; showLabel?: boolean }) {
  return (
    <Popover trigger={<button type="button" className="inline-flex items-center"><PriorityIcon priority={value} showLabel={showLabel} /></button>}>
      {(close) =>
        PRIORITIES.map((p) => (
          <MenuItem key={p} active={p === value} icon={<PriorityIcon priority={p} />} onClick={() => (onChange(p), close())}>
            {PRIORITY_META[p].label}
          </MenuItem>
        ))
      }
    </Popover>
  )
}

// ---------------------------------------------------------------- dates

export function DatePanel({ value, onChange, close }: { value: string | null; onChange: (v: string | null) => void; close: () => void }) {
  const [withTime, setWithTime] = useState(!!value && hasTime(value))
  // typed dates are saved once complete (blur / Enter), not on every keystroke (M10)
  const typed = useRef('')
  const commit = () => {
    const v = typed.current
    typed.current = ''
    if (isAppDate(v) && v !== value) onChange(v)
  }
  // clicking outside can unmount the panel before blur fires: save on close too (once)
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])
  const today = localDate()
  const nextMonday = addDays(today, ((8 - new Date().getDay()) % 7) || 7)
  const set = (v: string | null) => {
    onChange(v)
    close()
  }
  const quick: [string, string][] = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['Next week', nextMonday],
    ['In 2 weeks', addDays(today, 14)]
  ]
  return (
    <div className="w-60 p-1">
      <div className="mb-1 grid grid-cols-2 gap-1">
        {quick.map(([label, d]) => (
          <Button key={label} size="sm" variant="ghost" className="justify-start" onClick={() => set(d)}>
            {label}
          </Button>
        ))}
      </div>
      <MenuSeparator />
      <div className="space-y-2 p-1">
        <Input
          key={withTime ? 'time' : 'date'}
          type={withTime ? 'datetime-local' : 'date'}
          aria-label={withTime ? 'Date and time' : 'Date'}
          defaultValue={value ? (withTime ? (hasTime(value) ? value : `${value}T09:00`) : value.slice(0, 10)) : ''}
          onChange={(e) => (typed.current = e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
              close()
            }
          }}
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />
          Include time
        </label>
        {value && (
          <Button size="sm" variant="ghost" className="w-full text-danger" onClick={() => set(null)}>
            Clear date
          </Button>
        )}
      </div>
    </div>
  )
}

export function DateField({
  value,
  onChange,
  status,
  placeholder = 'Set date',
  className
}: {
  value: string | null
  onChange: (v: string | null) => void
  status?: Status
  placeholder?: string
  className?: string
}) {
  return (
    <Popover
      trigger={
        <button type="button" className={cn('inline-flex items-center gap-1 whitespace-nowrap', value ? dueTone(value, status) : 'text-muted', className)}>
          {value ? formatDue(value) : <><Calendar size={13} className="opacity-60" /><span className="opacity-70">{placeholder}</span></>}
        </button>
      }
    >
      {(close) => <DatePanel value={value} onChange={onChange} close={close} />}
    </Popover>
  )
}

// ---------------------------------------------------------------- tags

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-0.5 rounded px-1.5 text-[11px] font-medium"
      style={{ background: `${tag.color}26`, color: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button type="button" onClick={(e) => (e.stopPropagation(), onRemove())} aria-label={`Remove ${tag.name}`}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}

export function TagPicker({ value, onChange, trigger }: { value: string[]; onChange: (ids: string[]) => void; trigger?: ReactNode }) {
  const { data: tags = [] } = useTags()
  const [q, setQ] = useState('')
  const filtered = tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
  const exact = tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase())
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <Popover
      trigger={
        trigger ?? (
          <button type="button" className="inline-flex items-center text-muted hover:text-fg" aria-label="Edit tags">
            <TagIcon size={13} />
          </button>
        )
      }
    >
      <div className="w-56">
        <Input
          autoFocus
          placeholder="Search or create tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && q.trim()) {
              const match = tags.find((t) => t.name.toLowerCase() === q.trim().toLowerCase())
              const tag = match ?? (await api.createTag({ name: q.trim() }))
              if (!value.includes(tag.id)) onChange([...value, tag.id])
              setQ('')
            }
          }}
        />
        <div className="mt-1 max-h-60 overflow-auto">
          {filtered.map((t) => (
            <MenuItem key={t.id} active={value.includes(t.id)} onClick={() => toggle(t.id)}>
              <TagChip tag={t} />
            </MenuItem>
          ))}
          {q.trim() && !exact && (
            <MenuItem
              icon={<Plus size={14} />}
              onClick={async () => {
                const tag = await api.createTag({ name: q.trim() })
                onChange([...value, tag.id])
                setQ('')
              }}
            >
              Create “{q.trim()}”
            </MenuItem>
          )}
        </div>
      </div>
    </Popover>
  )
}

export function TagList({ ids, onChange }: { ids: string[]; onChange?: (ids: string[]) => void }) {
  const { data: tags = [] } = useTags()
  const shown = ids.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as Tag[]
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={onChange ? () => onChange(ids.filter((x) => x !== t.id)) : undefined} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- list picker

export function ListPicker({ value, onChange, trigger }: { value?: string; onChange: (listId: string) => void; trigger: ReactNode }) {
  const maps = useTreeMaps()
  if (!maps) return null
  return (
    <Popover trigger={trigger}>
      {(close) => (
        <div className="max-h-80 w-64 overflow-auto">
          {maps.spaces.map((s) => (
            <div key={s.id}>
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-muted">
                <Dot color={s.color} /> {s.name}
              </div>
              {maps.lists
                .filter((l) => l.space_id === s.id)
                .map((l) => (
                  <MenuItem key={l.id} active={l.id === value} onClick={() => (onChange(l.id), close())}>
                    {l.folder_id ? `${maps.folder.get(l.folder_id)?.name} / ` : ''}
                    {l.name}
                  </MenuItem>
                ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------- custom field values

/** Whole number within [min, max]; NaN → min. */
const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min)

export function FieldValue({ field, value }: { field: CustomField; value: unknown }) {
  if (value === undefined || value === null || value === '') return <span className="text-muted opacity-50">—</span>
  switch (field.type) {
    case 'checkbox':
      return <span>{value ? '☑' : '☐'}</span>
    case 'money':
      return <span>{Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</span>
    case 'date':
      return <span>{formatDue(String(value))}</span>
    case 'rating':
      return <span className="text-amber-500">{'★'.repeat(clamp(Number(value), 0, 5))}</span>
    case 'progress':
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-14 overflow-hidden rounded bg-hover">
            <span className="block h-full bg-accent" style={{ width: `${clamp(Number(value), 0, 100)}%` }} />
          </span>
          {clamp(Number(value), 0, 100)}%
        </span>
      )
    case 'dropdown': {
      const o = field.options.find((x) => x.id === value)
      return o ? <TagChip tag={{ id: o.id, name: o.label, color: o.color }} /> : null
    }
    case 'labels':
      return (
        <span className="inline-flex flex-wrap gap-1">
          {(value as string[]).map((id) => {
            const o = field.options.find((x) => x.id === id)
            return o ? <TagChip key={id} tag={{ id, name: o.label, color: o.color }} /> : null
          })}
        </span>
      )
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="truncate text-accent underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      )
    default:
      return <span className="truncate">{String(value)}</span>
  }
}

export function FieldEditor({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
    case 'date':
      return <DateField value={(value as string) ?? null} onChange={onChange} placeholder="Empty" />
    case 'rating':
      return (
        <span className="inline-flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => onChange(n === value ? null : n)} aria-label={`${n} stars`}>
              <Star size={15} className={Number(value) >= n ? 'fill-amber-400 text-amber-400' : 'text-muted'} />
            </button>
          ))}
        </span>
      )
    case 'dropdown':
    case 'labels': {
      const multi = field.type === 'labels'
      const selected: string[] = multi ? ((value as string[]) ?? []) : value ? [value as string] : []
      return (
        <Popover trigger={<button type="button" className="min-h-5 text-left"><FieldValue field={field} value={value} /></button>}>
          {(close) => (
            <>
              {field.options.map((o) => (
                <MenuItem
                  key={o.id}
                  active={selected.includes(o.id)}
                  icon={<Dot color={o.color} />}
                  onClick={() => {
                    if (multi) onChange(selected.includes(o.id) ? selected.filter((x) => x !== o.id) : [...selected, o.id])
                    else {
                      onChange(selected.includes(o.id) ? null : o.id)
                      close()
                    }
                  }}
                >
                  {o.label}
                </MenuItem>
              ))}
              {field.options.length === 0 && <div className="p-2 text-xs text-muted">No options. Add them in Custom Fields.</div>}
            </>
          )}
        </Popover>
      )
    }
    default: {
      const numeric = ['number', 'money', 'progress'].includes(field.type)
      return (
        <input
          key={String(value ?? '')}
          type={numeric ? 'number' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
          min={field.type === 'progress' ? 0 : undefined}
          max={field.type === 'progress' ? 100 : undefined}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          placeholder="Empty"
          onBlur={(e) => {
            const raw = e.target.value.trim()
            const v = raw === '' ? null : numeric ? Number(raw) : raw
            if (v !== (value ?? null)) onChange(v)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-line focus:border-accent"
        />
      )
    }
  }
}
