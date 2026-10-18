import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, Copy, History, MinusCircle, MoreHorizontal, Pencil, Play, Plus, Sparkles, Trash2, XCircle, Zap } from 'lucide-react'
import type { Automation, AutomationInput, AutomationRun } from '@shared/automation'
import { api } from '@/lib/api'
import { useAccounts, useFields, useIntegrations, useSequences, useTags, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import { Button, Empty, IconButton, MenuItem, MenuSeparator, Modal, Popover } from '@/components/ui'
import { AutomationEditor, emptyAutomation } from './AutomationEditor'
import { describeAction, describeCondition, describeScope, describeTrigger, type Names } from './describe'

const useAutomations = () => useQuery({ queryKey: ['automations'], queryFn: () => api.listAutomations() })

/** Ready-made rules; open in the editor so the user can adjust before saving. */
function templates(firstListId: string | undefined): { title: string; description: string; rule: AutomationInput }[] {
  const base = (p: Partial<AutomationInput>): AutomationInput => ({ ...emptyAutomation(), ...p })
  return [
    {
      title: 'Give new tasks a due date',
      description: 'Tasks created without a due date get one a week out.',
      rule: base({ name: 'Default due date', trigger: { type: 'task_created' }, conditions: [{ field: 'due_date', op: 'is_not_set' }], actions: [{ type: 'set_due_date', days_from_now: 7 }] })
    },
    {
      title: 'Escalate overdue tasks',
      description: 'When a task becomes overdue, make it urgent and notify me.',
      rule: base({
        name: 'Escalate overdue',
        trigger: { type: 'task_overdue' },
        actions: [{ type: 'set_priority', priority: 'urgent' }, { type: 'notify', title: 'Overdue: {{task.title}}', body: 'Was due {{task.due_date}}' }]
      })
    },
    {
      title: 'Heads-up the day before',
      description: 'Get a notification one day before a task is due.',
      rule: base({ name: 'Due tomorrow heads-up', trigger: { type: 'due_date_arrives', days_before: 1 }, actions: [{ type: 'notify', title: 'Due tomorrow: {{task.title}}', body: 'In {{task.list}}' }] })
    },
    {
      title: 'Checklist done → Review',
      description: 'When every item of a checklist is ticked, move the task to Review.',
      rule: base({ name: 'Checklist complete → Review', trigger: { type: 'checklist_completed' }, actions: [{ type: 'set_status', status: 'Review' }] })
    },
    {
      title: 'Review checklist',
      description: 'When a task enters Review, add a review checklist.',
      rule: base({
        name: 'Add review checklist',
        trigger: { type: 'status_changed', to: 'Review' },
        actions: [{ type: 'add_checklist', name: 'Review', items: ['Double-check requirements', 'Proofread', 'Get sign-off'] }]
      })
    },
    {
      title: 'Plan my day',
      description: 'Every weekday at 9:00 create a planning task due today.',
      rule: base({
        name: 'Daily planning',
        trigger: { type: 'schedule', every: 'weekday', at: '09:00' },
        actions: [{ type: 'create_task', list_id: firstListId ?? '', title: 'Plan my day — {{date.today}}', due_days: 0, priority: 'high' }]
      })
    },
    {
      title: 'Weekly review',
      description: 'Every Friday at 16:00 create a weekly review task.',
      rule: base({
        name: 'Weekly review',
        trigger: { type: 'schedule', every: 'week', weekday: 5, at: '16:00' },
        actions: [{ type: 'create_task', list_id: firstListId ?? '', title: 'Weekly review', due_days: 0, priority: 'normal' }]
      })
    },
    {
      title: 'Over the estimate',
      description: 'When tracked time passes the estimate, raise priority and tell me.',
      rule: base({
        name: 'Over estimate',
        trigger: { type: 'time_over_estimate' },
        actions: [{ type: 'set_priority', priority: 'high' }, { type: 'notify', title: 'Over estimate: {{task.title}}' }]
      })
    }
  ]
}

export function AutomationsPage() {
  const maps = useTreeMaps()
  const { data: tags = [] } = useTags()
  const { data: fields = [] } = useFields()
  const { data: automations = [], isLoading } = useAutomations()
  const [editing, setEditing] = useState<Automation | AutomationInput | null>(null)
  const [history, setHistory] = useState<Automation | 'all' | null>(null)
  const { data: accounts = [] } = useAccounts()
  const { data: sequences = [] } = useSequences()
  const { data: integrations = [] } = useIntegrations()
  const names: Names | null = useMemo(
    () => (maps ? { maps, tags, fields, accounts, sequences, integrations } : null),
    [maps, tags, fields, accounts, sequences, integrations]
  )
  if (!names) return null

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="mb-6 flex items-center gap-2">
          <h1 className="flex-1 text-2xl font-semibold">Automations</h1>
          <Button onClick={() => setHistory('all')}>
            <History size={14} /> Run history
          </Button>
          <Button variant="primary" onClick={() => setEditing(emptyAutomation())}>
            <Plus size={15} /> New automation
          </Button>
        </div>

        {!isLoading && automations.length === 0 && (
          <Empty>
            <Zap size={28} className="mx-auto mb-2 opacity-50" />
            Automations do routine work for you: “when this happens, if that's true, do this”.
            <br />
            Start from a template below or build your own.
          </Empty>
        )}

        <div className="space-y-3">
          {automations.map((a) => (
            <article key={a.id} className={cn('rounded-xl border border-line bg-panel p-4', !a.enabled && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.enabled}
                  aria-label={a.enabled ? 'Disable automation' : 'Enable automation'}
                  onClick={() => api.updateAutomation(a.id, { enabled: !a.enabled })}
                  className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', a.enabled ? 'bg-accent' : 'bg-line')}
                >
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', a.enabled ? 'left-[18px]' : 'left-0.5')} />
                </button>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(a)}>
                  <div className="font-semibold">{a.name}</div>
                  <div className="mt-1 text-[13px]">
                    <span className="font-semibold text-violet-500">When</span> {describeTrigger(a.trigger, names)}
                    {a.trigger.type !== 'schedule' && <span className="text-muted"> {describeScope(a.scope, names)}</span>}
                    {a.conditions.length > 0 && (
                      <>
                        <span className="font-semibold text-sky-500"> · if</span> {a.conditions.map((c) => describeCondition(c, names)).join(' and ')}
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 text-[13px]">
                    <span className="font-semibold text-emerald-500">Then</span> {a.actions.map((x) => describeAction(x, names)).join(', then ')}
                  </div>
                </button>
                <div className="shrink-0 text-right text-xs text-muted">
                  <div>{a.run_count} run{a.run_count === 1 ? '' : 's'}</div>
                  {a.last_run_at && <div>{formatDistanceToNow(new Date(a.last_run_at), { addSuffix: true })}</div>}
                </div>
                <Popover align="end" trigger={<IconButton label="Automation options"><MoreHorizontal size={15} /></IconButton>}>
                  {(close) => (
                    <>
                      <MenuItem icon={<Pencil size={14} />} onClick={() => (close(), setEditing(a))}>Edit & test</MenuItem>
                      <MenuItem icon={<History size={14} />} onClick={() => (close(), setHistory(a))}>Run history</MenuItem>
                      {a.trigger.type === 'schedule' && (
                        <MenuItem
                          icon={<Play size={14} />}
                          onClick={async () => {
                            close()
                            await api.runAutomationNow(a.id, null)
                            toast(`Running “${a.name}”`, 'success')
                          }}
                        >
                          Run now
                        </MenuItem>
                      )}
                      <MenuItem icon={<Copy size={14} />} onClick={() => (close(), api.duplicateAutomation(a.id))}>Duplicate</MenuItem>
                      <MenuSeparator />
                      <MenuItem danger icon={<Trash2 size={14} />} onClick={() => (close(), window.confirm(`Delete automation “${a.name}”?`) && api.deleteAutomation(a.id))}>
                        Delete
                      </MenuItem>
                    </>
                  )}
                </Popover>
              </div>
            </article>
          ))}
        </div>

        <h2 className="mt-10 mb-3 flex items-center gap-2 font-semibold">
          <Sparkles size={16} className="text-accent" /> Templates
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {templates(maps?.lists[0]?.id).map((t) => (
            <button key={t.title} type="button" onClick={() => setEditing(t.rule)} className="rounded-xl border border-line bg-panel p-4 text-left hover:border-accent">
              <div className="font-medium">{t.title}</div>
              <div className="mt-0.5 text-xs text-muted">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {editing && <AutomationEditor initial={editing} onClose={() => setEditing(null)} />}
      {history && <RunHistory automation={history === 'all' ? null : history} onClose={() => setHistory(null)} />}
    </div>
  )
}

const STATUS_ICON: Record<AutomationRun['status'], React.ReactNode> = {
  success: <CheckCircle2 size={15} className="text-green-500" />,
  skipped: <MinusCircle size={15} className="text-muted" />,
  failed: <XCircle size={15} className="text-danger" />
}

function RunHistory({ automation, onClose }: { automation: Automation | null; onClose: () => void }) {
  const { data: runs = [] } = useQuery({ queryKey: ['automationRuns', automation?.id ?? 'all'], queryFn: () => api.listAutomationRuns(automation?.id) })
  const { data: automations = [] } = useAutomations()
  const [hideSkipped, setHideSkipped] = useState(true)
  const shown = hideSkipped ? runs.filter((r) => r.status !== 'skipped') : runs
  return (
    <Modal title={automation ? `Run history · ${automation.name}` : 'Run history'} onClose={onClose} width={680}>
      <label className="mb-3 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={hideSkipped} onChange={(e) => setHideSkipped(e.target.checked)} />
        Hide runs skipped because a condition wasn't met
      </label>
      {shown.length === 0 && <Empty>No runs yet.</Empty>}
      <ul className="space-y-1">
        {shown.map((r) => (
          <li key={r.id} className="rounded-lg px-2.5 py-2 hover:bg-hover">
            <div className="flex items-center gap-2 text-[13px]">
              {STATUS_ICON[r.status]}
              {!automation && <span className="font-medium">{automations.find((a) => a.id === r.automation_id)?.name}</span>}
              {r.task_id && (
                <button
                  type="button"
                  className="max-w-64 truncate text-accent hover:underline"
                  onClick={() => {
                    useUi.getState().openTask(r.task_id!)
                    onClose()
                  }}
                >
                  {r.task_title ?? 'deleted task'}
                </button>
              )}
              <span className="text-xs text-muted">· {r.trigger}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
            </div>
            {(r.detail.length > 0 || r.error) && (
              <ul className="mt-1 ml-6 space-y-0.5 text-xs text-muted">
                {r.detail.map((d, i) => (
                  <li key={i}>• {d}</li>
                ))}
                {r.error && <li className="text-danger">Error: {r.error}</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
