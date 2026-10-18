import type { EmailTemplate, Enrollment, EnrollmentStatus, MailAddress, Sequence, SequenceInput, SendWindow } from '@shared/mail'
import { localDate } from '@shared/dates'
import { all, get, now, run, tx, uuid } from '../../db'
import { enqueue, registerJobHandler } from '../jobs'
import { getSettings } from '../meta'
import { queueEmail } from './send'

// ---------------------------------------------------------------- email templates

export function listTemplates(): EmailTemplate[] {
  return all<EmailTemplate>('SELECT id, name, subject, body FROM email_templates ORDER BY name COLLATE NOCASE')
}

export function saveTemplate(input: Partial<EmailTemplate> & { name: string }): EmailTemplate {
  if (!input.name.trim()) throw new Error('Give the template a name')
  if (input.id) {
    run('UPDATE email_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?', input.name, input.subject ?? '', input.body ?? '', now(), input.id)
    return get<EmailTemplate>('SELECT id, name, subject, body FROM email_templates WHERE id = ?', input.id)!
  }
  const id = uuid()
  run('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)', id, input.name, input.subject ?? '', input.body ?? '')
  return { id, name: input.name, subject: input.subject ?? '', body: input.body ?? '' }
}

export function deleteTemplate(id: string): void {
  run('DELETE FROM email_templates WHERE id = ?', id)
}

/** {{first_name}}, {{name}}, {{subject}} for a recipient. */
export function personalize(text: string, to: MailAddress | null, subject: string): string {
  const local = to?.address.split('@')[0] ?? ''
  const name = to?.name || local.replace(/[._-]+/g, ' ')
  const first = (name.split(/\s+/)[0] ?? '').replace(/^\w/, (c) => c.toUpperCase())
  return text.replace(/\{\{\s*first_name\s*\}\}/g, first || 'there').replace(/\{\{\s*name\s*\}\}/g, name || 'there').replace(/\{\{\s*subject\s*\}\}/g, subject)
}

// ---------------------------------------------------------------- send windows

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export function inWindow(at: Date, w: SendWindow): boolean {
  return w.days.includes(at.getDay()) && hm(at) >= w.start && hm(at) < w.end
}

/** The earliest moment ≥ `at` inside the window. */
export function nextWindowStart(at: Date, w: SendWindow): Date {
  if (!w.days.length) return at
  if (inWindow(at, w)) return at
  const [sh, sm] = w.start.split(':').map(Number)
  for (let i = 0; i < 8; i++) {
    const d = new Date(at)
    d.setDate(d.getDate() + i)
    d.setHours(sh, sm, 0, 0)
    if (w.days.includes(d.getDay()) && d.getTime() >= at.getTime()) return d
  }
  return at
}

// ---------------------------------------------------------------- sequences

interface SeqRow {
  id: string
  name: string
  send_window: string
  daily_cap: number
}

export function listSequences(): Sequence[] {
  const seqs = all<SeqRow>('SELECT id, name, send_window, daily_cap FROM sequences ORDER BY created_at')
  return seqs.map((s) => ({
    id: s.id,
    name: s.name,
    window: JSON.parse(s.send_window) as SendWindow,
    daily_cap: s.daily_cap,
    steps: all('SELECT id, wait_days, body FROM sequence_steps WHERE sequence_id = ? ORDER BY position', s.id),
    active_count: get<{ n: number }>("SELECT COUNT(*) n FROM sequence_enrollments WHERE sequence_id = ? AND status = 'active'", s.id)?.n ?? 0
  }))
}

function validateSequence(input: SequenceInput): void {
  if (!input.name.trim()) throw new Error('Give the sequence a name')
  if (!input.steps.length) throw new Error('Add at least one follow-up email')
  if (input.steps.some((s) => !s.body.trim())) throw new Error('Every follow-up needs a message')
  if (input.steps.some((s) => !(s.wait_days > 0))) throw new Error('Wait at least a day (or part of one) before each follow-up')
  if (!input.window.days.length) throw new Error('Pick at least one day to send on')
  if (input.window.start >= input.window.end) throw new Error('The sending window must end after it starts')
}

function writeSteps(id: string, steps: SequenceInput['steps']): void {
  run('DELETE FROM sequence_steps WHERE sequence_id = ?', id)
  steps.forEach((s, i) => run('INSERT INTO sequence_steps (id, sequence_id, position, wait_days, body) VALUES (?, ?, ?, ?, ?)', uuid(), id, i, s.wait_days, s.body))
}

export function createSequence(input: SequenceInput): Sequence {
  validateSequence(input)
  return tx(() => {
    const id = uuid()
    run('INSERT INTO sequences (id, name, send_window, daily_cap) VALUES (?, ?, ?, ?)', id, input.name.trim(), input.window, Math.max(1, input.daily_cap))
    writeSteps(id, input.steps)
    return listSequences().find((s) => s.id === id)!
  })
}

export function updateSequence(id: string, input: SequenceInput): Sequence {
  validateSequence(input)
  return tx(() => {
    run('UPDATE sequences SET name = ?, send_window = ?, daily_cap = ?, updated_at = ? WHERE id = ?', input.name.trim(), input.window, Math.max(1, input.daily_cap), now(), id)
    writeSteps(id, input.steps)
    // active enrollments past the new last step are finished
    run("UPDATE sequence_enrollments SET status = 'completed', next_run_at = NULL WHERE sequence_id = ? AND status = 'active' AND current_step >= ?", id, input.steps.length)
    return listSequences().find((s) => s.id === id)!
  })
}

export function deleteSequence(id: string): void {
  run('DELETE FROM sequences WHERE id = ?', id)
}

// ---------------------------------------------------------------- enrollments

const ENROLL_COLS = `e.id, e.sequence_id, s.name sequence_name, e.status, e.current_step, e.next_run_at, e.thread_id, th.subject thread_subject,
  e.to_addrs "to", e.enrolled_at, e.last_sent_at, e.stopped_reason,
  (SELECT COUNT(*) FROM sequence_steps st WHERE st.sequence_id = e.sequence_id) total_steps`

export function listEnrollments(filter: { threadId?: string; activeOnly?: boolean } = {}): Enrollment[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.threadId) {
    where.push('e.thread_id = ?')
    params.push(filter.threadId)
  }
  if (filter.activeOnly) where.push("e.status = 'active'")
  return all<Enrollment>(
    `SELECT ${ENROLL_COLS} FROM sequence_enrollments e JOIN sequences s ON s.id = e.sequence_id JOIN mail_threads th ON th.id = e.thread_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.enrolled_at DESC LIMIT 300`,
    ...params
  )
}

/** Who a follow-up goes to: the recipients of our last email, else the last sender. */
function defaultRecipients(threadId: string): string {
  const lastOut = get<{ to_addrs: string }>('SELECT to_addrs FROM mail_messages WHERE thread_id = ? AND is_outbound = 1 ORDER BY date DESC LIMIT 1', threadId)
  if (lastOut) return (JSON.parse(lastOut.to_addrs) as MailAddress[]).map((a) => a.address).join(', ')
  return get<{ from_addr: string }>('SELECT from_addr FROM mail_messages WHERE thread_id = ? AND is_outbound = 0 ORDER BY date DESC LIMIT 1', threadId)?.from_addr ?? ''
}

export function enrollThread(threadId: string, sequenceId: string, to?: string): Enrollment {
  return tx(() => {
    const thread = get<{ account_id: string }>('SELECT account_id FROM mail_threads WHERE id = ?', threadId)
    if (!thread) throw new Error('Email thread not found')
    const seq = listSequences().find((s) => s.id === sequenceId)
    if (!seq) throw new Error('Sequence not found')
    const recipients = (to ?? defaultRecipients(threadId)).trim()
    if (!recipients) throw new Error('No recipient to follow up with')
    // one active follow-up per thread
    stopEnrollmentsForThread(threadId, 'stopped', 'Replaced by a new follow-up')
    const id = uuid()
    const first = nextWindowStart(new Date(Date.now() + seq.steps[0].wait_days * 86_400_000), seq.window)
    run(
      'INSERT INTO sequence_enrollments (id, sequence_id, thread_id, account_id, to_addrs, next_run_at, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, sequenceId, threadId, thread.account_id, recipients, first.toISOString(), now()
    )
    return listEnrollments({ threadId }).find((e) => e.id === id)!
  })
}

export function stopEnrollment(id: string, reason = 'Stopped by you'): void {
  run("UPDATE sequence_enrollments SET status = 'stopped', stopped_reason = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'active'", reason, now(), id)
}

export function stopEnrollmentsForThread(threadId: string, status: EnrollmentStatus, reason: string): number {
  return run(
    "UPDATE sequence_enrollments SET status = ?, stopped_reason = ?, next_run_at = NULL, updated_at = ? WHERE thread_id = ? AND status = 'active'",
    status, reason, now(), threadId
  )
}

const BOUNCE_FROM = /^(mailer-daemon|postmaster|mail-daemon)@/i
const BOUNCE_SUBJECT = /undeliver|delivery status notification|returned mail|failure notice|delivery has failed|could not be delivered/i

/** New inbound mail in a thread ends its active follow-up. */
export function onInboundReply(threadId: string, fromAddr: string, subject: string): void {
  if (BOUNCE_FROM.test(fromAddr) || BOUNCE_SUBJECT.test(subject)) stopEnrollmentsForThread(threadId, 'bounced', 'The email bounced')
  else stopEnrollmentsForThread(threadId, 'replied', `${fromAddr} replied`)
}

/** Queue every enrollment whose next follow-up is due. */
export function sequenceTick(at: Date = new Date()): number {
  return tx(() => {
    const due = all<{ id: string; next_run_at: string }>(
      "SELECT id, next_run_at FROM sequence_enrollments WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?",
      at.toISOString()
    )
    for (const e of due) {
      // NULL marks it as in flight so the next tick doesn't queue it twice
      run('UPDATE sequence_enrollments SET next_run_at = NULL WHERE id = ?', e.id)
      enqueue('sequence_step', { enrollmentId: e.id, scheduledAt: e.next_run_at }, { maxAttempts: 3 })
    }
    return due.length
  })
}

interface EnrollRow {
  id: string
  sequence_id: string
  thread_id: string
  account_id: string
  to_addrs: string
  status: string
  current_step: number
  enrolled_at: string
}

/** Send the current step of one enrollment (or reschedule it). `at` is injectable for tests. */
export function runSequenceStep(enrollmentId: string, at: Date = new Date(), scheduledAt?: string): string {
  return tx(() => {
    const e = get<EnrollRow>('SELECT * FROM sequence_enrollments WHERE id = ?', enrollmentId)
    if (!e || e.status !== 'active') return 'not active'
    const seq = listSequences().find((s) => s.id === e.sequence_id)
    const step = seq?.steps[e.current_step]
    if (!seq || !step) {
      run("UPDATE sequence_enrollments SET status = 'completed', next_run_at = NULL WHERE id = ?", e.id)
      return 'completed'
    }
    const schedule = (d: Date) => run('UPDATE sequence_enrollments SET next_run_at = ? WHERE id = ?', d.toISOString(), e.id)

    // safety net: a reply that arrived since enrolling
    const reply = get<{ from_addr: string; subject: string }>(
      'SELECT from_addr, subject FROM mail_messages WHERE thread_id = ? AND is_outbound = 0 AND date > ? ORDER BY date LIMIT 1',
      e.thread_id,
      e.enrolled_at
    )
    if (reply) {
      onInboundReply(e.thread_id, reply.from_addr, reply.subject)
      return 'reply detected'
    }

    // the PC was off past the send time
    const late = scheduledAt ? at.getTime() - Date.parse(scheduledAt) > 24 * 3600_000 : false
    const skip = late && getSettings().followups.missedPolicy === 'skip'

    if (!skip) {
      if (!inWindow(at, seq.window)) {
        schedule(nextWindowStart(at, seq.window))
        return 'outside window'
      }
      const dayStart = new Date(`${localDate(at)}T00:00:00`)
      const sentToday =
        get<{ n: number }>(
          'SELECT COUNT(*) n FROM sequence_enrollments WHERE sequence_id = ? AND last_queued_at >= ? AND last_queued_at < ?',
          seq.id,
          dayStart.toISOString(),
          new Date(dayStart.getTime() + 86_400_000).toISOString()
        )?.n ?? 0
      if (sentToday >= seq.daily_cap) {
        const tomorrow = new Date(at)
        tomorrow.setDate(tomorrow.getDate() + 1)
        tomorrow.setHours(0, 0, 0, 0)
        schedule(nextWindowStart(tomorrow, seq.window))
        return 'daily cap reached'
      }
      const last = get<{ id: string; subject: string }>('SELECT id, subject FROM mail_messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1', e.thread_id)
      const thread = get<{ subject: string }>('SELECT subject FROM mail_threads WHERE id = ?', e.thread_id)!
      const firstTo = parseAddress(e.to_addrs.split(/[,;]/)[0] ?? '')
      const name =
        firstTo.name ||
        (get<{ from_name: string }>("SELECT from_name FROM mail_messages WHERE from_addr = ? AND from_name <> '' LIMIT 1", firstTo.address)?.from_name ?? '')
      const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`
      queueEmail(
        { account_id: e.account_id, to: e.to_addrs, subject, body: personalize(step.body, { name, address: firstTo.address }, thread.subject), reply_to: last?.id ?? null },
        { source: 'sequence', enrollmentId: e.id, threadId: e.thread_id }
      )
      run('UPDATE sequence_enrollments SET last_queued_at = ? WHERE id = ?', at.toISOString(), e.id)
    }

    const nextIndex = e.current_step + 1
    const next = seq.steps[nextIndex]
    if (next) {
      run('UPDATE sequence_enrollments SET current_step = ? WHERE id = ?', nextIndex, e.id)
      schedule(nextWindowStart(new Date(at.getTime() + next.wait_days * 86_400_000), seq.window))
    } else {
      run("UPDATE sequence_enrollments SET current_step = ?, status = 'completed', next_run_at = NULL WHERE id = ?", nextIndex, e.id)
    }
    return skip ? 'skipped (missed while offline)' : 'sent'
  })
}

registerJobHandler<{ enrollmentId: string; scheduledAt: string }>(
  'sequence_step',
  ({ payload }) => {
    runSequenceStep(payload.enrollmentId, new Date(), payload.scheduledAt)
  },
  // next_run_at was cleared when the step was queued: without this the follow-up would stay "active" forever (ADR-003)
  (job, error) =>
    run(
      "UPDATE sequence_enrollments SET status = 'failed', stopped_reason = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'active'",
      `Couldn't send the follow-up: ${error}`,
      now(),
      job.payload.enrollmentId
    )
)

/** "Ana Lima <ana@x.com>" → { name: "Ana Lima", address: "ana@x.com" } */
export function parseAddress(text: string): MailAddress {
  const t = text.trim()
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(t)
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim(), address: m[2].trim().toLowerCase() }
  return { name: '', address: t.toLowerCase() }
}
