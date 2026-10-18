import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { SMTPServer } from 'smtp-server'
import type { CalDavConfig, MailAccountConfig } from '@shared/mail'
import { addDays, localDate } from '@shared/dates'
import { all, closeDb, get, openDb, run } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as auto from '../src/main/services/automation'
import * as integ from '../src/main/services/integrations'
import * as oauth from '../src/main/services/oauth'
import * as accounts from '../src/main/services/mail/accounts'
import * as send from '../src/main/services/mail/send'
import * as cal from '../src/main/services/calendar'
import { pushNotification } from '../src/main/services/notify'
import { processJobs } from '../src/main/services/jobs'

// ---------------------------------------------------------------- one fake server for Slack, Teams, OAuth and CalDAV

interface Hit {
  path: string
  headers: IncomingMessage['headers']
  body: string
}
const hits: Hit[] = []
let base = ''
let server: Server
let webhookReply: { status: number; body: string } = { status: 200, body: 'ok' }
let slackHistory: unknown[] = []
const authCodes = new Map<string, string>() // code → code_challenge
let refreshResult: 'ok' | 'invalid_grant' = 'ok'

const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const u = new URL(req.url ?? '/', base)
      hits.push({ path: u.pathname, headers: req.headers, body })
      const json = (o: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(o))
      }
      if (u.pathname === '/slack-hook' || u.pathname === '/teams') {
        res.writeHead(webhookReply.status).end(webhookReply.body)
      } else if (u.pathname.startsWith('/api/')) {
        if (req.headers.authorization !== 'Bearer xoxb-test') return json({ ok: false, error: 'invalid_auth' })
        const method = u.pathname.slice(5)
        if (method === 'auth.test') return json({ ok: true })
        if (method === 'chat.postMessage') return json({ ok: true })
        if (method === 'conversations.history') return json({ ok: true, messages: slackHistory })
        if (method === 'chat.getPermalink') return json({ ok: true, permalink: `https://acme.slack.com/archives/C1/p${u.searchParams.get('message_ts')}` })
        if (method === 'conversations.list')
          return json({ ok: true, channels: [{ id: 'C2', name: 'random', is_member: false }, { id: 'C1', name: 'tasks', is_member: true }] })
        return json({ ok: false, error: 'unknown_method' })
      } else if (u.pathname === '/oauth/auth') {
        // the "browser": consent is instant, redirect back to the app's loopback server
        const code = `code-${authCodes.size + 1}`
        expect(u.searchParams.get('code_challenge_method')).toBe('S256')
        authCodes.set(code, u.searchParams.get('code_challenge')!)
        const back = new URL(u.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', code)
        back.searchParams.set('state', u.searchParams.get('state')!)
        res.writeHead(302, { Location: back.toString() }).end()
      } else if (u.pathname === '/oauth/token') {
        const f = new URLSearchParams(body)
        if (f.get('grant_type') === 'authorization_code') {
          const challenge = authCodes.get(f.get('code') ?? '')
          const ok = challenge && createHash('sha256').update(f.get('code_verifier')!).digest('base64url') === challenge
          if (!ok) return json({ error: 'invalid_grant' }, 400)
          return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, id_token: jwt({ email: 'oauth@example.com', name: 'O. Auth' }) })
        }
        if (refreshResult === 'invalid_grant') return json({ error: 'invalid_grant' }, 400)
        return json({ access_token: 'at-2', expires_in: 3600 })
      } else if (u.pathname.startsWith('/caldav')) {
        res.writeHead(500).end()
      } else res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  integ.setSlackApiBase(`${base}/api`)
  oauth.setOAuthTestHooks({
    endpoints: { google: { authUrl: `${base}/oauth/auth`, tokenUrl: `${base}/oauth/token` } },
    // fetch follows the redirect to the app's loopback callback, like a browser would
    openBrowser: (url) => void fetch(url).catch(() => {})
  })
})

afterAll(() => server.close())

let listId = ''
beforeEach(() => {
  closeDb()
  openDb(':memory:')
  hits.length = 0
  webhookReply = { status: 200, body: 'ok' }
  slackHistory = []
  refreshResult = 'ok'
  const s = h.createSpace({ name: 'Work' })
  listId = h.createList({ space_id: s.id, name: 'Inbox' }).id
})

const posts = (path: string) => hits.filter((x) => x.path === path).map((x) => JSON.parse(x.body) as Record<string, unknown>)

// ---------------------------------------------------------------- Slack / Teams

describe('Slack and Teams', () => {
  it('validates webhook URLs and tokens', () => {
    expect(() => integ.validateSecret('slack_webhook', 'http://hooks.slack.com/services/x')).toThrow(/https/)
    expect(() => integ.validateSecret('slack_webhook', 'https://evil.example.com/hook')).toThrow(/hooks\.slack\.com/)
    expect(() => integ.validateSecret('slack_bot', 'abc')).toThrow(/xoxb/)
    expect(() => integ.validateSecret('teams_webhook', 'https://prod-01.westus.logic.azure.com/workflows/1')).not.toThrow()
  })

  it('tests, posts through the queue and mirrors notifications', async () => {
    const input = { kind: 'slack_webhook' as const, name: 'Team Slack', config: { mirrorNotifications: true }, secret: `${base}/slack-hook` }
    expect(await integ.testIntegration(input)).toBeNull()
    expect(posts('/slack-hook')[0].text).toContain('*FollowUp is connected*')

    const i = integ.createIntegration(input)
    expect(i.target).toBe(new URL(base).host)
    expect(JSON.stringify(integ.listIntegrations())).not.toContain('slack-hook') // the secret never leaves the main process

    pushNotification({ kind: 'reminder', title: 'Call <Ana> & co', body: 'At 3pm', task_id: null })
    await processJobs()
    const last = posts('/slack-hook').at(-1)!
    expect(last.text).toBe('*Call &lt;Ana&gt; &amp; co*\nAt 3pm')
    expect(integ.listIntegrations()[0].last_used_at).not.toBeNull()
  })

  it('posts adaptive cards to Teams and stops retrying a revoked webhook', async () => {
    const teams = integ.createIntegration({ kind: 'teams_webhook', name: 'Teams', config: { mirrorNotifications: false }, secret: `${base}/teams` })
    integ.postToIntegration(teams.id, { title: 'Release', body: 'v1 shipped' })
    await processJobs()
    const card = posts('/teams')[0] as { attachments: { contentType: string; content: { body: { text: string }[] } }[] }
    expect(card.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(card.attachments[0].content.body.map((b) => b.text)).toEqual(['Release', 'v1 shipped'])

    webhookReply = { status: 403, body: 'invalid_token' }
    const slack = integ.createIntegration({ kind: 'slack_webhook', name: 'Old', config: { mirrorNotifications: false }, secret: `${base}/slack-hook` })
    integ.postToIntegration(slack.id, { title: 'Hello' })
    await processJobs()
    const job = get<{ status: string; attempts: number }>("SELECT status, attempts FROM jobs WHERE type = 'integration_post' ORDER BY created_at DESC LIMIT 1")!
    expect(job).toMatchObject({ status: 'done', attempts: 1 })
    expect(integ.listIntegrations().find((x) => x.id === slack.id)!.last_error).toMatch(/no longer valid/)
  })

  it('automation action posts a templated message', async () => {
    const i = integ.createIntegration({ kind: 'slack_webhook', name: 'Slack', config: { mirrorNotifications: false }, secret: `${base}/slack-hook` })
    expect(() =>
      auto.createAutomation({ name: 'x', enabled: true, scope: null, trigger: { type: 'task_created' }, conditions: [], actions: [{ type: 'post_message', integration_id: 'nope', text: 'hi' }] })
    ).toThrow(/where to post/)
    auto.createAutomation({
      name: 'Announce',
      enabled: true,
      scope: null,
      trigger: { type: 'task_created' },
      conditions: [],
      actions: [{ type: 'post_message', integration_id: i.id, text: 'New task: {{task.title}}' }]
    })
    t.createTask({ list_id: listId, title: 'Ship v1' })
    await processJobs()
    expect(posts('/slack-hook').at(-1)!.text).toBe('New task: Ship v1')
  })

  it('turns reacted Slack messages into tasks once', async () => {
    const bot = integ.createIntegration({
      kind: 'slack_bot',
      name: 'Slack app',
      config: { channel: 'C1', mirrorNotifications: false, watch: { enabled: true, emoji: ':memo:', list_id: listId } },
      secret: 'xoxb-test'
    })
    expect(bot.config.watch!.emoji).toBe('memo')
    expect(await integ.testIntegration({ kind: 'slack_bot', name: 'x', config: { channel: 'C1', mirrorNotifications: false }, secret: 'xoxb-test' })).toBeNull()
    expect(await integ.testIntegration({ kind: 'slack_bot', name: 'x', config: { channel: 'C1', mirrorNotifications: false }, secret: 'xoxb-wrong' })).toMatch(/rejected the token/)
    expect((await integ.listSlackChannels({ id: bot.id })).map((c) => c.name)).toEqual(['tasks', 'random'])

    slackHistory = [
      { ts: '1700000000.0001', text: 'Fix the <https://x.io/login|login page> for <@U1|ana>\nIt breaks on Safari', reactions: [{ name: 'memo', count: 1 }] },
      { ts: '1700000000.0002', text: 'just chatting', reactions: [{ name: 'tada', count: 2 }] },
      { ts: '1700000000.0003', subtype: 'channel_join', text: 'joined', reactions: [{ name: 'memo', count: 1 }] }
    ]
    expect(await integ.pollSlack(bot.id)).toBe(1)
    expect(await integ.pollSlack(bot.id)).toBe(0)
    const task = t.queryTasks({ location: { kind: 'list', id: listId } })[0]
    expect(task.title).toBe('Fix the login page (https://x.io/login) for @ana')
    expect(t.getTask(task.id)!.description).toContain('Open in Slack')
    expect(t.getTask(task.id)!.description).toContain('It breaks on Safari')
  })
})

// ---------------------------------------------------------------- Google sign-in → IMAP / SMTP / CalDAV with tokens

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')
const IMAP_PORT = 21400 + Math.floor(Math.random() * 300)
const SMTP_PORT = 21800 + Math.floor(Math.random() * 300)

describe('Sign in with Google', () => {
  let imap: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void }
  let smtp: SMTPServer
  const delivered: string[] = []
  const smtpTokens: string[] = []

  beforeAll(async () => {
    imap = hoodiecrow({
      plugins: ['ID', 'UNSELECT', 'ENABLE', 'SPECIAL-USE', 'UIDPLUS', 'SASL-IR', 'XOAUTH2', 'NAMESPACE', 'LITERALPLUS'],
      users: { 'oauth@example.com': { password: 'unused', xoauth2: { accessToken: 'at-2' } } },
      storage: {
        INBOX: { messages: [{ raw: 'From: ana@client.com\r\nTo: oauth@example.com\r\nSubject: Hi there\r\nMessage-ID: <h1@client.com>\r\n\r\nHello', flags: [] }] },
        '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] } } }
      }
    })
    await new Promise<void>((r) => imap.listen(IMAP_PORT, r))
    smtp = new SMTPServer({
      authMethods: ['XOAUTH2'],
      allowInsecureAuth: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onAuth: (a, _s, cb) => {
        smtpTokens.push(a.accessToken ?? '')
        return a.method === 'XOAUTH2' && a.accessToken === 'at-2' ? cb(null, { user: a.username }) : cb(null, { data: { status: '401', schemes: 'bearer' } })
      },
      onData: (stream, _s, cb) => {
        let raw = ''
        stream.on('data', (c) => (raw += c))
        stream.on('end', () => (delivered.push(raw), cb()))
      }
    })
    await new Promise<void>((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r))
  })

  afterAll(async () => {
    await new Promise<void>((r) => imap.close(() => r()))
    await new Promise<void>((r) => smtp.close(() => r()))
  })

  it('needs a client id, then signs in with PKCE and adds Gmail + Google Calendar', async () => {
    await expect(accounts.signInWithProvider('google')).rejects.toThrow(/NEEDS_CLIENT/)
    expect(() => oauth.setOAuthClient('google', 'not-a-client')).toThrow(/googleusercontent/)
    oauth.setOAuthClient('google', '123-abc.apps.googleusercontent.com', 'desktop-secret')
    expect(oauth.getOAuthClients().google).toMatchObject({ clientId: '123-abc.apps.googleusercontent.com', hasSecret: true, builtIn: false })

    const added = await accounts.signInWithProvider('google')
    expect(added.map((a) => a.kind).sort()).toEqual(['caldav', 'mail'])
    expect(added.every((a) => a.email === 'oauth@example.com')).toBe(true)
    const tokenCall = new URLSearchParams(hits.find((x) => x.path === '/oauth/token')!.body)
    expect(tokenCall.get('client_secret')).toBe('desktop-secret')
    // refresh token is stored encrypted, never in config
    const row = get<{ secret: string; config: string }>("SELECT secret, config FROM accounts WHERE kind = 'mail'")!
    expect(row.config).not.toContain('rt-1')
    expect(row.secret).not.toContain('rt-1')
    run("DELETE FROM jobs WHERE type = 'account_sync'") // don't contact the real Google servers

    // signing in again with the same address reuses the accounts
    expect((await accounts.signInWithProvider('google')).map((a) => a.id).sort()).toEqual(added.map((a) => a.id).sort())
    expect(all('SELECT id FROM accounts')).toHaveLength(2)
    run("DELETE FROM jobs WHERE type = 'account_sync'")
  })

  it('syncs and sends with XOAUTH2, refreshing a rejected token, and reports a revoked sign-in', async () => {
    oauth.setOAuthClient('google', '123-abc.apps.googleusercontent.com', 'desktop-secret')
    const [mailAcc] = (await accounts.signInWithProvider('google')).filter((a) => a.kind === 'mail')
    run("DELETE FROM jobs WHERE type = 'account_sync'")
    const local: MailAccountConfig = {
      imap: { host: '127.0.0.1', port: IMAP_PORT, secure: false, user: 'oauth@example.com' },
      smtp: { host: '127.0.0.1', port: SMTP_PORT, secure: false, user: 'oauth@example.com' },
      syncDays: 30,
      appendSent: false,
      oauth: 'google'
    }
    accounts.updateAccount(mailAcc.id, { config: local })

    // the token from sign-in (at-1) is refused by the server → cache dropped → refresh gives at-2
    await expect(accounts.syncMailAccount(mailAcc.id)).rejects.toThrow()
    expect(accounts.listAccounts().find((a) => a.id === mailAcc.id)!.last_error).toMatch(/Sign in again/)
    expect(await accounts.syncMailAccount(mailAcc.id)).toEqual({ added: 1 })
    expect(new URLSearchParams(hits.filter((x) => x.path === '/oauth/token').at(-1)!.body).get('grant_type')).toBe('refresh_token')

    send.queueEmail({ account_id: mailAcc.id, to: 'ana@client.com', subject: 'Re: Hi there', body: 'Hello back' })
    await processJobs()
    expect(smtpTokens.at(-1)).toBe('at-2')
    expect(delivered.at(-1)).toContain('Hello back')

    // Google CalDAV sends the account's token (from sign-in) as a bearer header
    const calAcc = accounts.listAccounts().find((a) => a.kind === 'caldav')!
    accounts.updateAccount(calAcc.id, { config: { url: `${base}/caldav/`, user: 'oauth@example.com', oauth: 'google' } as CalDavConfig })
    await expect(cal.testCalDavAccount(calAcc.id)).rejects.toThrow()
    expect(hits.find((x) => x.path.startsWith('/caldav'))!.headers.authorization).toBe('Bearer at-1')

    // revoked access: refresh fails with invalid_grant
    oauth.forgetAccessToken(mailAcc.id)
    refreshResult = 'invalid_grant'
    await expect(accounts.syncMailAccount(mailAcc.id)).rejects.toThrow(/expired or was revoked/)
  })
})

// ---------------------------------------------------------------- calendar export

describe('.ics export', () => {
  it('exports events and due tasks with escaping and line folding', () => {
    const today = localDate()
    const calId = cal.listCalendars()[0]?.id ?? (cal.listEvents(today, addDays(today, 1)), cal.listCalendars()[0].id)
    cal.createEvent({ calendar_id: calId, title: 'Review; budget, Q4', start: `${today}T10:00`, end: `${today}T11:00`, all_day: false, description: 'Line 1\nLine 2 ' + 'x'.repeat(100) })
    t.createTask({ list_id: listId, title: 'Send report', due_date: addDays(today, 2) })
    const ics = cal.calendarIcs(addDays(today, -1), addDays(today, 7), { includeTasks: true })
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
    expect(ics).toContain('SUMMARY:Review\\; budget\\, Q4')
    expect(ics).toContain(`DTSTART;VALUE=DATE:${addDays(today, 2).replace(/-/g, '')}`)
    expect(ics).toContain('SUMMARY:Due: Send report')
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true)
    expect(ics).toContain('\r\n ') // the long description was folded
  })
})
