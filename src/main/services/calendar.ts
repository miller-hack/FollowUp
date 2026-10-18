import ICAL from 'ical.js'
import { createDAVClient } from 'tsdav'
import type { CalDavConfig, CalendarEvent, CalendarInfo, EventInput } from '@shared/mail'
import { addDays, hasTime, isAppDate, isAppDateTime, localDate, localDateTime, parseLocal } from '@shared/dates'
import { all, get, now, run, tx, uuid } from '../db'
import { enqueue, registerJobHandler } from './jobs'
import { authFor, getAccountFull } from './mail/accounts'
import { forgetAccessToken } from './oauth'
import { friendlyMailError } from './mail/transport'

// ---------------------------------------------------------------- iCalendar helpers

const pad = (n: number) => String(n).padStart(2, '0')

/** ICAL.Time → app date string (local). */
function fromIcal(t: ICAL.Time): string {
  if (t.isDate) return `${t.year}-${pad(t.month)}-${pad(t.day)}`
  return localDateTime(t.toJSDate())
}

/** App date string → iCalendar property value: DATE for all-day, UTC DATE-TIME otherwise. */
function toIcalTime(iso: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(iso.slice(0, 10))
  return ICAL.Time.fromJSDate(parseLocal(iso), true)
}

interface ParsedEvent {
  uid: string
  title: string
  description: string
  location: string
  start: string
  end: string
  all_day: boolean
  rrule: string | null
}

function registerTimezones(cal: ICAL.Component): void {
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz)
    } catch {
      /* malformed timezone: times fall back to floating */
    }
  }
}

/** Parse the master VEVENT of an .ics object. */
export function parseIcs(raw: string): ParsedEvent | null {
  const cal = new ICAL.Component(ICAL.parse(raw))
  registerTimezones(cal)
  const vevent = cal.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id')) ?? cal.getFirstSubcomponent('vevent')
  if (!vevent) return null
  const ev = new ICAL.Event(vevent)
  if (!ev.startDate) return null
  const start = fromIcal(ev.startDate)
  const allDay = ev.startDate.isDate
  // all-day DTEND is exclusive; store the inclusive last day
  let end = ev.endDate ? fromIcal(ev.endDate) : start
  if (allDay && ev.endDate) end = addDays(end, -1) < start ? start : addDays(end, -1)
  const rrule = vevent.getFirstPropertyValue('rrule')
  return {
    uid: ev.uid || uuid(),
    title: ev.summary ?? '(no title)',
    description: ev.description ?? '',
    location: ev.location ?? '',
    start,
    end,
    all_day: allDay,
    rrule: rrule ? String(rrule) : null
  }
}

export function buildIcs(e: { uid: string; title: string; description: string; location: string; start: string; end: string; all_day: boolean }, base?: string): string {
  let cal: ICAL.Component
  let vevent: ICAL.Component
  if (base) {
    cal = new ICAL.Component(ICAL.parse(base))
    vevent = cal.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id')) ?? cal.getFirstSubcomponent('vevent')!
  } else {
    cal = new ICAL.Component(['vcalendar', [], []])
    cal.updatePropertyWithValue('prodid', '-//FollowUp//EN')
    cal.updatePropertyWithValue('version', '2.0')
    vevent = new ICAL.Component('vevent')
    cal.addSubcomponent(vevent)
    vevent.updatePropertyWithValue('uid', e.uid)
  }
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
  vevent.updatePropertyWithValue('summary', e.title)
  if (e.description) vevent.updatePropertyWithValue('description', e.description)
  else vevent.removeAllProperties('description')
  if (e.location) vevent.updatePropertyWithValue('location', e.location)
  else vevent.removeAllProperties('location')
  vevent.removeAllProperties('dtstart')
  vevent.removeAllProperties('dtend')
  vevent.removeAllProperties('duration')
  vevent.addPropertyWithValue('dtstart', toIcalTime(e.start, e.all_day))
  vevent.addPropertyWithValue('dtend', e.all_day ? toIcalTime(addDays(e.end.slice(0, 10), 1), true) : toIcalTime(e.end, false))
  return cal.toString()
}

/** Safety net for pathological rules (≈ 50 years of a daily event, or minutely rules). */
const MAX_EXPANSION_STEPS = 20_000

/** Occurrences of a recurring event that overlap [from, to). */
function expand(raw: string, from: Date, to: Date): { start: string; end: string; title?: string }[] {
  const cal = new ICAL.Component(ICAL.parse(raw))
  registerTimezones(cal)
  const vevents = cal.getAllSubcomponents('vevent')
  const master = vevents.find((v) => !v.hasProperty('recurrence-id'))
  if (!master) return []
  const ev = new ICAL.Event(master)
  for (const ex of vevents.filter((v) => v.hasProperty('recurrence-id'))) ev.relateException(ex)
  const out: { start: string; end: string; title?: string }[] = []
  const it = ev.iterator()
  // walk forward until the range ends: counting from DTSTART (the old 1000 cap) dropped long-running series
  for (let i = 0, next = it.next(); next && i < MAX_EXPANSION_STEPS; i++, next = it.next()) {
    const d = ev.getOccurrenceDetails(next)
    const s = d.startDate.toJSDate()
    if (s >= to) break
    const e = d.endDate.toJSDate()
    if (e <= from && !(d.startDate.isDate && s >= from)) continue
    let end = fromIcal(d.endDate)
    if (d.startDate.isDate) end = addDays(end, -1) < fromIcal(d.startDate) ? fromIcal(d.startDate) : addDays(end, -1)
    out.push({ start: fromIcal(d.startDate), end, title: d.item.summary })
  }
  return out
}

// ---------------------------------------------------------------- calendars

interface CalRow {
  id: string
  account_id: string | null
  url: string | null
  name: string
  color: string
  ctag: string | null
  enabled: number
  read_only: number
}

const toInfo = (c: CalRow): CalendarInfo => ({ id: c.id, account_id: c.account_id, name: c.name, color: c.color, enabled: !!c.enabled, read_only: !!c.read_only })

function ensureLocalCalendar(): void {
  if (!get('SELECT 1 FROM calendars WHERE account_id IS NULL')) {
    run("INSERT INTO calendars (id, name, color) VALUES (?, 'My calendar', '#7b68ee')", uuid())
  }
}

export function listCalendars(): CalendarInfo[] {
  ensureLocalCalendar()
  return all<CalRow>('SELECT * FROM calendars ORDER BY account_id IS NOT NULL, name').map(toInfo)
}

export function updateCalendar(id: string, patch: Partial<Pick<CalendarInfo, 'name' | 'color' | 'enabled'>>): void {
  if (patch.name !== undefined) run('UPDATE calendars SET name = ? WHERE id = ?', patch.name, id)
  if (patch.color !== undefined) run('UPDATE calendars SET color = ? WHERE id = ?', patch.color, id)
  if (patch.enabled !== undefined) run('UPDATE calendars SET enabled = ? WHERE id = ?', patch.enabled, id)
}

// ---------------------------------------------------------------- events

interface EventRow {
  id: string
  calendar_id: string
  uid: string
  href: string | null
  etag: string | null
  title: string
  description: string
  location: string
  start: string
  end: string
  all_day: number
  rrule: string | null
  raw: string | null
  task_id: string | null
  dirty: number
  pending_delete: number
}

/** All event occurrences between two app dates (inclusive of `from`, exclusive of `to`). */
export function listEvents(from: string, to: string): CalendarEvent[] {
  ensureLocalCalendar()
  const cals = new Map(all<CalRow>('SELECT * FROM calendars WHERE enabled = 1').map((c) => [c.id, c]))
  if (!cals.size) return []
  const rows = all<EventRow>(
    `SELECT e.* FROM calendar_events e JOIN calendars c ON c.id = e.calendar_id
     WHERE c.enabled = 1 AND e.pending_delete = 0 AND (e.rrule IS NOT NULL OR (e.start < ? AND e.end >= ?))`,
    to,
    from.slice(0, 10)
  )
  const fromD = parseLocal(from)
  const toD = parseLocal(to)
  const out: CalendarEvent[] = []
  for (const r of rows) {
    const cal = cals.get(r.calendar_id)!
    const base = {
      event_id: r.id,
      calendar_id: r.calendar_id,
      title: r.title,
      all_day: !!r.all_day,
      location: r.location,
      description: r.description,
      task_id: r.task_id,
      color: cal.color
    }
    if (r.rrule && r.raw) {
      try {
        for (const o of expand(r.raw, fromD, toD)) out.push({ ...base, id: `${r.id}@${o.start}`, title: o.title ?? r.title, start: o.start, end: o.end, recurring: true })
      } catch {
        out.push({ ...base, id: r.id, start: r.start, end: r.end, recurring: true })
      }
    } else {
      out.push({ ...base, id: r.id, start: r.start, end: r.end, recurring: false })
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

function calendarOf(id: string): CalRow {
  const c = get<CalRow>('SELECT * FROM calendars WHERE id = ?', id)
  if (!c) throw new Error('Calendar not found')
  return c
}

function validateEvent(e: EventInput): void {
  if (!e.title.trim()) throw new Error('Give the event a title')
  const ok = e.all_day ? isAppDate(e.start) && isAppDate(e.end) : isAppDateTime(e.start) && isAppDateTime(e.end)
  if (!ok)
    throw new Error(
      e.all_day ? 'All-day events need dates like 2026-10-16' : `Event start and end need a date and time like ${localDate()}T14:30 (got “${e.start}” – “${e.end}”)`
    )
  if (e.end.slice(0, e.all_day ? 10 : 16) < e.start.slice(0, e.all_day ? 10 : 16)) throw new Error('The event must end after it starts')
}

/** Queue a push for CalDAV calendars (local ones need nothing). */
function schedulePush(cal: CalRow): void {
  if (cal.account_id) enqueue('caldav_sync', { accountId: cal.account_id }, { maxAttempts: 5 })
}

export function createEvent(input: EventInput): CalendarEvent {
  validateEvent(input)
  const cal = calendarOf(input.calendar_id)
  if (cal.read_only) throw new Error('This calendar is read-only')
  const id = uuid()
  const e = {
    uid: `${uuid()}@followup`,
    title: input.title.trim(),
    description: input.description ?? '',
    location: input.location ?? '',
    start: input.all_day ? input.start.slice(0, 10) : input.start,
    end: input.all_day ? input.end.slice(0, 10) : input.end,
    all_day: input.all_day
  }
  tx(() => {
    run(
      `INSERT INTO calendar_events (id, calendar_id, uid, title, description, location, start, end, all_day, raw, task_id, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, cal.id, e.uid, e.title, e.description, e.location, e.start, e.end, e.all_day, buildIcs(e), input.task_id ?? null, !!cal.account_id
    )
    schedulePush(cal)
  })
  return listEvents(e.start.slice(0, 10), addDays(e.end.slice(0, 10), 1)).find((x) => x.event_id === id)!
}

export function updateEvent(eventId: string, patch: Partial<EventInput>): void {
  const r = get<EventRow>('SELECT * FROM calendar_events WHERE id = ?', eventId)
  if (!r) throw new Error('Event not found')
  const cal = calendarOf(r.calendar_id)
  if (cal.read_only) throw new Error('This calendar is read-only')
  const allDay = patch.all_day ?? !!r.all_day
  const next = {
    uid: r.uid,
    title: (patch.title ?? r.title).trim(),
    description: patch.description ?? r.description,
    location: patch.location ?? r.location,
    // the times of a repeating series are kept; only details change
    start: r.rrule ? r.start : allDay ? (patch.start ?? r.start).slice(0, 10) : (patch.start ?? r.start),
    end: r.rrule ? r.end : allDay ? (patch.end ?? r.end).slice(0, 10) : (patch.end ?? r.end),
    all_day: r.rrule ? !!r.all_day : allDay
  }
  if (!r.rrule && !hasTime(next.start) && !next.all_day) next.start = `${next.start}T09:00`
  // switching an all-day event to timed: give it an hour unless an end time was set
  if (!r.rrule && !next.all_day && !hasTime(next.end)) next.end = localDateTime(new Date(parseLocal(next.start).getTime() + 3600_000))
  validateEvent({ ...next, calendar_id: r.calendar_id })
  tx(() => {
    run(
      `UPDATE calendar_events SET title = ?, description = ?, location = ?, start = ?, end = ?, all_day = ?, raw = ?, task_id = ?, dirty = ?, updated_at = ? WHERE id = ?`,
      next.title, next.description, next.location, next.start, next.end, next.all_day, buildIcs(next, r.raw ?? undefined),
      patch.task_id !== undefined ? patch.task_id : r.task_id, !!cal.account_id, now(), eventId
    )
    schedulePush(cal)
  })
}

export function deleteEvent(eventId: string): void {
  const r = get<EventRow>('SELECT * FROM calendar_events WHERE id = ?', eventId)
  if (!r) return
  const cal = calendarOf(r.calendar_id)
  if (cal.read_only) throw new Error('This calendar is read-only')
  tx(() => {
    if (cal.account_id && r.href) {
      run('UPDATE calendar_events SET pending_delete = 1 WHERE id = ?', eventId)
      schedulePush(cal)
    } else {
      run('DELETE FROM calendar_events WHERE id = ?', eventId)
    }
  })
}

/** Block time for a task: an event on its due date (or today), linked to the task. */
export function createEventForTask(taskId: string, calendarId?: string): CalendarEvent {
  const t = get<{ title: string; due_date: string | null; start_date: string | null; time_estimate_min: number | null }>(
    'SELECT title, due_date, start_date, time_estimate_min FROM tasks WHERE id = ?',
    taskId
  )
  if (!t) throw new Error('Task not found')
  const cal = calendarId ?? listCalendars().find((c) => !c.read_only && c.enabled)?.id
  if (!cal) throw new Error('No calendar to add the event to')
  const when = t.due_date ?? t.start_date ?? localDate()
  const start = hasTime(when) ? when : `${when.slice(0, 10)}T09:00`
  const minutes = t.time_estimate_min ?? 60
  const end = localDateTime(new Date(parseLocal(start).getTime() + minutes * 60_000))
  return createEvent({ calendar_id: cal, title: t.title, start, end, all_day: false, task_id: taskId })
}

// ---------------------------------------------------------------- CalDAV sync

type DavClient = Awaited<ReturnType<typeof createDAVClient>>
let davFactory: ((accountId: string) => Promise<DavClient>) | null = null

/** Test hook: replace the CalDAV client (null restores the real one). */
export function setDavClientFactory(f: ((accountId: string) => Promise<DavClient>) | null): void {
  davFactory = f
}

async function davClient(accountId: string): Promise<DavClient> {
  if (davFactory) return davFactory(accountId)
  const acc = getAccountFull(accountId)
  if (!acc || acc.kind !== 'caldav') throw new Error('Calendar account not found')
  const cfg = acc.config as CalDavConfig
  const auth = await authFor(acc)
  if ('accessToken' in auth)
    // Google CalDAV takes the OAuth access token as a bearer token
    return createDAVClient({
      serverUrl: cfg.url,
      credentials: { username: cfg.user },
      authMethod: 'Custom',
      authFunction: async () => ({ Authorization: `Bearer ${auth.accessToken}` }),
      defaultAccountType: 'caldav'
    })
  return createDAVClient({
    serverUrl: cfg.url,
    credentials: { username: cfg.user, password: auth.pass },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  })
}

/** Connection test for a saved account (works for Google sign-in accounts too). */
export async function testCalDavAccount(accountId: string): Promise<{ calendars: number }> {
  const client = await davClient(accountId)
  return { calendars: (await client.fetchCalendars()).length }
}

export async function testCalDav(cfg: CalDavConfig, password: string): Promise<{ calendars: number }> {
  const client = await createDAVClient({ serverUrl: cfg.url, credentials: { username: cfg.user, password }, authMethod: 'Basic', defaultAccountType: 'caldav' })
  const cals = await client.fetchCalendars()
  return { calendars: cals.length }
}

const PALETTE = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444']

/** Push local changes, then pull remote ones (server wins on conflicts). */
export async function syncCalDav(accountId: string): Promise<{ events: number }> {
  try {
    const client = await davClient(accountId)
    const remote = (await client.fetchCalendars()).filter((c) => !c.components || c.components.includes('VEVENT'))
    let count = 0
    // one event the server refuses must not stop the rest of the account from syncing (ADR-003)
    const pushErrors: string[] = []
    for (const [i, rc] of remote.entries()) {
      let cal = get<CalRow>('SELECT * FROM calendars WHERE account_id = ? AND url = ?', accountId, rc.url)
      if (!cal) {
        const id = uuid()
        const color = typeof rc.calendarColor === 'string' && /^#[0-9a-f]{6}/i.test(rc.calendarColor) ? rc.calendarColor.slice(0, 7) : PALETTE[i % PALETTE.length]
        const name = typeof rc.displayName === 'string' ? rc.displayName : 'Calendar'
        run('INSERT INTO calendars (id, account_id, url, name, color) VALUES (?, ?, ?, ?, ?)', id, accountId, rc.url, name, color)
        cal = get<CalRow>('SELECT * FROM calendars WHERE id = ?', id)!
      }

      // 1. push local edits
      for (const r of all<EventRow>('SELECT * FROM calendar_events WHERE calendar_id = ? AND (dirty = 1 OR pending_delete = 1)', cal.id)) {
        try {
          if (r.pending_delete) {
            if (r.href) {
              const res = await client.deleteCalendarObject({ calendarObject: { url: r.href, etag: r.etag ?? undefined } })
              // 404/410: already gone on the server
              if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Server refused the deletion (${res.status})`)
            }
            run('DELETE FROM calendar_events WHERE id = ?', r.id)
          } else if (!r.href) {
            const filename = `${r.uid.replace(/[^\w.-]/g, '')}.ics`
            const res = await client.createCalendarObject({ calendar: rc, filename, iCalString: r.raw! })
            if (!res.ok) throw new Error(`Server refused the new event (${res.status})`)
            const href = new URL(filename, rc.url.endsWith('/') ? rc.url : `${rc.url}/`).href
            run('UPDATE calendar_events SET href = ?, etag = ?, dirty = 0 WHERE id = ?', href, res.headers.get('etag'), r.id)
          } else {
            const res = await client.updateCalendarObject({ calendarObject: { url: r.href, data: r.raw!, etag: r.etag ?? undefined } })
            // 412: changed on the server meanwhile → the pull below takes the server version
            if (!res.ok && res.status !== 412) throw new Error(`Server refused the change (${res.status})`)
            run('UPDATE calendar_events SET dirty = 0, etag = ? WHERE id = ?', res.headers.get('etag') ?? r.etag, r.id)
          }
        } catch (e) {
          // stays dirty: retried on the next sync
          pushErrors.push(`“${r.title}”: ${(e as Error).message}`)
          console.warn('Calendar event upload failed', r.id, e)
        }
      }

      // 2. pull (skip unchanged calendars)
      const ctag = typeof rc.ctag === 'string' ? rc.ctag : null
      if (ctag && ctag === cal.ctag) continue
      const from = addDays(localDate(), -90)
      const to = addDays(localDate(), 366)
      const objects = await client.fetchCalendarObjects({
        calendar: rc,
        timeRange: { start: parseLocal(from).toISOString(), end: parseLocal(to).toISOString() }
      })
      const seen = new Set<string>()
      tx(() => {
        for (const o of objects) {
          if (!o.data) continue
          const p = parseIcs(o.data)
          if (!p) continue
          seen.add(o.url)
          const existing = get<{ id: string; dirty: number }>('SELECT id, dirty FROM calendar_events WHERE calendar_id = ? AND href = ?', cal!.id, o.url)
          if (existing?.dirty) continue
          if (existing) {
            run(
              'UPDATE calendar_events SET uid = ?, etag = ?, title = ?, description = ?, location = ?, start = ?, end = ?, all_day = ?, rrule = ?, raw = ? WHERE id = ?',
              p.uid, o.etag ?? null, p.title, p.description, p.location, p.start, p.end, p.all_day, p.rrule, o.data, existing.id
            )
          } else {
            run(
              `INSERT INTO calendar_events (id, calendar_id, uid, href, etag, title, description, location, start, end, all_day, rrule, raw)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              uuid(), cal!.id, p.uid, o.url, o.etag ?? null, p.title, p.description, p.location, p.start, p.end, p.all_day, p.rrule, o.data
            )
          }
          count++
        }
        // removed on the server (only within the fetched range)
        for (const r of all<{ id: string; href: string; start: string; rrule: string | null }>(
          'SELECT id, href, start, rrule FROM calendar_events WHERE calendar_id = ? AND href IS NOT NULL AND dirty = 0 AND pending_delete = 0',
          cal!.id
        )) {
          if (!seen.has(r.href) && (r.rrule || (r.start >= from && r.start < to))) run('DELETE FROM calendar_events WHERE id = ?', r.id)
        }
        run('UPDATE calendars SET ctag = ?, name = ? WHERE id = ?', ctag, typeof rc.displayName === 'string' ? rc.displayName : cal!.name, cal!.id)
      })
    }
    // calendars that disappeared from the server
    const urls = remote.map((r) => r.url)
    for (const c of all<CalRow>('SELECT * FROM calendars WHERE account_id = ?', accountId)) if (!urls.includes(c.url ?? '')) run('DELETE FROM calendars WHERE id = ?', c.id)
    run(
      'UPDATE accounts SET last_sync_at = ?, last_error = ? WHERE id = ?',
      now(),
      pushErrors.length ? `Couldn't upload ${pushErrors.length} event${pushErrors.length === 1 ? '' : 's'} (will retry): ${pushErrors[0]}` : null,
      accountId
    )
    return { events: count }
  } catch (e) {
    // an expired / revoked Google token: refresh on the next attempt
    if (/401|unauthori[sz]ed/i.test(String((e as Error)?.message ?? ''))) forgetAccessToken(accountId)
    run('UPDATE accounts SET last_error = ? WHERE id = ?', friendlyMailError(e, !!(getAccountFull(accountId)?.config as CalDavConfig | undefined)?.oauth), accountId)
    throw e
  }
}

registerJobHandler<{ accountId: string }>('caldav_sync', async ({ payload }) => {
  await syncCalDav(payload.accountId)
})

// ---------------------------------------------------------------- .ics export

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsUtc = (local: string) => parseLocal(local).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsDate = (d: string) => d.slice(0, 10).replace(/-/g, '')

/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur)
      cur = ' '
    }
    cur += ch
  }
  return [...out, cur].join('\r\n')
}

/** Events (recurring ones expanded) and open tasks with due dates, as an iCalendar file. */
export function calendarIcs(from: string, to: string, opts: { includeTasks?: boolean } = {}): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FollowUp//Desktop//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:FollowUp']
  for (const e of listEvents(from, to)) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@followup`, `DTSTAMP:${stamp}`)
    if (e.all_day) lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end > e.start ? e.end : addDays(e.start.slice(0, 10), 1))}`)
    else lines.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end)}`)
    lines.push(`SUMMARY:${icsText(e.title)}`)
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`)
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`)
    lines.push('END:VEVENT')
  }
  if (opts.includeTasks) {
    const tasks = all<{ id: string; title: string; due_date: string }>(
      `SELECT t.id, t.title, t.due_date FROM tasks t JOIN statuses s ON s.id = t.status_id
       WHERE s.type <> 'done' AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) BETWEEN ? AND ?`,
      from.slice(0, 10),
      to.slice(0, 10)
    )
    for (const t of tasks) {
      lines.push('BEGIN:VEVENT', `UID:task-${t.id}@followup`, `DTSTAMP:${stamp}`)
      if (hasTime(t.due_date)) {
        const end = localDateTime(new Date(parseLocal(t.due_date).getTime() + 30 * 60_000))
        lines.push(`DTSTART:${icsUtc(t.due_date)}`, `DTEND:${icsUtc(end)}`)
      } else lines.push(`DTSTART;VALUE=DATE:${icsDate(t.due_date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(t.due_date, 1))}`)
      lines.push(`SUMMARY:${icsText(`Due: ${t.title}`)}`, 'END:VEVENT')
    }
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}