import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { SMTPServer } from 'smtp-server'
import { ImapFlow } from 'imapflow'
import type { MailAccountConfig } from '@shared/mail'
import { addDays, localDate } from '@shared/dates'
import { all, closeDb, get, openDb } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as auto from '../src/main/services/automation'
import * as accounts from '../src/main/services/mail/accounts'
import * as mail from '../src/main/services/mail/index'
import * as send from '../src/main/services/mail/send'
import * as seq from '../src/main/services/mail/sequences'
import * as store from '../src/main/services/mail/store'
import * as cal from '../src/main/services/calendar'
import { updateSettings } from '../src/main/services/meta'
import { processJobs } from '../src/main/services/jobs'

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')

let IMAP_PORT = 19300 + Math.floor(Math.random() * 400)
const SMTP_PORT = 18000 + Math.floor(Math.random() * 900)
const ME = 'me@example.com'

const rfc = (o: { from: string; to?: string; subject: string; id: string; inReplyTo?: string; body?: string; date?: Date }) =>
  [
    `From: ${o.from}`,
    `To: ${o.to ?? ME}`,
    `Subject: ${o.subject}`,
    `Message-ID: <${o.id}>`,
    ...(o.inReplyTo ? [`In-Reply-To: <${o.inReplyTo}>`, `References: <${o.inReplyTo}>`] : []),
    `Date: ${(o.date ?? new Date()).toUTCString()}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    o.body ?? 'Hello'
  ].join('\r\n')

let imapServer: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void }
let smtpServer: SMTPServer
const delivered: string[] = []

/** A fresh in-memory IMAP server per test, so tests don't see each other's mail. */
async function startImap() {
  IMAP_PORT++
  imapServer = hoodiecrow({
    plugins: ['ID', 'IDLE', 'UNSELECT', 'ENABLE', 'SPECIAL-USE', 'UIDPLUS', 'AUTH-PLAIN', 'NAMESPACE', 'MOVE', 'LITERALPLUS'],
    users: { me: { password: 'app-pass' } },
    storage: {
      INBOX: {
        messages: [
          { raw: rfc({ from: 'Ana Lima <ana@client.com>', subject: 'Proposal', id: 'p1@client.com', body: 'Can you send the proposal?' }), flags: [] },
          { raw: rfc({ from: 'news@shop.com', subject: 'Big sale', id: 'n1@shop.com' }), flags: ['\\Seen'] }
        ]
      },
      '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] } } }
    }
  })
  await new Promise<void>((r) => imapServer.listen(IMAP_PORT, r))
}

beforeAll(async () => {  smtpServer = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (auth, _s, cb) => (auth.password === 'app-pass' ? cb(null, { user: auth.username }) : cb(new Error('Invalid login'))),
    onData: (stream, _s, cb) => {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => {
        delivered.push(Buffer.concat(chunks).toString())
        cb()
      })
    },
    logger: false
  })
  await new Promise<void>((r) => smtpServer.listen(SMTP_PORT, '127.0.0.1', r))
})

afterAll(async () => {
  await new Promise<void>((r) => smtpServer.close(() => r()))
})

afterEach(async () => {
  await new Promise<void>((r) => imapServer.close(() => r()))
})

const config: () => MailAccountConfig = () => ({
  imap: { host: '127.0.0.1', port: IMAP_PORT, secure: false, user: 'me' },
  smtp: { host: '127.0.0.1', port: SMTP_PORT, secure: false, user: 'me' },
  syncDays: 30,
  appendSent: true
})

async function appendToInbox(raw: string) {
  const c = new ImapFlow({ host: '127.0.0.1', port: IMAP_PORT, secure: false, auth: { user: 'me', pass: 'app-pass' }, logger: false })
  await c.connect()
  await c.append('INBOX', raw, [])
  await c.logout()
}

beforeEach(async () => {
  closeDb()
  openDb(':memory:')
  await startImap()
})

function setup() {
  const space = h.createSpace({ name: 'Work' })
  const list = h.createList({ space_id: space.id, name: 'Leads' })
  const acc = accounts.createAccount({ kind: 'mail', name: 'Me', email: ME, config: config(), password: 'app-pass' })
  return { list, acc }
}

describe('mail parsing', () => {
  it('sanitizes html and builds snippets', async () => {
    expect(store.sanitizeHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:evil()">x</a><img src=x onerror=boom>')).toBe(
      '<p>Hi</p><a href="#">x</a><img src=x>'
    )
    expect(store.normalizeSubject('Re: FWD: re: Quote')).toBe('quote')
    expect(store.snippetOf('Sounds good!\n\nOn Mon, Ana wrote:\n> old text')).toBe('Sounds good!')
    expect(store.htmlToText('<h2>Hi there!</h2><p>Line&nbsp;one<br>two &amp; three</p><img src="https://t/x.gif"><ul><li>a</li></ul>')).toBe(
      'Hi there!\nLine one\ntwo & three\n• a'
    )
    const htmlOnly = await store.parseRaw(
      Buffer.from('From: a@x.com\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n<h1>Big News</h1><p>Read <img src="https://t/p.gif">this</p>')
    )
    expect(htmlOnly.text).toBe('Big News\nRead this')
    const p = await store.parseRaw(Buffer.from(rfc({ from: 'A <a@x.com>', subject: 'Hi', id: 'z@x', inReplyTo: 'y@x' })))
    expect(p).toMatchObject({ messageId: '<z@x>', inReplyTo: '<y@x>', references: ['<y@x>'], from: { name: 'A', address: 'a@x.com' } })
  })
})

describe('accounts & sync', () => {
  it('tests the connection and reports bad passwords clearly', async () => {
    const ok = await accounts.testMailConnection({ kind: 'mail', name: '', email: ME, config: config(), password: 'app-pass' })
    expect(ok).toEqual({ imap: null, smtp: null })
    const bad = await accounts.testMailConnection({ kind: 'mail', name: '', email: ME, config: config(), password: 'wrong' })
    expect(bad.imap).toMatch(/Sign-in failed/)
    expect(bad.smtp).toMatch(/Sign-in failed/)
  })

  it('imports history, threads replies, and runs email automations for new mail only', async () => {
    const { list, acc } = setup()
    auto.createAutomation({
      name: 'Proposals become tasks',
      enabled: true,
      scope: null,
      trigger: { type: 'email_received' },
      conditions: [{ field: 'email_subject', op: 'contains', value: 'proposal' }],
      actions: [{ type: 'create_task_from_email', list_id: list.id }, { type: 'mark_email_read' }]
    })
    const first = await accounts.syncMailAccount(acc.id)
    expect(first.added).toBe(2)
    await processJobs()
    expect(t.queryTasks({})).toHaveLength(0) // history import doesn't trigger automations

    const inbox = store.listThreads({ folder: 'inbox' })
    expect(inbox.map((x) => x.subject).sort()).toEqual(['Big sale', 'Proposal'])
    expect(inbox.find((x) => x.subject === 'Proposal')!.unread_count).toBe(1)
    expect(store.listThreads({ folder: 'inbox', search: 'proposal' })).toHaveLength(1)

    await appendToInbox(rfc({ from: 'Ana Lima <ana@client.com>', subject: 'Re: Proposal', id: 'p2@client.com', inReplyTo: 'p1@client.com', body: 'Any update on the proposal?' }))
    const second = await accounts.syncMailAccount(acc.id)
    expect(second.added).toBe(1)
    const thread = store.listThreads({ folder: 'all' }).find((x) => x.subject === 'Proposal')!
    expect(thread.message_count).toBe(2) // reply joined the thread

    await processJobs()
    const [task] = t.queryTasks({})
    expect(task.title).toBe('Proposal')
    expect(t.getTask(task.id)!.emails.map((e) => e.id)).toEqual([thread.id])
    expect(store.getThread(thread.id)!.messages.every((m) => m.is_read)).toBe(true)
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM jobs WHERE type = 'mail_flags'")!.n).toBe(1)
  })
})

describe('sending', () => {
  it('sends a threaded reply, saves it to Sent and shows it in the thread', async () => {
    const { acc } = setup()
    await accounts.syncMailAccount(acc.id)
    const thread = store.listThreads({ folder: 'inbox' }).find((x) => x.subject === 'Proposal')!
    const parent = store.getThread(thread.id)!.messages[0]
    delivered.length = 0
    send.queueEmail({ account_id: acc.id, to: 'ana@client.com', subject: 'Re: Proposal', body: 'Attached!\n\n> Can you send it?', reply_to: parent.id })
    expect(() => send.queueEmail({ account_id: acc.id, to: 'not-an-email', subject: 'x', body: 'x' })).toThrow(/not a valid email/)
    await processJobs()

    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain('In-Reply-To: <p1@client.com>')
    expect(delivered[0]).toMatch(/<blockquote/)
    const detail = store.getThread(thread.id)!
    expect(detail.messages).toHaveLength(2)
    expect(detail.messages[1]).toMatchObject({ is_outbound: true, body_text: expect.stringContaining('Attached!') })
    expect(store.listThreads({ folder: 'sent' }).map((x) => x.id)).toContain(thread.id)

    // the copy appended to Sent is recognised as the same message on the next sync
    await accounts.syncMailAccount(acc.id)
    expect(store.getThread(thread.id)!.messages).toHaveLength(2)
  })

  it('marks the outbox item failed after retries', async () => {
    const { acc } = setup()
    accounts.updateAccount(acc.id, { password: 'wrong' })
    const o = send.queueEmail({ account_id: acc.id, to: 'x@y.com', subject: 'Hi', body: 'Hi' })
    for (let i = 0; i < 5; i++) await processJobs(new Date(Date.now() + i * 3600_000 + 1))
    expect(send.getOutboxItem(o.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/Sign-in failed/) })
  })
})

describe('follow-up sequences', () => {
  const allDay = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }

  it('sends steps as replies until the contact answers', async () => {
    const { acc } = setup()
    await accounts.syncMailAccount(acc.id)
    const thread = store.listThreads({ folder: 'inbox' }).find((x) => x.subject === 'Proposal')!
    const s = seq.createSequence({
      name: 'Nudge',
      window: allDay,
      daily_cap: 10,
      steps: [
        { wait_days: 2, body: 'Hi {{first_name}}, just checking in on “{{subject}}”.' },
        { wait_days: 3, body: 'Last nudge!' }
      ]
    })
    const e = seq.enrollThread(thread.id, s.id)
    expect(e).toMatchObject({ status: 'active', to: 'ana@client.com', total_steps: 2 })
    expect(store.listThreads({ folder: 'followups' }).map((x) => x.id)).toEqual([thread.id])

    expect(seq.sequenceTick(new Date())).toBe(0) // not due yet
    delivered.length = 0
    const due = new Date(Date.now() + 2.1 * 86_400_000)
    expect(seq.sequenceTick(due)).toBe(1)
    await processJobs(due)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain('Hi Ana, just checking in on')
    expect(delivered[0]).toContain('Subject: Re: Proposal')
    expect(seq.listEnrollments({ threadId: thread.id })[0]).toMatchObject({ status: 'active', current_step: 1 })

    await appendToInbox(rfc({ from: 'ana@client.com', subject: 'Re: Proposal', id: 'p3@client.com', inReplyTo: 'p1@client.com', body: 'Sorry, busy week!' }))
    await accounts.syncMailAccount(acc.id)
    expect(seq.listEnrollments({ threadId: thread.id })[0]).toMatchObject({ status: 'replied', stopped_reason: 'ana@client.com replied' })
  })

  it('respects the send window and the daily cap, and stops on bounces and manual replies', async () => {
    const { acc } = setup()
    await accounts.syncMailAccount(acc.id)
    const [a, b] = store.listThreads({ folder: 'inbox' })
    const s = seq.createSequence({ name: 'Weekdays', window: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }, daily_cap: 1, steps: [{ wait_days: 1, body: 'Ping' }] })
    const ea = seq.enrollThread(a.id, s.id)
    const eb = seq.enrollThread(b.id, s.id)

    // Saturday 10:00 → moved to Monday 09:00
    const sat = new Date(2026, 9, 17, 10, 0)
    expect(seq.runSequenceStep(ea.id, sat)).toBe('outside window')
    const next = new Date(get<{ next_run_at: string }>('SELECT next_run_at FROM sequence_enrollments WHERE id = ?', ea.id)!.next_run_at)
    expect([next.getDay(), next.getHours()]).toEqual([1, 9])

    const mon = new Date(2026, 9, 19, 10, 0)
    expect(seq.runSequenceStep(ea.id, mon)).toBe('sent')
    expect(seq.runSequenceStep(eb.id, mon)).toBe('daily cap reached')

    seq.onInboundReply(b.id, 'mailer-daemon@example.com', 'Undeliverable: Big sale')
    expect(seq.listEnrollments({ threadId: b.id })[0].status).toBe('bounced')

    const ec = seq.enrollThread(b.id, s.id)
    send.queueEmail({ account_id: acc.id, to: 'news@shop.com', subject: 'Re: Big sale', body: 'Thanks', reply_to: store.getThread(b.id)!.messages[0].id })
    expect(seq.listEnrollments({ threadId: b.id }).find((x) => x.id === ec.id)).toMatchObject({ status: 'stopped', stopped_reason: 'You replied' })
  })

  it('skips follow-ups missed while offline when configured', async () => {
    const { acc } = setup()
    await accounts.syncMailAccount(acc.id)
    const [thread] = store.listThreads({ folder: 'inbox' })
    const s = seq.createSequence({ name: 'S', window: allDay, daily_cap: 10, steps: [{ wait_days: 1, body: 'A' }, { wait_days: 1, body: 'B' }] })
    const e = seq.enrollThread(thread.id, s.id)
    updateSettings({ followups: { missedPolicy: 'skip' } })
    const scheduled = new Date(Date.now() - 3 * 86_400_000).toISOString()
    expect(seq.runSequenceStep(e.id, new Date(), scheduled)).toBe('skipped (missed while offline)')
    expect(all('SELECT id FROM outbox')).toHaveLength(0)
    expect(seq.listEnrollments({ threadId: thread.id })[0].current_step).toBe(1)
  })
})

describe('email automations', () => {
  it('replies automatically and starts sequences when no reply arrives', async () => {
    const { acc } = setup()
    await accounts.syncMailAccount(acc.id)
    const thread = store.listThreads({ folder: 'inbox' }).find((x) => x.subject === 'Proposal')!
    const parent = store.getThread(thread.id)!.messages[0]
    send.queueEmail({ account_id: acc.id, to: 'ana@client.com', subject: 'Re: Proposal', body: 'Here it is', reply_to: parent.id })
    await processJobs()

    const s = seq.createSequence({ name: 'Chase', window: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }, daily_cap: 5, steps: [{ wait_days: 2, body: 'Any thoughts?' }] })
    auto.createAutomation({
      name: 'Chase silence',
      enabled: true,
      scope: null,
      trigger: { type: 'email_no_reply', days: 3 },
      conditions: [],
      actions: [{ type: 'start_sequence', sequence_id: s.id }, { type: 'notify', title: 'No reply from {{email.to}}' }]
    })
    expect(auto.automationTick(new Date())).toBe(0)
    const later = new Date(Date.now() + 3.5 * 86_400_000)
    expect(auto.automationTick(later)).toBe(1)
    expect(auto.automationTick(later)).toBe(0)
    await processJobs(later)
    expect(seq.listEnrollments({ threadId: thread.id })[0]).toMatchObject({ status: 'active', sequence_name: 'Chase' })
    expect(auto.listAutomationRuns()[0].detail.join(' ')).toContain('No reply from ana@client.com')
  })

  it('rejects task actions on email triggers', () => {
    const { list } = setup()
    expect(() =>
      auto.createAutomation({
        name: 'x',
        enabled: true,
        scope: null,
        trigger: { type: 'email_received' },
        conditions: [],
        actions: [{ type: 'set_priority', priority: 'high' }]
      })
    ).toThrow(/needs a task/)
    expect(() =>
      auto.createAutomation({ name: 'x', enabled: true, scope: null, trigger: { type: 'task_created' }, conditions: [], actions: [{ type: 'create_task_from_email', list_id: list.id }] })
    ).toThrow(/needs an email/)
  })
})

describe('calendar', () => {
  it('stores local events, expands recurrences and blocks time for tasks', () => {
    const { list } = setup()
    const [my] = cal.listCalendars()
    expect(my.name).toBe('My calendar')
    const today = localDate()
    const ev = cal.createEvent({ calendar_id: my.id, title: 'Call Ana', start: `${today}T10:00`, end: `${today}T10:30`, all_day: false })
    expect(cal.listEvents(today, addDays(today, 1)).map((e) => e.title)).toEqual(['Call Ana'])
    cal.updateEvent(ev.event_id, { title: 'Call Ana (moved)', start: `${addDays(today, 1)}T11:00`, end: `${addDays(today, 1)}T12:00` })
    expect(cal.listEvents(today, addDays(today, 1))).toHaveLength(0)
    expect(cal.listEvents(addDays(today, 1), addDays(today, 2))[0]).toMatchObject({ title: 'Call Ana (moved)', start: `${addDays(today, 1)}T11:00` })

    // a weekly series coming from a CalDAV server
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', 'BEGIN:VEVENT', 'UID:standup@test', 'DTSTAMP:20260101T000000Z',
      'DTSTART:20260105T090000Z', 'DTEND:20260105T091500Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n')
    const p = cal.parseIcs(ics)!
    expect(p).toMatchObject({ title: 'Standup', all_day: false, rrule: expect.stringContaining('FREQ=WEEKLY') })
    run('INSERT INTO calendar_events (id, calendar_id, uid, title, start, end, rrule, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'r1', my.id, p.uid, p.title, p.start, p.end, p.rrule, ics)
    const mondays = cal.listEvents('2026-02-01', '2026-03-01').filter((e) => e.title === 'Standup')
    expect(mondays).toHaveLength(4)
    expect(mondays.every((e) => e.recurring && new Date(e.start).getDay() === 1)).toBe(true)

    const task = t.createTask({ list_id: list.id, title: 'Write proposal', due_date: `${today}T14:00`, time_estimate_min: 90 })
    const block = cal.createEventForTask(task.id)
    expect(block).toMatchObject({ title: 'Write proposal', start: `${today}T14:00`, end: `${today}T15:30`, task_id: task.id })
    expect(t.getTask(task.id)!.events).toHaveLength(1)

    // all-day round trip through iCalendar
    const allDay = cal.createEvent({ calendar_id: my.id, title: 'Holiday', start: '2026-12-24', end: '2026-12-26', all_day: true })
    const stored = get<{ raw: string }>('SELECT raw FROM calendar_events WHERE id = ?', allDay.event_id)!.raw
    expect(cal.parseIcs(stored)).toMatchObject({ start: '2026-12-24', end: '2026-12-26', all_day: true })
  })
})

import { run } from '../src/main/db'
void mail
