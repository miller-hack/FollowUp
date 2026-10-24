import type { FollowUpCounts, FollowUpKind, FollowUpSettings, MailAddress } from '@shared/mail'
import { localDate } from '@shared/dates'
import { all, get, marks, now, run, tx } from '../../db'
import { getSettings } from '../meta'
import { pushNotification } from '../notify'

/**
 * Follow-up (ADR-015): which conversations need a reply from us, or a nudge to them.
 *
 * - "reply":  the latest real message came from outside, and nobody on our side answered it;
 * - "nudge":  the latest real message is ours, went to someone outside, and they haven't answered.
 *
 * A thread is due once `replyAfterHours` / `nudgeAfterHours` working hours have passed since
 * that message (non-working days don't count). Automated mail (auto-replies, lists, robots)
 * is ignored. The state is stored on the thread (followup_* columns) and recomputed after
 * every sync, every send, every settings change, and periodically.
 */

// ---------------------------------------------------------------- who is "us"

/** Public mailbox providers: an address there is a person, never "our company". */
const FREE_MAIL =
  /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|rocketmail|icloud|me|mac|aol|proton|protonmail|pm|zoho|zohomail|gmx|yandex|mail|fastmail|hey|tutanota|tuta|qq|163|126|rediffmail)\.[a-z.]+$/

export const isFreeMailDomain = (domain: string): boolean => FREE_MAIL.test(domain.toLowerCase())

export interface Ours {
  addresses: Set<string>
  domains: Set<string>
}

/** Our addresses (every connected mailbox) and company domains (from Settings, plus the mailboxes' own non-free domains). */
export function ourIdentity(settings: FollowUpSettings = getSettings().followups): Ours {
  const addresses = new Set(all<{ email: string }>("SELECT email FROM accounts WHERE kind = 'mail'").map((a) => a.email.toLowerCase()))
  const domains = new Set(settings.companyDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))
  if (settings.includeAccountDomains)
    for (const a of addresses) {
      const d = a.split('@')[1]
      if (d && !isFreeMailDomain(d)) domains.add(d)
    }
  return { addresses, domains }
}

export const isOurs = (addr: string, ours: Ours): boolean => {
  const a = addr.toLowerCase()
  return ours.addresses.has(a) || ours.domains.has(a.split('@')[1] ?? '')
}

// ---------------------------------------------------------------- working hours

/** `start` plus `hours`, counting only time on working days (local time). */
export function addWorkingHours(start: Date, hours: number, workingDays: number[]): Date {
  if (!workingDays.length) return new Date(start.getTime() + hours * 3600_000)
  let cursor = new Date(start)
  let remaining = hours * 3600_000
  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    const midnight = new Date(cursor)
    midnight.setHours(24, 0, 0, 0)
    if (workingDays.includes(cursor.getDay())) {
      const chunk = Math.min(remaining, midnight.getTime() - cursor.getTime())
      remaining -= chunk
      cursor = new Date(cursor.getTime() + chunk)
    } else {
      cursor = midnight
    }
  }
  return cursor
}

// ---------------------------------------------------------------- the rule

export interface FuMessage {
  id: string
  from: string
  to: string[]
  date: string
  is_auto: boolean
}

export interface FuState {
  kind: FollowUpKind
  /** the message the clock started from */
  anchor: string
  since: string
}

/** The follow-up state of one conversation (messages in any order). */
export function followUpState(messages: FuMessage[], ours: Ours): FuState | null {
  const real = messages.filter((m) => !m.is_auto && m.from).sort((a, b) => a.date.localeCompare(b.date))
  const last = real.at(-1)
  if (!last) return null
  if (!isOurs(last.from, ours)) return { kind: 'reply', anchor: last.id, since: last.date }
  // ours: only a conversation with someone outside needs a nudge
  if (last.to.some((a) => !isOurs(a, ours))) return { kind: 'nudge', anchor: last.id, since: last.date }
  return null
}

// ---------------------------------------------------------------- storing the state

interface ThreadRow {
  id: string
  done: number
  ai_category: string | null
  followup_anchor: string | null
}

const IGNORED_CATEGORIES = new Set(['newsletter', 'notification', 'spam'])

/** Recompute the follow-up state of the given threads (all recent threads when omitted). */
export function recomputeFollowUps(threadIds?: string[], at: Date = new Date()): number {
  const s = getSettings().followups
  const ours = ourIdentity(s)
  const floor = new Date(at.getTime() - (s.lookbackDays + 1) * 86_400_000).toISOString()
  const threads = threadIds
    ? threadIds.length
      ? all<ThreadRow>(`SELECT id, done, ai_category, followup_anchor FROM mail_threads WHERE id IN (${marks(threadIds.length)})`, ...threadIds)
      : []
    : all<ThreadRow>('SELECT id, done, ai_category, followup_anchor FROM mail_threads WHERE last_message_at >= ? OR followup_kind IS NOT NULL', floor)
  if (!threads.length) return 0
  const ids = threads.map((t) => t.id)
  const rows = all<{ id: string; thread_id: string; from_addr: string; to_addrs: string; cc_addrs: string; date: string; is_auto: number; binned: number }>(
    `SELECT m.id, m.thread_id, m.from_addr, m.to_addrs, m.cc_addrs, m.date, m.is_auto,
       (EXISTS (SELECT 1 FROM mail_locations l JOIN mail_folders f ON f.account_id = m.account_id AND f.path = l.folder
                WHERE l.message_id = m.id AND f.role IN ('spam', 'trash'))
        AND NOT EXISTS (SELECT 1 FROM mail_locations l JOIN mail_folders f ON f.account_id = m.account_id AND f.path = l.folder
                WHERE l.message_id = m.id AND COALESCE(f.role, '') NOT IN ('spam', 'trash'))) binned
     FROM mail_messages m WHERE m.thread_id IN (${marks(ids.length)}) AND m.is_draft = 0`,
    ...ids
  )
  const byThread = new Map<string, FuMessage[]>()
  for (const r of rows) {
    // a message that is only in Spam or Trash doesn't count
    if (r.binned) continue
    const to = [...(JSON.parse(r.to_addrs) as MailAddress[]), ...(JSON.parse(r.cc_addrs) as MailAddress[])].map((a) => a.address)
    const list = byThread.get(r.thread_id) ?? []
    list.push({ id: r.id, from: r.from_addr, to, date: r.date, is_auto: !!r.is_auto })
    byThread.set(r.thread_id, list)
  }
  let changed = 0
  tx(() => {
    for (const t of threads) {
      let st = followUpState(byThread.get(t.id) ?? [], ours)
      if (st && Date.parse(st.since) < Date.parse(floor)) st = null
      // a conversation you closed (Done) or that AI filed as bulk mail needs no reply
      if (st?.kind === 'reply' && (t.done || (t.ai_category && IGNORED_CATEGORIES.has(t.ai_category)))) st = null
      const due = st ? addWorkingHours(new Date(st.since), st.kind === 'reply' ? s.replyAfterHours : s.nudgeAfterHours, s.workingDays).toISOString() : null
      changed += run(
        `UPDATE mail_threads SET followup_kind = ?, followup_anchor = ?, followup_since = ?, followup_due_at = ?,
           followup_snoozed_until = CASE WHEN COALESCE(followup_anchor, '') = COALESCE(?, '') THEN followup_snoozed_until ELSE NULL END
         WHERE id = ? AND (COALESCE(followup_kind, '') <> COALESCE(?, '') OR COALESCE(followup_anchor, '') <> COALESCE(?, '') OR COALESCE(followup_due_at, '') <> COALESCE(?, ''))`,
        st?.kind ?? null, st?.anchor ?? null, st?.since ?? null, due, st?.anchor ?? null, t.id, st?.kind ?? null, st?.anchor ?? null, due
      )
    }
  })
  return changed
}

/** SQL condition: the thread is in Follow-up right now. */
export const DUE_SQL = `th.followup_kind IS NOT NULL AND th.followup_due_at <= ?
  AND (th.followup_snoozed_until IS NULL OR th.followup_snoozed_until <= ?)
  AND COALESCE(th.followup_dismissed_for, '') <> th.followup_anchor`

export function followUpCounts(at: Date = new Date()): FollowUpCounts {
  const iso = at.toISOString()
  const rows = all<{ kind: FollowUpKind; n: number }>(`SELECT th.followup_kind kind, COUNT(*) n FROM mail_threads th WHERE ${DUE_SQL} GROUP BY th.followup_kind`, iso, iso)
  const out: FollowUpCounts = { reply: 0, nudge: 0 }
  for (const r of rows) out[r.kind] = r.n
  return out
}

/** "No follow-up needed": hidden until a new message arrives in the conversation. */
export function dismissFollowUp(threadId: string): void {
  run('UPDATE mail_threads SET followup_dismissed_for = followup_anchor, updated_at = ? WHERE id = ?', now(), threadId)
}

/** Bring a dismissed or snoozed conversation back. */
export function restoreFollowUp(threadId: string): void {
  run('UPDATE mail_threads SET followup_dismissed_for = NULL, followup_snoozed_until = NULL, updated_at = ? WHERE id = ?', now(), threadId)
}

export function snoozeFollowUp(threadId: string, until: string): void {
  if (Number.isNaN(Date.parse(until))) throw new Error('Choose when to bring it back')
  run('UPDATE mail_threads SET followup_snoozed_until = ?, updated_at = ? WHERE id = ?', new Date(until).toISOString(), now(), threadId)
}

// ---------------------------------------------------------------- daily reminder

/** Once a day (at the digest time), a notification when conversations need follow-up. */
export function followUpTick(at: Date = new Date()): void {
  const settings = getSettings()
  if (!settings.followups.dailyReminder) return
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  if (hm < settings.notifications.digestTime) return
  const key = `followup:${localDate(at)}`
  if (get('SELECT 1 FROM notify_log WHERE key = ?', key)) return
  const c = followUpCounts(at)
  const total = c.reply + c.nudge
  run('INSERT OR IGNORE INTO notify_log (key, created_at) VALUES (?, ?)', key, now())
  if (!total) return
  const parts = [c.reply && `${c.reply} waiting for your reply`, c.nudge && `${c.nudge} waiting on the other side`].filter(Boolean)
  pushNotification({ kind: 'info', title: `${total} email${total === 1 ? '' : 's'} need follow-up`, body: parts.join(' · '), task_id: null })
}
