import { useState } from 'react'
import { CheckCircle2, Circle, Link2, MoreHorizontal, Plus, Target, Trash2, X } from 'lucide-react'
import type { Goal, KeyResult, KeyResultType } from '@shared/types'
import { api } from '@/lib/api'
import { useGoals, useTask, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Button, ColorGrid, Empty, IconButton, InlineEdit, Input, MenuItem, MenuSeparator, Modal, Popover } from '@/components/ui'
import { ProgressBar } from '@/components/charts'
import { DateField } from '../tasks/pickers'
import { TaskSearch } from '../tasks/TaskSearch'

const KR_TYPES: [KeyResultType, string][] = [
  ['number', 'Number'],
  ['percent', 'Percentage'],
  ['currency', 'Currency'],
  ['boolean', 'True / false'],
  ['tasks', 'Tasks']
]

const pct = (p: number) => `${Math.round(p * 100)}%`

export function GoalsPage() {
  const { data: goals = [], isLoading } = useGoals()
  const [creating, setCreating] = useState(false)
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="mb-6 flex items-center">
          <h1 className="flex-1 text-2xl font-semibold">Goals</h1>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New goal
          </Button>
        </div>
        {!isLoading && goals.length === 0 && (
          <Empty>
            <Target size={28} className="mx-auto mb-2 opacity-50" />
            Set goals with measurable key results — numbers, percentages, yes/no or linked tasks.
          </Empty>
        )}
        <div className="space-y-4">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      </div>
      {creating && <NewGoalModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewGoalModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [due, setDue] = useState<string | null>(null)
  const create = async () => {
    if (!name.trim()) return
    await api.createGoal({ name, due_date: due })
    onClose()
  }
  return (
    <Modal
      title="New goal"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={create}>Create goal</Button>
        </>
      }
    >
      <Input autoFocus placeholder="e.g. Launch the new website" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
      <div className="mt-3 flex items-center gap-2 text-[13px]">
        <span className="text-muted">Due</span>
        <DateField value={due} onChange={setDue} placeholder="No due date" />
      </div>
    </Modal>
  )
}

function GoalCard({ goal }: { goal: Goal }) {
  const [adding, setAdding] = useState(false)
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: goal.color }} />
        <div className="min-w-0 flex-1">
          <InlineEdit value={goal.name} onSave={(name) => api.updateGoal(goal.id, { name })} className="text-[15px] font-semibold" />
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <DateField value={goal.due_date} onChange={(due_date) => api.updateGoal(goal.id, { due_date })} placeholder="No due date" />
            <span>·</span>
            <span>{goal.key_results.length} key result{goal.key_results.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">{pct(goal.progress)}</div>
        </div>
        <Popover align="end" trigger={<IconButton label="Goal options"><MoreHorizontal size={15} /></IconButton>}>
          {(close) => (
            <>
              <Popover trigger={<MenuItem>Color</MenuItem>} triggerClassName="w-full">
                <ColorGrid value={goal.color} onChange={(color) => (api.updateGoal(goal.id, { color }), close())} />
              </Popover>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={14} />} onClick={() => (close(), window.confirm(`Delete goal “${goal.name}”?`) && api.deleteGoal(goal.id))}>
                Delete goal
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
      <ProgressBar value={goal.progress} color={goal.color} className="mt-3" />

      <div className="mt-4 space-y-2">
        {goal.key_results.map((kr) => (
          <KeyResultRow key={kr.id} kr={kr} color={goal.color} />
        ))}
      </div>
      {adding ? (
        <NewKeyResult goalId={goal.id} onDone={() => setAdding(false)} />
      ) : (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add key result
        </Button>
      )}
    </section>
  )
}

function NewKeyResult({ goalId, onDone }: { goalId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<KeyResultType>('number')
  const [target, setTarget] = useState('10')
  const [unit, setUnit] = useState('')
  const needsTarget = type === 'number' || type === 'currency'
  const save = async () => {
    if (!name.trim()) return
    await api.addKeyResult(goalId, { name, type, target_value: needsTarget ? Number(target) || 1 : undefined, unit: type === 'currency' ? unit || '$' : unit })
    onDone()
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
      <Input autoFocus placeholder="Key result name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className="min-w-48 flex-1" />
      <select value={type} onChange={(e) => setType(e.target.value as KeyResultType)} className="h-8 rounded-md border border-line bg-panel px-2 text-[13px]">
        {KR_TYPES.map(([t, l]) => (
          <option key={t} value={t}>{l}</option>
        ))}
      </select>
      {needsTarget && (
        <>
          <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} className="w-24" aria-label="Target" />
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={type === 'currency' ? '$' : 'unit'} className="w-20" aria-label="Unit" />
        </>
      )}
      <Button size="sm" variant="primary" onClick={save} disabled={!name.trim()}>Add</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </div>
  )
}

function KeyResultRow({ kr, color }: { kr: KeyResult; color: string }) {
  const fmt = (v: number) => (kr.type === 'currency' ? `${kr.unit || '$'}${v.toLocaleString()}` : kr.type === 'percent' ? `${v}%` : `${v.toLocaleString()}${kr.unit ? ` ${kr.unit}` : ''}`)
  return (
    <div className="group rounded-lg bg-hover/50 px-3 py-2">
      <div className="flex items-center gap-3">
        {kr.type === 'boolean' ? (
          <button type="button" aria-label="Toggle done" onClick={() => api.updateKeyResult(kr.id, { current_value: kr.current_value >= 1 ? 0 : 1 })}>
            {kr.current_value >= 1 ? <CheckCircle2 size={16} className="text-green-500" /> : <Circle size={16} className="text-muted" />}
          </button>
        ) : null}
        <InlineEdit value={kr.name} onSave={(name) => api.updateKeyResult(kr.id, { name })} className="min-w-0 flex-1" />
        {(kr.type === 'number' || kr.type === 'percent' || kr.type === 'currency') && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <input
              key={kr.current_value}
              type="number"
              defaultValue={kr.current_value}
              aria-label="Current value"
              onBlur={(e) => Number(e.target.value) !== kr.current_value && api.updateKeyResult(kr.id, { current_value: Number(e.target.value) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-20 rounded border border-line bg-panel px-1.5 py-0.5 text-right text-[13px] text-fg outline-none focus:border-accent"
            />
            / {fmt(kr.target_value)}
          </span>
        )}
        {kr.type === 'tasks' && (
          <span className="text-xs text-muted">
            {kr.tasks_done}/{kr.task_ids.length} tasks
          </span>
        )}
        <span className="w-10 text-right text-xs font-semibold tabular-nums">{pct(kr.progress)}</span>
        <button type="button" aria-label="Delete key result" className="invisible text-muted group-hover:visible hover:text-danger" onClick={() => api.deleteKeyResult(kr.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      <ProgressBar value={kr.progress} color={color} className="mt-2" />
      {kr.type === 'tasks' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {kr.task_ids.map((id) => (
            <LinkedTask key={id} krId={kr.id} taskId={id} />
          ))}
          <Popover trigger={<button type="button" className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted hover:bg-hover hover:text-fg"><Link2 size={12} /> Link task</button>}>
            {(close) => <TaskSearch exclude={kr.task_ids} onPick={(t) => (api.linkKeyResultTask(kr.id, t.id), close())} />}
          </Popover>
        </div>
      )}
    </div>
  )
}

function LinkedTask({ krId, taskId }: { krId: string; taskId: string }) {
  const { data: task } = useTask(taskId)
  const maps = useTreeMaps()
  const done = !!task && maps?.status.get(task.status_id)?.type === 'done'
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-1.5 text-xs', done && 'text-muted line-through')}>
      <button type="button" onClick={() => useUi.getState().openTask(taskId)} className="max-w-48 truncate hover:underline">
        {task === undefined ? '…' : (task?.title ?? 'Deleted task')}
      </button>
      <button type="button" aria-label="Unlink" onClick={() => api.unlinkKeyResultTask(krId, taskId)} className="text-muted hover:text-fg">
        <X size={11} />
      </button>
    </span>
  )
}
