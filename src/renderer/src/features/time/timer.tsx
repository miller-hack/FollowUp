import { useEffect, useState } from 'react'
import { Pause, Play, Square } from 'lucide-react'
import { api } from '@/lib/api'
import { useRunningTimer } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

/** h:mm:ss since an ISO instant, updating every second. */
export function useElapsed(startIso: string | null | undefined): string {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!startIso) return
    const h = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(h)
  }, [startIso])
  if (!startIso) return ''
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 1000))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function TimerButton({ taskId, compact }: { taskId: string; compact?: boolean }) {
  const { data: timer } = useRunningTimer()
  const running = timer?.task.id === taskId
  const elapsed = useElapsed(running ? timer!.entry.started_at : null)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void (running ? api.stopTimer() : api.startTimer(taskId))
      }}
      title={running ? 'Stop timer' : 'Start timer'}
      aria-label={running ? `Stop timer (${elapsed})` : 'Start timer'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md text-xs font-medium',
        compact ? 'h-6 px-1.5' : 'h-7 px-2.5',
        running ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'border border-line text-muted hover:text-fg'
      )}
    >
      {running ? <Pause size={12} /> : <Play size={12} />}
      {running ? <span className="tabular-nums">{elapsed}</span> : !compact && 'Start'}
    </button>
  )
}

/** Shows the running timer in the sidebar. */
export function RunningTimerBar() {
  const { data: timer } = useRunningTimer()
  const elapsed = useElapsed(timer?.entry.started_at)
  if (!timer) return null
  return (
    <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-2.5 py-2">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => useUi.getState().openTask(timer.task.id)}>
        <div className="truncate text-xs font-medium">{timer.task.title}</div>
        <div className="text-[11px] text-muted tabular-nums">{elapsed}</div>
      </button>
      <button type="button" aria-label="Stop timer" title="Stop timer" onClick={() => api.stopTimer()} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
        <Square size={13} fill="currentColor" />
      </button>
    </div>
  )
}
