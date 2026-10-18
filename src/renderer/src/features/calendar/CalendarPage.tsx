import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { CheckSquare, Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { addDays, hasTime, localDate, localDateTime } from '@shared/dates'
import type { CalendarEvent } from '@shared/mail'
import { api } from '@/lib/api'
import { useCalendars, useSettings, useTasks, useTreeMaps } from '@/lib/hooks'
import { toast, useUi } from '@/stores/ui'
import { Button, ColorGrid, Input, Modal, Popover } from '@/components/ui'
import { Select } from '@/components/selects'

interface EventDraft {
  event_id?: string
  calendar_id: string
  title: string
  start: string
  end: string
  all_day: boolean
  location: string
  description: string
  task_id: string | null
  recurring?: boolean
}

const toStored = (d: Date, allDay: boolean) => (allDay ? localDate(d) : localDateTime(d))

export function CalendarPage() {
  const maps = useTreeMaps()
  const { data: settings } = useSettings()
  const { data: calendars = [] } = useCalendars()
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [showTasks, setShowTasks] = useState(true)
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const { data: events = [] } = useQuery({
    queryKey: ['events', range?.from, range?.to],
    queryFn: () => api.listEvents(range!.from, range!.to),
    enabled: !!range,
    placeholderData: (p) => p
  })
  const { data: tasks = [] } = useTasks({ includeClosed: false }, showTasks)
  const writable = calendars.filter((c) => !c.read_only)

  const fcEvents = useMemo<EventInput[]>(() => {
    const evs: EventInput[] = events.map((e) => ({
      id: `ev:${e.id}`,
      title: e.title,
      start: e.all_day ? e.start : e.start,
      end: e.all_day ? addDays(e.end, 1) : e.end,
      allDay: e.all_day,
      backgroundColor: e.color,
      borderColor: e.color,
      editable: !e.recurring && !calendars.find((c) => c.id === e.calendar_id)?.read_only,
      extendedProps: { kind: 'event', data: e }
    }))
    if (showTasks && maps) {
      for (const t of tasks) {
        if (!t.due_date) continue
        const status = maps.status.get(t.status_id)
        evs.push({
          id: `task:${t.id}`,
          title: `☐ ${t.title}`,
          start: t.due_date,
          allDay: !hasTime(t.due_date),
          backgroundColor: 'transparent',
          borderColor: status?.color,
          textColor: 'var(--app-fg)',
          classNames: ['task-event'],
          extendedProps: { kind: 'task', id: t.id }
        })
      }
    }
    return evs
  }, [events, tasks, showTasks, maps, calendars])

  const onClick = (arg: EventClickArg) => {
    const p = arg.event.extendedProps as { kind: string; id?: string; data?: CalendarEvent }
    if (p.kind === 'task') return useUi.getState().openTask(p.id!)
    const e = p.data!
    setDraft({ ...e, event_id: e.event_id })
  }

  const onMove = async (arg: EventDropArg | EventResizeDoneArg) => {
    const p = arg.event.extendedProps as { kind: string; id?: string; data?: CalendarEvent }
    const start = arg.event.start!
    if (p.kind === 'task') {
      await api.updateTask(p.id!, { due_date: toStored(start, arg.event.allDay) })
      return
    }
    const end = arg.event.end ?? new Date(start.getTime() + 3600_000)
    try {
      await api.updateEvent(p.data!.event_id, {
        start: toStored(start, arg.event.allDay),
        end: arg.event.allDay ? localDate(new Date(end.getTime() - 86_400_000)) : localDateTime(end),
        all_day: arg.event.allDay
      })
    } catch {
      arg.revert()
    }
  }

  const onSelect = (arg: DateSelectArg) => {
    if (!writable.length) return
    setDraft({
      calendar_id: writable[0].id,
      title: '',
      start: toStored(arg.start, arg.allDay),
      end: arg.allDay ? localDate(new Date(arg.end.getTime() - 86_400_000)) : localDateTime(arg.end),
      all_day: arg.allDay,
      location: '',
      description: '',
      task_id: null
    })
  }

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 space-y-4 border-r border-line bg-panel p-3">
        <Button
          variant="primary"
          className="w-full justify-center"
          disabled={!writable.length}
          onClick={() => {
            const start = new Date()
            start.setMinutes(0, 0, 0)
            start.setHours(start.getHours() + 1)
            onSelect({ start, end: new Date(start.getTime() + 3600_000), allDay: false } as DateSelectArg)
          }}
        >
          <Plus size={14} /> New event
        </Button>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Calendars</div>
          {calendars.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={c.enabled} onChange={(e) => api.updateCalendar(c.id, { enabled: e.target.checked })} aria-label={`Show ${c.name}`} />
              <Popover trigger={<button type="button" className="h-3 w-3 rounded-full" style={{ background: c.color }} aria-label="Calendar color" />}>
                {(close) => <ColorGrid value={c.color} onChange={(color) => (api.updateCalendar(c.id, { color }), close())} />}
              </Popover>
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
            </div>
          ))}
          <label className="mt-1 flex items-center gap-2 py-1 text-[13px]">
            <input type="checkbox" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} />
            <CheckSquare size={12} className="text-muted" /> Task due dates
          </label>
        </div>
        <Button size="sm" variant="ghost" onClick={async () => toast((await api.syncAllAccounts()) ? 'Syncing calendars…' : 'Nothing to sync')}>
          <RefreshCw size={13} /> Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const file = await api.exportIcs()
            if (file) toast(`Exported to ${file}`, 'success')
          }}
        >
          <Download size={13} /> Export .ics
        </Button>
        <p className="text-[11px] text-muted">Add Google Calendar (Sign in with Google), iCloud, Fastmail or other CalDAV calendars in Settings → Accounts.</p>
      </aside>
      <div className="min-w-0 flex-1 overflow-auto bg-panel px-6 py-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          firstDay={settings?.weekStart ?? 1}
          height="100%"
          nowIndicator
          selectable
          selectMirror
          editable
          dayMaxEvents={4}
          scrollTime="08:00:00"
          events={fcEvents}
          datesSet={(arg) => setRange({ from: localDate(arg.start), to: localDate(arg.end) })}
          eventClick={onClick}
          eventDrop={onMove}
          eventResize={onMove}
          select={onSelect}
        />
      </div>
      {draft && <EventDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

function EventDialog({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const { data: calendars = [] } = useCalendars()
  const [d, setD] = useState(draft)
  const set = (p: Partial<EventDraft>) => setD({ ...d, ...p })
  const readOnly = !!calendars.find((c) => c.id === d.calendar_id)?.read_only
  const save = async () => {
    const input = { calendar_id: d.calendar_id, title: d.title, start: d.start, end: d.end, all_day: d.all_day, location: d.location, description: d.description }
    if (d.event_id) await api.updateEvent(d.event_id, input)
    else await api.createEvent(input)
    onClose()
  }
  const timeInput = (v: string, onChange: (v: string) => void, label: string) => (
    <input
      type={d.all_day ? 'date' : 'datetime-local'}
      value={d.all_day ? v.slice(0, 10) : hasTime(v) ? v : `${v}T09:00`}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      disabled={d.recurring || readOnly}
      aria-label={label}
      className="h-8 rounded-md border border-line bg-panel px-2 text-[13px] disabled:opacity-60"
    />
  )
  return (
    <Modal
      title={d.event_id ? 'Event' : 'New event'}
      onClose={onClose}
      confirmDiscard={JSON.stringify(d) !== JSON.stringify(draft)}
      width={520}
      footer={
        <>
          {d.event_id && !readOnly && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (window.confirm(d.recurring ? 'Delete the whole repeating series?' : 'Delete this event?')) {
                  await api.deleteEvent(d.event_id!)
                  onClose()
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {!readOnly && (
            <Button variant="primary" onClick={save} disabled={!d.title.trim()}>Save</Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <Input autoFocus value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Event title" disabled={readOnly} />
        <div className="flex flex-wrap items-center gap-2">
          {timeInput(d.start, (start) => set({ start, end: d.end < start ? start : d.end }), 'Start')}
          <span className="text-muted">→</span>
          {timeInput(d.end, (end) => set({ end }), 'End')}
          <label className="ml-2 flex items-center gap-1.5">
            <input type="checkbox" checked={d.all_day} disabled={d.recurring || readOnly} onChange={(e) => set({ all_day: e.target.checked })} /> All day
          </label>
        </div>
        {d.recurring && <p className="text-xs text-muted">This is part of a repeating series. Times can be changed in the calendar it came from.</p>}
        <Select value={d.calendar_id} onChange={(e) => set({ calendar_id: e.target.value })} disabled={!!d.event_id} className="w-full" aria-label="Calendar">
          {calendars.filter((c) => !c.read_only || c.id === d.calendar_id).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Input value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location" disabled={readOnly} />
        <textarea
          value={d.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Notes"
          rows={3}
          disabled={readOnly}
          className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 outline-none focus:border-accent"
        />
        {d.task_id && (
          <Button size="sm" onClick={() => (useUi.getState().openTask(d.task_id!), onClose())}>
            <CheckSquare size={13} /> Open linked task
          </Button>
        )}
      </div>
    </Modal>
  )
}
