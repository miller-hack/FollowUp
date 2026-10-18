import { useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg, DateClickArg } from '@fullcalendar/interaction'
import { addDays, diffDays, hasTime, localDate, localDateTime } from '@shared/dates'
import type { Task, TaskPatch } from '@shared/types'
import { api } from '@/lib/api'
import { optimisticPatch, useSettings, useTreeMaps } from '@/lib/hooks'
import { PRIORITY_META } from '@/lib/utils'
import { useUi } from '@/stores/ui'

/** Shift a stored date by n days keeping its shape (date-only vs date-time). */
const shift = (iso: string | null, days: number): string | null => (iso ? addDays(iso, days) : null)

/** Convert a FullCalendar Date back to our storage format. */
const toStored = (d: Date, allDay: boolean): string => (allDay ? localDate(d) : localDateTime(d))

export function CalendarView({ tasks, defaultListId, sprintId }: { tasks: Task[]; defaultListId?: string; sprintId?: string }) {
  const maps = useTreeMaps()
  const { data: settings } = useSettings()
  const openQuickAdd = useUi((s) => s.openQuickAdd)

  const events = useMemo<EventInput[]>(() => {
    if (!maps) return []
    return tasks
      .filter((t) => t.due_date || t.start_date)
      .map((t) => {
        const status = maps.status.get(t.status_id)
        const start = t.start_date ?? t.due_date!
        const end = t.due_date ?? t.start_date!
        const allDay = !hasTime(start) || !hasTime(end)
        return {
          id: t.id,
          title: t.title,
          start: allDay ? start.slice(0, 10) : start,
          // FullCalendar's all-day end is exclusive
          end: allDay ? addDays(end.slice(0, 10), 1) : end === start ? undefined : end,
          allDay,
          backgroundColor: status?.color,
          borderColor: t.priority !== 'none' ? PRIORITY_META[t.priority].color : status?.color,
          textColor: '#fff',
          classNames: status?.type === 'done' ? ['opacity-60', 'line-through'] : []
        }
      })
  }, [tasks, maps])

  const apply = (id: string, patch: TaskPatch) => {
    optimisticPatch(id, patch)
    void api.updateTask(id, patch)
  }

  const onDrop = (arg: EventDropArg) => {
    const t = tasks.find((x) => x.id === arg.event.id)
    if (!t || !arg.event.start) return
    const anchor = t.start_date ?? t.due_date!
    const timed = !arg.event.allDay
    if (timed !== hasTime(anchor)) {
      // moved between the all-day row and the time grid: convert format
      const start = toStored(arg.event.start, arg.event.allDay)
      apply(t.id, t.start_date && t.due_date && t.start_date !== t.due_date ? { start_date: start, due_date: start } : { due_date: start, start_date: t.start_date ? start : null })
      return
    }
    const days = diffDays(localDate(arg.oldEvent.start!), localDate(arg.event.start))
    if (!timed) apply(t.id, { start_date: shift(t.start_date, days), due_date: shift(t.due_date, days) })
    else {
      const deltaMin = Math.round((arg.event.start.getTime() - arg.oldEvent.start!.getTime()) / 60000)
      const move = (iso: string | null) => (iso ? localDateTime(new Date(new Date(iso).getTime() + deltaMin * 60000)) : null)
      apply(t.id, { start_date: move(t.start_date), due_date: move(t.due_date) })
    }
  }

  const onResize = (arg: EventResizeDoneArg) => {
    const ev = arg.event
    if (!ev.end) return
    const due = ev.allDay ? addDays(localDate(ev.end), -1) : localDateTime(ev.end)
    const start = ev.start ? toStored(ev.start, ev.allDay) : null
    apply(ev.id, { due_date: due, start_date: start })
  }

  return (
    <div className="h-full overflow-auto bg-panel px-6 py-4">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
        buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
        firstDay={settings?.weekStart ?? 1}
        height="100%"
        events={events}
        editable
        eventResizableFromStart
        dayMaxEvents={4}
        nowIndicator
        eventClick={(arg) => useUi.getState().openTask(arg.event.id)}
        eventDrop={onDrop}
        eventResize={onResize}
        dateClick={(arg: DateClickArg) =>
          defaultListId && openQuickAdd({ list_id: defaultListId, sprint_id: sprintId, due_date: arg.allDay ? arg.dateStr.slice(0, 10) : localDateTime(arg.date) })
        }
      />
    </div>
  )
}
