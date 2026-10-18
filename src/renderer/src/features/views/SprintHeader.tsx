import { useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronUp, Flag, Play } from 'lucide-react'
import { diffDays, localDate, parseLocal } from '@shared/dates'
import { api } from '@/lib/api'
import { useSprintStats, useTreeMaps } from '@/lib/hooks'
import { cn, formatMinutes } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button } from '@/components/ui'
import { Burndown, ProgressBar } from '@/components/charts'

export function SprintHeader({ sprintId }: { sprintId: string }) {
  const maps = useTreeMaps()
  const sprint = maps?.sprint.get(sprintId)
  const { data: stats } = useSprintStats(sprintId)
  const [open, setOpen] = useState(true)
  if (!sprint) return null
  const today = localDate()
  const daysLeft = diffDays(today, sprint.end_date)
  const statusLabel = { planned: 'Planned', active: 'Active', closed: 'Closed' }[sprint.status]

  return (
    <div className="mt-2 rounded-lg border border-line bg-bg/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase',
            sprint.status === 'active' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-hover text-muted'
          )}
        >
          {statusLabel}
        </span>
        <label className="flex items-center gap-1 text-muted">
          <input
            type="date"
            value={sprint.start_date}
            onChange={(e) => e.target.value && api.updateSprint(sprint.id, { start_date: e.target.value })}
            className="rounded border border-transparent bg-transparent px-1 text-fg hover:border-line"
            aria-label="Sprint start"
          />
          →
          <input
            type="date"
            value={sprint.end_date}
            onChange={(e) => e.target.value && api.updateSprint(sprint.id, { end_date: e.target.value })}
            className="rounded border border-transparent bg-transparent px-1 text-fg hover:border-line"
            aria-label="Sprint end"
          />
        </label>
        {sprint.status !== 'closed' && (
          <span className={cn('text-xs', daysLeft < 0 ? 'text-red-500' : 'text-muted')}>
            {daysLeft < 0 ? `${-daysLeft} days over` : daysLeft === 0 ? 'Ends today' : `${daysLeft} days left`}
          </span>
        )}
        {stats && (
          <div className="flex items-center gap-2">
            <ProgressBar value={stats.total ? stats.done / stats.total : 0} className="w-32" />
            <span className="text-xs text-muted">
              {stats.done}/{stats.total} done{stats.estimate_min ? ` · ${formatMinutes(stats.estimate_min)} estimated` : ''}
            </span>
          </div>
        )}
        <div className="flex-1" />
        {sprint.status === 'planned' && (
          <Button size="sm" onClick={() => api.updateSprint(sprint.id, { status: 'active' })}>
            <Play size={13} /> Start sprint
          </Button>
        )}
        {sprint.status === 'active' && (
          <Button
            size="sm"
            onClick={async () => {
              if (!window.confirm('Complete this sprint? Unfinished tasks move to the next sprint.')) return
              const r = await api.completeSprint(sprint.id)
              toast(`Sprint completed. ${r.moved} unfinished task(s) moved to ${r.next.name}.`, 'success')
            }}
          >
            <Flag size={13} /> Complete sprint
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          Burndown {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </Button>
      </div>
      {open && stats && (
        <div className="mt-2 max-w-3xl">
          {stats.total === 0 ? (
            <p className="py-3 text-xs text-muted">
              Add tasks to this sprint ({format(parseLocal(sprint.start_date), 'MMM d')} – {format(parseLocal(sprint.end_date), 'MMM d')}) to see the burndown.
            </p>
          ) : (
            <Burndown stats={stats} height={150} showTotals={false} />
          )}
        </div>
      )}
    </div>
  )
}
