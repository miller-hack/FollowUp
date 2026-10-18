import { addDays, hasTime, isAppDate, localDate, localDateTime, parseLocal } from '@shared/dates'
import type { AppNotification, Reminder, Settings } from '@shared/types'
import { all, get, marks, now, run, tx, uuid } from '../db'

// ---------------------------------------------------------------- reminders

export function listReminders(opts: { includeDone?: boolean } = {}): (Reminder & { task_title: string | null })[] {
  return all(
    `SELECT r.id, r.task_id, r.title, r.remind_at, r.done_at, r.notified_at, t.title task_title
     FROM reminders r LEFT JOIN tasks t ON t.id = r.task_id
     ${opts.includeDone ? '' : 'WHERE r.done_at IS NULL'} ORDER BY r.remind_at`
  )
}

export function createReminder(input: { task_id?: string | null; title?: string; remind_at: string }): Reminder {
  if (!isAppDate(input.remind_at)) throw new Error(`The reminder time must look like ${localDateTime(new Date())} (got “${String(input.remind_at).slice(0, 40)}”)`)
  const taskTitle = input.task_id ? get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', input.task_id)?.title : undefined
  const r: Reminder = {
    id: uuid(),
    task_id: input.task_id ?? null,
    title: input.title?.trim() || taskTitle || 'Reminder',
    remind_at: input.remind_at,
    done_at: null,
    notified_at: null
  }
  run('INSERT INTO reminders (id, task_id, title, remind_at) VALUES (?, ?, ?, ?)', r.id, r.task_id, r.title, r.remind_at)
  return r
}

export function updateReminder(id: string, patch: { title?: string; remind_at?: string; done?: boolean }): void {
  if (patch.title !== undefined) run('UPDATE reminders SET title = ?, updated_at = ? WHERE id = ?', patch.title, now(), id)
  // rescheduling re-arms the reminder
  if (patch.remind_at !== undefined && !isAppDate(patch.remind_at)) throw new Error('The reminder time is not a valid date')
  if (patch.remind_at !== undefined) run('UPDATE reminders SET remind_at = ?, notified_at = NULL, updated_at = ? WHERE id = ?', patch.remind_at, now(), id)
  if (patch.done !== undefined) run('UPDATE reminders SET done_at = ?, updated_at = ? WHERE id = ?', patch.done ? now() : null, now(), id)
}

export function deleteReminder(id: string): void {
  run('DELETE FROM reminders WHERE id = ?', id)
}

// ---------------------------------------------------------------- notifications

export function listNotifications(): AppNotification[] {
  return all<AppNotification>('SELECT id, kind, title, body, task_id, read_at, created_at FROM notifications ORDER BY created_at DESC LIMIT 100')
}

export function markNotificationsRead(ids?: string[]): void {
  if (ids?.length) run(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND id IN (${marks(ids.length)})`, now(), ...ids)
  else run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL', now())
}

export function clearNotifications(): void {
  run('DELETE FROM notifications')
}

export function addNotification(n: Pick<AppNotification, 'kind' | 'title' | 'body' | 'task_id'>): AppNotification {
  const full: AppNotification = { ...n, id: uuid(), read_at: null, created_at: now() }
  run('INSERT INTO notifications (id, kind, title, body, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', full.id, n.kind, n.title, n.body, n.task_id, full.created_at)
  return full
}

let deliver: ((n: AppNotification) => void) | null = null

/** The desktop runtime sets this to show Windows toasts. */
export function setNotificationDelivery(fn: ((n: AppNotification) => void) | null): void {
  deliver = fn
}

const listeners: ((n: AppNotification) => void)[] = []

/** Called for every delivered notification (Slack / Teams mirroring). */
export function onNotify(fn: (n: AppNotification) => void): void {
  listeners.push(fn)
}

/** Show an already-stored notification as a toast (and pass it to listeners). */
export function deliverNotification(n: AppNotification): void {
  deliver?.(n)
  for (const fn of listeners) {
    try {
      fn(n)
    } catch (e) {
      console.error('Notification listener failed', e)
    }
  }
}

/** Store a notification and show it immediately. */
export function pushNotification(n: Pick<AppNotification, 'kind' | 'title' | 'body' | 'task_id'>): AppNotification {
  const full = addNotification(n)
  deliverNotification(full)
  return full
}

/** Record a key once; returns false if it was already logged. */
function once(key: string): boolean {
  return run('INSERT OR IGNORE INTO notify_log (key, created_at) VALUES (?, ?)', key, now()) > 0
}

const hm = (d: Date) => localDateTime(d).slice(11, 16)

/**
 * Work out which notifications are due at `at`, store them and return them for delivery.
 * Each reminder / due date / daily digest fires once.
 */
export function collectDue(at: Date, settings: Settings): AppNotification[] {
  return tx(() => {
    const out: AppNotification[] = []
    const nowLocal = localDateTime(at)
    const today = localDate(at)
    const ns = settings.notifications

    // reminders
    for (const r of all<Reminder>("SELECT * FROM reminders WHERE done_at IS NULL AND notified_at IS NULL AND remind_at <= ?", nowLocal)) {
      run('UPDATE reminders SET notified_at = ? WHERE id = ?', now(), r.id)
      out.push(addNotification({ kind: 'reminder', title: 'Reminder', body: r.title, task_id: r.task_id }))
    }

    if (ns.dueEnabled) {
      const open = all<{ id: string; title: string; due_date: string }>(
        `SELECT t.id, t.title, t.due_date FROM tasks t JOIN statuses s ON s.id = t.status_id
         WHERE s.type <> 'done' AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) BETWEEN ? AND ?`,
        addDays(today, -1),
        addDays(today, 1)
      )
      for (const t of open) {
        let fire = false
        let body = ''
        if (hasTime(t.due_date)) {
          const due = parseLocal(t.due_date)
          const lead = new Date(due.getTime() - ns.dueLeadMin * 60_000)
          // window: from lead time until 12h after the due time (don't flood old items)
          fire = at >= lead && at.getTime() - due.getTime() < 12 * 3600_000
          body = at >= due ? `Was due at ${hm(due)}` : `Due at ${hm(due)}`
        } else {
          fire = t.due_date === today && hm(at) >= ns.dueDayTime
          body = 'Due today'
        }
        if (fire && once(`due:${t.id}:${t.due_date}`)) out.push(addNotification({ kind: 'due', title: t.title, body, task_id: t.id }))
      }
    }

    if (ns.digestEnabled && hm(at) >= ns.digestTime && !get('SELECT 1 FROM notify_log WHERE key = ?', `digest:${today}`)) {
      once(`digest:${today}`)
      const c = get<{ overdue: number; today: number }>(
        `SELECT SUM(CASE WHEN substr(t.due_date, 1, 10) < ? THEN 1 ELSE 0 END) overdue,
                SUM(CASE WHEN substr(t.due_date, 1, 10) = ? THEN 1 ELSE 0 END) today
         FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE s.type <> 'done' AND t.due_date IS NOT NULL`,
        today,
        today
      )
      const parts = [c?.today ? `${c.today} due today` : '', c?.overdue ? `${c.overdue} overdue` : ''].filter(Boolean)
      if (parts.length) out.push(addNotification({ kind: 'digest', title: 'Your day', body: `${parts.join(' · ')}.`, task_id: null }))
    }
    return out
  })
}
