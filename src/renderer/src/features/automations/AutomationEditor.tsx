import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CheckCircle2, FlaskConical, Plus, Trash2, XCircle } from 'lucide-react'
import {
  EMAIL_FIELDS,
  TEMPLATE_VARS,
  TRIGGER_CONTEXT,
  actionAllowed,
  type TriggerContext,
  type Action,
  type ActionType,
  type Automation,
  type AutomationInput,
  type Condition,
  type ConditionField,
  type ConditionOp,
  type TestResult,
  type Trigger,
  type TriggerType
} from '@shared/automation'
import type { Priority, TaskRef } from '@shared/types'
import { EMAIL_CATEGORY_LABEL, type EmailCategory } from '@shared/ai'
import { api } from '@/lib/api'
import { useAccounts, useFields, useIntegrations, useSequences, useTags, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Button, IconButton, Input, Modal } from '@/components/ui'
import { ListSelect, LocationSelect, PrioritySelect, Select, StatusNameSelect, TagSelect } from '@/components/selects'
import { TaskSearch } from '../tasks/TaskSearch'
import { ACTION_LABELS, TRIGGER_LABELS } from './describe'

// ---------------------------------------------------------------- defaults

function defaultTrigger(type: TriggerType): Trigger {
  switch (type) {
    case 'due_date_arrives':
      return { type, days_before: 0 }
    case 'schedule':
      return { type, every: 'weekday', at: '09:00', weekday: 1, monthday: 1 }
    case 'email_no_reply':
      return { type, days: 3 }
    case 'event_starts':
      return { type, minutes_before: 10 }
    default:
      return { type } as Trigger
  }
}

function defaultAction(type: ActionType, firstListId: string | undefined): Action {
  switch (type) {
    case 'set_status':
      return { type, status: '' }
    case 'set_priority':
      return { type, priority: 'high' }
    case 'set_due_date':
      return { type, days_from_now: 1 }
    case 'add_tag':
    case 'remove_tag':
      return { type, tag_id: '' }
    case 'move_to_list':
      return { type, list_id: firstListId ?? '' }
    case 'add_comment':
      return { type, text: '' }
    case 'create_subtask':
      return { type, title: '' }
    case 'add_checklist':
      return { type, name: 'Checklist', items: [] }
    case 'create_task':
      return { type, list_id: firstListId ?? '', title: '', due_days: 0, priority: 'none' }
    case 'create_reminder':
      return { type, minutes_from_now: 60 }
    case 'notify':
      return { type, title: '{{task.title}}', body: '' }
    case 'set_custom_field':
      return { type, field_id: '', value: '' }
    case 'send_email':
      return { type, to: '', subject: '', body: '' }
    case 'create_task_from_email':
      return { type, list_id: firstListId ?? '' }
    case 'reply_to_email':
      return { type, body: '' }
    case 'start_sequence':
      return { type, sequence_id: '' }
    case 'mark_email_read':
      return { type }
    case 'ai_prompt':
      return { type, prompt: 'Suggest the next three steps for {{task.title}}.' }
    case 'post_message':
      return { type, integration_id: '', text: '' }
  }
}

export const emptyAutomation = (): AutomationInput => ({
  name: '',
  enabled: true,
  scope: null,
  trigger: { type: 'task_created' },
  conditions: [],
  actions: []
})

// ---------------------------------------------------------------- layout helpers

function Block({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <section className="relative rounded-xl border border-line p-3.5 pl-4">
      <span className={cn('absolute -top-2.5 left-3 rounded px-1.5 text-[11px] font-bold tracking-wide text-white', tone)}>{label}</span>
      <div className="space-y-2 pt-1">{children}</div>
    </section>
  )
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>

// ---------------------------------------------------------------- trigger

function TriggerEditor({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const set = (p: Partial<Trigger>) => onChange({ ...trigger, ...p } as Trigger)
  return (
    <Row>
      <Select value={trigger.type} onChange={(e) => onChange(defaultTrigger(e.target.value as TriggerType))} aria-label="Trigger">
        <optgroup label="When something changes">
          {(['task_created', 'status_changed', 'priority_changed', 'task_moved', 'tag_added', 'comment_added', 'checklist_completed', 'time_over_estimate'] as TriggerType[]).map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </optgroup>
        <optgroup label="Time based">
          {(['due_date_arrives', 'task_overdue', 'schedule'] as TriggerType[]).map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </optgroup>
        <optgroup label="Email & calendar">
          {(['email_received', 'email_no_reply', 'event_starts', 'email_triaged'] as TriggerType[]).map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </optgroup>
      </Select>
      {trigger.type === 'email_received' && <AccountSelect value={trigger.account_id} onChange={(account_id) => set({ account_id })} />}
      {trigger.type === 'email_no_reply' && (
        <Select value={trigger.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Days without reply">
          {[1, 2, 3, 5, 7, 14].map((d) => (
            <option key={d} value={d}>within {d} day{d > 1 ? 's' : ''}</option>
          ))}
        </Select>
      )}
      {trigger.type === 'email_triaged' && (
        <>
          <span className="text-muted">as</span>
          <Select value={trigger.category ?? ''} onChange={(e) => set({ category: e.target.value || null })} aria-label="Email category">
            <option value="">any category</option>
            {(Object.keys(EMAIL_CATEGORY_LABEL) as EmailCategory[]).map((c) => (
              <option key={c} value={c}>{EMAIL_CATEGORY_LABEL[c]}</option>
            ))}
          </Select>
          <span className="w-full text-xs text-muted">Needs “Sort new email automatically” in Settings → AI.</span>
        </>
      )}
      {trigger.type === 'event_starts' && (
        <Select value={trigger.minutes_before} onChange={(e) => set({ minutes_before: Number(e.target.value) })} aria-label="Minutes before">
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>{m} minutes before</option>
          ))}
        </Select>
      )}
      {trigger.type === 'status_changed' && (
        <>
          <span className="text-muted">from</span>
          <StatusNameSelect value={trigger.from} onChange={(from) => set({ from })} anyLabel="any status" />
          <span className="text-muted">to</span>
          <StatusNameSelect value={trigger.to} onChange={(to) => set({ to })} anyLabel="any status" />
        </>
      )}
      {trigger.type === 'priority_changed' && (
        <>
          <span className="text-muted">to</span>
          <PrioritySelect value={trigger.to} onChange={(to) => set({ to: to as Priority | null })} anyLabel="any priority" />
        </>
      )}
      {trigger.type === 'task_moved' && (
        <>
          <span className="text-muted">to</span>
          <Select value={trigger.to_list_id ?? ''} onChange={(e) => set({ to_list_id: e.target.value || null })}>
            <option value="">any list</option>
            <ListOptions />
          </Select>
        </>
      )}
      {trigger.type === 'tag_added' && <TagSelect value={trigger.tag_id} onChange={(tag_id) => set({ tag_id })} anyLabel="any tag" />}
      {trigger.type === 'due_date_arrives' && (
        <Select value={trigger.days_before ?? 0} onChange={(e) => set({ days_before: Number(e.target.value) })}>
          <option value={0}>on the due date / time</option>
          {[1, 2, 3, 7].map((d) => (
            <option key={d} value={d}>{d} day{d > 1 ? 's' : ''} before</option>
          ))}
        </Select>
      )}
      {trigger.type === 'schedule' && (
        <>
          <Select value={trigger.every} onChange={(e) => set({ every: e.target.value as 'day' })}>
            <option value="day">every day</option>
            <option value="weekday">every weekday (Mon–Fri)</option>
            <option value="week">every week</option>
            <option value="month">every month</option>
          </Select>
          {trigger.every === 'week' && (
            <Select value={trigger.weekday ?? 1} onChange={(e) => set({ weekday: Number(e.target.value) })}>
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                <option key={d} value={i}>on {d}</option>
              ))}
            </Select>
          )}
          {trigger.every === 'month' && (
            <Select value={trigger.monthday ?? 1} onChange={(e) => set({ monthday: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>on day {d}</option>
              ))}
            </Select>
          )}
          <span className="text-muted">at</span>
          <input type="time" value={trigger.at} onChange={(e) => set({ at: e.target.value })} className="h-8 rounded-md border border-line bg-panel px-2" aria-label="Time" />
        </>
      )}
    </Row>
  )
}

function AccountSelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const { data: accounts = [] } = useAccounts()
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Account">
      <option value="">in any account</option>
      {accounts
        .filter((a) => a.kind === 'mail')
        .map((a) => (
          <option key={a.id} value={a.id}>in {a.email}</option>
        ))}
    </Select>
  )
}

function ListOptions() {
  const maps = useTreeMaps()
  if (!maps) return null
  return (
    <>
      {maps.spaces.map((s) => (
        <optgroup key={s.id} label={s.name}>
          {maps.lists.filter((l) => l.space_id === s.id).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- conditions

const FIELD_LABELS: Record<ConditionField, string> = {
  status: 'Status',
  priority: 'Priority',
  list: 'List',
  tag: 'Tag',
  title: 'Title',
  due_date: 'Due date',
  sprint: 'Sprint',
  custom_field: 'Custom field',
  email_from: 'Sender',
  email_to: 'Recipients',
  email_subject: 'Subject',
  email_body: 'Message text'
}

const TEXT_OPS: [ConditionOp, string][] = [['contains', 'contains'], ['not_contains', 'does not contain'], ['is', 'is exactly'], ['is_not', 'is not']]

const OPS: Record<ConditionField, [ConditionOp, string][]> = {
  status: [['is', 'is'], ['is_not', 'is not']],
  priority: [['is', 'is'], ['is_not', 'is not']],
  list: [['is', 'is'], ['is_not', 'is not']],
  tag: [['is', 'has'], ['is_not', 'does not have']],
  title: [['contains', 'contains'], ['not_contains', 'does not contain'], ['is', 'is']],
  due_date: [['is_set', 'is set'], ['is_not_set', 'is not set']],
  sprint: [['is_set', 'is set'], ['is_not_set', 'is not set']],
  custom_field: [['is', 'is'], ['is_not', 'is not'], ['contains', 'contains'], ['gt', 'is greater than'], ['lt', 'is less than'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  email_from: TEXT_OPS,
  email_to: TEXT_OPS,
  email_subject: TEXT_OPS,
  email_body: TEXT_OPS
}

function ConditionRow({ c, ctx, onChange, onRemove }: { c: Condition; ctx: TriggerContext; onChange: (c: Condition) => void; onRemove: () => void }) {
  const { data: fields = [] } = useFields()
  const field = fields.find((f) => f.id === c.field_id)
  const needsValue = !['is_set', 'is_not_set'].includes(c.op)
  return (
    <Row>
      <Select value={c.field} onChange={(e) => onChange({ field: e.target.value as ConditionField, op: OPS[e.target.value as ConditionField][0][0] })} aria-label="Field">
        {(Object.entries(FIELD_LABELS) as [ConditionField, string][])
          .filter(([f]) => EMAIL_FIELDS.includes(f) === (ctx === 'email'))
          .map(([f, l]) => (
            <option key={f} value={f}>{l}</option>
          ))}
      </Select>
      {c.field === 'custom_field' && (
        <Select value={c.field_id ?? ''} onChange={(e) => onChange({ ...c, field_id: e.target.value, value: '' })}>
          <option value="" disabled>{fields.length ? 'Choose a field…' : 'No custom fields'}</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </Select>
      )}
      <Select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as ConditionOp })} aria-label="Operator">
        {OPS[c.field].map(([op, l]) => (
          <option key={op} value={op}>{l}</option>
        ))}
      </Select>
      {needsValue && c.field === 'status' && <StatusNameSelect value={c.value as string} onChange={(value) => onChange({ ...c, value })} />}
      {needsValue && c.field === 'priority' && <PrioritySelect value={(c.value as string) ?? 'high'} onChange={(value) => onChange({ ...c, value })} />}
      {needsValue && c.field === 'list' && <ListSelect value={c.value as string} onChange={(value) => onChange({ ...c, value })} />}
      {needsValue && c.field === 'tag' && <TagSelect value={c.value as string} onChange={(value) => onChange({ ...c, value })} />}
      {needsValue && (c.field === 'title' || EMAIL_FIELDS.includes(c.field)) && (
        <Input
          value={(c.value as string) ?? ''}
          onChange={(e) => onChange({ ...c, value: e.target.value })}
          className="w-56"
          placeholder={c.field === 'email_from' ? 'name, address or @domain.com' : 'text'}
        />
      )}
      {needsValue && c.field === 'custom_field' &&
        (field && (field.type === 'dropdown' || field.type === 'labels') ? (
          <Select value={(c.value as string) ?? ''} onChange={(e) => onChange({ ...c, value: e.target.value })}>
            <option value="" disabled>Choose…</option>
            {field.options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        ) : (
          <Input
            value={String(c.value ?? '')}
            type={field && ['number', 'money', 'rating', 'progress'].includes(field.type) ? 'number' : 'text'}
            onChange={(e) => onChange({ ...c, value: e.target.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value })}
            className="w-40"
            placeholder="value"
          />
        ))}
      <IconButton label="Remove condition" onClick={onRemove}>
        <Trash2 size={14} />
      </IconButton>
    </Row>
  )
}

// ---------------------------------------------------------------- actions

/** Which template variables apply (depends on the trigger). */
const VarsContext = createContext<TriggerContext>('task')

function TextWithVars({ value, onChange, placeholder, multiline }: { value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean }) {
  const ctx = useContext(VarsContext)
  return (
    <div className="w-full">
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full resize-y rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {TEMPLATE_VARS[ctx].map((v) => (
          <button key={v} type="button" onClick={() => onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${v}`)} className="rounded bg-hover px-1.5 py-0.5 font-mono text-[10.5px] text-muted hover:text-fg">
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

function ActionFields({ a, onChange }: { a: Action; onChange: (a: Action) => void }) {
  const { data: fields = [] } = useFields()
  const set = (p: Partial<Action>) => onChange({ ...a, ...p } as Action)
  switch (a.type) {
    case 'set_status':
      return <StatusNameSelect value={a.status} onChange={(status) => set({ status: status ?? '' })} />
    case 'set_priority':
      return <PrioritySelect value={a.priority} onChange={(p) => set({ priority: (p ?? 'none') as Priority })} />
    case 'set_due_date':
      return (
        <Select value={a.days_from_now === null ? 'clear' : a.days_from_now} onChange={(e) => set({ days_from_now: e.target.value === 'clear' ? null : Number(e.target.value) })}>
          <option value={0}>today</option>
          {[1, 2, 3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>in {d} day{d > 1 ? 's' : ''}</option>
          ))}
          <option value="clear">clear the due date</option>
        </Select>
      )
    case 'add_tag':
    case 'remove_tag':
      return <TagSelect value={a.tag_id} onChange={(tag_id) => set({ tag_id: tag_id ?? '' })} />
    case 'move_to_list':
      return <ListSelect value={a.list_id} onChange={(list_id) => set({ list_id })} />
    case 'add_comment':
      return <TextWithVars multiline value={a.text} onChange={(text) => set({ text })} placeholder="Comment text" />
    case 'create_subtask':
      return <TextWithVars value={a.title} onChange={(title) => set({ title })} placeholder="Subtask title" />
    case 'add_checklist':
      return (
        <div className="w-full space-y-1.5">
          <Input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Checklist name" />
          <textarea
            value={a.items.join('\n')}
            onChange={(e) => set({ items: e.target.value.split('\n') })}
            placeholder="One item per line"
            rows={3}
            className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </div>
      )
    case 'create_task':
      return (
        <div className="w-full space-y-1.5">
          <TextWithVars value={a.title} onChange={(title) => set({ title })} placeholder="Task title" />
          <Row>
            <span className="text-muted">in</span>
            <ListSelect value={a.list_id} onChange={(list_id) => set({ list_id })} />
            <span className="text-muted">due</span>
            <Select value={a.due_days ?? 'none'} onChange={(e) => set({ due_days: e.target.value === 'none' ? null : Number(e.target.value) })}>
              <option value="none">no due date</option>
              <option value={0}>today</option>
              {[1, 2, 3, 7].map((d) => (
                <option key={d} value={d}>in {d} day{d > 1 ? 's' : ''}</option>
              ))}
            </Select>
            <PrioritySelect value={a.priority ?? 'none'} onChange={(p) => set({ priority: (p ?? 'none') as Priority })} />
          </Row>
        </div>
      )
    case 'create_reminder':
      return (
        <Select value={a.minutes_from_now} onChange={(e) => set({ minutes_from_now: Number(e.target.value) })}>
          {[[15, '15 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']].map(([m, l]) => (
            <option key={m} value={m}>in {l}</option>
          ))}
        </Select>
      )
    case 'notify':
      return (
        <div className="w-full space-y-1.5">
          <TextWithVars value={a.title} onChange={(title) => set({ title })} placeholder="Notification title" />
          <Input value={a.body ?? ''} onChange={(e) => set({ body: e.target.value })} placeholder="Message (optional)" />
        </div>
      )
    case 'set_custom_field': {
      const f = fields.find((x) => x.id === a.field_id)
      return (
        <Row>
          <Select value={a.field_id} onChange={(e) => set({ field_id: e.target.value, value: '' })}>
            <option value="" disabled>{fields.length ? 'Choose a field…' : 'No custom fields'}</option>
            {fields.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
          {f && f.type === 'dropdown' ? (
            <Select value={String(a.value ?? '')} onChange={(e) => set({ value: e.target.value })}>
              <option value="" disabled>Choose…</option>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          ) : f && f.type === 'checkbox' ? (
            <Select value={a.value ? '1' : ''} onChange={(e) => set({ value: !!e.target.value })}>
              <option value="1">checked</option>
              <option value="">unchecked</option>
            </Select>
          ) : (
            <Input
              value={String(a.value ?? '')}
              onChange={(e) => set({ value: f && ['number', 'money', 'rating', 'progress'].includes(f.type) ? Number(e.target.value) : e.target.value })}
              placeholder="value"
              className="w-40"
            />
          )}
        </Row>
      )
    }
    case 'send_email':
      return (
        <div className="w-full space-y-1.5">
          <TextWithVars value={a.to} onChange={(to) => set({ to })} placeholder="To (address, or a variable like {{email.from}})" />
          <TextWithVars value={a.subject} onChange={(subject) => set({ subject })} placeholder="Subject" />
          <TextWithVars multiline value={a.body} onChange={(body) => set({ body })} placeholder="Message" />
        </div>
      )
    case 'create_task_from_email':
      return (
        <Row>
          <span className="text-muted">in</span>
          <ListSelect value={a.list_id} onChange={(list_id) => set({ list_id })} />
        </Row>
      )
    case 'reply_to_email':
      return <TextWithVars multiline value={a.body} onChange={(body) => set({ body })} placeholder="Reply text" />
    case 'start_sequence':
      return <SequenceSelect value={a.sequence_id} onChange={(sequence_id) => set({ sequence_id })} />
    case 'mark_email_read':
      return <span className="text-xs text-muted">Marks the thread read here and on the server.</span>
    case 'ai_prompt':
      return (
        <div className="w-full space-y-1">
          <TextWithVars multiline value={a.prompt} onChange={(prompt) => set({ prompt })} placeholder="What should the AI do? e.g. Suggest next steps for {{task.title}}" />
          <span className="block text-xs text-muted">Runs in the background with the task’s details; the answer is added as a comment. Uses your AI provider (Settings → AI).</span>
        </div>
      )
    case 'post_message':
      return (
        <div className="w-full space-y-1.5">
          <IntegrationSelect value={a.integration_id} onChange={(integration_id) => set({ integration_id })} />
          <TextWithVars multiline value={a.text} onChange={(text) => set({ text })} placeholder="Message, e.g. ✅ {{task.title}} is done" />
        </div>
      )
  }
}

function IntegrationSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: integrations = [] } = useIntegrations()
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Post to">
      <option value="" disabled>{integrations.length ? 'Choose where to post…' : 'No Slack / Teams connected — add one in Settings'}</option>
      {integrations.map((i) => (
        <option key={i.id} value={i.id}>{i.name}</option>
      ))}
    </Select>
  )
}

function SequenceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: sequences = [] } = useSequences()
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>{sequences.length ? 'Choose a sequence…' : 'No sequences yet — create one under Follow-ups'}</option>
      {sequences.map((s) => (
        <option key={s.id} value={s.id}>{s.name} ({s.steps.length} emails)</option>
      ))}
    </Select>
  )
}

/** Recent email threads to test email rules against. */
function ThreadPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data: threads = [] } = useQuery({ queryKey: ['threads', 'picker'], queryFn: () => api.listThreads({ folder: 'all', limit: 40 }) })
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="w-80">
      <option value="">{threads.length ? 'Choose an email…' : 'No emails synced yet'}</option>
      {threads.map((t) => (
        <option key={t.id} value={t.id}>{t.subject} — {t.participants.find((p) => p.name !== 'me')?.address ?? ''}</option>
      ))}
    </Select>
  )
}

// ---------------------------------------------------------------- editor

export function AutomationEditor({ initial, onClose }: { initial: Automation | AutomationInput; onClose: () => void }) {
  const maps = useTreeMaps()
  useTags()
  const [draft, setDraft] = useState<AutomationInput>(() => ({ ...initial }))
  // unsaved changes → Esc / click outside asks before discarding (M11)
  const [initialJson] = useState(() => JSON.stringify(initial))
  const [testTask, setTestTask] = useState<TaskRef | null>(null)
  const [testThread, setTestThread] = useState<string | null>(null)
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saved = 'id' in initial ? initial : null
  const kind = TRIGGER_CONTEXT[draft.trigger.type]
  const firstList = maps?.lists[0]?.id
  const set = (p: Partial<AutomationInput>) => {
    setDraft({ ...draft, ...p })
    setResult(null)
    setError(null)
  }
  const actionTypes = (Object.keys(ACTION_LABELS) as ActionType[]).filter((t) => actionAllowed(t, kind))
  const target = kind === 'task' ? (testTask?.id ?? null) : kind === 'email' ? testThread : null
  const firstActionFor = (k: TriggerContext): ActionType => (k === 'task' ? 'add_comment' : k === 'email' ? 'create_task_from_email' : 'notify')

  const changeTrigger = (trigger: Trigger) => {
    const k = TRIGGER_CONTEXT[trigger.type]
    set({
      trigger,
      actions: draft.actions.filter((a) => actionAllowed(a.type, k)),
      conditions: k === 'none' ? [] : draft.conditions.filter((c) => EMAIL_FIELDS.includes(c.field) === (k === 'email')),
      scope: k === 'task' ? draft.scope : null
    })
  }

  const save = async () => {
    try {
      if (saved) await window.bridge.invoke('updateAutomation', [saved.id, draft])
      else await window.bridge.invoke('createAutomation', [draft])
      onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <VarsContext.Provider value={kind}>
    <Modal
      title={saved ? 'Edit automation' : 'New automation'}
      confirmDiscard={JSON.stringify(draft) !== initialJson}
      onClose={onClose}
      width={760}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>{saved ? 'Save' : 'Create automation'}</Button>
        </>
      }
    >
      <div className="space-y-5 text-[13px]">
        <Input autoFocus value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Automation name, e.g. Escalate overdue tasks" className="h-9 text-[14px] font-medium" />

        <Block label="WHEN" tone="bg-violet-500">
          <TriggerEditor trigger={draft.trigger} onChange={changeTrigger} />
          {kind === 'task' && (
            <Row>
              <span className="text-muted">for tasks</span>
              <div className="w-72">
                <LocationSelect value={draft.scope} onChange={(scope) => set({ scope })} emptyLabel="anywhere" />
              </div>
            </Row>
          )}
        </Block>

        {kind !== 'none' && (
          <Block label="IF" tone="bg-sky-500">
            {draft.conditions.length === 0 && <p className="text-muted">No conditions — runs every time the trigger fires.</p>}
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-2 w-8 shrink-0 text-right text-[11px] font-semibold text-muted">{i === 0 ? 'IF' : 'AND'}</span>
                <ConditionRow
                  c={c}
                  ctx={kind}
                  onChange={(nc) => set({ conditions: draft.conditions.map((x, j) => (j === i ? nc : x)) })}
                  onRemove={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set({
                  conditions: [
                    ...draft.conditions,
                    kind === 'email' ? { field: 'email_subject', op: 'contains', value: '' } : { field: 'priority', op: 'is', value: 'high' }
                  ]
                })
              }
            >
              <Plus size={13} /> Add condition
            </Button>
          </Block>
        )}

        <Block label="THEN" tone="bg-emerald-500">
          {draft.actions.map((a, i) => (
            <div key={i} className="rounded-lg bg-hover/50 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="w-5 text-center text-[11px] font-bold text-muted">{i + 1}</span>
                <Select
                  value={a.type}
                  onChange={(e) => set({ actions: draft.actions.map((x, j) => (j === i ? defaultAction(e.target.value as ActionType, firstList) : x)) })}
                  aria-label="Action"
                >
                  {actionTypes.map((t) => (
                    <option key={t} value={t}>{ACTION_LABELS[t]}</option>
                  ))}
                </Select>
                <div className="flex-1" />
                <IconButton label="Move up" disabled={i === 0} onClick={() => set({ actions: swap(draft.actions, i, i - 1) })}>
                  <ArrowUp size={13} />
                </IconButton>
                <IconButton label="Move down" disabled={i === draft.actions.length - 1} onClick={() => set({ actions: swap(draft.actions, i, i + 1) })}>
                  <ArrowDown size={13} />
                </IconButton>
                <IconButton label="Remove action" onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              <div className="pl-7">
                <ActionFields a={a} onChange={(na) => set({ actions: draft.actions.map((x, j) => (j === i ? na : x)) })} />
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set({ actions: [...draft.actions, defaultAction(firstActionFor(kind), firstList)] })}>
            <Plus size={13} /> Add action
          </Button>
        </Block>

        <section className="rounded-xl border border-dashed border-line p-3.5">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <FlaskConical size={15} className="text-muted" /> Test
            <span className="text-xs font-normal text-muted">
              — checks the rule {kind === 'task' ? 'against a task' : kind === 'email' ? 'against an email' : ''} without changing anything
            </span>
          </div>
          <Row>
            {kind === 'task' &&
              (testTask ? (
                <Button size="sm" onClick={() => setTestTask(null)}>{testTask.title} ✕</Button>
              ) : (
                <div className="w-72">
                  <TaskSearch exclude={[]} onPick={(t) => (setTestTask(t), setResult(null))} />
                </div>
              ))}
            {kind === 'email' && <ThreadPicker value={testThread} onChange={(id) => (setTestThread(id), setResult(null))} />}
            <Button size="sm" disabled={kind !== 'none' && !target} onClick={async () => setResult(await api.testAutomation(draft, target))}>
              Run test
            </Button>
            {saved && (target || kind === 'none') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.runAutomationNow(saved.id, target)
                  setResult({ matches: true, checks: [{ label: 'Queued — see the run history for the result', pass: true }] })
                }}
                title="Runs the saved version for real"
              >
                Run now for real
              </Button>
            )}
          </Row>
          {result && (
            <div className="mt-3 space-y-1">
              {result.checks.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  {c.pass ? <CheckCircle2 size={14} className="text-green-500" /> : <XCircle size={14} className="text-danger" />}
                  {c.label}
                </div>
              ))}
              <div className={cn('pt-1 font-medium', result.matches ? 'text-green-600 dark:text-green-400' : 'text-danger')}>
                {result.matches ? 'This automation would run.' : 'This automation would not run.'}
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
    </VarsContext.Provider>
  )
}

function swap<T>(xs: T[], i: number, j: number): T[] {
  const next = [...xs]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
