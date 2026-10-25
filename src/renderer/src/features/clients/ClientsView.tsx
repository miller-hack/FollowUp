import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { Building2, ChevronDown, Download, Lightbulb, Plus, Search, Settings2, Upload, UserPlus } from 'lucide-react'
import type { Company, CompanyType, CrmStage, Person, TeamMember } from '@shared/crm'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, Empty, MenuItem, Popover } from '@/components/ui'
import { Select } from '@/components/selects'
import { ResizablePanel, ResizeHandle, useWidth } from '@/components/Resizable'
import { ClientPanel } from './ClientPanel'
import { ImportDialog, StagesTeamDialog, SuggestionsDialog } from './ClientDialogs'

export const useStages = () => useQuery({ queryKey: ['crmStages'], queryFn: () => api.listCrmStages() })
export const useTeam = () => useQuery({ queryKey: ['team'], queryFn: () => api.listTeam() })

const TYPES: [CompanyType, string][] = [
  ['client', 'Client'],
  ['vendor', 'Vendor'],
  ['partner', 'Partner'],
  ['other', 'Other']
]

export const ago = (iso: string | null) => (iso ? formatDistanceToNowStrict(new Date(iso.length === 16 ? iso : iso), { addSuffix: true }) : '—')

type ColKey = 'company' | 'stage' | 'person' | 'designation' | 'phone' | 'email' | 'last' | 'responds' | 'action' | 'owner' | 'next' | 'due'
const COLUMNS: { key: ColKey; label: string; width: number; hint?: string }[] = [
  { key: 'company', label: 'Company', width: 200 },
  { key: 'stage', label: 'Stage', width: 140 },
  { key: 'person', label: 'Person', width: 170 },
  { key: 'designation', label: 'Designation', width: 150 },
  { key: 'phone', label: 'Phone', width: 140 },
  { key: 'email', label: 'Work email', width: 210 },
  { key: 'last', label: 'Last contact', width: 120, hint: 'Latest email, call, chat or meeting' },
  { key: 'responds', label: 'Responds', width: 90, hint: 'Wrote to you in the last 90 days' },
  { key: 'action', label: 'Acts for them', width: 105, hint: 'Responsible for taking action on their side' },
  { key: 'owner', label: 'Our owner', width: 130, hint: 'Who on your team looks after them' },
  { key: 'next', label: 'Next action', width: 220 },
  { key: 'due', label: 'Due', width: 130 }
]

/**
 * Clients (ADR-016): an Excel-like table. The company cell spans its people's rows; every cell
 * edits in place (click, type, Enter). Click a row's ⋯ / name to open the company's history.
 */
export function ClientsView() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<string>('')
  const [owner, setOwner] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [open, setOpen] = useState<{ company: string; person: string | null } | null>(null)
  const [dialog, setDialog] = useState<'suggest' | 'import' | 'setup' | null>(null)
  useEffect(() => {
    const h = setTimeout(() => setQ(search), 200)
    return () => clearTimeout(h)
  }, [search])
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['clients', q, stage, owner, type],
    queryFn: () => api.listClients({ search: q || undefined, stage_id: stage || null, owner_id: owner || null, type: (type || null) as CompanyType | null }),
    placeholderData: (p) => p
  })
  const { data: stages = [] } = useStages()
  const { data: team = [] } = useTeam()
  const { data: suggestions = [] } = useQuery({ queryKey: ['clientSuggestions'], queryFn: () => api.listClientSuggestions() })
  const opened = open ? companies.find((c) => c.id === open.company) : null

  const addCompany = async () => {
    const name = window.prompt('Company or organisation name')
    if (!name?.trim()) return
    const c = await api.createCompany({ name })
    setOpen({ company: c.id, person: null })
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <h1 className="mr-2 flex items-center gap-2 text-[15px] font-semibold">
            <Building2 size={16} /> Clients
          </h1>
          <label className="flex h-8 w-56 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-muted focus-within:border-accent">
            <Search size={13} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone…" className="w-full bg-transparent text-[13px] text-fg outline-none" />
          </label>
          <Select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage">
            <option value="">All stages</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by our owner">
            <option value="">Any owner</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant={suggestions.length ? 'outline' : 'ghost'} onClick={() => setDialog('suggest')} title="People you email who aren’t in the table yet">
              <Lightbulb size={13} /> From email{suggestions.length ? ` (${suggestions.length})` : ''}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog('import')}>
              <Upload size={13} /> Import
            </Button>
            <Popover
              align="end"
              trigger={
                <Button size="sm" variant="ghost">
                  <Download size={13} /> Export <ChevronDown size={12} />
                </Button>
              }
            >
              {(close) => (
                <div className="w-52">
                  {(['xlsx', 'csv'] as const).map((f) => (
                    <MenuItem
                      key={f}
                      onClick={async () => {
                        close()
                        const file = await api.exportClients(f)
                        if (file) toast(`Saved ${file}`, 'success')
                      }}
                    >
                      {f === 'xlsx' ? 'Excel (.xlsx), with interactions' : 'CSV (.csv)'}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>
            <Button size="sm" variant="ghost" onClick={() => setDialog('setup')} title="Stages and team">
              <Settings2 size={13} />
            </Button>
            <Button size="sm" variant="primary" onClick={addCompany}>
              <Plus size={13} /> Company
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {!isLoading && companies.length === 0 ? (
            <Empty>
              {q || stage || owner || type ? (
                'No matching clients.'
              ) : (
                <span>
                  No clients yet. Add a company, import a spreadsheet, or pick people from your email
                  {suggestions.length ? ` (${suggestions.length} suggestions)` : ''}.
                </span>
              )}
            </Empty>
          ) : (
            <ClientTable companies={companies} stages={stages} team={team} selected={open} onOpen={setOpen} />
          )}
        </div>
      </div>

      {opened && (
        <ResizablePanel id="clients.panel" initial={460} min={340} max={900} side="left" label="Resize the client panel" className="h-full">
          <ClientPanel key={opened.id} company={opened} personId={open!.person} stages={stages} team={team} onPerson={(person) => setOpen({ company: opened.id, person })} onClose={() => setOpen(null)} />
        </ResizablePanel>
      )}

      {dialog === 'suggest' && <SuggestionsDialog suggestions={suggestions} companies={companies} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'setup' && <StagesTeamDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- the table

function ClientTable({
  companies,
  stages,
  team,
  selected,
  onOpen
}: {
  companies: Company[]
  stages: CrmStage[]
  team: TeamMember[]
  selected: { company: string; person: string | null } | null
  onOpen: (o: { company: string; person: string | null }) => void
}) {
  const widths = COLUMNS.map((c) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useWidth(`clients.col.${c.key}`, c.width, 60, 600)
  })
  const total = widths.reduce((n, [w]) => n + w, 0)
  const stageOf = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages])

  return (
    <table className="border-separate border-spacing-0 text-[13px]" style={{ width: total, tableLayout: 'fixed' }}>
      <colgroup>
        {widths.map(([w], i) => (
          <col key={COLUMNS[i].key} style={{ width: w }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-bg">
        <tr>
          {COLUMNS.map((c, i) => (
            <th key={c.key} title={c.hint} className="relative h-8 border-b border-r border-line px-2 text-left text-[11px] font-medium tracking-wide text-muted uppercase">
              <span className="block truncate">{c.label}</span>
              <ResizeHandle width={widths[i][0]} onResize={widths[i][1]} label={`Resize the ${c.label} column`} className="absolute top-0 -right-[3px] h-full" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {companies.map((c) => {
          const rows: (Person | null)[] = c.people.length ? c.people : [null]
          const span = rows.length
          const st = c.stage_id ? stageOf.get(c.stage_id) : undefined
          const isOpen = selected?.company === c.id
          return (
            <Fragment key={c.id}>
              {rows.map((p, i) => (
                <tr key={p?.id ?? `${c.id}-empty`} className={cn('group/row', isOpen && (selected?.person ? selected.person === p?.id : true) && 'bg-accent/5')}>
                  {i === 0 && (
                    <>
                      <td rowSpan={span} className="border-b border-r border-line px-2 py-1.5 align-top">
                        <button type="button" className="block w-full truncate text-left font-medium hover:text-accent" onClick={() => onOpen({ company: c.id, person: null })} title="Open the company">
                          {c.name}
                        </button>
                        {c.domains.length > 0 && <div className="truncate text-[11px] text-muted">{c.domains.join(', ')}</div>}
                        <button
                          type="button"
                          className="mt-1 flex items-center gap-1 text-[11px] text-muted opacity-0 group-hover/row:opacity-100 hover:text-accent focus:opacity-100"
                          onClick={async () => {
                            const name = window.prompt(`New person at ${c.name}`)
                            if (name?.trim()) await api.createPerson({ company_id: c.id, name })
                          }}
                        >
                          <UserPlus size={11} /> Add person
                        </button>
                      </td>
                      <td rowSpan={span} className="border-b border-r border-line px-1 py-1 align-top">
                        <select
                          value={c.stage_id ?? ''}
                          onChange={(e) => api.updateCompany(c.id, { stage_id: e.target.value || null })}
                          aria-label={`Stage of ${c.name}`}
                          className="h-7 w-full rounded border border-transparent bg-transparent px-1 hover:border-line"
                          style={st ? { color: st.color } : undefined}
                        >
                          <option value="">—</option>
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                    </>
                  )}
                  {p ? (
                    <>
                      <Cell value={p.name} onSave={(name) => api.updatePerson(p.id, { name })} required onOpen={() => onOpen({ company: c.id, person: p.id })} />
                      <Cell value={p.designation} onSave={(designation) => api.updatePerson(p.id, { designation })} />
                      <Cell value={p.phone} onSave={(phone) => api.updatePerson(p.id, { phone })} />
                      <Cell value={p.email} onSave={(email) => api.updatePerson(p.id, { email })} />
                      <td className="border-b border-r border-line px-2 text-xs text-muted" title={p.last_contact ?? ''}>
                        {ago(p.last_contact)}
                      </td>
                      <td className="border-b border-r border-line px-2 text-xs">
                        {p.responds ? <span className="text-green-600 dark:text-green-400">Yes</span> : <span className="text-muted">{p.emails_in ? 'Not lately' : '—'}</span>}
                      </td>
                      <td className="border-b border-r border-line px-2 text-center">
                        <input type="checkbox" checked={p.action_owner} onChange={(e) => api.updatePerson(p.id, { action_owner: e.target.checked })} aria-label={`${p.name} acts for them`} />
                      </td>
                      <td className="border-b border-r border-line px-1">
                        <OwnerSelect value={p.owner_id ?? c.owner_id} team={team} onChange={(owner_id) => api.updatePerson(p.id, { owner_id })} label={`Our owner for ${p.name}`} />
                      </td>
                      <Cell value={p.next_action || c.next_action} placeholder={c.next_action ? undefined : '—'} onSave={(next_action) => api.updatePerson(p.id, { next_action })} />
                      <td className="border-b border-r border-line px-1">
                        <DateCell value={p.next_action_due ?? c.next_action_due} onSave={(d) => api.updatePerson(p.id, { next_action_due: d })} />
                      </td>
                    </>
                  ) : (
                    <td colSpan={COLUMNS.length - 2} className="border-b border-r border-line px-2 text-xs text-muted">
                      No people yet —{' '}
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={async () => {
                          const name = window.prompt(`New person at ${c.name}`)
                          if (name?.trim()) await api.createPerson({ company_id: c.id, name })
                        }}
                      >
                        add someone
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

export function OwnerSelect({ value, team, onChange, label }: { value: string | null; team: TeamMember[]; onChange: (v: string | null) => void; label: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label} className="h-7 w-full rounded border border-transparent bg-transparent px-1 hover:border-line">
      <option value="">—</option>
      {team.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  )
}

/** A table cell that edits in place: click to edit, Enter or leaving saves, Escape cancels. */
function Cell({ value, onSave, required, placeholder, onOpen }: { value: string; onSave: (v: string) => Promise<unknown>; required?: boolean; placeholder?: string; onOpen?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])
  const commit = async () => {
    setEditing(false)
    const next = v.trim()
    if (next === value.trim()) return
    if (required && !next) return setV(value)
    try {
      await onSave(next)
    } catch {
      setV(value)
    }
  }
  return (
    <td className="border-b border-r border-line p-0">
      {editing ? (
        <input
          ref={ref}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') (setV(value), setEditing(false))
          }}
          className="h-8 w-full bg-panel px-2 outline outline-2 -outline-offset-2 outline-accent"
        />
      ) : (
        <div className="flex h-8 items-center gap-1 px-2">
          <button type="button" className="min-w-0 flex-1 cursor-text truncate text-left" onClick={() => setEditing(true)} title={value || undefined}>
            {value || <span className="text-muted">{placeholder ?? ''}</span>}
          </button>
          {onOpen && (
            <button type="button" className="shrink-0 text-xs text-muted opacity-0 group-hover/row:opacity-100 hover:text-accent focus:opacity-100" onClick={onOpen} title="Open their history">
              History
            </button>
          )}
        </div>
      )}
    </td>
  )
}

export function DateCell({ value, onSave }: { value: string | null; onSave: (d: string | null) => unknown }) {
  const overdue = value && value < new Date().toISOString().slice(0, 10)
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onSave(e.target.value || null)}
      aria-label="Next action due"
      className={cn('h-7 w-full rounded border border-transparent bg-transparent px-1 hover:border-line', overdue && 'text-danger')}
    />
  )
}
