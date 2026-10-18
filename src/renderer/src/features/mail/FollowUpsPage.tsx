import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { FileText, Pencil, Plus, Square, Trash2, Zap } from 'lucide-react'
import { SEQUENCE_VARS, type EmailTemplate, type Enrollment, type Sequence, type SequenceInput } from '@shared/mail'
import { api } from '@/lib/api'
import { useEmailTemplates, useSequences } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Button, Empty, IconButton, Input, Modal } from '@/components/ui'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATUS_STYLE: Record<Enrollment['status'], string> = {
  active: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  replied: 'bg-green-500/15 text-green-600 dark:text-green-400',
  completed: 'bg-hover text-muted',
  stopped: 'bg-hover text-muted',
  bounced: 'bg-danger/15 text-danger',
  failed: 'bg-danger/15 text-danger'
}

export function FollowUpsPage() {
  const [tab, setTab] = useState<'sequences' | 'people' | 'templates'>('sequences')
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <h1 className="text-2xl font-semibold">Follow-ups</h1>
        <p className="mt-1 text-muted">Sequences send polite reminders as replies in the same thread and stop as soon as someone answers.</p>
        <div className="mt-5 mb-4 flex gap-4 border-b border-line">
          {(
            [
              ['sequences', 'Sequences'],
              ['people', 'In progress'],
              ['templates', 'Email templates']
            ] as const
          ).map(([t, l]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn('-mb-px border-b-2 pb-2 text-[13px]', tab === t ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-fg')}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === 'sequences' ? <Sequences /> : tab === 'people' ? <Enrollments /> : <Templates />}
      </div>
    </div>
  )
}

function Sequences() {
  const { data: sequences = [], isLoading } = useSequences()
  const [editing, setEditing] = useState<Sequence | 'new' | null>(null)
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> New sequence
        </Button>
      </div>
      {!isLoading && sequences.length === 0 && (
        <Empty>
          <Zap size={26} className="mx-auto mb-2 opacity-50" />
          Create a sequence, then use “Follow up” on any email in the inbox.
        </Empty>
      )}
      <div className="space-y-3">
        {sequences.map((s) => (
          <article key={s.id} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{s.name}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {s.window.days.map((d) => DAYS[d]).join(', ')} · {s.window.start}–{s.window.end} · max {s.daily_cap}/day · {s.active_count} in progress
                </div>
              </div>
              <IconButton label="Edit sequence" onClick={() => setEditing(s)}>
                <Pencil size={14} />
              </IconButton>
              <IconButton
                label="Delete sequence"
                onClick={() => window.confirm(`Delete “${s.name}”? Follow-ups in progress stop.`) && api.deleteSequence(s.id)}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
            <ol className="mt-3 space-y-1.5">
              {s.steps.map((st, i) => (
                <li key={st.id} className="flex gap-3 text-[13px]">
                  <span className="w-28 shrink-0 text-xs text-muted">
                    +{st.wait_days} day{st.wait_days === 1 ? '' : 's'} {i === 0 ? 'after start' : 'later'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{st.body.split('\n')[0]}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
      {editing && <SequenceEditor sequence={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SequenceEditor({ sequence, onClose }: { sequence: Sequence | null; onClose: () => void }) {
  const [draft, setDraft] = useState<SequenceInput>(
    sequence
      ? { name: sequence.name, window: sequence.window, daily_cap: sequence.daily_cap, steps: sequence.steps.map(({ wait_days, body }) => ({ wait_days, body })) }
      : {
          name: '',
          window: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
          daily_cap: 30,
          steps: [
            { wait_days: 3, body: 'Hi {{first_name}},\n\nJust bumping this up in case it got buried. Any thoughts?\n\nThanks!' },
            { wait_days: 4, body: 'Hi {{first_name}},\n\nFollowing up one last time on “{{subject}}”. Let me know if now isn’t a good time.\n\nBest,' }
          ]
        }
  )
  const [error, setError] = useState<string | null>(null)
  const [initialJson] = useState(() => JSON.stringify(draft))
  const set = (p: Partial<SequenceInput>) => setDraft({ ...draft, ...p })
  const setStep = (i: number, p: Partial<SequenceInput['steps'][number]>) => set({ steps: draft.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  const save = async () => {
    try {
      if (sequence) await window.bridge.invoke('updateSequence', [sequence.id, draft])
      else await window.bridge.invoke('createSequence', [draft])
      onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <Modal
      title={sequence ? 'Edit sequence' : 'New follow-up sequence'}
      onClose={onClose}
      confirmDiscard={JSON.stringify(draft) !== initialJson}
      width={660}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save sequence</Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px]">
        <Input autoFocus value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Sequence name, e.g. Proposal follow-up" />
        <div className="rounded-lg border border-line p-3">
          <div className="mb-2 text-xs font-medium text-muted">Only send on</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {DAYS.map((d, i) => {
              const on = draft.window.days.includes(i)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ window: { ...draft.window, days: on ? draft.window.days.filter((x) => x !== i) : [...draft.window.days, i].sort() } })}
                  className={cn('h-7 w-11 rounded-md border text-xs', on ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted')}
                >
                  {d}
                </button>
              )
            })}
            <span className="ml-2 text-muted">between</span>
            <input type="time" value={draft.window.start} onChange={(e) => set({ window: { ...draft.window, start: e.target.value } })} className="h-7 rounded-md border border-line bg-panel px-1.5" aria-label="Window start" />
            <span className="text-muted">and</span>
            <input type="time" value={draft.window.end} onChange={(e) => set({ window: { ...draft.window, end: e.target.value } })} className="h-7 rounded-md border border-line bg-panel px-1.5" aria-label="Window end" />
          </div>
          <label className="mt-2 flex items-center gap-2 text-muted">
            At most
            <input type="number" min={1} value={draft.daily_cap} onChange={(e) => set({ daily_cap: Number(e.target.value) })} className="h-7 w-16 rounded-md border border-line bg-panel px-1.5 text-fg" aria-label="Daily cap" />
            emails per day from this sequence
          </label>
        </div>

        {draft.steps.map((s, i) => (
          <div key={i} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-medium">Follow-up {i + 1}</span>
              <span className="text-muted">— wait</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={s.wait_days}
                onChange={(e) => setStep(i, { wait_days: Number(e.target.value) })}
                className="h-7 w-16 rounded-md border border-line bg-panel px-1.5"
                aria-label="Days to wait"
              />
              <span className="text-muted">days {i === 0 ? 'after starting' : 'after the previous one'}</span>
              <div className="flex-1" />
              <IconButton label="Remove follow-up" disabled={draft.steps.length === 1} onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            <textarea
              value={s.body}
              onChange={(e) => setStep(i, { body: e.target.value })}
              rows={4}
              aria-label={`Follow-up ${i + 1} message`}
              className="w-full resize-y rounded-md border border-line bg-panel px-2.5 py-1.5 leading-relaxed outline-none focus:border-accent"
            />
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={() => set({ steps: [...draft.steps, { wait_days: 7, body: '' }] })}>
            <Plus size={13} /> Add follow-up
          </Button>
          <span className="text-xs text-muted">Variables: {SEQUENCE_VARS.join(' ')}</span>
        </div>
      </div>
    </Modal>
  )
}

function Enrollments() {
  const { data: rows = [] } = useQuery({ queryKey: ['enrollments'], queryFn: () => api.listEnrollments() })
  if (!rows.length) return <Empty>Nobody is being followed up with yet.</Empty>
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
      {rows.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase', STATUS_STYLE[e.status])}>{e.status}</span>
          <a href={`#/inbox?folder=all&thread=${e.thread_id}`} className="min-w-0 flex-1 truncate hover:underline">
            <span className="font-medium">{e.to}</span> <span className="text-muted">· {e.thread_subject}</span>
          </a>
          <span className="shrink-0 text-xs text-muted">
            {e.sequence_name} · {Math.min(e.current_step, e.total_steps)}/{e.total_steps} sent
          </span>
          <span className="w-40 shrink-0 text-right text-xs text-muted">
            {e.status === 'active'
              ? e.next_run_at
                ? `next ${format(new Date(e.next_run_at), 'EEE MMM d, HH:mm')}`
                : 'sending…'
              : (e.stopped_reason ?? `started ${formatDistanceToNow(new Date(e.enrolled_at), { addSuffix: true })}`)}
          </span>
          {e.status === 'active' && (
            <IconButton label="Stop follow-up" onClick={() => api.stopEnrollment(e.id)}>
              <Square size={12} fill="currentColor" />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  )
}

function Templates() {
  const { data: templates = [] } = useEmailTemplates()
  const [editing, setEditingState] = useState<Partial<EmailTemplate> | null>(null)
  const [startJson, setStartJson] = useState('')
  const setEditing = (t: Partial<EmailTemplate> | null) => {
    if (t && !editing) setStartJson(JSON.stringify(t))
    setEditingState(t)
  }
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setEditing({ name: '', subject: '', body: '' })}>
          <Plus size={14} /> New template
        </Button>
      </div>
      {templates.length === 0 && <Empty>Templates are reusable emails you can insert while composing.</Empty>}
      <ul className="space-y-2">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2.5">
            <FileText size={15} className="text-muted" />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(t)}>
              <div className="font-medium">{t.name}</div>
              <div className="truncate text-xs text-muted">{t.subject || t.body.split('\n')[0]}</div>
            </button>
            <IconButton label="Delete template" onClick={() => window.confirm(`Delete template “${t.name}”?`) && api.deleteEmailTemplate(t.id)}>
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      {editing && (
        <Modal
          title={editing.id ? 'Edit template' : 'New template'}
          onClose={() => setEditing(null)}
          confirmDiscard={JSON.stringify(editing) !== startJson}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!editing.name?.trim()}
                onClick={async () => {
                  await api.saveEmailTemplate({ ...editing, name: editing.name ?? '' })
                  setEditing(null)
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Input autoFocus value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Template name" />
            <Input value={editing.subject ?? ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Subject (optional)" />
            <textarea
              value={editing.body ?? ''}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              rows={8}
              placeholder="Message"
              className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
        </Modal>
      )}
    </>
  )
}
