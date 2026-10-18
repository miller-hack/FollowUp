import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { addDays, diffDays, localDate, parseLocal } from '@shared/dates'
import { sortTasks } from '@shared/sort'
import type { Task, TaskPatch, ViewConfig } from '@shared/types'
import { api } from '@/lib/api'
import { optimisticPatch, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { StatusCircle } from '../tasks/pickers'

const ROW = 34
const LEFT = 300
const HEADER = 52
const DAY_WIDTH: Record<ViewConfig['ganttZoom'], number> = { day: 36, week: 16, month: 5 }

interface Drag {
  id: string
  mode: 'move' | 'start' | 'end'
  x0: number
  delta: number
}

interface Row {
  task: Task
  depth: number
}

export function GanttView({ tasks, config, onConfig }: { tasks: Task[]; config: ViewConfig; onConfig: (p: Partial<ViewConfig>) => void }) {
  const maps = useTreeMaps()
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const w = DAY_WIDTH[config.ganttZoom]
  const today = localDate()

  // tree order: dated tasks first (by start), subtasks under parents, undated at the end
  const rows = useMemo<Row[]>(() => {
    const ids = new Set(tasks.map((t) => t.id))
    const kids = new Map<string, Task[]>()
    for (const t of tasks) if (t.parent_id && ids.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t])
    const startOf = (t: Task) => (t.start_date ?? t.due_date ?? '9999').slice(0, 10)
    const order = (xs: Task[]) => sortTasks(xs, 'position', 'asc').sort((a, b) => startOf(a).localeCompare(startOf(b)))
    const out: Row[] = []
    const walk = (t: Task, depth: number) => {
      out.push({ task: t, depth })
      for (const k of order(kids.get(t.id) ?? [])) walk(k, depth + 1)
    }
    for (const t of order(tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id)))) walk(t, 0)
    return out
  }, [tasks])

  const range = useMemo(() => {
    const dates = tasks.flatMap((t) => [t.start_date, t.due_date]).filter(Boolean).map((d) => d!.slice(0, 10))
    const min = [today, ...dates].sort()[0]
    const max = [today, ...dates].sort().at(-1)!
    const start = addDays(min, -14)
    const days = Math.max(diffDays(start, max) + 45, 90)
    return { start, days }
  }, [tasks, today])

  const x = (iso: string) => diffDays(range.start, iso.slice(0, 10)) * w

  // scroll so that today is visible on first render / zoom change
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = Math.max(0, x(today) - (el.clientWidth - LEFT) / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.ganttZoom, range.start])

  if (!maps) return null

  const bar = (t: Task) => {
    if (!t.start_date && !t.due_date) return null
    let s = (t.start_date ?? t.due_date)!.slice(0, 10)
    let e = (t.due_date ?? t.start_date)!.slice(0, 10)
    if (e < s) e = s
    if (drag?.id === t.id && drag.delta) {
      if (drag.mode !== 'end') s = addDays(s, drag.delta)
      if (drag.mode !== 'start') e = addDays(e, drag.delta)
      if (e < s) drag.mode === 'start' ? (s = e) : (e = s)
    }
    return { left: x(s), width: (diffDays(s, e) + 1) * w, s, e }
  }

  const commit = (t: Task, d: Drag) => {
    const shiftDate = (iso: string | null) => (iso ? addDays(iso, d.delta) : null)
    const patch: TaskPatch = {}
    if (d.mode === 'move') {
      patch.start_date = shiftDate(t.start_date)
      patch.due_date = shiftDate(t.due_date)
    } else if (d.mode === 'start') {
      const cur = t.start_date ?? t.due_date!
      const next = addDays(cur, d.delta)
      patch.start_date = t.due_date && next.slice(0, 10) > t.due_date.slice(0, 10) ? t.due_date : next
    } else {
      const cur = t.due_date ?? t.start_date!
      const next = addDays(cur, d.delta)
      patch.due_date = t.start_date && next.slice(0, 10) < t.start_date.slice(0, 10) ? t.start_date : next
      if (!t.start_date && t.due_date) patch.start_date = t.due_date
    }
    optimisticPatch(t.id, patch)
    void api.updateTask(t.id, patch)
  }

  const startDrag = (e: React.PointerEvent, t: Task, mode: Drag['mode']) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: t.id, mode, x0: e.clientX, delta: 0 })
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, delta: Math.round((e.clientX - drag.x0) / w) })
  }
  const onUp = (t: Task) => {
    if (!drag) return
    if (drag.delta) commit(t, drag)
    else if (drag.mode === 'move') useUi.getState().openTask(t.id)
    setDrag(null)
  }

  // header cells
  const days = Array.from({ length: range.days }, (_, i) => addDays(range.start, i))
  const months: { label: string; left: number; width: number }[] = []
  for (const d of days) {
    const label = format(parseLocal(d), 'MMMM yyyy')
    const last = months.at(-1)
    if (last?.label === label) last.width += w
    else months.push({ label, left: x(d), width: w })
  }
  const timelineWidth = range.days * w
  const rowIndex = new Map(rows.map((r, i) => [r.task.id, i]))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-6 py-2">
        {(['day', 'week', 'month'] as const).map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => onConfig({ ganttZoom: z })}
            className={cn('rounded-md px-2.5 py-1 text-xs capitalize', config.ganttZoom === z ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover')}
          >
            {z}
          </button>
        ))}
        <button
          type="button"
          className="ml-2 rounded-md px-2.5 py-1 text-xs text-muted hover:bg-hover"
          onClick={() => scroller.current && (scroller.current.scrollLeft = x(today) - 200)}
        >
          Today
        </button>
        <span className="ml-auto text-xs text-muted">Drag bars to reschedule · drag edges to resize · click an empty row to set dates</span>
      </div>

      <div ref={scroller} className="relative flex-1 overflow-auto border-t border-line bg-panel">
        <div style={{ width: LEFT + timelineWidth, height: HEADER + rows.length * ROW + 40 }} className="relative">
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-panel" style={{ height: HEADER }}>
            <div className="sticky left-0 z-10 flex items-end border-r border-line bg-panel px-3 pb-2 text-[11px] font-medium uppercase text-muted" style={{ width: LEFT, minWidth: LEFT }}>
              Task
            </div>
            <div className="relative" style={{ width: timelineWidth }}>
              {months.map((m) => (
                <div key={m.label + m.left} className="absolute top-0 border-l border-line pt-1.5 text-xs font-semibold" style={{ left: m.left, width: m.width }}>
                  {/* stays visible while the month's start is scrolled under the task column */}
                  <span className="sticky inline-block truncate px-2" style={{ left: LEFT, maxWidth: m.width }}>
                    {m.label}
                  </span>
                </div>
              ))}
              {config.ganttZoom !== 'month' &&
                days.map((d, i) => {
                  const date = parseLocal(d)
                  const show = config.ganttZoom === 'day' || date.getDay() === 1
                  if (!show) return null
                  return (
                    <div
                      key={d}
                      className={cn('absolute bottom-1 text-center text-[11px] text-muted', d === today && 'font-bold text-accent')}
                      style={{ left: i * w, width: config.ganttZoom === 'day' ? w : w * 7 }}
                    >
                      {config.ganttZoom === 'day' ? format(date, 'd') : format(date, 'MMM d')}
                    </div>
                  )
                })}
            </div>
          </div>

          {/* weekend shading + today line */}
          <div className="pointer-events-none absolute" style={{ left: LEFT, top: HEADER, width: timelineWidth, height: rows.length * ROW }}>
            {config.ganttZoom === 'day' &&
              days.map((d, i) => {
                const wd = parseLocal(d).getDay()
                return wd === 0 || wd === 6 ? <div key={d} className="absolute top-0 bottom-0 bg-hover/60" style={{ left: i * w, width: w }} /> : null
              })}
            <div className="absolute top-0 bottom-0 w-0.5 bg-accent/70" style={{ left: x(today) + w / 2 }} />
          </div>

          {/* dependency arrows */}
          <svg className="pointer-events-none absolute z-[5]" style={{ left: LEFT, top: HEADER }} width={timelineWidth} height={rows.length * ROW}>
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--app-muted)" />
              </marker>
            </defs>
            {rows.flatMap(({ task }) =>
              task.blocked_by.map((bid) => {
                const blocker = tasks.find((t) => t.id === bid)
                const from = blocker && bar(blocker)
                const to = bar(task)
                if (!from || !to) return null
                const y1 = rowIndex.get(bid)! * ROW + ROW / 2
                const y2 = rowIndex.get(task.id)! * ROW + ROW / 2
                const x1 = from.left + from.width
                const x2 = to.left
                const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12))
                return (
                  <path
                    key={`${bid}-${task.id}`}
                    d={`M${x1},${y1} H${mid} V${y2} H${x2 - 2}`}
                    fill="none"
                    stroke="var(--app-muted)"
                    strokeWidth="1.3"
                    markerEnd="url(#arrow)"
                  />
                )
              })
            )}
          </svg>

          {/* rows */}
          {rows.map(({ task: t, depth }) => {
            const list = maps.list.get(t.list_id)
            const statuses = list ? maps.statusesOf(list.space_id) : []
            const status = maps.status.get(t.status_id)
            const b = bar(t)
            return (
              <div key={t.id} className="group flex border-b border-line/60 hover:bg-hover/40" style={{ height: ROW }}>
                <div
                  className="sticky left-0 z-10 flex items-center gap-2 border-r border-line bg-panel pr-2 group-hover:bg-hover"
                  style={{ width: LEFT, minWidth: LEFT, paddingLeft: 12 + depth * 18 }}
                >
                  <StatusCircle statuses={statuses} value={t.status_id} onChange={(status_id) => api.updateTask(t.id, { status_id })} />
                  <button type="button" className={cn('truncate text-left hover:underline', status?.type === 'done' && 'text-muted line-through')} onClick={() => useUi.getState().openTask(t.id)}>
                    {t.title}
                  </button>
                </div>
                <div
                  className="relative"
                  style={{ width: timelineWidth }}
                  onClick={(e) => {
                    if (b) return
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const d = addDays(range.start, Math.floor((e.clientX - rect.left) / w))
                    void api.updateTask(t.id, { start_date: d, due_date: d })
                  }}
                >
                  {b ? (
                    <div
                      className={cn(
                        'absolute top-[7px] flex h-5 cursor-grab items-center rounded-md text-[11px] font-medium text-white shadow-sm active:cursor-grabbing',
                        drag?.id === t.id && 'ring-2 ring-accent'
                      )}
                      style={{ left: b.left + 1, width: Math.max(b.width - 2, 6), background: status?.color ?? 'var(--app-accent)' }}
                      onPointerDown={(e) => startDrag(e, t, 'move')}
                      onPointerMove={onMove}
                      onPointerUp={() => onUp(t)}
                      title={`${t.title}\n${b.s} → ${b.e}`}
                    >
                      <span
                        className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-black/20"
                        onPointerDown={(e) => startDrag(e, t, 'start')}
                        onPointerMove={onMove}
                        onPointerUp={(e) => (e.stopPropagation(), onUp(t))}
                      />
                      {b.width > 60 && <span className="truncate px-2.5">{t.title}</span>}
                      <span
                        className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize rounded-r-md hover:bg-black/20"
                        onPointerDown={(e) => startDrag(e, t, 'end')}
                        onPointerMove={onMove}
                        onPointerUp={(e) => (e.stopPropagation(), onUp(t))}
                      />
                    </div>
                  ) : (
                    <span className="absolute top-2 hidden text-[11px] text-muted group-hover:block" style={{ left: x(today) + 8 }}>
                      Click to schedule
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
