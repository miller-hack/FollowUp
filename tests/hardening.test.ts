import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { isAppDate, isAppDateTime } from '@shared/dates'
import { all, closeDb, get, openDb } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as meta from '../src/main/services/meta'
import * as notify from '../src/main/services/notify'
import * as cal from '../src/main/services/calendar'
import { TOOL_BY_NAME } from '../src/main/services/ai/tools'
// resolve CommonJS test servers from the project root (import.meta trips vitest's mock hoisting here)
const requireCjs = createRequire(`${process.cwd()}/package.json`)

let listId = ''
let spaceId = ''
beforeEach(() => {
  closeDb()
  openDb(':memory:')
  const s = h.createSpace({ name: 'Work' })
  spaceId = s.id
  listId = h.createList({ space_id: s.id, name: 'Inbox' }).id
})

// ---------------------------------------------------------------- H5 / L1 / L2: validation at the service boundary

describe('date validation', () => {
  it('accepts only real app dates', () => {
    for (const ok of ['2026-10-16', '2026-02-28T23:59', '2024-02-29']) expect(isAppDate(ok)).toBe(true)
    for (const bad of ['next Tuesday', '2026-02-30', '2026-13-01', '0002-10-16', '2026-10-16T24:00', '2026-10-16 14:30', '', null, 42])
      expect(isAppDate(bad)).toBe(false)
    expect(isAppDateTime('2026-10-16')).toBe(false)
    expect(isAppDateTime('2026-10-16T09:00')).toBe(true)
  })

  it('rejects free-text dates on tasks, reminders and events', () => {
    expect(() => t.createTask({ list_id: listId, title: 'x', due_date: 'next Tuesday' })).toThrow(/Due date must be a date/)
    const task = t.createTask({ list_id: listId, title: 'x', due_date: '2026-10-20' })
    expect(() => t.updateTask(task.id, { start_date: 'tomorrow' })).toThrow(/Start date/)
    expect(t.updateTask(task.id, { due_date: null }).due_date).toBeNull()
    expect(() => notify.createReminder({ title: 'x', remind_at: 'in an hour' })).toThrow(/reminder time/)
    const calId = cal.listCalendars()[0].id
    expect(() => cal.createEvent({ calendar_id: calId, title: 'x', start: '2026-10-20', end: '2026-10-20', all_day: false })).toThrow(/date and time/)
    expect(cal.createEvent({ calendar_id: calId, title: 'x', start: '2026-10-20', end: '2026-10-20', all_day: true }).all_day).toBe(true)
  })

  it('surfaces the validation message to the AI as a tool error', () => {
    const tool = TOOL_BY_NAME.get('create_task')!
    const input = tool.validate({ list_id: listId, title: 'Call Sam', due_date: 'next Tuesday' })
    expect(input.ok).toBe(true)
    expect(() => tool.run((input as { data: Record<string, unknown> }).data)).toThrow(/Due date must be a date like/)
  })
})

describe('task structure validation', () => {
  it('refuses parent cycles and moves a task into its new parent list', () => {
    const a = t.createTask({ list_id: listId, title: 'A' })
    const b = t.createTask({ list_id: listId, title: 'B', parent_id: a.id })
    const c = t.createTask({ list_id: listId, title: 'C', parent_id: b.id })
    expect(() => t.updateTask(a.id, { parent_id: c.id })).toThrow(/own subtasks/)
    expect(() => t.updateTask(a.id, { parent_id: a.id })).toThrow(/own parent/)
    expect(() => t.updateTask(a.id, { parent_id: 'nope' })).toThrow(/Parent task not found/)

    const other = h.createList({ space_id: spaceId, name: 'Other' })
    const x = t.createTask({ list_id: other.id, title: 'X' })
    expect(t.updateTask(x.id, { parent_id: a.id }).list_id).toBe(listId)
    // deleting still terminates and removes the whole subtree
    t.deleteTasks([a.id])
    expect(get('SELECT 1 FROM tasks WHERE id IN (?, ?, ?, ?)', a.id, b.id, c.id, x.id)).toBeUndefined()
  })

  it('maps a status from another space by name', () => {
    const other = h.createSpace({ name: 'Personal' })
    const foreignDone = h.getTree().statuses.find((s) => s.space_id === other.id && s.name === 'Done')!
    const task = t.createTask({ list_id: listId, title: 'x' })
    const updated = t.updateTask(task.id, { status_id: foreignDone.id })
    const status = h.getTree().statuses.find((s) => s.id === updated.status_id)!
    expect(status.space_id).toBe(spaceId)
    expect(status.name).toBe('Done')
    expect(updated.completed_at).not.toBeNull()
  })

  it('rejects empty tag names', () => {
    expect(() => meta.createTag({ name: '   ' })).toThrow(/tag a name/)
    const tag = meta.createTag({ name: 'ok' })
    expect(() => meta.updateTag(tag.id, { name: '' })).toThrow(/tag a name/)
  })
})

// ---------------------------------------------------------------- M7 / M8: maintenance and migration 7

describe('maintenance', () => {
  it('prunes old rows, keeps recent ones, removes orphans and repairs bad dates', async () => {
    const { run, all } = await import('../src/main/db')
    const { runMaintenance } = await import('../src/main/services/maintenance')
    const old = new Date(Date.now() - 500 * 86_400_000).toISOString()
    const fresh = new Date().toISOString()
    run("INSERT INTO notifications (id, kind, title, read_at, created_at) VALUES ('n-old', 'due', 'old', ?, ?)", old, old)
    run("INSERT INTO notifications (id, kind, title, read_at, created_at) VALUES ('n-unread', 'due', 'unread', NULL, ?)", old)
    run("INSERT INTO notifications (id, kind, title, read_at, created_at) VALUES ('n-new', 'due', 'new', ?, ?)", fresh, fresh)
    run('INSERT INTO notify_log (key, created_at) VALUES (?, ?), (?, ?)', 'old', old, 'new', fresh)
    run('INSERT INTO automation_fired (key, created_at) VALUES (?, ?)', 'old', old)
    run("INSERT INTO jobs (id, type, payload, run_at, status, updated_at) VALUES ('j1', 'x', '{}', ?, 'failed', ?)", old, old)
    run("INSERT INTO activity_log (id, entity_type, entity_id, action) VALUES ('a1', 'task', 'gone', 'created')")
    run("INSERT INTO tasks_fts (task_id, title, body) VALUES ('gone', 'ghost', '')")
    const task = t.createTask({ list_id: listId, title: 'legacy' })
    run("UPDATE tasks SET due_date = 'next Tuesday' WHERE id = ?", task.id)

    const r = runMaintenance()
    expect(all<{ id: string }>('SELECT id FROM notifications ORDER BY id').map((x) => x.id)).toEqual(['n-new', 'n-unread'])
    expect(all('SELECT key FROM notify_log')).toEqual([{ key: 'new' }])
    expect(all('SELECT * FROM automation_fired')).toHaveLength(0)
    expect(all('SELECT * FROM jobs')).toHaveLength(0)
    expect(get("SELECT 1 FROM activity_log WHERE id = 'a1'")).toBeUndefined()
    expect(get("SELECT 1 FROM tasks_fts WHERE task_id = 'gone'")).toBeUndefined()
    expect(t.getTask(task.id)!.due_date).toBeNull()
    expect(t.getTask(task.id)!.activity.some((a) => a.action === 'repaired')).toBe(true)
    expect(r.repairedDates).toBe(1)
  })

  it('migration 7 adds the hot-path indexes and the automated-mail flag', () => {
    const idx = (get<{ n: number }>("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND name IN ('idx_messages_uid','idx_comments_task','idx_checklists_task','idx_attachments_task','idx_email_links_task','idx_notifications_created','idx_activity_created')")?.n)
    expect(idx).toBe(7)
    expect(get("SELECT 1 FROM pragma_table_info('mail_messages') WHERE name = 'is_auto'")).toBeTruthy()
  })
})

// ---------------------------------------------------------------- H1 / H3: untrusted attachments

describe('attachments', () => {
  it('builds safe file names', async () => {
    const { safeName } = await import('../src/main/services/mail/store')
    expect(safeName('..')).toBe('attachment')
    expect(safeName('.')).toBe('attachment')
    expect(safeName('')).toBe('attachment')
    expect(safeName(undefined)).toBe('attachment')
    expect(safeName('a/b\\c:d.txt')).toBe('a_b_c_d.txt')
    expect(safeName('CON.txt')).toBe('_CON.txt')
    expect(safeName('report.pdf. . ')).toBe('report.pdf')
    expect(safeName('x\u0007y.png')).toBe('xy.png')
    const long = safeName(`${'a'.repeat(300)}.docx`)
    expect(long.length).toBe(120)
    expect(long.endsWith('.docx')).toBe(true)
  })

  it('flags programs, scripts and shortcuts as dangerous', async () => {
    const { isDangerousFile } = await import('../src/main/services/mail/store')
    for (const n of ['invoice.exe', 'INVOICE.PDF.EXE', 'run.js', 'x.hta', 'link.lnk', 'setup.msi', 'disk.iso', 'a.ps1', 'b.bat', 'trailing.exe. '])
      expect(isDangerousFile(n), n).toBe(true)
    for (const n of ['report.pdf', 'photo.jpg', 'sheet.xlsx', 'notes.txt', 'noext']) expect(isDangerousFile(n), n).toBe(false)
  })

  it('stores same-named and crafted-name attachments separately, with Mark of the Web', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, relative } = await import('node:path')
    const store = await import('../src/main/services/mail/store')
    const { createAccount } = await import('../src/main/services/mail/accounts')
    const { all } = await import('../src/main/db')
    const dir = mkdtempSync(join(tmpdir(), 'followup-att-'))
    store.setMailDataDir(dir)
    const acc = createAccount({
      kind: 'mail', name: 'Me', email: 'me@example.com', password: 'x',
      config: { imap: { host: 'h', port: 993, secure: true, user: 'me' }, smtp: { host: 'h', port: 465, secure: true, user: 'me' }, syncDays: 30, appendSent: true }
    })
    const mk = (filename: string, body: string) => ({ filename, mime: 'text/plain', size: body.length, content: Buffer.from(body) })
    store.storeMessage(
      acc.id,
      {
        messageId: '<m1@x>', inReplyTo: null, references: [], from: { name: 'A', address: 'a@x.com' }, to: [], cc: [],
        subject: 'files', date: new Date().toISOString(), text: 'hi', html: null, auto: false,
        attachments: [mk('image.png', 'first'), mk('image.png', 'second'), mk('..', 'dots'), mk('', 'empty')]
      },
      { accountEmail: 'me@example.com', folder: 'INBOX', uid: 1, seen: false, inInbox: true }
    )
    const rows = all<{ stored_path: string; filename: string }>('SELECT stored_path, filename FROM mail_attachments ORDER BY rowid')
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((r) => r.stored_path)).size).toBe(4)
    expect(rows.map((r) => readFileSync(r.stored_path, 'utf8'))).toEqual(['first', 'second', 'dots', 'empty'])
    for (const r of rows) expect(relative(dir, r.stored_path).startsWith('..')).toBe(false)
    if (process.platform === 'win32') {
      for (const r of rows) expect(readFileSync(`${r.stored_path}:Zone.Identifier`, 'utf8')).toContain('ZoneId=3')
    }
  })
})

// ---------------------------------------------------------------- H3 / M5: sync isolation and automated mail

describe('mail sync isolation', () => {
  it('skips a message that cannot be stored and keeps syncing the rest', async () => {

    const store = await import('../src/main/services/mail/store')
    const accounts = await import('../src/main/services/mail/accounts')
    const hoodiecrow = requireCjs('hoodiecrow-imap')
    const port = 22400 + Math.floor(Math.random() * 400)
    const msg = (subject: string, id: string) =>
      ({ raw: `From: ana@client.com\r\nTo: me@example.com\r\nSubject: ${subject}\r\nMessage-ID: <${id}>\r\nDate: ${new Date().toUTCString()}\r\n\r\nHello`, flags: [] })
    const server = hoodiecrow({
      plugins: ['ID', 'UNSELECT', 'ENABLE', 'SPECIAL-USE', 'UIDPLUS', 'AUTH-PLAIN', 'NAMESPACE', 'LITERALPLUS'],
      users: { me: { password: 'pw' } },
      storage: { INBOX: { messages: [msg('One', 'a@x'), msg('Broken', 'b@x'), msg('Three', 'c@x')] }, '': { separator: '/', folders: {} } }
    })
    await new Promise<void>((r) => server.listen(port, r))
    try {
      const acc = accounts.createAccount({
        kind: 'mail', name: 'Me', email: 'me@example.com', password: 'pw',
        config: { imap: { host: '127.0.0.1', port, secure: false, user: 'me' }, smtp: { host: '127.0.0.1', port: 1, secure: false, user: 'me' }, syncDays: 30, appendSent: false }
      })
      const real = store.storeMessage
      const spy = vi.spyOn(store, 'storeMessage').mockImplementation((a, m, meta) => {
        if (m.subject === 'Broken') throw new Error('disk full')
        return real(a, m, meta)
      })
      expect(await accounts.syncMailAccount(acc.id)).toEqual({ added: 2 })
      expect(accounts.listAccounts()[0].last_error).toMatch(/Skipped 1 message/)
      // the broken message is not retried forever
      expect(await accounts.syncMailAccount(acc.id)).toEqual({ added: 0 })
      spy.mockRestore()
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('flags auto-replies, lists and robots as automated mail', async () => {
    const { parseRaw } = await import('../src/main/services/mail/store')
    const raw = (extra: string, from = 'ana@client.com') =>
      Buffer.from(`From: ${from}\r\nTo: me@example.com\r\nSubject: Hi\r\nMessage-ID: <${Math.random()}@x>\r\n${extra}\r\nHello`)
    expect((await parseRaw(raw(''))).auto).toBe(false)
    expect((await parseRaw(raw('Auto-Submitted: no\r\n'))).auto).toBe(false)
    expect((await parseRaw(raw('Auto-Submitted: auto-replied\r\n'))).auto).toBe(true)
    expect((await parseRaw(raw('Precedence: bulk\r\n'))).auto).toBe(true)
    expect((await parseRaw(raw('List-Id: <news.example.com>\r\n'))).auto).toBe(true)
    expect((await parseRaw(raw('X-Auto-Response-Suppress: All\r\n'))).auto).toBe(true)
    expect((await parseRaw(raw('', 'MAILER-DAEMON@mx.example.com'))).auto).toBe(true)
    expect((await parseRaw(raw('', 'noreply@service.com'))).auto).toBe(true)
  })
})

// ---------------------------------------------------------------- H4: at-most-once sending

describe('sending', () => {
  it('marks an email sent as soon as the server accepts it, even if storing the copy fails', async () => {
    const { SMTPServer } = await import('smtp-server')
    const store = await import('../src/main/services/mail/store')
    const accounts = await import('../src/main/services/mail/accounts')
    const send = await import('../src/main/services/mail/send')
    const { processJobs } = await import('../src/main/services/jobs')
    const delivered: string[] = []
    const port = 22900 + Math.floor(Math.random() * 300)
    const smtp = new SMTPServer({
      authOptional: true, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
      onAuth: (_a, _s, cb) => cb(null, { user: 'me' }),
      onData: (stream, _s, cb) => {
        let raw = ''
        stream.on('data', (c) => (raw += c))
        stream.on('end', () => (delivered.push(raw), cb()))
      }
    })
    await new Promise<void>((r) => smtp.listen(port, '127.0.0.1', r))
    try {
      const acc = accounts.createAccount({
        kind: 'mail', name: 'Me', email: 'me@example.com', password: 'pw',
        config: { imap: { host: '127.0.0.1', port: 1, secure: false, user: 'me' }, smtp: { host: '127.0.0.1', port, secure: false, user: 'me' }, syncDays: 30, appendSent: false }
      })
      const { run } = await import('../src/main/db')
      run("DELETE FROM jobs WHERE type = 'account_sync'")
      const spy = vi.spyOn(store, 'storeMessage').mockImplementation(() => {
        throw new Error('disk full')
      })
      const o = send.queueEmail({ account_id: acc.id, to: 'Ana <ana@client.com>', subject: 'Hi', body: 'Hello' })
      await processJobs()
      spy.mockRestore()
      expect(delivered).toHaveLength(1)
      expect(get<{ status: string }>('SELECT status FROM outbox WHERE id = ?', o.id)?.status).toBe('sent')
      // a retry of the same job (e.g. after a crash) never sends again
      const { enqueue } = await import('../src/main/services/jobs')
      enqueue('mail_send', { outboxId: o.id })
      await processJobs()
      expect(delivered).toHaveLength(1)
    } finally {
      await new Promise<void>((r) => smtp.close(() => r()))
    }
  })
})

// ---------------------------------------------------------------- M5: automated-mail loop protection

describe('email automation loop protection', () => {
  it('never auto-replies to automated mail and replies to a sender at most once a day', async () => {
    const store = await import('../src/main/services/mail/store')
    const accounts = await import('../src/main/services/mail/accounts')
    const auto = await import('../src/main/services/automation')
    const { emit } = await import('../src/main/services/events')
    const { processJobs } = await import('../src/main/services/jobs')
    const { all, run } = await import('../src/main/db')
    const acc = accounts.createAccount({
      kind: 'mail', name: 'Me', email: 'me@example.com', password: 'pw',
      config: { imap: { host: 'h', port: 993, secure: true, user: 'me' }, smtp: { host: 'h', port: 465, secure: true, user: 'me' }, syncDays: 30, appendSent: false }
    })
    run("DELETE FROM jobs WHERE type = 'account_sync'")
    const rule = auto.createAutomation({
      name: 'Thanks', enabled: true, scope: null, trigger: { type: 'email_received' }, conditions: [],
      actions: [{ type: 'reply_to_email', body: 'Thanks, got it!' }]
    })
    const receive = (id: string, isAuto: boolean) => {
      const r = store.storeMessage(
        acc.id,
        { messageId: `<${id}>`, inReplyTo: null, references: [], from: { name: 'Bot', address: 'ana@client.com' }, to: [{ name: '', address: 'me@example.com' }], cc: [], subject: `Msg ${id}`, date: new Date().toISOString(), text: 'hi', html: null, auto: isAuto, attachments: [] },
        { accountEmail: 'me@example.com', folder: 'INBOX', uid: null, seen: false, inInbox: true }
      )
      emit({ type: 'mail.received', threadId: r.threadId, messageId: r.messageRowId })
    }
    receive('auto-1@x', true)
    receive('real-1@x', false)
    receive('real-2@x', false)
    // run the automation jobs only (sending isn't under test here)
    run("UPDATE jobs SET run_at = '9999-01-01' WHERE type <> 'automation'")
    await processJobs()
    expect(all('SELECT id FROM outbox')).toHaveLength(1)
    const details = auto.listAutomationRuns(rule.id).flatMap((r) => r.detail).join('\n')
    expect(details).toMatch(/automated message/)
    expect(details).toMatch(/already emailed ana@client.com today/)
  })
})

// ---------------------------------------------------------------- M3 / M4: follow-ups

describe('email addresses', () => {
  it('parses Name <address> recipients', async () => {
    const { parseAddress } = await import('../src/main/services/mail/templates')
    expect(parseAddress('Ana Lima <Ana@Client.com>')).toEqual({ name: 'Ana Lima', address: 'ana@client.com' })
    expect(parseAddress('"Lima, Ana" <ana@client.com>')).toEqual({ name: 'Lima, Ana', address: 'ana@client.com' })
    expect(parseAddress(' bob@x.com ')).toEqual({ name: '', address: 'bob@x.com' })
  })
})

// ---------------------------------------------------------------- M1 / M2: calendars

describe('calendar sync and recurrence', () => {
  it('keeps syncing when the server refuses one local event', async () => {
    const accounts = await import('../src/main/services/mail/accounts')
    const { run } = await import('../src/main/db')
    let ctag = '1'
    const created: { url: string; etag: string; data: string }[] = []
    const remoteIcs = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\nBEGIN:VEVENT\r\nUID:remote@t\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T100000Z\r\nDTEND:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T110000Z\r\nSUMMARY:From server\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
    cal.setDavClientFactory(async () =>
      ({
        fetchCalendars: async () => [{ url: 'https://dav.test/cal1/', displayName: 'Work', ctag, components: ['VEVENT'] }],
        createCalendarObject: async ({ iCalString, filename }: { iCalString: string; filename: string }) => {
          if (iCalString.includes('Refused')) return new Response('nope', { status: 403 })
          created.push({ url: `https://dav.test/cal1/${filename}`, etag: '"e1"', data: iCalString })
          return new Response('', { status: 201, headers: { etag: '"e1"' } })
        },
        updateCalendarObject: async () => new Response('', { status: 204 }),
        deleteCalendarObject: async () => new Response('', { status: 204 }),
        fetchCalendarObjects: async () => [{ url: 'https://dav.test/cal1/remote.ics', etag: '"r1"', data: remoteIcs }, ...created]
      }) as never
    )
    try {
      const acc = accounts.createAccount({ kind: 'caldav', name: 'Cal', email: 'me@dav.test', password: 'pw', config: { url: 'https://dav.test/', user: 'me' } })
      run("DELETE FROM jobs WHERE type = 'account_sync'")
      await cal.syncCalDav(acc.id)
      const davCal = cal.listCalendars().find((c) => c.account_id === acc.id)!
      const day = new Date().toISOString().slice(0, 10)
      cal.createEvent({ calendar_id: davCal.id, title: 'Refused meeting', start: `${day}T13:00`, end: `${day}T14:00`, all_day: false })
      cal.createEvent({ calendar_id: davCal.id, title: 'Good meeting', start: `${day}T15:00`, end: `${day}T16:00`, all_day: false })
      ctag = '2'
      await cal.syncCalDav(acc.id) // must not throw
      const rows = all<{ title: string; dirty: number; href: string | null }>('SELECT title, dirty, href FROM calendar_events ORDER BY title')
      expect(rows.find((r) => r.title === 'Good meeting')).toMatchObject({ dirty: 0 })
      expect(rows.find((r) => r.title === 'Refused meeting')).toMatchObject({ dirty: 1, href: null })
      expect(rows.some((r) => r.title === 'From server')).toBe(true)
      expect(accounts.listAccounts().find((a) => a.id === acc.id)!.last_error).toMatch(/Couldn't upload 1 event .*Refused meeting/)
    } finally {
      cal.setDavClientFactory(null)
    }
  })

  it('shows today\'s occurrence of a daily series that started years ago', async () => {
    const { run } = await import('../src/main/db')
    const calId = cal.listCalendars()[0].id
    const raw = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\nBEGIN:VEVENT\r\nUID:daily@t\r\nDTSTAMP:20150101T000000Z\r\nDTSTART:20150101T090000Z\r\nDTEND:20150101T093000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    run(
      "INSERT INTO calendar_events (id, calendar_id, uid, title, start, end, all_day, rrule, raw) VALUES ('ev1', ?, 'daily@t', 'Standup', '2015-01-01T09:00', '2015-01-01T09:30', 0, 'FREQ=DAILY', ?)",
      calId,
      raw
    )
    const { addDays, localDate } = await import('@shared/dates')
    const today = localDate()
    const events = cal.listEvents(today, addDays(today, 1)).filter((e) => e.event_id === 'ev1')
    expect(events).toHaveLength(1)
    expect(events[0].start.slice(0, 10)).toBe(today)
  })
})

// ---------------------------------------------------------------- M6 / M9: cleanup and export

describe('cleanup and export', () => {
  it('removes attachment files when a task, list or space is deleted', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { run } = await import('../src/main/db')
    const root = mkdtempSync(join(tmpdir(), 'followup-files-'))
    const attach = (taskId: string) => {
      const dir = join(root, taskId)
      mkdirSync(dir, { recursive: true })
      const p = join(dir, `${taskId}.txt`)
      writeFileSync(p, 'x')
      run("INSERT INTO attachments (id, task_id, file_name, mime, size, stored_path) VALUES (?, ?, 'f.txt', 'text/plain', 1, ?)", `a-${taskId}`, taskId, p)
      return p
    }
    const parent = t.createTask({ list_id: listId, title: 'P' })
    const child = t.createTask({ list_id: listId, title: 'C', parent_id: parent.id })
    const [pf, cf] = [attach(parent.id), attach(child.id)]
    t.deleteTasks([parent.id])
    expect(existsSync(pf) || existsSync(cf)).toBe(false)

    const other = h.createList({ space_id: spaceId, name: 'Other' })
    const lf = attach(t.createTask({ list_id: other.id, title: 'L' }).id)
    h.deleteList(other.id)
    expect(existsSync(lf)).toBe(false)

    const sf = attach(t.createTask({ list_id: listId, title: 'S' }).id)
    h.deleteSpace(spaceId)
    expect(existsSync(sf)).toBe(false)
  })

  it('exports all user data but no secrets', async () => {
    const { buildExport } = await import('../src/main/services/exporter')
    const auto = await import('../src/main/services/automation')
    const { setAiKey } = await import('../src/main/services/ai/providers')
    const integ = await import('../src/main/services/integrations')
    setAiKey('anthropic', 'sk-ant-secret-value')
    auto.createAutomation({ name: 'Rule', enabled: true, scope: null, trigger: { type: 'task_created' }, conditions: [], actions: [{ type: 'set_priority', priority: 'high' }] })
    integ.createIntegration({ kind: 'teams_webhook', name: 'Teams', config: { mirrorNotifications: false }, secret: 'https://prod.logic.azure.com/workflows/secret-token' })
    const calId = cal.listCalendars()[0].id
    cal.createEvent({ calendar_id: calId, title: 'Local event', start: '2026-10-20T10:00', end: '2026-10-20T11:00', all_day: false })
    const out = buildExport()
    const text = JSON.stringify(out)
    expect(out.data.automations).toHaveLength(1)
    expect(out.data.calendar_events).toHaveLength(1)
    expect(out.data.integrations).toHaveLength(1)
    expect(text).not.toContain('secret:')
    expect(text).not.toContain('secret-token')
    expect(text).not.toContain('sk-ant')
  })
})
