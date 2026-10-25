import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Calendar, Mail, MessageCircle, Pencil, Phone, Plus, StickyNote, Trash2, Users, X } from 'lucide-react'
import type { Company, CompanyType, CrmStage, Interaction, InteractionInput, InteractionKind, MeetingMode, TeamMember, TimelineItem } from '@shared/crm'
import { INTERACTION_LABEL, MEETING_MODE_LABEL } from '@shared/crm'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, IconButton, Input, Modal } from '@/components/ui'
import { Select } from '@/components/selects'
import { ListSelect } from '@/components/selects'
import { DateCell, OwnerSelect, ago } from './ClientsView'

const KIND_ICON: Record<InteractionKind, React.ReactNode> = {
  call: <Phone size={13} />,
  chat: <MessageCircle size={13} />,
  meeting: <Users size={13} />,
  event: <Calendar size={13} />,
  note: <StickyNote size={13} />
}

const localNow = () => {
  const d = new Date()
  d.setSeconds(0, 0)
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

/** A company: details, people, history (emails + logged contact) and "Log a call / meeting / …". */
export function ClientPanel({
  company: c,
  personId,
  stages,
  team,
  onPerson,
  onClose
}: {
  company: Company
  personId: string | null
  stages: CrmStage[]
  team: TeamMember[]
  onPerson: (id: string | null) => void
  onClose: () => void
}) {
  const [logging, setLogging] = useState<Interaction | 'new' | null>(null)
  const { data: timeline = [] } = useQuery({ queryKey: ['clientTimeline', c.id, personId], queryFn: () => api.getClientTimeline(c.id, personId) })
  const person = personId ? c.people.find((p) => p.id === personId) : null
  const nameOf = new Map(c.people.map((p) => [p.id, p.name]))
  const memberOf = new Map(team.map((m) => [m.id, m.name]))

  return (
    <aside className="flex h-full flex-col border-l border-line bg-panel">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Editable className="text-[16px] font-semibold" value={c.name} onSave={(name) => api.updateCompany(c.id, { name })} />
            <Editable className="text-xs text-muted" value={c.domains.join(', ')} placeholder="Add email domains, e.g. acme.com" onSave={(d) => api.updateCompany(c.id, { domains: d.split(/[\s,;]+/).filter(Boolean) })} />
          </div>
          <IconButton
            label="Delete company"
            onClick={() => window.confirm(`Delete ${c.name}, its people and logged interactions? Emails stay in your inbox.`) && api.deleteCompany(c.id).then(onClose)}
          >
            <Trash2 size={14} />
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="mt-2 grid grid-cols-[90px_1fr] items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="text-xs text-muted">Stage</span>
          <Select value={c.stage_id ?? ''} onChange={(e) => api.updateCompany(c.id, { stage_id: e.target.value || null })} aria-label="Stage">
            <option value="">—</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <span className="text-xs text-muted">Type</span>
          <Select value={c.type} onChange={(e) => api.updateCompany(c.id, { type: e.target.value as CompanyType })} aria-label="Type">
            <option value="client">Client</option>
            <option value="vendor">Vendor</option>
            <option value="partner">Partner</option>
            <option value="other">Other</option>
          </Select>
          <span className="text-xs text-muted">Our owner</span>
          <div className="rounded-md border border-line">
            <OwnerSelect value={c.owner_id} team={team} onChange={(owner_id) => api.updateCompany(c.id, { owner_id })} label="Our owner" />
          </div>
          <span className="text-xs text-muted">Next action</span>
          <div className="flex gap-1">
            <Editable className="min-w-0 flex-1 rounded-md border border-line px-2 py-1" value={c.next_action} placeholder="What happens next?" onSave={(next_action) => api.updateCompany(c.id, { next_action })} />
            <div className="w-36 rounded-md border border-line">
              <DateCell value={c.next_action_due} onSave={(d) => api.updateCompany(c.id, { next_action_due: d })} />
            </div>
          </div>
          <span className="self-start pt-1 text-xs text-muted">Notes</span>
          <Editable multiline className="rounded-md border border-line px-2 py-1" value={c.notes} placeholder="Anything worth remembering" onSave={(notes) => api.updateCompany(c.id, { notes })} />
        </div>
      </header>

      <div className="border-b border-line px-4 py-2">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted uppercase">
          People <span className="font-normal normal-case">· click to see only their history</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onPerson(null)} className={cn('rounded-full border px-2 py-0.5 text-xs', !personId ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg')}>
            Everyone
          </button>
          {c.people.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPerson(p.id)}
              title={[p.designation, p.email, p.phone].filter(Boolean).join(' · ')}
              className={cn('rounded-full border px-2 py-0.5 text-xs', personId === p.id ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:text-fg')}
            >
              {p.name}
              {p.action_owner && <span className="ml-1 text-amber-600" title="Acts for them">★</span>}
            </button>
          ))}
        </div>
        {person && (
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {person.emails_in} email{person.emails_in === 1 ? '' : 's'} from them · {person.emails_out} to them · {person.interactions} logged · last contact {ago(person.last_contact)}
            </span>
            <button type="button" className="text-danger hover:underline" onClick={() => window.confirm(`Remove ${person.name}?`) && api.deletePerson(person.id).then(() => onPerson(null))}>
              Remove person
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 pt-3">
        <h2 className="flex-1 text-[13px] font-semibold">History{person ? ` with ${person.name}` : ''}</h2>
        <Button size="sm" variant="primary" onClick={() => setLogging('new')}>
          <Plus size={13} /> Log a call, meeting…
        </Button>
      </div>
      <ol className="flex-1 space-y-2 overflow-auto px-4 py-3">
        {timeline.length === 0 && <li className="text-xs text-muted">Nothing yet. Emails with their addresses appear here automatically; log calls, chats and meetings with the button above.</li>}
        {timeline.map((t) => (
          <TimelineRow key={t.type === 'email' ? t.message_id : t.interaction.id} t={t} nameOf={nameOf} memberOf={memberOf} onEdit={(i) => setLogging(i)} />
        ))}
      </ol>

      {logging && <InteractionDialog company={c} team={team} existing={logging === 'new' ? null : logging} defaultPerson={personId} onClose={() => setLogging(null)} />}
    </aside>
  )
}

function TimelineRow({ t, nameOf, memberOf, onEdit }: { t: TimelineItem; nameOf: Map<string, string>; memberOf: Map<string, string>; onEdit: (i: Interaction) => void }) {
  if (t.type === 'email')
    return (
      <li>
        <button
          type="button"
          onClick={() => (window.location.hash = `#/inbox?folder=all&thread=${t.thread_id}`)}
          className="flex w-full items-start gap-2 rounded-lg border border-line px-3 py-2 text-left hover:bg-hover"
        >
          <Mail size={13} className={cn('mt-0.5 shrink-0', t.outbound ? 'text-accent' : 'text-muted')} />
          <span className="min-w-0 flex-1">
            <span className="flex gap-2 text-xs text-muted">
              <span className="flex-1 truncate">{t.outbound ? 'You wrote' : `${t.person_ids.map((p) => nameOf.get(p)).filter(Boolean).join(', ') || t.from} wrote`}</span>
              <span className="shrink-0">{format(new Date(t.at), 'MMM d, yyyy HH:mm')}</span>
            </span>
            <span className="block truncate font-medium">{t.subject || '(no subject)'}</span>
            <span className="block truncate text-xs text-muted">{t.snippet}</span>
          </span>
        </button>
      </li>
    )
  const i = t.interaction
  const where = [i.mode ? MEETING_MODE_LABEL[i.mode] : '', i.channel, i.place].filter(Boolean).join(' · ')
  return (
    <li className="group rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300">{KIND_ICON[i.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex gap-2 text-xs text-muted">
            <span className="flex-1 truncate">
              {INTERACTION_LABEL[i.kind]}
              {where && ` · ${where}`}
              {i.duration_min ? ` · ${i.duration_min} min` : ''}
            </span>
            <span className="shrink-0">{i.at.length > 10 ? format(new Date(i.at), 'MMM d, yyyy HH:mm') : format(new Date(`${i.at}T12:00`), 'MMM d, yyyy')}</span>
          </div>
          {i.title && <div className="font-medium">{i.title}</div>}
          {(i.person_ids.length > 0 || i.member_ids.length > 0) && (
            <div className="text-xs">
              {i.person_ids.length > 0 && <span>With {i.person_ids.map((p) => nameOf.get(p)).filter(Boolean).join(', ')}</span>}
              {i.member_ids.length > 0 && <span className="text-muted">{i.person_ids.length ? ' · ' : ''}our side: {i.member_ids.map((m) => memberOf.get(m)).filter(Boolean).join(', ')}</span>}
            </div>
          )}
          {i.summary && <p className="mt-1 whitespace-pre-wrap">{i.summary}</p>}
          {i.next_steps && <p className="mt-1 text-xs"><span className="font-medium">Next: </span>{i.next_steps}</p>}
        </div>
        <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
          <IconButton label="Edit" onClick={() => onEdit(i)}>
            <Pencil size={12} />
          </IconButton>
          <IconButton label="Delete" onClick={() => window.confirm('Delete this entry?') && api.deleteInteraction(i.id)}>
            <Trash2 size={12} />
          </IconButton>
        </span>
      </div>
    </li>
  )
}

/** Log (or edit) a call, chat, meeting, event or note, with who took part on both sides. */
function InteractionDialog({ company: c, team, existing, defaultPerson, onClose }: { company: Company; team: TeamMember[]; existing: Interaction | null; defaultPerson: string | null; onClose: () => void }) {
  const [v, setV] = useState<InteractionInput>(
    existing
      ? { ...existing, task: null }
      : {
          company_id: c.id, kind: 'call', channel: '', mode: null, title: '', at: localNow(), duration_min: null, place: '', summary: '', next_steps: '',
          person_ids: defaultPerson ? [defaultPerson] : [], member_ids: team[0] ? [team[0].id] : [], task: null
        }
  )
  const [makeTask, setMakeTask] = useState(false)
  const [taskList, setTaskList] = useState<string | null>(null)
  const [taskDue, setTaskDue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<InteractionInput>) => setV({ ...v, ...p })
  const toggle = (key: 'person_ids' | 'member_ids', id: string) => set({ [key]: v[key].includes(id) ? v[key].filter((x) => x !== id) : [...v[key], id] })

  const save = async () => {
    setError(null)
    try {
      const input: InteractionInput = {
        ...v,
        mode: v.kind === 'meeting' ? (v.mode ?? 'in_person') : null,
        task: makeTask && taskList ? { list_id: taskList, title: v.next_steps.split('\n')[0] || `Follow up with ${c.name}`, due_date: taskDue } : null
      }
      if (existing) await window.bridge.invoke('updateInteraction', [existing.id, input])
      else await window.bridge.invoke('logInteraction', [input])
      toast(existing ? 'Saved' : 'Logged', 'success')
      onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <Modal
      title={existing ? 'Edit entry' : `Log contact with ${c.name}`}
      onClose={onClose}
      width={580}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>{existing ? 'Save' : 'Log it'}</Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(INTERACTION_LABEL) as InteractionKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => set({ kind: k })}
              className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', v.kind === k ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg')}
            >
              {KIND_ICON[k]} {INTERACTION_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-muted">When</span>
            <Input type="datetime-local" value={v.at.length === 10 ? `${v.at}T12:00` : v.at} onChange={(e) => set({ at: e.target.value })} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Title (optional)</span>
            <Input value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={v.kind === 'event' ? 'e.g. Expo 2026' : 'e.g. Pricing discussion'} className="mt-1" />
          </label>
        </div>
        {v.kind === 'meeting' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Where</span>
            {(Object.keys(MEETING_MODE_LABEL) as MeetingMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set({ mode: m })}
                className={cn('rounded-full border px-2.5 py-0.5 text-xs', (v.mode ?? 'in_person') === m ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg')}
              >
                {MEETING_MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[1fr_1fr_100px] gap-2">
          <label className="block">
            <span className="text-xs text-muted">{v.kind === 'meeting' ? 'Place or meeting link' : v.kind === 'event' ? 'Venue' : 'Place (optional)'}</span>
            <Input value={v.place} onChange={(e) => set({ place: e.target.value })} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Channel (optional)</span>
            <Input value={v.channel} onChange={(e) => set({ channel: e.target.value })} placeholder={v.kind === 'chat' ? 'WhatsApp' : v.kind === 'meeting' ? 'Zoom, Teams…' : 'Phone, mobile…'} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Minutes</span>
            <Input type="number" min={0} value={v.duration_min ?? ''} onChange={(e) => set({ duration_min: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <fieldset>
            <legend className="text-xs text-muted">Their people who took part</legend>
            <div className="mt-1 max-h-32 space-y-1 overflow-auto">
              {c.people.length === 0 && <span className="text-xs text-muted">No people in this company yet.</span>}
              {c.people.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={v.person_ids.includes(p.id)} onChange={() => toggle('person_ids', p.id)} />
                  <span className="truncate">{p.name}</span>
                  {p.designation && <span className="truncate text-xs text-muted">{p.designation}</span>}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs text-muted">Your team</legend>
            <div className="mt-1 max-h-32 space-y-1 overflow-auto">
              {team.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={v.member_ids.includes(m.id)} onChange={() => toggle('member_ids', m.id)} />
                  <span className="truncate">{m.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="block">
          <span className="text-xs text-muted">What was discussed or agreed</span>
          <textarea value={v.summary} onChange={(e) => set({ summary: e.target.value })} rows={4} className="mt-1 w-full resize-y rounded-md border border-line bg-panel px-3 py-2 outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Next steps</span>
          <Input value={v.next_steps} onChange={(e) => set({ next_steps: e.target.value })} placeholder="e.g. Send the revised quote by Friday" className="mt-1" />
        </label>
        {!existing && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={makeTask} onChange={(e) => setMakeTask(e.target.checked)} />
              Create a task for the next step
            </label>
            {makeTask && (
              <>
                <ListSelect value={taskList} onChange={(id) => setTaskList(id)} />
                <input type="date" value={taskDue ?? ''} onChange={(e) => setTaskDue(e.target.value || null)} aria-label="Task due date" className="h-8 rounded-md border border-line bg-panel px-2" />
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Text that edits in place. */
function Editable({ value, onSave, placeholder, className, multiline }: { value: string; onSave: (v: string) => Promise<unknown>; placeholder?: string; className?: string; multiline?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  const commit = async () => {
    setEditing(false)
    if (v.trim() === value.trim()) return
    try {
      await onSave(v.trim())
    } catch {
      setV(value)
    }
  }
  if (editing)
    return multiline ? (
      <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={3} className={cn('w-full resize-y bg-panel outline-none', className)} />
    ) : (
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') (setV(value), setEditing(false))
        }}
        className={cn('w-full bg-panel outline-none', className)}
      />
    )
  return (
    <button type="button" onClick={() => (setV(value), setEditing(true))} className={cn('block w-full cursor-text text-left whitespace-pre-wrap', className)}>
      {value || <span className="text-muted">{placeholder}</span>}
    </button>
  )
}
