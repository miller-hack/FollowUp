import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays as addDaysFns, format, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, Download, Plus, Trash2 } from 'lucide-react'
import { localDate } from '@shared/dates'
import type { TaskRef, TimeEntryRow } from '@shared/types'
import { api } from '@/lib/api'
import { useSettings, useTreeMaps } from '@/lib/hooks'
import { cn, formatMinutes, parseDuration } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import { Button, Empty, Input, Modal } from '@/components/ui'
import { TaskSearch } from '../tasks/TaskSearch'
import { useElapsed } from './timer'

const minutesOf = (e: TimeEntryRow, nowMs: number) =>
  e.duration_sec != null ? e.duration_sec / 60 : Math.max(0, (nowMs - Date.parse(e.started_at)) / 60000)

export function TimePage() {
  const { data: settings } = useSettings()
  const maps = useTreeMaps()
  const weekStartsOn = settings?.weekStart ?? 1
  const [anchor, setAnchor] = useState(() => new Date())
  const [adding, setAdding] = useState(false)
  const weekStart = startOfWeek(anchor, { weekStartsOn })
  const days = Array.from({ length: 7 }, (_, i) => addDaysFns(weekStart, i))
  const from = weekStart.toISOString()
  const to = addDaysFns(weekStart, 7).toISOString()
  const { data: entries = [] } = useQuery({ queryKey: ['time', from], queryFn: () => api.listTimeEntries({ from, to }) })
  const nowMs = Date.now()

  // rows = tasks, columns = local days
  const grid = useMemo(() => {
    const rows = new Map<string, { task_id: string; title: string; list_id: string; perDay: number[]; total: number }>()
    for (const e of entries) {
      const row = rows.get(e.task_id) ?? { task_id: e.task_id, title: e.task_title, list_id: e.list_id, perDay: Array(7).fill(0), total: 0 }
      const day = days.findIndex((d) => localDate(d) === localDate(new Date(e.started_at)))
      const m = minutesOf(e, nowMs)
      if (day >= 0) row.perDay[day] += m
      row.total += m
      rows.set(e.task_id, row)
    }
    return [...rows.values()].sort((a, b) => b.total - a.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, from])
  const dayTotals = days.map((_, i) => grid.reduce((a, r) => a + r.perDay[i], 0))
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0)
  const fmt = (m: number) => (m >= 1 ? formatMinutes(Math.round(m)) : '')
  const today = localDate()

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Time tracking</h1>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" aria-label="Previous week" onClick={() => setAnchor(addDaysFns(anchor, -7))}>
            <ChevronLeft size={15} />
          </Button>
          <span className="min-w-44 text-center font-medium">
            {format(weekStart, 'MMM d')} – {format(addDaysFns(weekStart, 6), 'MMM d, yyyy')}
          </span>
          <Button size="sm" variant="ghost" aria-label="Next week" onClick={() => setAnchor(addDaysFns(anchor, 7))}>
            <ChevronRight size={15} />
          </Button>
          <Button size="sm" onClick={() => setAnchor(new Date())}>This week</Button>
          <Button
            size="sm"
            onClick={async () => {
              const file = await api.exportTimeCsv(from, to)
              if (file) toast(`Exported to ${file}`, 'success')
            }}
          >
            <Download size={13} /> Export CSV
          </Button>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add time
          </Button>
        </div>

        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="grid border-b border-line text-xs font-medium text-muted" style={{ gridTemplateColumns: 'minmax(220px,1fr) repeat(7, 84px) 90px' }}>
            <div className="px-4 py-2.5">Task</div>
            {days.map((d) => (
              <div key={d.toISOString()} className={cn('py-2.5 text-center', localDate(d) === today && 'text-accent')}>
                {format(d, 'EEE d')}
              </div>
            ))}
            <div className="py-2.5 pr-4 text-right">Total</div>
          </div>
          {grid.length === 0 && <Empty>No time tracked this week. Start a timer from any task.</Empty>}
          {grid.map((r) => (
            <div key={r.task_id} className="grid border-b border-line text-[13px] hover:bg-hover/50" style={{ gridTemplateColumns: 'minmax(220px,1fr) repeat(7, 84px) 90px' }}>
              <button type="button" className="truncate px-4 py-2 text-left hover:underline" onClick={() => useUi.getState().openTask(r.task_id)}>
                {r.title}
                <span className="ml-2 text-xs text-muted">{maps?.list.get(r.list_id)?.name}</span>
              </button>
              {r.perDay.map((m, i) => (
                <div key={i} className="py-2 text-center tabular-nums">{fmt(m)}</div>
              ))}
              <div className="py-2 pr-4 text-right font-semibold tabular-nums">{fmt(r.total)}</div>
            </div>
          ))}
          <div className="grid bg-hover/40 text-[13px] font-semibold" style={{ gridTemplateColumns: 'minmax(220px,1fr) repeat(7, 84px) 90px' }}>
            <div className="px-4 py-2.5">Total</div>
            {dayTotals.map((m, i) => (
              <div key={i} className="py-2.5 text-center tabular-nums">{fmt(m)}</div>
            ))}
            <div className="py-2.5 pr-4 text-right tabular-nums">{fmt(weekTotal) || '0m'}</div>
          </div>
        </section>

        <h2 className="mt-8 mb-2 font-semibold">Entries</h2>
        <section className="rounded-xl border border-line bg-panel">
          {entries.length === 0 && <Empty>No entries.</Empty>}
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </section>
      </div>
      {adding && <AddTimeModal onClose={() => setAdding(false)} />}
    </div>
  )
}

function EntryRow({ entry: e }: { entry: TimeEntryRow }) {
  const running = e.ended_at === null
  const elapsed = useElapsed(running ? e.started_at : null)
  const start = new Date(e.started_at)
  return (
    <div className="group flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
      <span className="w-28 shrink-0 text-muted">{format(start, 'EEE MMM d')}</span>
      <span className="w-24 shrink-0 text-muted tabular-nums">
        {format(start, 'HH:mm')}–{e.ended_at ? format(new Date(e.ended_at), 'HH:mm') : 'now'}
      </span>
      <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => useUi.getState().openTask(e.task_id)}>
        {e.task_title}
        {e.note && <span className="ml-2 text-muted">· {e.note}</span>}
      </button>
      {running ? (
        <span className="text-green-600 tabular-nums dark:text-green-400">{elapsed}</span>
      ) : (
        <input
          key={e.duration_sec}
          defaultValue={formatMinutes(Math.round((e.duration_sec ?? 0) / 60))}
          aria-label="Duration"
          onBlur={(ev) => {
            const v = parseDuration(ev.target.value)
            if (v && v !== Math.round((e.duration_sec ?? 0) / 60)) void api.updateTimeEntry(e.id, { duration_min: v })
          }}
          onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
          className="w-20 rounded border border-transparent bg-transparent px-1 text-right font-medium tabular-nums outline-none hover:border-line focus:border-accent"
        />
      )}
      <button type="button" aria-label="Delete entry" className="invisible text-muted group-hover:visible hover:text-danger" onClick={() => api.deleteTimeEntry(e.id)}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export function AddTimeModal({ onClose, task }: { onClose: () => void; task?: TaskRef }) {
  const [picked, setPicked] = useState<TaskRef | undefined>(task)
  const [date, setDate] = useState(localDate())
  const [startTime, setStartTime] = useState('09:00')
  const [duration, setDuration] = useState('1h')
  const [note, setNote] = useState('')
  const minutes = parseDuration(duration)
  const save = async () => {
    if (!picked || !minutes) return
    await api.addTimeEntry({ task_id: picked.id, started_at: new Date(`${date}T${startTime}`).toISOString(), duration_min: minutes, note })
    onClose()
  }
  return (
    <Modal
      title="Add time"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked || !minutes} onClick={save}>Add entry</Button>
        </>
      }
    >
      <div className="space-y-3">
        {!task && (
          <div>
            <div className="mb-1 text-xs text-muted">Task</div>
            {picked ? (
              <div className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5">
                {picked.title}
                <Button size="sm" variant="ghost" onClick={() => setPicked(undefined)}>Change</Button>
              </div>
            ) : (
              <TaskSearch exclude={[]} onPick={setPicked} />
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-muted">
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </label>
          <label className="text-xs text-muted">
            Start
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1" />
          </label>
          <label className="text-xs text-muted">
            Duration
            <Input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1h 30m" className="mt-1" />
          </label>
        </div>
        <label className="block text-xs text-muted">
          Note
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" className="mt-1" />
        </label>
      </div>
    </Modal>
  )
}
