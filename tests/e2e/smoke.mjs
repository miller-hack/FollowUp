// End-to-end smoke test: launches the built app with a throwaway data folder,
// walks through the main screens and saves screenshots.
// Usage: npm run build && node tests/e2e/smoke.mjs [screenshotDir]
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { SMTPServer } from 'smtp-server'

const shots = process.argv[2] ?? join(tmpdir(), 'followup-shots')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'followup-e2e-'))
const errors = []

// ---- local mail servers (in-memory IMAP + SMTP) for the email steps
const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')
const IMAP_PORT = 21143
const SMTP_PORT = 21025
const now = new Date().toUTCString()
const htmlMail = [
  'From: Ana Lima <ana@client.com>', 'To: me@example.com', 'Subject: Proposal for Q4', 'Message-ID: <p1@client.com>', `Date: ${now}`,
  'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
  '<h2 style="color:#0a7">Hi there!</h2><p>Could you send the <b>Q4 proposal</b> by Friday?</p><img src="https://tracker.example.com/pixel.gif"><script>alert(1)</script>'
].join('\r\n')
const textMail = ['From: news@shop.com', 'To: me@example.com', 'Subject: Weekly deals', 'Message-ID: <n1@shop.com>', `Date: ${now}`, '', 'Big sale this week.'].join('\r\n')
// a program disguised as a PDF: the app must never launch it
const invoiceMail = [
  'From: billing@vendor.example', 'To: me@example.com', 'Subject: Invoice attached', 'Message-ID: <i1@vendor.example>', `Date: ${now}`,
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '',
  '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Please see the attached invoice.', '',
  '--b1', 'Content-Type: application/octet-stream; name="invoice.pdf.exe"', 'Content-Disposition: attachment; filename="invoice.pdf.exe"',
  'Content-Transfer-Encoding: base64', '', Buffer.from('MZ - not really a program').toString('base64'), '--b1--', ''
].join('\r\n')
// a picture shown inside the body (cid:): stored as a file, shown again when opened (ADR-010)
const LOGO_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const newsletterMail = [
  'From: Studio <hello@studio.example>', 'To: me@example.com', 'Subject: Monthly newsletter', 'Message-ID: <nl1@studio.example>', `Date: ${now}`,
  'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="r1"', '',
  '--r1', 'Content-Type: text/html; charset=utf-8', '', '<p>Our news</p><img alt="Studio logo" src="cid:logo@studio">', '',
  '--r1', 'Content-Type: image/png; name="logo.png"', 'Content-ID: <logo@studio>', 'Content-Disposition: inline; filename="logo.png"',
  'Content-Transfer-Encoding: base64', '', LOGO_PNG, '--r1--', ''
].join('\r\n')
const imap = hoodiecrow({
  plugins: ['ID', 'IDLE', 'UNSELECT', 'ENABLE', 'SPECIAL-USE', 'UIDPLUS', 'AUTH-PLAIN', 'NAMESPACE', 'MOVE', 'LITERALPLUS'],
  users: { me: { password: 'app-pass' } },
  storage: {
    INBOX: {
      messages: [
        { raw: newsletterMail, flags: ['\\Seen'] },
        { raw: invoiceMail, flags: ['\\Seen'] },
        { raw: htmlMail, flags: [] },
        { raw: textMail, flags: ['\\Seen'] }
      ]
    },
    '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] } } }
  }
})
await new Promise((r) => imap.listen(IMAP_PORT, r))
const delivered = []
const smtp = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  onAuth: (a, _s, cb) => (a.password === 'app-pass' ? cb(null, { user: a.username }) : cb(new Error('Invalid login'))),
  onData: (stream, _s, cb) => {
    let raw = ''
    stream.on('data', (c) => (raw += c))
    stream.on('end', () => (delivered.push(raw), cb()))
  }
})
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r))

// ---- fake Claude API: answers by request shape, streams like the real Messages API
const aiState = { listId: null, requests: 0 }
function fakeClaude(body) {
  const text = (t) => ({ blocks: [{ type: 'text', text: t }], stop: 'end_turn' })
  const json = (o) => text(JSON.stringify(o))
  const props = body.output_config?.format?.schema?.properties ?? {}
  if ('category' in props) return json({ category: 'action', priority: 1, summary: 'Ana needs the Q4 proposal by Friday.' })
  if ('next_steps' in props) return json({ summary: 'Set up, not started yet.', next_steps: ['Draft an outline'] })
  if ('subtasks' in props) return json({ subtasks: ['Collect requirements', 'Write first draft'] })
  if ('action_items' in props) return json({ summary: 'Ana asks for the **Q4 proposal** by Friday.', action_items: ['Send the Q4 proposal'] })
  if ('tasks' in props) return json({ tasks: [{ title: 'Send Q4 proposal to Ana', due_date: null }] })
  if ('tags' in props) return json({ title: 'Call Sam', due_date: '2030-01-15', priority: 'urgent', tags: ['sales'] })
  if (body.tools) {
    const last = body.messages.at(-1)
    const content = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }]
    if (content.some((b) => b.type === 'tool_result')) return text('Done: **Call Ana about Q4** is on your list.')
    const said = content.map((b) => b.text ?? '').join(' ')
    if (/create a task/i.test(said))
      return { blocks: [{ type: 'tool_use', id: 'toolu_1', name: 'create_task', input: { list_id: aiState.listId, title: 'Call Ana about Q4' } }], stop: 'tool_use' }
    return text('You have **2 tasks** due today.')
  }
  const sys = JSON.stringify(body.system ?? '')
  if (sys.includes('weekly review')) return text('**Wins**\n- Shipped the end-to-end tests\n\n**Plan for next week**\n- Send the Q4 proposal')
  if (sys.includes('draft email replies')) return text('Hi Ana,\n\nThe proposal will be with you on Friday.')
  return text('OK')
}
function sse(s) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let out = ev('message_start', { message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } })
  s.blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const part of b.text.match(/[\s\S]{1,6}/g) ?? []) out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: part } })
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    out += ev('content_block_stop', { index })
  })
  out += ev('message_delta', { delta: { stop_reason: s.stop, stop_sequence: null }, usage: { output_tokens: 30 } })
  return out + ev('message_stop', {})
}
const claude = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    aiState.requests++
    const body = JSON.parse(raw || '{}')
    const r = fakeClaude(body)
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(sse(r))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: r.blocks, stop_reason: r.stop, stop_sequence: null, usage: { input_tokens: 60, output_tokens: 12 } }))
    }
  })
})
await new Promise((r) => claude.listen(0, '127.0.0.1', r))
const CLAUDE_URL = `http://127.0.0.1:${claude.address().port}`

// ---- fake Slack incoming webhook
const slackPosts = []
const slack = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    slackPosts.push(JSON.parse(raw || '{}'))
    res.writeHead(200).end('ok')
  })
})
await new Promise((r) => slack.listen(0, '127.0.0.1', r))
const SLACK_HOOK = `http://127.0.0.1:${slack.address().port}/services/T0/B0/x`

const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLLOWUP_DATA_DIR: dataDir, ANTHROPIC_BASE_URL: CLAUDE_URL } })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  // the blocked tracking pixel is expected (that's the privacy protection working)
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('tracker.example.com') && errors.push(`console: ${m.text()}`))
  await page.setViewportSize({ width: 1400, height: 880 })
  const shot = async (name) => page.screenshot({ path: join(shots, `${name}.png`) })
  const step = async (name, fn) => {
    try {
      await fn()
      console.log(`ok ${name}`)
    } catch (e) {
      errors.push(`${name}: ${e.message.split('\n')[0]}`)
      await shot(`FAIL-${name.replace(/[^a-z0-9]+/gi, '-')}`).catch(() => {})
      // leave a clean slate for the next step
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      console.log(`FAIL ${name}`)
    }
  }

  await step('home renders', async () => {
    await page.locator('nav').getByText('Getting Started').waitFor({ timeout: 15000 })
    await page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor()
    await shot('01-home')
  })

  await step('list view', async () => {
    await page.locator('nav').getByText('Website Launch').click()
    await page.getByText('Design mockups').first().waitFor()
    await shot('02-list')
  })

  await step('quick add task', async () => {
    await page.keyboard.press('Control+n')
    await page.getByPlaceholder('Task name').fill('E2E created task')
    await page.keyboard.press('Enter')
    // must land in the list on screen (Website Launch), not the last-used list
    await page.getByRole('button', { name: 'E2E created task' }).first().waitFor()
  })

  await step('task panel', async () => {
    await page.getByRole('button', { name: 'E2E created task' }).first().click()
    await page.getByText('Subtasks').waitFor()
    await page.getByPlaceholder('Add subtask').fill('First subtask')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'First subtask' }).first().waitFor()
    await page.getByPlaceholder(/Write a comment/).fill('Looks good')
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await page.getByText('Looks good').waitFor()
    await shot('03-task-panel')
    await page.getByRole('button', { name: 'Close' }).first().click()
  })

  await step('board view', async () => {
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    await page.getByText('Add task').first().waitFor()
    await shot('04-board')
  })

  await step('board drag & drop', async () => {
    const card = page.locator('div.cursor-pointer', { hasText: 'Design mockups' }).first()
    const target = page.getByText('In Progress', { exact: true }).first()
    const from = await card.boundingBox()
    const to = await target.boundingBox()
    await page.mouse.move(from.x + 40, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 })
    await page.mouse.move(to.x + 40, to.y + 120, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const status = await page.evaluate(async () => {
      const tasks = await window.bridge.invoke('queryTasks', [{ search: 'Design mockups', includeClosed: true }])
      const tree = await window.bridge.invoke('getTree', [])
      return tree.statuses.find((s) => s.id === tasks[0].status_id).name
    })
    if (status !== 'In Progress') throw new Error(`status is ${status}`)
  })

  await step('calendar view', async () => {
    await page.getByRole('button', { name: 'Calendar', exact: true }).click()
    await page.locator('.fc-daygrid').waitFor()
    await shot('05-calendar')
  })

  await step('gantt view', async () => {
    await page.getByRole('button', { name: 'Gantt', exact: true }).click()
    await page.getByText('Drag bars to reschedule').waitFor()
    await shot('06-gantt')
  })

  await step('command palette search', async () => {
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('Search tasks, lists, commands' + '…').fill('mockups')
    await page.getByRole('button', { name: /Design mockups/ }).waitFor()
    await shot('07-palette')
    await page.keyboard.press('Escape')
  })

  // ---------------------------------------------------------------- Phase 2

  const invoke = (method, ...args) => page.evaluate(([m, a]) => window.bridge.invoke(m, a), [method, args])

  await step('time tracking: timer + manual entry', async () => {
    await page.locator('nav').getByText('Website Launch').click()
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await page.getByRole('button', { name: 'Build pages' }).first().click()
    await page.locator('aside').getByRole('button', { name: 'Start timer' }).click()
    await page.locator('aside').getByRole('button', { name: /Stop timer/ }).waitFor()
    // sidebar shows the running timer
    await page.locator('nav').getByText('Build pages').waitFor()
    await page.getByRole('button', { name: 'Add time' }).click()
    await page.getByLabel('Duration').first().fill('1h 30m')
    await page.getByRole('button', { name: 'Add entry' }).click()
    await page.getByText(/Time entries · 1h 30m/).waitFor()
    await shot('10-task-time')
    await page.getByRole('button', { name: 'Close' }).first().click()
    await page.locator('nav').getByRole('button', { name: /Stop timer/ }).click()
    const running = await invoke('getRunningTimer')
    if (running) throw new Error('timer still running')
  })

  await step('timesheet page', async () => {
    await page.getByRole('link', { name: 'Time tracking' }).click()
    await page.getByText('Build pages').first().waitFor()
    await page.getByText('1h 30m').first().waitFor()
    await shot('11-timesheet')
  })

  await step('sprint: create, add task, burndown', async () => {
    const work = page.locator('nav').getByText('Work', { exact: true })
    await work.hover()
    await work.locator('xpath=ancestor::div[contains(@class,"group")][1]').getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'New sprint' }).click()
    await page.getByRole('button', { name: 'Start sprint' }).click()
    await page.getByRole('button', { name: 'Complete sprint' }).waitFor()
    await page.keyboard.press('Control+n')
    await page.getByPlaceholder('Task name').fill('Sprint task')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Sprint task' }).first().waitFor()
    await page.getByText('0/1 done').first().waitFor()
    await shot('12-sprint')
  })

  await step('goals', async () => {
    await page.getByRole('link', { name: 'Goals' }).click()
    await page.getByRole('button', { name: 'New goal' }).click()
    await page.getByPlaceholder(/Launch the new website/).fill('Grow newsletter')
    await page.getByRole('button', { name: 'Create goal' }).click()
    await page.getByRole('button', { name: 'Add key result' }).click()
    await page.getByPlaceholder('Key result name').fill('Subscribers')
    await page.getByLabel('Target').fill('200')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByLabel('Current value').fill('50')
    await page.getByLabel('Current value').press('Enter')
    await page.getByText('25%').first().waitFor()
    await shot('13-goals')
  })

  await step('dashboard', async () => {
    await page.getByRole('link', { name: 'Dashboards' }).click()
    await page.getByText('Tasks by status').waitFor()
    await page.getByText('Time by list (7 days)').waitFor()
    await page.waitForTimeout(500)
    await shot('14-dashboard')
  })

  await step('reminder notification', async () => {
    const pad = (n) => String(n).padStart(2, '0')
    const d = new Date(Date.now() - 60_000)
    const at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    await invoke('createReminder', { title: 'E2E reminder', remind_at: at })
    // the scheduler ticks every 30 s
    await page.getByRole('button', { name: /Notifications \(\d+ unread\)/ }).waitFor({ timeout: 40_000 })
    await page.getByRole('button', { name: /Notifications \(/ }).click()
    await page.getByText('E2E reminder').first().waitFor()
    await shot('15-notifications')
    await page.keyboard.press('Escape')
  })

  // ---------------------------------------------------------------- Phase 3

  const waitFor = async (fn, what, ms = 8000) => {
    const end = Date.now() + ms
    for (;;) {
      if (await fn()) return
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
      await page.waitForTimeout(150)
    }
  }

  await step('automation from template fires', async () => {
    await page.getByRole('link', { name: 'Automations' }).click()
    await page.getByRole('button', { name: /Give new tasks a due date/ }).click()
    await page.getByRole('button', { name: 'Create automation' }).click()
    await page.getByText('Default due date').waitFor()
    const tree = await invoke('getTree')
    const task = await invoke('createTask', { list_id: tree.lists[0].id, title: 'Automated due date' })
    await waitFor(async () => (await invoke('getTask', task.id)).due_date !== null, 'due date to be set')
  })

  await step('custom automation built in the editor', async () => {
    await page.getByRole('button', { name: 'New automation' }).click()
    await page.getByPlaceholder(/Automation name/).fill('Thank-you note')
    await page.getByLabel('Trigger').selectOption('status_changed')
    // "to" status = Done
    await page.locator('select').filter({ hasText: 'any status' }).nth(1).selectOption('Done')
    await page.getByRole('button', { name: 'Add action' }).click()
    await page.getByPlaceholder('Comment text').fill('Finished on ')
    await page.getByRole('button', { name: '{{date.today}}' }).click()
    // dry run against a task
    await page.getByPlaceholder('Search tasks…').fill('Automated')
    await page.getByRole('button', { name: 'Automated due date' }).click()
    await page.getByRole('button', { name: 'Run test' }).click()
    await page.getByText('This automation would run.').waitFor()
    await shot('16-automation-editor')
    await page.getByRole('button', { name: 'Create automation' }).click()
    await page.getByText('Thank-you note').waitFor()
    await shot('17-automations')

    const [t] = await invoke('queryTasks', { search: 'Automated due date' })
    const tree = await invoke('getTree')
    const list = tree.lists.find((l) => l.id === t.list_id)
    const done = tree.statuses.find((s) => s.space_id === list.space_id && s.name === 'Done')
    await invoke('updateTask', t.id, { status_id: done.id })
    await waitFor(async () => (await invoke('getTask', t.id)).comments.some((c) => c.body.startsWith('Finished on 20')), 'automation comment')
  })

  await step('run history', async () => {
    await page.getByRole('button', { name: 'Run history' }).first().click()
    await page.getByText('Set due date to').first().waitFor()
    await shot('18-run-history')
    await page.keyboard.press('Escape')
  })

  // ---------------------------------------------------------------- Phase 4

  await step('add email account through settings', async () => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Email (app password)' }).click()
    await page.getByRole('dialog').getByLabel('Provider').selectOption('custom')
    await page.getByLabel('Email address').fill('me@example.com')
    await page.getByLabel('Your name (shown to recipients)').fill('Me Myself')
    await page.getByLabel(/App password/).fill('app-pass')
    for (const [k, port] of [['IMAP', IMAP_PORT], ['SMTP', SMTP_PORT]]) {
      await page.getByLabel(`${k} server`).fill('127.0.0.1')
      await page.getByLabel(`${k} port`).fill(String(port))
      await page.getByLabel(`${k} security`).selectOption('starttls')
    }
    await page.getByPlaceholder('Username (defaults to the email address)').fill('me')
    await page.getByRole('dialog').getByRole('button', { name: 'Test connection' }).click()
    await page.getByText('Receiving (IMAP):').waitFor()
    await page.getByText('Sending (SMTP):').waitFor()
    if (await page.getByText(/Sign-in failed|refused|not found/).count()) throw new Error('connection test failed')
    await shot('19-account-dialog')
    await page.getByRole('button', { name: 'Add account' }).click()
    await page.getByText(/Synced .* ago/).waitFor({ timeout: 20_000 })
  })

  await step('inbox shows synced mail safely', async () => {
    await page.getByRole('link', { name: /^Inbox/ }).click()
    await page.getByRole('button', { name: /Proposal for Q4/ }).click()
    await page.getByText('Remote images are hidden').waitFor()
    const frame = page.frameLocator('iframe[title="Email content"]')
    await frame.getByText('Could you send the').waitFor()
    if (await frame.locator('script').count()) throw new Error('script survived sanitising')
    await shot('20-inbox')
  })

  await step('pictures inside an email are shown from local files', async () => {
    await page.getByRole('button', { name: /Monthly newsletter/ }).click()
    const frame = page.frameLocator('iframe[title="Email content"]')
    await frame.getByText('Our news').waitFor()
    const src = await frame.getByAltText('Studio logo').getAttribute('src')
    if (src !== `data:image/png;base64,${LOGO_PNG}`) throw new Error(`inline image not resolved: ${String(src).slice(0, 60)}`)
    // the picture is part of the message, not a file to download
    if (await page.getByRole('button', { name: /logo\.png/ }).count()) throw new Error('inline image listed as an attachment')
    // kept once as a file next to the mail, not inside the database
    const mailDir = join(dataDir, 'mail')
    const inline = readdirSync(mailDir).flatMap((acc) => (existsSync(join(mailDir, acc, 'inline')) ? readdirSync(join(mailDir, acc, 'inline')) : []))
    if (inline.length !== 1) throw new Error(`expected one stored inline image, found ${inline.length}`)
  })

  await step('dangerous attachment is never launched', async () => {
    // stand-ins for the native warning and the OS "open" so nothing really runs
    await app.evaluate(({ dialog, shell }) => {
      globalThis.__gate = { asked: [], opened: [] }
      dialog.showMessageBoxSync = (...args) => (globalThis.__gate.asked.push(String((args.at(-1) ?? {}).message)), 1)
      shell.openPath = async (p) => (globalThis.__gate.opened.push(p), '')
    })
    await page.getByRole('button', { name: /Invoice attached/ }).click()
    await page.getByRole('button', { name: /invoice\.pdf\.exe/ }).click()
    await waitFor(async () => (await app.evaluate(() => globalThis.__gate.asked.length)) === 1, 'the warning dialog')
    const gate = await app.evaluate(() => globalThis.__gate)
    if (gate.opened.length) throw new Error(`a program was opened: ${gate.opened[0]}`)
    if (!gate.asked[0].includes('can run programs')) throw new Error(`unexpected warning: ${gate.asked[0]}`)
    await page.getByRole('button', { name: /Proposal for Q4/ }).click()
    await page.getByText('Remote images are hidden').waitFor()
  })

  await step('create a task from an email', async () => {
    await page.getByRole('button', { name: /Create task/ }).click()
    await page.getByRole('button', { name: /Website Launch/ }).click()
    await page.locator('aside').getByText('Email & calendar').waitFor()
    await page.locator('aside').getByText('Proposal for Q4').first().waitFor()
    await page.locator('aside').getByRole('button', { name: 'Block time' }).click()
    await page.getByText(/Added to calendar/).waitFor()
    await shot('21-task-from-email')
    await page.locator('aside', { hasText: 'Email & calendar' }).getByRole('button', { name: 'Close' }).click()
  })

  await step('reply from the app', async () => {
    delivered.length = 0
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await page.getByLabel('Message').fill('Sure, coming on Friday!')
    await shot('22-compose')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await waitFor(async () => delivered.length === 1, 'SMTP delivery', 15_000)
    if (!delivered[0].includes('In-Reply-To: <p1@client.com>')) throw new Error('reply not threaded')
    await page.getByText('Sure, coming on Friday!').first().waitFor()
  })

  await step('compose asks before discarding a draft', async () => {
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await page.getByLabel('Message').fill('Half-written thought')
    page.once('dialog', (d) => void d.dismiss())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (!(await page.getByLabel('Message').inputValue()).includes('Half-written')) throw new Error('the draft was lost')
    page.once('dialog', (d) => void d.accept())
    await page.keyboard.press('Escape')
    await page.getByLabel('Message').waitFor({ state: 'detached' })
  })

  await step('follow-up sequence', async () => {
    await page.getByRole('link', { name: 'Follow-ups' }).click()
    await page.getByRole('button', { name: 'New sequence' }).click()
    await page.getByPlaceholder(/Sequence name/).fill('Proposal nudge')
    await page.getByRole('button', { name: 'Save sequence' }).click()
    await page.getByText('Proposal nudge').waitFor()
    await page.getByRole('link', { name: /^Inbox/ }).click()
    await page.getByRole('button', { name: /Proposal for Q4/ }).click()
    await page.getByRole('button', { name: /Follow up/ }).click()
    await page.getByRole('button', { name: /Proposal nudge/ }).click()
    await page.getByText(/next email/).waitFor()
    await shot('23-thread-followup')
    await page.getByRole('link', { name: 'Follow-ups' }).click()
    await page.getByRole('button', { name: 'In progress' }).click()
    await page.getByText('ana@client.com').waitFor()
    await shot('24-followups')
  })

  await step('calendar', async () => {
    await page.getByRole('link', { name: 'Calendar' }).click()
    await page.locator('.fc-timegrid').waitFor()
    await page.getByRole('button', { name: 'New event' }).click()
    await page.getByPlaceholder('Event title').fill('Client call')
    await page.getByRole('button', { name: 'Save' }).click()
    // "New event" starts at the next full hour, which is next week late on a Sunday: the calendar must follow it
    await page.getByPlaceholder('Event title').waitFor({ state: 'detached' })
    const events = await invoke('listEvents', '2000-01-01', '2100-01-01')
    if (!events.some((e) => e.title === 'Client call')) throw new Error('new event missing')
    await page.locator('.fc-event', { hasText: 'Client call' }).waitFor()
    // moving it three weeks out from the dialog takes the calendar to that week
    await page.locator('.fc-event', { hasText: 'Client call' }).click()
    const later = new Date(Date.now() + 21 * 86_400_000)
    const laterDay = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`
    await page.getByLabel('Start', { exact: true }).fill(`${laterDay}T10:00`)
    await page.getByLabel('End', { exact: true }).fill(`${laterDay}T11:00`)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByPlaceholder('Event title').waitFor({ state: 'detached' })
    await page.locator(`.fc-timegrid-col[data-date="${laterDay}"] .fc-event`, { hasText: 'Client call' }).waitFor()
    await page.getByRole('button', { name: 'Today' }).click()
    // the time block for the email task (its due date may be next week)
    const blocks = await invoke('listEvents', '2000-01-01', '2100-01-01')
    if (!blocks.some((e) => e.title === 'Proposal for Q4' && e.task_id)) throw new Error('task time block missing')
    await shot('25-calendar')
  })

  await step('email automation editor', async () => {
    await page.getByRole('link', { name: 'Automations' }).click()
    await page.getByRole('button', { name: 'New automation' }).click()
    await page.getByLabel('Trigger').selectOption('email_received')
    await page.getByRole('button', { name: 'Add condition' }).click()
    await page.getByRole('button', { name: 'Add action' }).click()
    await page.getByLabel('Action', { exact: true }).selectOption('start_sequence')
    await page.getByText('{{email.from}}').count()
    await shot('26-email-automation')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  // ---------------------------------------------------------------- Phase 5 (AI, against the fake Claude server)

  await step('AI settings: key, test, sort inbox', async () => {
    await page.getByRole('link', { name: 'Settings' }).click()
    const ai = page.locator('#ai')
    await ai.getByLabel('Anthropic API key').fill('sk-ant-e2e-test')
    await ai.getByRole('button', { name: 'Save key' }).click()
    await ai.getByText('Key saved').waitFor()
    await ai.getByRole('button', { name: 'Test connection' }).click()
    await ai.getByText('Connected to claude-opus-5-5.').waitFor()
    await ai.getByRole('switch').click()
    await ai.getByRole('button', { name: 'Sort current inbox now' }).click()
    await shot('27-ai-settings')
  })

  await step('inbox: AI labels, summary, tasks, draft', async () => {
    await page.getByRole('link', { name: /^Inbox/ }).click()
    const row = page.getByRole('button', { name: /Proposal for Q4/ })
    await row.getByText('Needs action').waitFor({ timeout: 15_000 })
    await row.click()
    await page.locator('main').getByRole('button', { name: 'AI', exact: true }).click()
    await page.getByRole('button', { name: 'Summarize thread' }).click()
    await page.getByText('Action items').waitFor()
    await shot('28-inbox-ai')
    await page.locator('main').getByRole('button', { name: 'AI', exact: true }).click()
    await page.getByRole('button', { name: 'Find tasks in this email' }).click()
    await page.getByText('Send Q4 proposal to Ana').waitFor()
    await page.getByRole('button', { name: 'Create 1 task' }).click()
    await page.getByText('Created 1 task').waitFor()
    await page.locator('main').getByRole('button', { name: 'AI', exact: true }).click()
    await page.getByRole('button', { name: 'Draft a reply…' }).click()
    await page.getByRole('button', { name: 'Write draft' }).click()
    await waitFor(async () => (await page.getByLabel('Message').inputValue()).includes('with you on Friday'), 'AI draft in compose')
    await page.getByRole('button', { name: 'Discard' }).click()
  })

  await step('assistant chat with approval', async () => {
    const tree = await invoke('getTree')
    aiState.listId = tree.lists.find((l) => l.name === 'Website Launch')?.id ?? tree.lists[0].id
    await page.keyboard.press('Control+j')
    const panel = page.getByRole('complementary', { name: 'AI assistant' })
    await panel.getByLabel('Message the assistant').fill('Please create a task to call Ana about Q4')
    await page.keyboard.press('Enter')
    await panel.getByRole('button', { name: 'Approve', exact: true }).click()
    await panel.getByText('is on your list').waitFor()
    const found = await invoke('search', 'Call Ana about Q4')
    if (!found.tasks.length) throw new Error('approved task was not created')
    await shot('29-assistant')
    await page.keyboard.press('Control+j')
  })

  await step('task panel: AI subtasks', async () => {
    await page.locator('nav').getByText('Website Launch').click()
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await page.getByRole('button', { name: 'E2E created task' }).first().click()
    await page.locator('aside').getByRole('button', { name: 'AI', exact: true }).click()
    await page.getByRole('button', { name: 'Suggest subtasks' }).click()
    await page.getByText('Write first draft').waitFor()
    await page.getByRole('button', { name: 'Add 2 subtasks' }).click()
    await page.locator('aside').getByRole('button', { name: 'Collect requirements' }).waitFor()
    await shot('30-task-ai')
    await page.locator('aside').getByRole('button', { name: 'Close' }).first().click()
  })

  await step('quick add parsed by AI', async () => {
    await page.keyboard.press('Control+n')
    const input = page.getByPlaceholder(/Task name/)
    await input.fill('call Sam on Jan 15 2030, urgent #sales')
    await page.keyboard.press('Alt+Enter')
    await waitFor(async () => (await input.inputValue()) === 'Call Sam', 'parsed title')
    await page.getByText('sales').first().waitFor()
    await shot('31-quick-add-ai')
    await page.keyboard.press('Enter')
    await page.getByText('Created “Call Sam”').waitFor()
    const t = (await invoke('search', 'Call Sam')).tasks[0]
    const full = await invoke('getTask', t.id)
    if (full.priority !== 'urgent' || !full.due_date?.startsWith('2030-01-15')) throw new Error(`parsed fields not applied: ${full.priority} ${full.due_date}`)
  })

  await step('home weekly review', async () => {
    await page.getByRole('link', { name: 'Home' }).click()
    await page.getByRole('button', { name: 'Review my week' }).click()
    await page.getByText('Shipped the end-to-end tests').waitFor()
    await shot('32-weekly-review')
  })

  // ---------------------------------------------------------------- Phase 6 (integrations & release)

  await step('connect Slack and send a task to it', async () => {
    await page.getByRole('link', { name: 'Settings' }).click()
    const section = page.locator('#integrations')
    await section.getByRole('button', { name: 'Slack', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('https://hooks.slack.com/services/…').fill(SLACK_HOOK)
    await dialog.getByRole('button', { name: 'Send test message' }).click()
    await dialog.getByText('Test message sent').waitFor()
    await shot('33-slack-dialog')
    await dialog.getByRole('button', { name: 'Connect' }).click()
    await section.getByText('not used yet').waitFor()
    if (!slackPosts[0]?.text?.includes('FollowUp is connected')) throw new Error('test message not received')

    await page.locator('nav').getByText('Website Launch').click()
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await page.getByRole('button', { name: 'Design mockups' }).first().click()
    await page.locator('aside').getByRole('button', { name: 'Send to Slack / Teams' }).click()
    await page.getByRole('button', { name: 'Slack', exact: true }).click()
    await waitFor(async () => slackPosts.some((p) => p.text?.includes('*Design mockups*')), 'task posted to Slack')
    await page.locator('aside').getByRole('button', { name: 'Close' }).first().click()
  })

  await step('sign-in setup and updates section', async () => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Sign in with Google' }).click()
    await page.getByRole('dialog', { name: /Connect FollowUp to Google/ }).waitFor()
    await shot('34-google-setup')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await page.locator('#updates').getByText('development build').waitFor()
    await page.locator('#integrations').scrollIntoViewIfNeeded()
    await shot('35-settings-integrations')
  })

  await step('settings + dark mode', async () => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Dark' }).click()
    await page.waitForTimeout(300)
    await shot('08-settings-dark')
    await page.locator('nav').getByText('Website Launch').click()
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await page.waitForTimeout(300)
    await shot('09-list-dark')
  })

  await step('first close asks once; reopening brings the window back (ADR-009)', async () => {
    // stand-in for the native question: "Keep running in the background", "Don't ask me again" ticked
    await app.evaluate(({ dialog }) => {
      globalThis.__close = { asked: [] }
      dialog.showMessageBox = async (_win, opts) => (globalThis.__close.asked.push(opts.message), { response: 0, checkboxChecked: true })
    })
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
    const closeWindow = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closeWindow()
    await waitFor(async () => !(await visible()), 'the window to hide')
    const asked = await app.evaluate(() => globalThis.__close.asked)
    if (asked.length !== 1 || !asked[0].includes('Keep FollowUp running')) throw new Error(`unexpected close prompt: ${JSON.stringify(asked)}`)
    const s = await page.evaluate(() => window.bridge.invoke('getSettings', []))
    if (!s.closeToTray || !s.closeAsked) throw new Error('close choice not remembered')
    // clicking the Start-menu or desktop shortcut starts a second instance, which shows the window
    await app.evaluate(({ app: a }) => a.emit('second-instance', {}, [], ''))
    await waitFor(visible, 'the window to come back')
    await closeWindow()
    await waitFor(async () => !(await visible()), 'the window to hide again')
    if ((await app.evaluate(() => globalThis.__close.asked.length)) !== 1) throw new Error('asked again after "Don\'t ask me again"')
    await app.evaluate(({ app: a }) => a.emit('second-instance', {}, [], ''))
    await waitFor(visible, 'the window to come back again')
  })
} finally {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
  imap.close(() => {})
  smtp.close(() => {})
  claude.close()
  slack.close()
}

if (errors.length) {
  console.error('\nProblems:\n' + errors.map((e) => ` - ${e}`).join('\n'))
  process.exit(1)
}
console.log(`\nAll good. Screenshots in ${shots}`)

