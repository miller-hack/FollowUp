import { clsx, type ClassValue } from 'clsx'
import { format, isThisYear } from 'date-fns'
import { diffDays, hasTime, isAppDate, localDate, parseLocal } from '@shared/dates'
import type { Priority, Status } from '@shared/types'

export const cn = (...v: ClassValue[]): string => clsx(v)

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#ef4444' },
  high: { label: 'High', color: '#f59e0b' },
  normal: { label: 'Normal', color: '#3b82f6' },
  low: { label: 'Low', color: '#94a3b8' },
  none: { label: 'No priority', color: 'transparent' }
}

export const PALETTE = [
  '#7b68ee', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16',
  '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#87909e'
]

/** Human label for a due date: Today, Tomorrow, Mon, Oct 3, Oct 3 2027 (+ time). */
export function formatDue(iso: string | null): string {
  if (!iso) return ''
  // never throw while rendering: show odd values as they are (ADR-005)
  if (!isAppDate(iso)) return iso
  const today = localDate()
  const d = parseLocal(iso)
  const days = diffDays(today, iso)
  let label: string
  if (days === 0) label = 'Today'
  else if (days === 1) label = 'Tomorrow'
  else if (days === -1) label = 'Yesterday'
  else if (days > 1 && days < 7) label = format(d, 'EEE')
  else label = format(d, isThisYear(d) ? 'MMM d' : 'MMM d, yyyy')
  return hasTime(iso) ? `${label} ${format(d, 'HH:mm')}` : label
}

export function dueTone(iso: string | null, status?: Status): string {
  if (!iso || status?.type === 'done' || !isAppDate(iso)) return 'text-muted'
  const days = diffDays(localDate(), iso)
  if (days < 0) return 'text-red-500'
  if (days === 0) return 'text-amber-500'
  return 'text-muted'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatMinutes(min: number | null): string {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** Parse "1h 30m", "90m", "1.5h", "2" (hours) into minutes. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const h = /(\d+(?:\.\d+)?)\s*h/.exec(t)
  const m = /(\d+)\s*m/.exec(t)
  if (h || m) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0))
  const n = parseFloat(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null
}

export const plainText = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
