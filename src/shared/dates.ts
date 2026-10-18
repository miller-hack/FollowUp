import type { Recurrence } from './types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date as `YYYY-MM-DD`. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local date-time as `YYYY-MM-DDTHH:mm`. */
export function localDateTime(d: Date): string {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const hasTime = (iso: string): boolean => iso.length > 10

const APP_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/

/** A stored app date: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` with real calendar values (years 1900–2999). */
export function isAppDate(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = APP_DATE.exec(s)
  if (!m) return false
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0'].map(Number)
  if (y < 1900 || y > 2999 || h > 23 || mi > 59) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

/** An app date that includes a time of day. */
export const isAppDateTime = (s: unknown): s is string => isAppDate(s) && hasTime(s)

/** Parse a stored date (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`) as a local Date. */
export function parseLocal(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const [hh, mm] = hasTime(iso) ? iso.slice(11, 16).split(':').map(Number) : [0, 0]
  return new Date(y, m - 1, d, hh, mm)
}

/** Format back in the same shape (date-only stays date-only). */
function formatLike(template: string, d: Date): string {
  return hasTime(template) ? localDateTime(d) : localDate(d)
}

export function addDays(iso: string, days: number): string {
  const d = parseLocal(iso)
  d.setDate(d.getDate() + days)
  return formatLike(iso, d)
}

export function addInterval(iso: string, rec: Recurrence): string {
  const d = parseLocal(iso)
  const n = Math.max(1, rec.interval)
  if (rec.freq === 'daily') d.setDate(d.getDate() + n)
  if (rec.freq === 'weekly') d.setDate(d.getDate() + 7 * n)
  if (rec.freq === 'monthly') {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + n)
    // clamp to month end (Jan 31 → Feb 28)
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  }
  if (rec.freq === 'yearly') d.setFullYear(d.getFullYear() + n)
  return formatLike(iso, d)
}

/** Whole days from a to b (b - a), ignoring time of day. */
export function diffDays(a: string, b: string): number {
  const da = parseLocal(a.slice(0, 10))
  const db = parseLocal(b.slice(0, 10))
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}
