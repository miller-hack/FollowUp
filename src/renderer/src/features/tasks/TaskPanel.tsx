import { useEffect, useState, type ReactNode } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowRight, Bell, CheckSquare, ChevronRight, Clock, Copy, File, Flag, Link2, ListTree, Paperclip, Plus, Repeat, Tag, Trash2, X, CircleDot,
  CalendarClock, CalendarDays, CalendarPlus, Mail, Share2, Timer, Zap
} from 'lucide-react'
import { format } from 'date-fns'
import { localDateTime, parseLocal } from '@shared/dates'
import type { Recurrence, Status, TaskDetail, TaskPatch, TaskRef } from '@shared/types'
import { api } from '@/lib/api'
import { useFields, useIntegrations, useTask, useTreeMaps } from '@/lib/hooks'
import { cn, formatBytes, formatDue, formatMinutes, parseDuration } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import { Button, Dot, IconButton, MenuItem, Popover } from '@/components/ui'
import { RichEditor } from './RichEditor'
import { DateField, FieldEditor, ListPicker, PriorityPicker, StatusCircle, StatusPicker, TagList, TagPicker } from './pickers'
import { TaskSearch } from './TaskSearch'
import { TimerButton } from '../time/timer'
import { AddTimeModal } from '../time/TimePage'
import { TaskAiCard, TaskAiMenu, type TaskAiResult } from '../ai/TaskAi'

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center">
      <div className="flex w-36 shrink-0 items-center gap-2 text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  )
}

function Section({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <h3 className="flex-1 text-[13px] font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

const RECURRENCE_OPTIONS: [string, Recurrence | null][] = [
  ['Does not repeat', null],
  ['Daily', { freq: 'daily', interval: 1 }],
  ['Weekly', { freq: 'weekly', interval: 1 }],
  ['Every 2 weeks', { freq: 'weekly', interval: 2 }],
  ['Monthly', { freq: 'monthly', interval: 1 }],
  ['Yearly', { freq: 'yearly', interval: 1 }]
]

const recurrenceLabel = (r: Recurrence | null): string =>
  RECURRENCE_OPTIONS.find(([, v]) => JSON.stringify(v) === JSON.stringify(r))?.[0] ?? `Every ${r!.interval} ${r!.freq}`

export function TaskPanel() {
  const id = useUi((s) => s.openTaskId)
  const openTask = useUi((s) => s.openTask)
  const { data: task, isFetched } = useTask(id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) openTask(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openTask])

  // task was deleted
  useEffect(() => {
    if (id && isFetched && task === null) openTask(null)
  }, [id, isFetched, task, openTask])

  if (!id || !task) return null
  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/20" onClick={() => openTask(null)} />
      <aside className="fixed top-0 right-0 bottom-0 z-30 flex w-[min(720px,92vw)] flex-col border-l border-line bg-panel shadow-2xl">
        <TaskBody key={task.id} task={task} />
      </aside>
    </>
  )
}

function TaskBody({ task }: { task: TaskDetail }) {
  const maps = useTreeMaps()
  const openTask = useUi((s) => s.openTask)
  const list = maps?.list.get(task.list_id)
  const space = list ? maps?.space.get(list.space_id) : undefined
  const statuses = space ? maps!.statusesOf(space.id) : []
  const status = maps?.status.get(task.status_id)
  const { data: fields = [] } = useFields(space?.id)
  const update = (patch: TaskPatch) => api.updateTask(task.id, patch)
  const [aiResult, setAiResult] = useState<TaskAiResult | null>(null)

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[12.5px]">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-muted">
          {space && <Dot color={space.color} />}
          <span className="truncate">{space?.name}</span>
          <ChevronRight size={13} />
          <ListPicker
            value={task.list_id}
            onChange={(listId) => update({ list_id: listId })}
            trigger={<button type="button" className="truncate rounded px-1 hover:bg-hover hover:text-fg" title="Move to list">{list?.name}</button>}
          />
          {task.parent && (
            <>
              <ChevronRight size={13} />
              <button type="button" className="truncate rounded px-1 hover:bg-hover hover:text-fg" onClick={() => openTask(task.parent!.id)}>
                {task.parent.title}
              </button>
            </>
          )}
        </div>
        <ShareMenu task={task} status={status?.name} list={list?.name} />
        <TaskAiMenu task={task} onResult={setAiResult} />
        <IconButton label="Duplicate" onClick={async () => openTask((await api.duplicateTask(task.id)).id)}>
          <Copy size={15} />
        </IconButton>
        <IconButton
          label="Delete task"
          onClick={async () => {
            if (window.confirm(`Delete “${task.title}”${task.subtask_count ? ' and its subtasks' : ''}?`)) {
              await api.deleteTasks([task.id])
              openTask(null)
            }
          }}
        >
          <Trash2 size={15} />
        </IconButton>
        <IconButton label="Close" onClick={() => openTask(null)}>
          <X size={16} />
        </IconButton>
      </header>

      <div className="flex-1 overflow-auto px-7 pt-5 pb-10">
        <TitleEditor value={task.title} onSave={(title) => update({ title })} />

        <div className="mt-4 grid gap-0.5">
          <Row icon={<CircleDot size={14} />} label="Status">
            <StatusPicker statuses={statuses} value={task.status_id} onChange={(status_id) => update({ status_id })} />
            {task.blocked_by.length > 0 && <span className="ml-2 text-xs text-amber-500">Waiting on {task.blocked_by.length} task(s)</span>}
          </Row>
          <Row icon={<Flag size={14} />} label="Priority">
            <PriorityPicker value={task.priority} onChange={(priority) => update({ priority })} showLabel />
          </Row>
          <Row icon={<CalendarDays size={14} />} label="Start date">
            <DateField value={task.start_date} onChange={(start_date) => update({ start_date })} placeholder="Empty" />
          </Row>
          <Row icon={<CalendarClock size={14} />} label="Due date">
            <DateField value={task.due_date} onChange={(due_date) => update({ due_date })} status={status} placeholder="Empty" />
          </Row>
          <Row icon={<Clock size={14} />} label="Time estimate">
            <input
              key={task.time_estimate_min ?? ''}
              defaultValue={formatMinutes(task.time_estimate_min)}
              placeholder="e.g. 1h 30m"
              onBlur={(e) => {
                const v = parseDuration(e.target.value)
                if (v !== task.time_estimate_min) update({ time_estimate_min: v })
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-line focus:border-accent"
            />
          </Row>
          <Row icon={<Timer size={14} />} label="Time tracked">
            <div className="flex items-center gap-2">
              <TimerButton taskId={task.id} />
              <span className={cn('tabular-nums', task.time_estimate_min && task.time_spent_min > task.time_estimate_min && 'text-amber-500')}>
                {formatMinutes(task.time_spent_min) || '0m'}
                {task.time_estimate_min ? <span className="text-muted"> / {formatMinutes(task.time_estimate_min)}</span> : null}
              </span>
            </div>
          </Row>
          {space && (
            <Row icon={<Zap size={14} />} label="Sprint">
              <SprintPicker spaceId={space.id} value={task.sprint_id} onChange={(sprint_id) => update({ sprint_id })} />
            </Row>
          )}
          <Row icon={<Bell size={14} />} label="Reminders">
            <ReminderEditor task={task} />
          </Row>
          <Row icon={<Repeat size={14} />} label="Repeat">
            <Popover trigger={<button type="button" className={cn(!task.recurrence && 'text-muted')}>{recurrenceLabel(task.recurrence)}</button>}>
              {(close) =>
                RECURRENCE_OPTIONS.map(([label, r]) => (
                  <MenuItem key={label} active={JSON.stringify(r) === JSON.stringify(task.recurrence)} onClick={() => (update({ recurrence: r }), close())}>
                    {label}
                  </MenuItem>
                ))
              }
            </Popover>
            {task.recurrence && !task.due_date && <span className="ml-2 text-xs text-muted">(set a due date to schedule repeats)</span>}
          </Row>
          <Row icon={<Tag size={14} />} label="Tags">
            <div className="flex flex-wrap items-center gap-1">
              <TagList ids={task.tag_ids} onChange={(tag_ids) => update({ tag_ids })} />
              <TagPicker value={task.tag_ids} onChange={(tag_ids) => update({ tag_ids })} />
            </div>
          </Row>
          {fields.map((f) => (
            <Row key={f.id} icon={<span className="w-[14px] text-center text-[11px] font-bold">#</span>} label={f.name}>
              <FieldEditor field={f} value={task.fields[f.id]} onChange={(v) => update({ fields: { [f.id]: v } })} />
            </Row>
          ))}
        </div>

        {aiResult && <TaskAiCard key={aiResult.kind} task={task} result={aiResult} onClose={() => setAiResult(null)} />}

        <section className="mt-6">
          <RichEditor value={task.description} onSave={(description) => update({ description })} />
        </section>

        <Subtasks task={task} statuses={statuses} />
        <Checklists task={task} />
        <Dependencies task={task} />
        <TimeEntries task={task} />
        <EmailAndCalendar task={task} />
        <Attachments task={task} />
        <Comments task={task} />
      </div>
    </>
  )
}

/** Post the task to a connected Slack / Teams channel. */
function ShareMenu({ task, status, list }: { task: TaskDetail; status?: string; list?: string }) {
  const { data: integrations = [] } = useIntegrations()
  if (!integrations.some((i) => i.enabled)) return null
  const body = [status && `Status: ${status}`, task.due_date && `Due: ${formatDue(task.due_date)}`, list && `List: ${list}`].filter(Boolean).join(' · ')
  return (
    <Popover
      align="end"
      trigger={
        <IconButton label="Send to Slack / Teams">
          <Share2 size={15} />
        </IconButton>
      }
    >
      {(close) => (
        <div className="w-56">
          <div className="px-2 pt-1 pb-1.5 text-xs text-muted">Send this task to</div>
          {integrations
            .filter((i) => i.enabled)
            .map((i) => (
              <MenuItem
                key={i.id}
                onClick={async () => {
                  close()
                  await api.postToIntegration(i.id, { title: task.title, body })
                  toast(`Sent to ${i.name}`, 'success')
                }}
              >
                {i.name}
              </MenuItem>
            ))}
        </div>
      )}
    </Popover>
  )
}

function TitleEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <textarea
      value={text}
      rows={1}
      onChange={(e) => setText(e.target.value.replace(/\n/g, ''))}
      onBlur={() => text.trim() && text !== value && onSave(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
      className="field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 text-[22px] leading-tight font-semibold outline-none hover:border-line focus:border-accent"
    />
  )
}

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="mt-1 flex items-center gap-2 rounded-md px-1 text-muted">
      <Plus size={14} />
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            onAdd(text.trim())
            setText('')
          }
        }}
        className="h-7 flex-1 bg-transparent text-fg outline-none placeholder:text-muted"
      />
    </div>
  )
}

function Subtasks({ task, statuses }: { task: TaskDetail; statuses: Status[] }) {
  const openTask = useUi((s) => s.openTask)
  return (
    <Section title={`Subtasks${task.subtask_count ? ` (${task.subtask_done}/${task.subtask_count})` : ''}`} icon={<ListTree size={15} />}>
      <div className="rounded-lg border border-line">
        {task.subtasks.map((s) => (
          <div key={s.id} className="group flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-hover">
            <StatusCircle statuses={statuses} value={s.status_id} onChange={(status_id) => api.updateTask(s.id, { status_id })} />
            <button type="button" className="flex-1 truncate text-left" onClick={() => openTask(s.id)}>
              {s.title}
            </button>
            <DateField value={s.due_date} onChange={(due_date) => api.updateTask(s.id, { due_date })} placeholder="" />
            <PriorityPicker value={s.priority} onChange={(priority) => api.updateTask(s.id, { priority })} />
          </div>
        ))}
        <div className="px-2 py-0.5">
          <AddInput placeholder="Add subtask" onAdd={(title) => api.createTask({ list_id: task.list_id, parent_id: task.id, title })} />
        </div>
      </div>
    </Section>
  )
}

function Checklists({ task }: { task: TaskDetail }) {
  return (
    <Section
      title="Checklists"
      icon={<CheckSquare size={15} />}
      action={
        <Button size="sm" variant="ghost" onClick={() => api.addChecklist(task.id, 'Checklist')}>
          <Plus size={13} /> Add
        </Button>
      }
    >
      <div className="space-y-3">
        {task.checklists.map((c) => {
          const done = c.items.filter((i) => i.done).length
          return (
            <div key={c.id} className="rounded-lg border border-line p-2">
              <div className="mb-1 flex items-center gap-2 px-1">
                <input
                  defaultValue={c.name}
                  onBlur={(e) => e.target.value !== c.name && api.updateChecklist(c.id, e.target.value)}
                  className="flex-1 bg-transparent font-medium outline-none"
                />
                <span className="text-xs text-muted">
                  {done}/{c.items.length}
                </span>
                <IconButton label="Delete checklist" onClick={() => api.deleteChecklist(c.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              {c.items.length > 0 && (
                <div className="mx-1 mb-1 h-1 overflow-hidden rounded bg-hover">
                  <div className="h-full bg-green-500 transition-all" style={{ width: `${(done / c.items.length) * 100}%` }} />
                </div>
              )}
              {c.items.map((i) => (
                <div key={i.id} className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
                  <input type="checkbox" checked={i.done} onChange={(e) => api.updateChecklistItem(i.id, { done: e.target.checked })} />
                  <input
                    defaultValue={i.text}
                    onBlur={(e) => e.target.value !== i.text && api.updateChecklistItem(i.id, { text: e.target.value })}
                    className={cn('flex-1 bg-transparent outline-none', i.done && 'text-muted line-through')}
                  />
                  <button type="button" className="invisible text-muted group-hover:visible" onClick={() => api.deleteChecklistItem(i.id)} aria-label="Delete item">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <AddInput placeholder="Add item" onAdd={(text) => api.addChecklistItem(c.id, text)} />
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function Dependencies({ task }: { task: TaskDetail }) {
  const openTask = useUi((s) => s.openTask)
  const maps = useTreeMaps()
  const exclude = [task.id, ...task.blockers.map((b) => b.id)]
  const RefRow = ({ t, onRemove }: { t: TaskRef; onRemove: () => void }) => (
    <div className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-hover">
      <Dot color={maps?.status.get(t.status_id)?.color ?? '#999'} />
      <button type="button" className="flex-1 truncate text-left" onClick={() => openTask(t.id)}>
        {t.title}
      </button>
      <button type="button" className="invisible text-muted group-hover:visible" onClick={onRemove} aria-label="Remove dependency">
        <X size={13} />
      </button>
    </div>
  )
  return (
    <Section
      title="Dependencies"
      icon={<Link2 size={15} />}
      action={
        <Popover
          align="end"
          trigger={
            <Button size="sm" variant="ghost">
              <Plus size={13} /> Waiting on
            </Button>
          }
        >
          {(close) => <TaskSearch exclude={exclude} onPick={(t) => (api.addDependency(task.id, t.id), close())} />}
        </Popover>
      }
    >
      {task.blockers.length === 0 && task.blocking.length === 0 && <p className="text-xs text-muted">No dependencies.</p>}
      {task.blockers.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-medium text-amber-500">Waiting on</div>
          {task.blockers.map((b) => (
            <RefRow key={b.id} t={b} onRemove={() => api.removeDependency(task.id, b.id)} />
          ))}
        </div>
      )}
      {task.blocking.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
            Blocking <ArrowRight size={12} />
          </div>
          {task.blocking.map((b) => (
            <RefRow key={b.id} t={b} onRemove={() => api.removeDependency(b.id, task.id)} />
          ))}
        </div>
      )}
    </Section>
  )
}

export function SprintPicker({ spaceId, value, onChange }: { spaceId: string; value: string | null; onChange: (id: string | null) => void }) {
  const maps = useTreeMaps()
  const sprints = (maps?.sprints ?? []).filter((s) => s.space_id === spaceId && (s.status !== 'closed' || s.id === value))
  const current = value ? maps?.sprint.get(value) : undefined
  return (
    <Popover trigger={<button type="button" className={cn(!current && 'text-muted')}>{current?.name ?? 'None'}</button>}>
      {(close) => (
        <>
          <MenuItem active={!value} onClick={() => (onChange(null), close())}>None</MenuItem>
          {sprints.map((s) => (
            <MenuItem key={s.id} active={s.id === value} onClick={() => (onChange(s.id), close())}>
              {s.name}
              <span className="ml-2 text-xs text-muted">
                {format(parseLocal(s.start_date), 'MMM d')}–{format(parseLocal(s.end_date), 'MMM d')}
                {s.status === 'active' && ' · active'}
              </span>
            </MenuItem>
          ))}
          {sprints.length === 0 && <div className="p-2 text-xs text-muted">No sprints in this space yet.</div>}
        </>
      )}
    </Popover>
  )
}

function ReminderEditor({ task }: { task: TaskDetail }) {
  const preset = (minutes: number) => localDateTime(new Date(Date.now() + minutes * 60_000))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {task.reminders.map((r) => (
        <span key={r.id} className="inline-flex h-6 items-center gap-1 rounded bg-hover px-2 text-xs">
          <Bell size={11} /> {formatDue(r.remind_at)}
          <button type="button" aria-label="Remove reminder" onClick={() => api.deleteReminder(r.id)} className="text-muted hover:text-fg">
            <X size={11} />
          </button>
        </span>
      ))}
      <Popover trigger={<button type="button" className="text-xs text-muted hover:text-fg">+ Remind me</button>}>
        {(close) => (
          <div className="w-60">
            {[
              ['In 1 hour', 60],
              ['In 3 hours', 180],
              ['Tomorrow 9:00', -1]
            ].map(([label, m]) => (
              <MenuItem
                key={label}
                onClick={() => {
                  const tomorrow = new Date()
                  tomorrow.setDate(tomorrow.getDate() + 1)
                  tomorrow.setHours(9, 0, 0, 0)
                  void api.createReminder({ task_id: task.id, remind_at: m === -1 ? localDateTime(tomorrow) : preset(Number(m)) })
                  close()
                }}
              >
                {label}
              </MenuItem>
            ))}
            {task.due_date && (
              <MenuItem
                onClick={() => {
                  const due = parseLocal(task.due_date!)
                  if (task.due_date!.length <= 10) due.setHours(9, 0)
                  void api.createReminder({ task_id: task.id, remind_at: localDateTime(new Date(due.getTime() - 3600_000)) })
                  close()
                }}
              >
                1 hour before due
              </MenuItem>
            )}
            <form
              className="mt-1 flex gap-1 border-t border-line p-1 pt-2"
              onSubmit={(e) => {
                e.preventDefault()
                const v = (new FormData(e.currentTarget).get('at') as string) || ''
                if (v) {
                  void api.createReminder({ task_id: task.id, remind_at: v })
                  close()
                }
              }}
            >
              <input
                name="at"
                type="datetime-local"
                required
                defaultValue={preset(60).slice(0, 16)}
                className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-1.5 text-xs outline-none focus:border-accent"
              />
              <Button size="sm" variant="primary" type="submit">Set</Button>
            </form>
          </div>
        )}
      </Popover>
    </div>
  )
}

function TimeEntries({ task }: { task: TaskDetail }) {
  const [adding, setAdding] = useState(false)
  return (
    <Section
      title={`Time entries${task.time_spent_min ? ` · ${formatMinutes(task.time_spent_min)}` : ''}`}
      icon={<Timer size={15} />}
      action={
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add time
        </Button>
      }
    >
      {task.time_entries.length === 0 ? (
        <p className="text-xs text-muted">No time tracked yet.</p>
      ) : (
        <ul className="space-y-0.5 text-[13px]">
          {task.time_entries.slice(0, 10).map((e) => (
            <li key={e.id} className="group flex items-center gap-3 rounded px-2 py-1 hover:bg-hover">
              <span className="w-32 text-muted">{format(new Date(e.started_at), 'MMM d, HH:mm')}</span>
              <span className="flex-1 truncate text-muted">{e.note}</span>
              <span className="font-medium tabular-nums">{e.duration_sec == null ? 'running' : formatMinutes(Math.max(1, Math.round(e.duration_sec / 60)))}</span>
              <button type="button" aria-label="Delete entry" className="invisible text-muted group-hover:visible" onClick={() => api.deleteTimeEntry(e.id)}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddTimeModal task={{ id: task.id, title: task.title, status_id: task.status_id, list_id: task.list_id }} onClose={() => setAdding(false)} />}
    </Section>
  )
}

function EmailAndCalendar({ task }: { task: TaskDetail }) {
  const openTask = useUi((s) => s.openTask)
  const openCompose = useUi((s) => s.openCompose)
  return (
    <Section
      title="Email & calendar"
      icon={<Mail size={15} />}
      action={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => openCompose({ subject: task.title })}>
            <Mail size={13} /> Email
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const ev = await api.createEventForTask(task.id)
              toast(`Added to calendar: ${formatDue(ev.start)}`, 'success')
            }}
          >
            <CalendarPlus size={13} /> Block time
          </Button>
        </div>
      }
    >
      {task.emails.length === 0 && task.events.length === 0 && <p className="text-xs text-muted">No linked emails or events.</p>}
      <ul className="space-y-0.5 text-[13px]">
        {task.emails.map((e) => (
          <li key={e.id}>
            <a
              href={`#/inbox?folder=all&thread=${e.id}`}
              onClick={() => openTask(null)}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-hover"
            >
              <Mail size={13} className="shrink-0 text-muted" />
              <span className="flex-1 truncate">{e.subject || '(no subject)'}</span>
              <span className="text-xs text-muted">{format(new Date(e.last_message_at), 'MMM d')}</span>
            </a>
          </li>
        ))}
        {task.events.map((e) => (
          <li key={e.id}>
            <a href="#/calendar" onClick={() => openTask(null)} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-hover">
              <CalendarDays size={13} className="shrink-0 text-muted" />
              <span className="flex-1 truncate">{e.title}</span>
              <span className="text-xs text-muted">
                {formatDue(e.start)}
                {!e.all_day && e.end.length > 10 ? `–${e.end.slice(11, 16)}` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Attachments({ task }: { task: TaskDetail }) {
  return (
    <Section
      title="Attachments"
      icon={<Paperclip size={15} />}
      action={
        <Button size="sm" variant="ghost" onClick={() => api.addAttachments(task.id)}>
          <Plus size={13} /> Attach files
        </Button>
      }
    >
      {task.attachments.length === 0 ? (
        <p className="text-xs text-muted">No files attached.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {task.attachments.map((a) => (
            <div key={a.id} className="group flex items-center gap-2 rounded-lg border border-line px-3 py-2 hover:bg-hover">
              <File size={16} className="shrink-0 text-muted" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => api.openAttachment(a.id)}>
                <div className="truncate">{a.file_name}</div>
                <div className="text-[11px] text-muted">{formatBytes(a.size)}</div>
              </button>
              <button
                type="button"
                className="invisible text-muted group-hover:visible"
                aria-label="Delete attachment"
                onClick={() => window.confirm(`Delete ${a.file_name}?`) && api.deleteAttachment(a.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Comments({ task }: { task: TaskDetail }) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const [text, setText] = useState('')
  const submit = () => {
    if (!text.trim()) return
    void api.addComment(task.id, text.trim())
    setText('')
  }
  return (
    <section className="mt-8">
      <div className="mb-3 flex gap-4 border-b border-line">
        {(['comments', 'activity'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 pb-2 text-[13px] font-medium capitalize', tab === t ? 'border-accent text-fg' : 'border-transparent text-muted')}
          >
            {t} {t === 'comments' && task.comments.length > 0 && `(${task.comments.length})`}
          </button>
        ))}
      </div>
      {tab === 'comments' ? (
        <>
          <div className="space-y-3">
            {task.comments.map((c) => (
              <div key={c.id} className="group rounded-lg bg-hover/60 px-3 py-2">
                <div className="mb-0.5 flex items-center gap-2 text-[11px] text-muted">
                  <span className="font-semibold text-fg">{c.author === 'me' ? 'You' : c.author}</span>
                  {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                  <button type="button" className="invisible ml-auto group-hover:visible" onClick={() => api.deleteComment(c.id)} aria-label="Delete comment">
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="whitespace-pre-wrap select-text">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-line focus-within:border-accent">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()}
              placeholder="Write a comment… (Ctrl+Enter to send)"
              rows={2}
              className="block w-full resize-none bg-transparent px-3 py-2 outline-none"
            />
            <div className="flex justify-end px-2 pb-2">
              <Button size="sm" variant="primary" disabled={!text.trim()} onClick={submit}>
                Comment
              </Button>
            </div>
          </div>
        </>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {task.activity.map((a) => (
            <li key={a.id} className="flex gap-2">
              <span className="w-28 shrink-0 text-muted">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
              <span>
                <span className="font-medium capitalize">{a.action}</span>
                {a.detail && <span className="text-muted"> · {a.action === 'due date' && a.detail !== 'cleared' ? formatDue(a.detail) : a.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
