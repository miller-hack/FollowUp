import type { SelectHTMLAttributes } from 'react'
import { PRIORITIES, type Location } from '@shared/types'
import { useTags, useTreeMaps } from '@/lib/hooks'
import { cn, PRIORITY_META } from '@/lib/utils'

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('h-8 rounded-md border border-line bg-panel px-2 text-[13px] text-fg outline-none focus:border-accent', className)} {...props} />
}

/** Everything / space / folder / list / sprint. */
export function LocationSelect({
  value,
  onChange,
  emptyLabel = 'Everything',
  className
}: {
  value: Location | null | undefined
  onChange: (l: Location | null) => void
  emptyLabel?: string
  className?: string
}) {
  const maps = useTreeMaps()
  if (!maps) return null
  return (
    <Select
      value={value ? `${value.kind}:${value.id}` : ''}
      onChange={(e) => {
        const [kind, id] = e.target.value.split(':')
        onChange(e.target.value ? { kind: kind as Location['kind'], id } : null)
      }}
      className={cn('w-full', className)}
    >
      <option value="">{emptyLabel}</option>
      {maps.spaces.map((s) => (
        <optgroup key={s.id} label={s.name}>
          <option value={`space:${s.id}`}>{s.name} (whole space)</option>
          {maps.folders.filter((f) => f.space_id === s.id).map((f) => (
            <option key={f.id} value={`folder:${f.id}`}>📁 {f.name}</option>
          ))}
          {maps.lists.filter((l) => l.space_id === s.id).map((l) => (
            <option key={l.id} value={`list:${l.id}`}>{l.folder_id ? '   ' : ''}{l.name}</option>
          ))}
          {maps.sprints.filter((sp) => sp.space_id === s.id && sp.status !== 'closed').map((sp) => (
            <option key={sp.id} value={`sprint:${sp.id}`}>⚡ {sp.name}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}

export function ListSelect({ value, onChange, className }: { value: string | undefined | null; onChange: (id: string) => void; className?: string }) {
  const maps = useTreeMaps()
  if (!maps) return null
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="" disabled>Choose a list…</option>
      {maps.spaces.map((s) => (
        <optgroup key={s.id} label={s.name}>
          {maps.lists.filter((l) => l.space_id === s.id).map((l) => (
            <option key={l.id} value={l.id}>{l.folder_id ? `${maps.folder.get(l.folder_id)?.name} / ` : ''}{l.name}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}

/** Unique status names (statuses are matched by name across spaces). */
export function useStatusNames(spaceId?: string): string[] {
  const maps = useTreeMaps()
  const statuses = maps ? (spaceId ? maps.statusesOf(spaceId) : maps.statuses) : []
  return [...new Map(statuses.map((s) => [s.name.toLowerCase(), s.name])).values()]
}

export function StatusNameSelect({ value, onChange, spaceId, anyLabel, className }: { value: string | null | undefined; onChange: (v: string | null) => void; spaceId?: string; anyLabel?: string; className?: string }) {
  const names = useStatusNames(spaceId)
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {anyLabel ? <option value="">{anyLabel}</option> : <option value="" disabled>Choose a status…</option>}
      {names.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </Select>
  )
}

export function PrioritySelect({ value, onChange, anyLabel, className }: { value: string | null | undefined; onChange: (v: string | null) => void; anyLabel?: string; className?: string }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {anyLabel && <option value="">{anyLabel}</option>}
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>{PRIORITY_META[p].label}</option>
      ))}
    </Select>
  )
}

export function TagSelect({ value, onChange, anyLabel, className }: { value: string | null | undefined; onChange: (v: string | null) => void; anyLabel?: string; className?: string }) {
  const { data: tags = [] } = useTags()
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {anyLabel ? <option value="">{anyLabel}</option> : <option value="" disabled>{tags.length ? 'Choose a tag…' : 'No tags yet'}</option>}
      {tags.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </Select>
  )
}
