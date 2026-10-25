// Screenshots for the README and the guide (docs/images).
//
//   npm run build && node scripts/docs-screenshots.mjs [outDir]
//
// Launches the built app with a throwaway data folder, fills it with a realistic
// demo workspace (fictional people on .example domains), local fake mail and AI
// servers, and saves one screenshot per screen. Nothing leaves this PC.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'docs/images')
mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'followup-docs-'))
const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')

// ---------------------------------------------------------------- demo mail (fake IMAP)

const ago = (min) => new Date(Date.now() - min * 60_000).toUTCString()
const mail = ({ from, to = 'Alex Morgan <alex@example.com>', subject, id, date, html, text, inReplyTo }) =>
  [
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${id}>`, `Date: ${date}`,
    ...(inReplyTo ? [`In-Reply-To: <${inReplyTo}>`, `References: <${inReplyTo}>`] : []),
    'MIME-Version: 1.0', `Content-Type: text/${html ? 'html' : 'plain'}; charset=utf-8`, '', html ?? text
  ].join('\r\n')

const inbox = [
  mail({
    from: 'Priya Shah <priya@northwind.example>', subject: 'Contract for the Q4 project', id: 'c1@northwind.example', date: ago(35),
    html: '<p>Hi Alex,</p><p>Thanks for the call today. Could you send the <b>signed contract</b> back by <b>Friday</b>? Legal needs it before we can schedule the kickoff.</p><p>Best,<br>Priya</p>'
  }),
  mail({
    from: 'Daniel Kim <daniel@studio.example>', subject: 'Re: Website launch timeline', id: 't2@studio.example', date: ago(120), inReplyTo: 't1@example.com',
    text: 'Hi Alex,\n\nThe mockups are almost done. Can we move the design review to Thursday 10:00?\n\nDaniel'
  }),
  mail({ from: 'Maya Chen <maya@example.org>', subject: 'Lunch next week?', id: 'l1@example.org', date: ago(60 * 20), text: 'Are you free for lunch on Tuesday or Wednesday?\n\nMaya' }),
  mail({ from: 'Cloudhost Billing <billing@cloudhost.example>', subject: 'Your invoice #4821 is ready', id: 'i1@cloudhost.example', date: ago(60 * 26), text: 'Your monthly invoice of $24.00 is ready. No action is needed; it will be charged automatically.' }),
  mail({
    from: 'Sam Rivera <sam@globex.example>', subject: 'Pricing for 200 seats', id: 'g1@globex.example', date: ago(60 * 24 * 3),
    text: 'Hi Alex,\n\nWe are comparing offers this week. Could you send pricing for 200 seats, and tell us whether onboarding is included?\n\nThanks,\nSam'
  }),
  mail({ from: 'Design Weekly <hello@designweekly.example>', subject: 'Design Weekly #142', id: 'n1@designweekly.example', date: ago(60 * 30), text: 'This week: colour systems, motion on the web and ten great portfolio sites.' })
]
const sent = [
  mail({ from: 'Alex Morgan <alex@example.com>', to: 'Daniel Kim <daniel@studio.example>', subject: 'Website launch timeline', id: 't1@example.com', date: ago(60 * 26), text: 'Hi Daniel,\n\nHere is the plan for the launch. Could you confirm the design dates?\n\nAlex' }),
  mail({
    from: 'Alex Morgan <alex@example.com>', to: 'Jordan Lee <jordan@acme.example>', subject: 'Proposal for the website redesign', id: 'p1@example.com', date: ago(60 * 24 * 2),
    text: 'Hi Jordan,\n\nAttached is our proposal for the redesign. Happy to walk you through it.\n\nAlex'
  })
]
const imap = hoodiecrow({
  plugins: ['ID', 'IDLE', 'UNSELECT', 'ENABLE', 'SPECIAL-USE', 'UIDPLUS', 'AUTH-PLAIN', 'NAMESPACE', 'MOVE', 'LITERALPLUS'],
  users: { alex: { password: 'demo' } },
  storage: {
    INBOX: { messages: inbox.map((raw, i) => ({ raw, flags: i < 2 ? [] : ['\\Seen'] })) },
    '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: sent.map((raw) => ({ raw, flags: ['\\Seen'] })) } } }
  }
})
await new Promise((r) => imap.listen(0, r))
const IMAP_PORT = imap.server.address().port

// ---------------------------------------------------------------- fake Claude (answers by request shape)

const state = { clientsList: null }
function answer(body) {
  const text = (t) => ({ blocks: [{ type: 'text', text: t }], stop: 'end_turn' })
  const json = (o) => text(JSON.stringify(o))
  const props = body.output_config?.format?.schema?.properties ?? {}
  const prompt = JSON.stringify(body.messages ?? '')
  if ('category' in props) {
    if (/contract/i.test(prompt)) return json({ category: 'action', priority: 1, summary: 'Priya needs the signed contract by Friday.' })
    if (/timeline/i.test(prompt)) return json({ category: 'reply', priority: 1, summary: 'Daniel asks to move the design review to Thursday.' })
    if (/lunch/i.test(prompt)) return json({ category: 'reply', priority: 2, summary: 'Maya suggests lunch on Tuesday or Wednesday.' })
    if (/200 seats/i.test(prompt)) return json({ category: 'reply', priority: 1, summary: 'Sam needs pricing for 200 seats and asks about onboarding.' })
    if (/invoice/i.test(prompt)) return json({ category: 'notification', priority: 3, summary: 'Monthly $24 invoice, charged automatically.' })
    return json({ category: 'newsletter', priority: 3, summary: 'Design newsletter: colour, motion, portfolios.' })
  }
  if (body.tools) {
    const last = body.messages.at(-1)
    const content = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }]
    if (content.some((b) => b.type === 'tool_result')) return text('Done — it is in **Clients**, due Friday.')
    return {
      blocks: [
        { type: 'text', text: 'I’ll add that to your Clients list:' },
        { type: 'tool_use', id: 'toolu_demo', name: 'create_task', input: { list_id: state.clientsList, title: 'Send the signed contract to Northwind', due_date: state.friday, priority: 'high' } }
      ],
      stop: 'tool_use'
    }
  }
  if (/follow-up emails/.test(JSON.stringify(body.system ?? ''))) {
    if (/200 seats/i.test(prompt))
      return text('Hi Sam,\n\nThanks for your patience. For 200 seats the price is $18 per seat per month on the annual plan, and onboarding is included: two live sessions for your team plus setup of your workspace.\n\nI can send the formal quote today. Would a 20-minute call on Thursday help to go through it?\n\nBest regards,\nAlex')
    return text('Hi Jordan,\n\nI wanted to follow up on the redesign proposal we discussed on Thursday. Do you have any questions, or should I walk your team through it this week?\n\nBest regards,\nAlex')
  }
  return text('OK')
}
function sse(s) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let o = ev('message_start', { message: { id: 'msg_docs', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } })
  s.blocks.forEach((b, index) => {
    if (b.type === 'text') {
      o += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      o += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      o += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      o += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    o += ev('content_block_stop', { index })
  })
  o += ev('message_delta', { delta: { stop_reason: s.stop, stop_sequence: null }, usage: { output_tokens: 20 } })
  return o + ev('message_stop', {})
}
const claude = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    const r = answer(body)
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(sse(r))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg_docs', type: 'message', role: 'assistant', model: body.model, content: r.blocks, stop_reason: r.stop, stop_sequence: null, usage: { input_tokens: 60, output_tokens: 12 } }))
    }
  })
})
await new Promise((r) => claude.listen(0, '127.0.0.1', r))

// ---------------------------------------------------------------- app

const app = await electron.launch({ args: ['.'], env: { ...process.env, FOLLOWUP_DATA_DIR: dataDir, ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.address().port}` } })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.locator('nav').getByText('Getting Started').waitFor({ timeout: 30_000 })
  const call = (method, ...args) => page.evaluate(([m, a]) => window.bridge.invoke(m, a), [method, args])
  const go = async (hash, wait) => {
    await page.evaluate((h) => (location.hash = h), hash)
    if (wait) await wait()
    await page.waitForTimeout(600)
  }
  const shot = async (name) => {
    // toasts are transient feedback, not part of the screen
    await page.addStyleTag({ content: 'div[class*="z-[60]"]{display:none!important}' })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(out, `${name}.png`) })
    console.log(`saved ${name}.png`)
  }
  const pad = (n) => String(n).padStart(2, '0')
  const day = (offset, time) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return time ? `${date}T${time}` : date
  }
  const friday = (() => {
    const d = new Date()
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7))
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  state.friday = friday

  // ---- workspace
  const tree = await call('getTree')
  const work = tree.spaces.find((s) => s.name === 'Work')
  const launch = tree.lists.find((l) => l.name === 'Website Launch')
  const st = Object.fromEntries(tree.statuses.filter((s) => s.space_id === work.id).map((s) => [s.name, s.id]))
  const tag = async (name, color) => (await call('createTag', { name, color })).id
  const [design, client, content, dev] = [await tag('design', '#8b5cf6'), await tag('client', '#0ea5e9'), await tag('content', '#22c55e'), await tag('dev', '#f97316')]
  const field = await call('createField', {
    space_id: work.id, name: 'Client', type: 'dropdown',
    options: [
      { id: 'nw', label: 'Northwind', color: '#0ea5e9' }, { id: 'ac', label: 'Acme', color: '#f97316' },
      { id: 'bh', label: 'Blue Harbor', color: '#14b8a6' }, { id: 'co', label: 'Contoso', color: '#a855f7' }
    ]
  })
  const tasks = await call('queryTasks', { location: { kind: 'list', id: launch.id }, includeClosed: true })
  const byTitle = (t) => tasks.find((x) => x.title === t)
  const mockups = byTitle('Design mockups')
  const build = byTitle('Build pages')
  await call('updateTask', byTitle('Define scope & sitemap').id, { status_id: st['Done'], tag_ids: [content] })
  await call('updateTask', mockups.id, { status_id: st['In Progress'], tag_ids: [design], time_estimate_min: 360, description: '<p>Homepage, pricing and contact pages in desktop and mobile layouts. Follow the brand guide; review with Daniel before handing over to development.</p>' })
  await call('updateTask', build.id, { tag_ids: [dev], time_estimate_min: 960 })
  await call('updateTask', byTitle('Content & SEO').id, { status_id: st['Review'], tag_ids: [content] })
  await call('addDependency', build.id, mockups.id)
  for (const [i, t] of ['Homepage hero', 'Pricing page', 'Mobile layouts'].entries()) {
    const s = await call('createTask', { list_id: launch.id, parent_id: mockups.id, title: t })
    if (i === 0) await call('updateTask', s.id, { status_id: st['Done'] })
  }
  const cl = await call('addChecklist', mockups.id, 'Design review')
  for (const [i, item] of ['Brand colours applied', 'Accessible contrast', 'Sign-off from Daniel'].entries()) {
    const it = await call('addChecklistItem', cl.id, item)
    if (i < 2) await call('updateChecklistItem', it.id, { done: true })
  }
  await call('addComment', mockups.id, 'Daniel shared the first drafts — looking good. Pricing page needs another pass.')

  const clients = await call('createList', { space_id: work.id, name: 'Clients' })
  state.clientsList = clients.id
  const clientTasks = [
    ['Invoice Contoso for September', day(-1), 'high', 'co', st['To Do']],
    ['Send signed contract to Northwind', day(0), 'high', 'nw', st['In Progress']],
    ['Prepare Q4 proposal for Acme', day(2), 'normal', 'ac', st['To Do']],
    ['Quarterly check-in with Blue Harbor', day(6), 'low', 'bh', st['To Do']],
    ['Renewal call with Northwind', day(9), 'normal', 'nw', st['Review']]
  ]
  const created = {}
  for (const [title, due, priority, c, status] of clientTasks) {
    created[title] = await call('createTask', { list_id: clients.id, title, due_date: due, priority, status_id: status, tag_ids: [client], fields: { [field.id]: c } })
  }

  // ---- sprint, goals, time
  const sprint = await call('createSprint', { space_id: work.id, name: 'Sprint 12', start_date: day(-4), end_date: day(9) })
  for (const t of tasks.filter((x) => !x.parent_id)) await call('updateTask', t.id, { sprint_id: sprint.id })
  await call('updateSprint', sprint.id, { status: 'active' })
  const g1 = await call('createGoal', { name: 'Launch the new website', color: '#0ea5e9', due_date: day(25), description: 'Live, fast and converting.' })
  await call('addKeyResult', g1.id, { name: 'Launch tasks done', type: 'tasks' })
  await call('addKeyResult', g1.id, { name: 'Pages built', type: 'percent', current_value: 40 })
  await call('addKeyResult', g1.id, { name: 'Leads from the new site', type: 'number', start_value: 0, target_value: 50, current_value: 12 })
  const g2 = await call('createGoal', { name: 'Grow Q4 revenue', color: '#22c55e', due_date: day(70) })
  await call('addKeyResult', g2.id, { name: 'New contracts signed', type: 'currency', start_value: 0, target_value: 50000, current_value: 18500, unit: '$' })
  await call('addKeyResult', g2.id, { name: 'Proposal sent to Acme', type: 'boolean' })
  const kr = (await call('listGoals')).find((g) => g.id === g1.id).key_results.find((k) => k.type === 'tasks')
  for (const t of tasks.filter((x) => !x.parent_id)) await call('linkKeyResultTask', kr.id, t.id)
  const log = (taskId, offset, start, minutes, note) => call('addTimeEntry', { task_id: taskId, started_at: new Date(`${day(offset, start)}`).toISOString(), duration_min: minutes, note })
  await log(mockups.id, -4, '09:30', 150, 'Homepage hero')
  await log(mockups.id, -3, '10:00', 120, 'Pricing page')
  await log(mockups.id, -1, '14:00', 90, 'Mobile layouts')
  await log(byTitle('Define scope & sitemap').id, -5, '09:00', 180, 'Workshop with Daniel')
  await log(created['Prepare Q4 proposal for Acme'].id, -2, '15:00', 75, 'First draft')
  await log(created['Send signed contract to Northwind'].id, 0, '09:15', 30, 'Review clauses')

  // ---- calendar, reminders
  const cal = (await call('listCalendars'))[0]
  const ev = (title, start, end, location = '') => call('createEvent', { calendar_id: cal.id, title, start, end, all_day: false, location })
  // this week (Monday first), so the week view is full whatever day the script runs
  const mon = -((new Date().getDay() + 6) % 7)
  await ev('Sprint planning', day(mon, '09:30'), day(mon, '10:30'))
  await ev('Design review with Daniel', day(mon + 1, '10:00'), day(mon + 1, '11:00'), 'Studio')
  await ev('Northwind kickoff call', day(mon + 2, '15:00'), day(mon + 2, '15:45'), 'Video call')
  await ev('Focus: build pages', day(mon + 3, '13:00'), day(mon + 3, '15:30'))
  await ev('Lunch with Maya', day(mon + 3, '12:00'), day(mon + 3, '13:00'), 'Café Nord')
  await ev('Weekly review', day(mon + 4, '16:00'), day(mon + 4, '16:45'))
  await ev('Design review with Daniel', day(1, '10:00'), day(1, '11:00'), 'Studio')
  await call('createReminder', { task_id: created['Send signed contract to Northwind'].id, title: 'Call Priya about the contract', remind_at: dayAt(1, '09:00') })

  // ---- automations
  const rule = (name, trigger, actions, conditions = [], scope = null) => call('createAutomation', { name, enabled: true, scope, trigger, conditions, actions })
  await rule('Escalate overdue tasks', { type: 'task_overdue' }, [{ type: 'set_priority', priority: 'urgent' }, { type: 'notify', title: 'Overdue: {{task.title}}', body: 'Was due {{task.due_date}}' }])
  await rule('Heads-up the day before', { type: 'due_date_arrives', days_before: 1 }, [{ type: 'notify', title: 'Due tomorrow: {{task.title}}', body: 'In {{task.list}}' }])
  await rule('Plan my day', { type: 'schedule', every: 'weekday', at: '09:00' }, [{ type: 'create_task', list_id: clients.id, title: 'Plan my day — {{date.today}}', due_days: 0, priority: 'high' }])
  await rule('Contract emails become tasks', { type: 'email_received' }, [{ type: 'create_task_from_email', list_id: clients.id }, { type: 'notify', title: 'New contract email from {{email.from_name}}' }], [{ field: 'email_subject', op: 'contains', value: 'contract' }])
  await rule('Review checklist', { type: 'status_changed', to: 'Review' }, [{ type: 'add_checklist', name: 'Review', items: ['Double-check requirements', 'Proofread', 'Get sign-off'] }], [], { kind: 'space', id: work.id })

  // ---- email, follow-ups, AI
  await call('setAiKey', 'anthropic', 'sk-ant-demo-key')
  await call('createAccount', {
    kind: 'mail', name: 'Alex Morgan', email: 'alex@example.com', password: 'demo',
    config: { imap: { host: '127.0.0.1', port: IMAP_PORT, secure: false, user: 'alex' }, smtp: { host: '127.0.0.1', port: 1, secure: false, user: 'alex' }, syncDays: 30, appendSent: false, preset: 'custom' }
  })
  for (let i = 0; i < 60 && (await call('listThreads', { folder: 'all' })).length < 6; i++) await page.waitForTimeout(500)
  await call('aiTriageInbox')
  for (let i = 0; i < 60 && (await call('listThreads', { folder: 'inbox' })).some((t) => !t.ai); i++) await page.waitForTimeout(500)
  await call('saveEmailTemplate', { name: 'Proposal follow-up', subject: 'Following up on our proposal', body: 'Hi {{first_name}},\n\nI wanted to follow up on the proposal I sent last week…' })
  const threads = await call('listThreads', { folder: 'all' })
  // ---- follow-up (every day counts in the demo) and clients
  await call('updateSettings', { followups: { workingDays: [0, 1, 2, 3, 4, 5, 6] } })
  const team = await call('listTeam')
  const hina = await call('saveTeamMember', { name: 'Hina Malik', email: 'hina@example.com' })
  const co = async (name, domains, stage_id, people, extra = {}) => {
    const c = await call('createCompany', { name, domains, stage_id, owner_id: team[0].id, ...extra })
    const out = {}
    for (const p of people) out[p.name] = await call('createPerson', { company_id: c.id, ...p })
    return { c, p: out }
  }
  const northwind = await co('Northwind Traders', ['northwind.example'], 'stage-negotiation', [
    { name: 'Priya Shah', designation: 'Head of Procurement', phone: '+1 415 555 0142', email: 'priya@northwind.example', action_owner: true },
    { name: 'Tom Becker', designation: 'Legal Counsel', phone: '+1 415 555 0177', email: 'tom@northwind.example' }
  ], { next_action: 'Send the signed contract', next_action_due: state.friday })
  const acme = await co('Acme Corporation', ['acme.example'], 'stage-proposal', [
    { name: 'Jordan Lee', designation: 'Marketing Director', phone: '+1 212 555 0108', email: 'jordan@acme.example', action_owner: true },
    { name: 'Lena Ortiz', designation: 'Web Lead', phone: '+1 212 555 0133', email: 'lena@acme.example' },
    { name: 'Chris Wong', designation: 'CFO', email: 'chris@acme.example' }
  ], { next_action: 'Walk the team through the proposal' })
  await co('Globex', ['globex.example'], 'stage-contacted', [{ name: 'Sam Rivera', designation: 'Operations Manager', phone: '+44 20 7946 0958', email: 'sam@globex.example', action_owner: true }])
  await co('Studio North', ['studio.example'], 'stage-won', [{ name: 'Daniel Kim', designation: 'Design Director', email: 'daniel@studio.example' }], { type: 'partner' })
  const dayAt = (n, hm) => {
    const d = new Date(Date.now() - n * 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm}`
  }
  await call('logInteraction', {
    company_id: acme.c.id, kind: 'meeting', channel: 'Zoom', mode: 'virtual', title: 'Redesign kickoff', at: dayAt(4, '15:00'), duration_min: 45, place: '',
    summary: 'Walked through goals for the new site. Jordan wants a mobile-first redesign live before the spring campaign.', next_steps: 'Send the proposal by Monday',
    person_ids: [acme.p['Jordan Lee'].id, acme.p['Lena Ortiz'].id], member_ids: [team[0].id, hina.id]
  })
  await call('logInteraction', {
    company_id: acme.c.id, kind: 'call', channel: 'Phone', mode: null, title: '', at: dayAt(1, '11:30'), duration_min: 10, place: '',
    summary: 'Chris confirmed the budget is approved for this quarter.', next_steps: '', person_ids: [acme.p['Chris Wong'].id], member_ids: [team[0].id]
  })
  await call('logInteraction', {
    company_id: northwind.c.id, kind: 'meeting', channel: '', mode: 'office', title: 'Contract review', at: dayAt(0, '10:00'), duration_min: 60, place: 'Northwind HQ, 3rd floor',
    summary: 'Agreed on payment terms (30 days). Tom will send the final contract.', next_steps: 'Sign and return by Friday',
    person_ids: [northwind.p['Priya Shah'].id, northwind.p['Tom Becker'].id], member_ids: [team[0].id]
  })
  await call('logInteraction', {
    company_id: northwind.c.id, kind: 'event', channel: '', mode: null, title: 'Web Summit 2026', at: dayAt(20, '14:00'), duration_min: null, place: 'Lisbon',
    summary: 'Met Priya at our stand; interested in a pilot.', next_steps: '', person_ids: [northwind.p['Priya Shah'].id], member_ids: [hina.id]
  })
  const contract = threads.find((t) => t.subject === 'Contract for the Q4 project')
  await call('createTaskFromThread', contract.id, clients.id)
  await call('updateSettings', { closeAsked: true })

  // ---- screenshots
  const view = (key, v) => call('setViewConfig', key, { view: v, filter: { includeClosed: false }, groupBy: 'status', sortBy: 'position', sortDir: 'asc', showSubtasks: true, hiddenFields: [], ganttZoom: 'day' })
  await go('#/', () => page.getByText('Overdue').first().waitFor())
  await shot('home')

  await view(`list:${launch.id}`, 'list')
  await go(`#/l/list/${launch.id}`, () => page.getByText('Design mockups').first().waitFor())
  await page.getByRole('button', { name: 'Expand subtasks' }).first().click().catch(() => {})
  await shot('list')

  await view(`list:${clients.id}`, 'board')
  await go(`#/l/list/${clients.id}`, () => page.getByText('Prepare Q4 proposal for Acme').waitFor())
  await shot('board')

  await view(`list:${launch.id}`, 'gantt')
  await go(`#/l/list/${launch.id}`, () => page.getByText('Drag bars to reschedule').waitFor())
  await shot('gantt')

  await view(`sprint:${sprint.id}`, 'list')
  await go(`#/l/sprint/${sprint.id}`, () => page.getByText('Burndown').waitFor())
  await shot('sprint')

  await view(`list:${launch.id}`, 'list')
  await go(`#/l/list/${launch.id}`, () => page.getByText('Design mockups').first().waitFor())
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('app-event', { type: 'open-task', taskId: id }), mockups.id)
  await page.getByText('Daniel shared the first drafts').waitFor()
  await shot('task')
  await page.keyboard.press('Escape')

  await go(`#/inbox?folder=inbox&thread=${contract.id}`, () => page.getByRole('heading', { name: /Contract for the Q4 project/ }).waitFor())
  await page.frameLocator('iframe[title="Email content"]').first().getByText('signed contract').waitFor()
  await shot('inbox')

  const pricing = (await call('listThreads', { folder: 'all' })).find((t) => t.subject === 'Pricing for 200 seats')
  await go(`#/inbox?folder=followups&thread=${pricing.id}`, () => page.getByText('They’re waiting for your reply').waitFor())
  await page.getByText('onboarding is included').first().waitFor()
  await shot('followups')

  await go('#/clients', () => page.getByText('Acme Corporation').first().waitFor())
  await page.getByRole('button', { name: 'Acme Corporation' }).click()
  await page.getByText('Redesign kickoff').waitFor()
  await shot('clients')

  await go('#/calendar', () => page.getByText('Design review with Daniel').first().waitFor())
  await shot('calendar')

  await go('#/automations', () => page.getByText('Escalate overdue tasks').waitFor())
  await shot('automations')
  await page.getByText('Contract emails become tasks').click()
  await page.getByRole('dialog').waitFor()
  await shot('automation-editor')
  await page.keyboard.press('Escape')

  await go('#/dashboards', () => page.getByText('Tasks by status').waitFor())
  await page.waitForTimeout(800)
  await shot('dashboard')

  await go('#/goals', () => page.getByText('Launch the new website').waitFor())
  await shot('goals')

  await go('#/time', () => page.getByText('This week').first().waitFor())
  await shot('time')

  await go(`#/inbox?folder=inbox&thread=${contract.id}`, () => page.getByRole('heading', { name: /Contract for the Q4 project/ }).waitFor())
  await page.keyboard.press('Control+j')
  await page.getByLabel('Message the assistant').fill('Remind me to send the signed contract to Northwind by Friday')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /Approve/ }).first().waitFor({ timeout: 20_000 })
  await shot('assistant')
  await page.keyboard.press('Control+j')

  await call('updateSettings', { theme: 'dark' })
  await view(`list:${launch.id}`, 'board')
  await go(`#/l/list/${launch.id}`, () => page.getByText('Design mockups').first().waitFor())
  await shot('dark')
} finally {
  await app.close()
  imap.close(() => {})
  claude.close()
  rmSync(dataDir, { recursive: true, force: true })
}
console.log(`\nScreenshots in ${out}`)
