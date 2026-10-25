import { useState } from 'react'
import { ArrowDown, ArrowUp, FileSpreadsheet, Plus, Trash2 } from 'lucide-react'
import type { ClientSuggestion, Company, CrmStage, ImportField, ImportMapping, ImportPreview, StageKind } from '@shared/crm'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/hooks'
import { toast } from '@/stores/ui'
import { Button, ColorGrid, Empty, IconButton, Input, Modal, Popover } from '@/components/ui'
import { Select } from '@/components/selects'
import { useStages, useTeam } from './ClientsView'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------------------------------------------------------------- suggestions from email

export function SuggestionsDialog({ suggestions, companies, onClose }: { suggestions: ClientSuggestion[]; companies: Company[]; onClose: () => void }) {
  return (
    <Modal title="People from your email" onClose={onClose} width={640}>
      <p className="mb-3 text-[13px] text-muted">
        People you’ve emailed in the last 6 months who aren’t clients yet, grouped by company. Newsletters, robots, your own company and public mailboxes (Gmail, Outlook…) are
        kept apart.
      </p>
      {suggestions.length === 0 && <Empty>No new people found in your email.</Empty>}
      <div className="max-h-[60vh] space-y-3 overflow-auto">
        {suggestions.map((s) => (
          <SuggestionGroup key={s.key} s={s} companies={companies} />
        ))}
      </div>
    </Modal>
  )
}

function SuggestionGroup({ s, companies }: { s: ClientSuggestion; companies: Company[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(s.people.map((p) => p.address)))
  const [name, setName] = useState(s.company_guess)
  const [target, setTarget] = useState<string>(s.company_id ?? '')
  const domain = s.key.includes('@') ? null : s.key
  const add = async () => {
    const people = s.people.filter((p) => picked.has(p.address)).map((p) => ({ address: p.address, name: p.name }))
    if (!people.length) return
    const c = await api.addClientSuggestion({ people, company_id: target || null, company_name: name, domain })
    toast(`Added to ${c.name}`, 'success')
  }
  return (
    <div className="rounded-lg border border-line p-3 text-[13px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Company">
          <option value="">New company:</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        {!target && <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" aria-label="New company name" />}
        {domain && <span className="text-xs text-muted">@{domain}</span>}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => api.ignoreClientSuggestion(s.people.map((p) => p.address))}>Ignore</Button>
          <Button size="sm" variant="primary" disabled={!picked.size} onClick={add}>Add {picked.size}</Button>
        </span>
      </div>
      <ul className="space-y-1">
        {s.people.map((p) => (
          <li key={p.address}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={picked.has(p.address)}
                onChange={() => {
                  const n = new Set(picked)
                  if (n.has(p.address)) n.delete(p.address)
                  else n.add(p.address)
                  setPicked(n)
                }}
              />
              <span className="font-medium">{p.name || p.address.split('@')[0]}</span>
              <span className="truncate text-xs text-muted">{p.address}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{p.messages} email{p.messages === 1 ? '' : 's'}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- import

const FIELDS: [ImportField, string][] = [
  ['company', 'Company'],
  ['name', 'Person’s name'],
  ['designation', 'Designation'],
  ['phone', 'Phone'],
  ['email', 'Work email'],
  ['stage', 'Stage'],
  ['domain', 'Website / domain'],
  ['notes', 'Notes']
]

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = async () => {
    setError(null)
    try {
      const p = await window.bridge.invoke('chooseClientImport', [])
      if (!p) return
      setPreview(p as ImportPreview)
      setMapping((p as ImportPreview).mapping)
    } catch (e) {
      setError(clean(e))
    }
  }
  const run = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.runClientImport(preview.token, mapping)
      toast(`Imported: ${r.companies} new compan${r.companies === 1 ? 'y' : 'ies'}, ${r.people} new people, ${r.updated} updated${r.skipped ? `, ${r.skipped} rows skipped` : ''}`, 'success')
      onClose()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Import clients"
      onClose={onClose}
      width={760}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {preview && (
            <Button variant="primary" disabled={busy || (mapping.company === undefined && mapping.name === undefined)} onClick={run}>
              Import {preview.total} row{preview.total === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {!preview ? (
          <>
            <p className="text-muted">
              Choose an Excel (.xlsx) or CSV file whose first row holds the column names. One row per person: company, name, designation, phone, email… Rows of the same company
              are grouped. People already in Clients (same email) are updated, not duplicated.
            </p>
            <Button variant="primary" onClick={choose}>
              <FileSpreadsheet size={14} /> Choose file…
            </Button>
          </>
        ) : (
          <>
            <p>
              <b>{preview.file_name}</b> · {preview.total} rows. Check which column holds what:
            </p>
            <div className="grid grid-cols-4 gap-2">
              {FIELDS.map(([f, label]) => (
                <label key={f} className="block">
                  <span className="text-xs text-muted">{label}</span>
                  <Select
                    value={mapping[f] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className="mt-1 w-full"
                  >
                    <option value="">— not in the file —</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            <div className="max-h-60 overflow-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="border-b border-line px-2 py-1 text-left font-medium whitespace-nowrap">
                        {h}
                        {Object.entries(mapping).find(([, v]) => v === i) && (
                          <span className="ml-1 rounded bg-accent/10 px-1 text-accent">{FIELDS.find(([f]) => mapping[f] === i)?.[1]}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      {preview.headers.map((_, j) => (
                        <td key={j} className="max-w-40 truncate border-b border-line px-2 py-1">{r[j]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- stages & team

const KINDS: [StageKind, string][] = [
  ['open', 'In progress'],
  ['won', 'Won'],
  ['lost', 'Lost'],
  ['hold', 'On hold']
]

export function StagesTeamDialog({ onClose }: { onClose: () => void }) {
  const { data: saved = [] } = useStages()
  const { data: team = [] } = useTeam()
  const [stages, setStages] = useState<Omit<CrmStage, 'position'>[] | null>(null)
  const list = stages ?? saved
  const [member, setMember] = useState({ name: '', email: '' })
  const [error, setError] = useState<string | null>(null)
  const edit = (i: number, p: Partial<CrmStage>) => setStages(list.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const moveStage = (i: number, d: number) => {
    const next = [...list]
    const [s] = next.splice(i, 1)
    next.splice(i + d, 0, s)
    setStages(next)
  }

  return (
    <Modal
      title="Stages and team"
      onClose={onClose}
      width={620}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {stages && (
            <Button
              variant="primary"
              onClick={async () => {
                setError(null)
                try {
                  await window.bridge.invoke('saveCrmStages', [stages])
                  void queryClient.invalidateQueries()
                  setStages(null)
                  toast('Stages saved', 'success')
                } catch (e) {
                  setError(clean(e))
                }
              }}
            >
              Save stages
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5 text-[13px]">
        <section>
          <h3 className="mb-1 font-semibold">Stages</h3>
          <p className="mb-2 text-xs text-muted">Where each relationship stands. Rename them to match how you work (e.g. “Met at exhibition”).</p>
          <div className="space-y-1.5">
            {list.map((s, i) => (
              <div key={s.id || i} className="flex items-center gap-2">
                <Popover trigger={<span className="block h-5 w-5 cursor-pointer rounded-full border border-line" style={{ background: s.color }} />}>
                  {(close) => <ColorGrid value={s.color} onChange={(color) => (edit(i, { color }), close())} />}
                </Popover>
                <Input value={s.name} onChange={(e) => edit(i, { name: e.target.value })} className="flex-1" aria-label="Stage name" />
                <Select value={s.kind} onChange={(e) => edit(i, { kind: e.target.value as StageKind })} aria-label="Stage kind">
                  {KINDS.map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </Select>
                <IconButton label="Move up" disabled={i === 0} onClick={() => moveStage(i, -1)}>
                  <ArrowUp size={13} />
                </IconButton>
                <IconButton label="Move down" disabled={i === list.length - 1} onClick={() => moveStage(i, 1)}>
                  <ArrowDown size={13} />
                </IconButton>
                <IconButton label="Remove stage" onClick={() => setStages(list.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setStages([...list, { id: '', name: 'New stage', color: '#94a3b8', kind: 'open' }])}>
              <Plus size={13} /> Add stage
            </Button>
          </div>
        </section>

        <section>
          <h3 className="mb-1 font-semibold">Your team</h3>
          <p className="mb-2 text-xs text-muted">Who can own a client and take part in meetings.</p>
          <ul className="space-y-1">
            {team.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="flex-1">{m.name}</span>
                <span className="text-xs text-muted">{m.email}</span>
                <IconButton label={`Remove ${m.name}`} onClick={() => window.confirm(`Remove ${m.name} from the team?`) && api.deleteTeamMember(m.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} placeholder="Name" />
            <Input value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} placeholder="Email (optional)" />
            <Button
              disabled={!member.name.trim()}
              onClick={async () => {
                await api.saveTeamMember(member)
                setMember({ name: '', email: '' })
              }}
            >
              <Plus size={13} /> Add
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
