import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { SMTPServer } from 'smtp-server'
import { ImapFlow } from 'imapflow'
import type { MailAccountConfig } from '@shared/mail'
import { closeDb, get, openDb, run } from '../src/main/db'
import * as accounts from '../src/main/services/mail/accounts'
import * as auto from '../src/main/services/automation'
import * as folders from '../src/main/services/mail/folders'
import * as fu from '../src/main/services/mail/followups'
import { followUpTarget, draftFollowUp } from '../src/main/services/mail/followupDraft'
import * as send from '../src/main/services/mail/send'
import * as store from '../src/main/services/mail/store'
import { DEFAULT_SETTINGS, updateSettings } from '../src/main/services/meta'
import { processJobs } from '../src/main/services/jobs'

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')

let IMAP_PORT = 20300 + Math.floor(Math.random() * 400)
const SMTP_PORT = 21000 + Math.floor(Math.random() * 900)
const ME = 'me@example.com'
const DAY = 86_400_000
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

const rfc = (o: { from: string; to?: string; subject: string; id: string; inReplyTo?: string; body?: string; date?: Date; list?: boolean }) =>
  [
    `From: ${o.from}`,
    `To: ${o.to ?? ME}`,
    `Subject: ${o.subject}`,
    `Message-ID: <${o.id}>`,
    ...(o.inReplyTo ? [`In-Reply-To: <${o.inReplyTo}>`, `References: <${o.inReplyTo}>`] : []),
    ...(o.list ? ['List-Id: <deals.shop.com>', 'List-Unsubscribe: <https://shop.com/u>'] : []),
    `Date: ${(o.date ?? new Date()).toUTCString()}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    o.body ?? 'Hello'
  ].join('\r\n')

let imapServer: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void }
let smtpServer: SMTPServer

async function startImap() {
  IMAP_PORT++
  const old = new Date(Date.now() - 5 * DAY)
  imapServer = hoodiecrow({
    plugins: ['ID', 'IDLE', 'UNSELECT', 'ENABLE', 'SPECIAL-USE', 'UIDPLUS', 'AUTH-PLAIN', 'NAMESPACE', 'MOVE', 'LITERALPLUS'],
    users: { me: { password: 'app-pass' } },
    storage: {
      INBOX: {
        messages: [
          { raw: rfc({ from: 'Ana Lima <ana@client.com>', subject: 'Proposal', id: 'p1@client.com', body: 'Can you send the proposal?', date: old }), flags: [] },
          { raw: rfc({ from: 'Deals <news@shop.com>', subject: 'Big sale', id: 'n1@shop.com', list: true, date: old }), flags: ['\\Seen'] },
          { raw: rfc({ from: 'Bob <bob@example.com>', subject: 'Lunch?', id: 'l1@example.com', date: old }), flags: [] }
        ]
      },
      '': {
        separator: '/',
        folders: {
          Sent: {
            'special-use': '\\Sent',
            messages: [{ raw: rfc({ from: `Me <${ME}>`, to: 'Sam <sam@vendor.com>', subject: 'Quote request', id: 'q1@example.com', date: old }), flags: ['\\Seen'] }]
          },
          Drafts: { 'special-use': '\\Drafts', messages: [{ raw: rfc({ from: ME, to: 'kim@client.com', subject: 'Unfinished', id: 'd1@example.com' }), flags: ['\\Draft'] }] },
          Junk: { 'special-use': '\\Junk', messages: [] },
          Trash: { 'special-use': '\\Trash', messages: [] },
          Archive: { 'special-use': '\\Archive', messages: [] },
          Clients: { messages: [] }
        }
      }
    }
  })
  await new Promise<void>((r) => imapServer.listen(IMAP_PORT, r))
}

beforeAll(async () => {
  smtpServer = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (auth, _s, cb) => (auth.password === 'app-pass' ? cb(null, { user: auth.username }) : cb(new Error('Invalid login'))),
    onData: (stream, _s, cb) => {
      stream.on('data', () => {})
      stream.on('end', () => cb())
    },
    logger: false
  })
  await new Promise<void>((r) => smtpServer.listen(SMTP_PORT, '127.0.0.1', r))
})
afterAll(async () => new Promise<void>((r) => smtpServer.close(() => r())))
afterEach(async () => new Promise<void>((r) => imapServer.close(() => r())))
beforeEach(async () => {
  closeDb()
  openDb(':memory:')
  await startImap()
})

const config = (): MailAccountConfig => ({
  imap: { host: '127.0.0.1', port: IMAP_PORT, secure: false, user: 'me' },
  smtp: { host: '127.0.0.1', port: SMTP_PORT, secure: false, user: 'me' },
  syncDays: 30,
  appendSent: false
})

async function imap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = new ImapFlow({ host: '127.0.0.1', port: IMAP_PORT, secure: false, auth: { user: 'me', pass: 'app-pass' }, logger: false })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.logout()
  }
}

async function connected() {
  updateSettings({ followups: { ...DEFAULT_SETTINGS.followups, workingDays: ALL_DAYS } })
  const acc = accounts.createAccount({ kind: 'mail', name: 'Me', email: ME, config: config(), password: 'app-pass' })
  await accounts.syncMailAccount(acc.id)
  const byTitle = (subject: string) => store.listThreads({ folder: 'all' }).find((t) => t.subject === subject)!
  return { acc, byTitle }
}

// ---------------------------------------------------------------- rules

describe('follow-up rules', () => {
  it('counts only working days', () => {
    const fri = new Date(2026, 9, 23, 18, 0) // Friday 18:00
    expect(fu.addWorkingHours(fri, 24, [1, 2, 3, 4, 5]).toString()).toBe(new Date(2026, 9, 26, 18, 0).toString()) // Monday 18:00
    expect(fu.addWorkingHours(fri, 30, [1, 2, 3, 4, 5]).toString()).toBe(new Date(2026, 9, 27, 0, 0).toString())
    expect(fu.addWorkingHours(fri, 24, ALL_DAYS).toString()).toBe(new Date(2026, 9, 24, 18, 0).toString())
    const sat = new Date(2026, 9, 24, 10, 0)
    expect(fu.addWorkingHours(sat, 1, [1, 2, 3, 4, 5]).toString()).toBe(new Date(2026, 9, 26, 1, 0).toString())
  })

  it('knows who is waiting for whom', () => {
    const ours: fu.Ours = { addresses: new Set([ME]), domains: new Set(['example.com']) }
    const m = (id: string, from: string, to: string[], date: string, is_auto = false) => ({ id, from, to, date, is_auto })
    expect(fu.followUpState([m('1', 'ana@client.com', [ME], '2026-10-01')], ours)).toMatchObject({ kind: 'reply', anchor: '1' })
    expect(fu.followUpState([m('1', 'ana@client.com', [ME], '2026-10-01'), m('2', ME, ['ana@client.com'], '2026-10-02')], ours)).toMatchObject({ kind: 'nudge', anchor: '2' })
    // a teammate answered: nobody waits on us
    expect(fu.followUpState([m('1', 'ana@client.com', [ME, 'bob@example.com'], '2026-10-01'), m('2', 'bob@example.com', ['ana@client.com'], '2026-10-02')], ours)?.kind).toBe('nudge')
    // internal conversation: nobody outside waits
    expect(fu.followUpState([m('1', 'bob@example.com', [ME], '2026-10-01')], ours)).toBeNull()
    // an out-of-office after our email doesn't count as their answer
    expect(fu.followUpState([m('1', ME, ['ana@client.com'], '2026-10-01'), m('2', 'ana@client.com', [ME], '2026-10-02', true)], ours)).toMatchObject({ kind: 'nudge', anchor: '1' })
    expect(fu.isFreeMailDomain('gmail.com')).toBe(true)
    expect(fu.isFreeMailDomain('thetalent.example')).toBe(false)
  })
})

// ---------------------------------------------------------------- end to end on a fake server

describe('follow-up in the inbox', () => {
  it('lists emails waiting for our reply and our emails waiting for theirs', async () => {
    const { byTitle } = await connected()
    const due = store.listThreads({ folder: 'followups' })
    expect(due.map((t) => [t.subject, t.followup?.kind]).sort()).toEqual([
      ['Proposal', 'reply'],
      ['Quote request', 'nudge']
    ])
    // the newsletter (list mail), the colleague's lunch question and the draft are not follow-ups
    expect(byTitle('Big sale').followup).toBeNull()
    expect(byTitle('Lunch?').followup).toBeNull()
    expect(fu.followUpCounts()).toEqual({ reply: 1, nudge: 1 })
    expect(store.listThreads({ folder: 'followups', followup_kind: 'reply' }).map((t) => t.subject)).toEqual(['Proposal'])
  })

  it('our reply moves a conversation from "reply" to "waiting on them" after the nudge time', async () => {
    const { acc, byTitle } = await connected()
    const th = store.getThread(byTitle('Proposal').id)!
    send.queueEmail({ account_id: acc.id, to: 'ana@client.com', subject: 'Re: Proposal', body: 'Attached.', reply_to: th.messages[0].id })
    await processJobs()
    const after = byTitle('Proposal').followup!
    expect(after.kind).toBe('nudge')
    expect(after.due).toBe(false)
    expect(fu.followUpCounts(new Date(Date.now() + 29 * 3600_000)).nudge).toBe(1) // only "Quote request"
    expect(fu.followUpCounts(new Date(Date.now() + 31 * 3600_000)).nudge).toBe(2)
  })

  it('dismiss and snooze hide a conversation until something new happens', async () => {
    const { byTitle } = await connected()
    const id = byTitle('Proposal').id
    fu.dismissFollowUp(id)
    expect(fu.followUpCounts().reply).toBe(0)
    // Ana writes again: back in Follow-up (after the waiting time)
    await imap((c) => c.append('INBOX', rfc({ from: 'Ana Lima <ana@client.com>', subject: 'Re: Proposal', id: 'p2@client.com', inReplyTo: 'p1@client.com' }), []))
    await accounts.syncMailAccount(byTitle('Proposal').account_id)
    expect(fu.followUpCounts().reply).toBe(0)
    expect(fu.followUpCounts(new Date(Date.now() + 25 * 3600_000)).reply).toBe(1)

    fu.snoozeFollowUp(byTitle('Quote request').id, new Date(Date.now() + 2 * DAY).toISOString())
    expect(fu.followUpCounts().nudge).toBe(0)
    expect(fu.followUpCounts(new Date(Date.now() + 3 * DAY)).nudge).toBe(1)
  })

  it('company domains from settings count as us', async () => {
    const { byTitle } = await connected()
    updateSettings({ followups: { ...DEFAULT_SETTINGS.followups, workingDays: ALL_DAYS, companyDomains: ['client.com'] } })
    fu.recomputeFollowUps()
    expect(byTitle('Proposal').followup).toBeNull()
  })

  it('drafts a follow-up to the right people', async () => {
    const { byTitle } = await connected()
    expect(followUpTarget(byTitle('Proposal').id)).toMatchObject({ kind: 'reply', to: 'Ana Lima <ana@client.com>', subject: 'Re: Proposal' })
    expect(followUpTarget(byTitle('Quote request').id)).toMatchObject({ kind: 'nudge', to: 'Sam <sam@vendor.com>' })
    // no AI key in tests: a template, and the reason
    const d = await draftFollowUp(byTitle('Quote request').id)
    expect(d.source).toBe('template')
    expect(d.body).toMatch(/^Hi Sam,\n\nI wanted to follow up on my email below about “Quote request”/)
    expect(d.ai_error).toBeTruthy()
  })

  it('fires the "email needs follow-up" trigger once per waiting message', async () => {
    const { byTitle } = await connected()
    auto.createAutomation({ name: 'Chase', enabled: true, scope: null, trigger: { type: 'email_needs_follow_up', kind: 'nudge' }, conditions: [], actions: [{ type: 'notify', title: 'Chase {{email.subject}}' }] })
    // conversations that were already waiting when the rule was made don't fire
    expect(auto.automationTick()).toBe(0)
    run('UPDATE automations SET created_at = ?', new Date(Date.now() - 30 * DAY).toISOString())
    expect(auto.automationTick()).toBe(1)
    expect(auto.automationTick()).toBe(0)
    await processJobs()
    expect(auto.listAutomationRuns()[0].detail.join(' ')).toContain('Chase Quote request')
    void byTitle
  })
})


describe('server folders', () => {
  it('lists every folder with its role and shows drafts separately', async () => {
    const { acc, byTitle } = await connected()
    const list = folders.listMailFolders(acc.id)
    expect(list.map((f) => [f.path, f.role])).toEqual([
      ['INBOX', 'inbox'],
      ['Drafts', 'drafts'],
      ['Sent', 'sent'],
      ['Archive', 'archive'],
      ['Junk', 'spam'],
      ['Trash', 'trash'],
      ['Clients', null]
    ])
    expect(store.listThreads({ folder: 'drafts' }).map((t) => t.subject)).toEqual(['Unfinished'])
    expect(store.listThreads({ folder: 'sent' }).map((t) => t.subject)).toEqual(['Quote request'])
    expect(byTitle('Unfinished').followup).toBeNull()
  })

  it('moves a conversation to Spam on the server and leaves Follow-up', async () => {
    const { acc, byTitle } = await connected()
    const id = byTitle('Proposal').id
    folders.moveThread(id, 'inbox', 'spam')
    expect(store.listThreads({ folder: 'spam' }).map((t) => t.subject)).toEqual(['Proposal'])
    expect(store.listThreads({ folder: 'inbox' }).map((t) => t.subject)).not.toContain('Proposal')
    await processJobs() // the server move, then a sync
    await processJobs()
    expect(await imap(async (c) => ((await c.status('Junk', { messages: true })) || { messages: -1 }).messages)).toBe(1)
    expect(get<{ uid: number }>("SELECT uid FROM mail_locations WHERE folder = 'Junk'")!.uid).toBeGreaterThan(0)
    expect(fu.followUpCounts().reply).toBe(0)
    // Not spam
    folders.moveThread(id, 'spam', 'inbox')
    await processJobs()
    await processJobs()
    expect(store.listThreads({ folder: 'inbox' }).map((t) => t.subject)).toContain('Proposal')
    void acc
  })

  it('saves drafts on the server, replaces them, and removes them once sent', async () => {
    const { acc, byTitle } = await connected()
    const drafts = await import('../src/main/services/mail/drafts')
    const drafted = () => imap(async (c) => ((await c.status('Drafts', { messages: true })) || { messages: -1 }).messages)
    const input = { account_id: acc.id, to: 'ana@client.com', subject: 'Re: Proposal', body: 'First try', reply_to: store.getThread(byTitle('Proposal').id)!.messages[0].id }
    const first = await drafts.saveDraft(input)
    expect(await drafted()).toBe(2) // the seeded "Unfinished" + ours
    const second = await drafts.saveDraft({ ...input, body: 'Better version' }, first)
    await processJobs()
    expect(await drafted()).toBe(2)
    const thread = store.getThread(byTitle('Proposal').id)!
    expect(thread.messages.filter((m) => m.is_draft).map((m) => m.body_text.trim())).toEqual(['Better version'])
    // a draft is not "our reply": Ana is still waiting
    expect(byTitle('Proposal').followup?.kind).toBe('reply')
    drafts.discardDraft(second)
    await processJobs()
    expect(await drafted()).toBe(1)
  })

  it('notices messages deleted on another device, and deletes from Trash for good', async () => {
    const { acc, byTitle } = await connected()
    await imap(async (c) => {
      await c.mailboxOpen('INBOX')
      await c.messageDelete({ header: { 'message-id': 'l1@example.com' } } as never)
    })
    await accounts.syncMailAccount(acc.id)
    expect(byTitle('Lunch?')).toBeUndefined()

    const id = byTitle('Big sale').id
    expect(() => folders.deleteThreadForever(id)).toThrow(/Move it to Trash first/)
    folders.moveThread(id, 'inbox', 'trash')
    await processJobs()
    await processJobs()
    folders.deleteThreadForever(id)
    await processJobs()
    expect(await imap(async (c) => ((await c.status('Trash', { messages: true })) || { messages: -1 }).messages)).toBe(0)
    expect(store.getThread(id)).toBeNull()
  })
})
