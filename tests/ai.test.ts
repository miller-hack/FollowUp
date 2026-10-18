import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { closeDb, get, openDb } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as auto from '../src/main/services/automation'
import * as chat from '../src/main/services/ai/assistant'
import * as features from '../src/main/services/ai/features'
import { anthropicProvider, openAiCompatibleProvider, setAiKey, getAiKey, setProviderFactory, type AiProvider } from '../src/main/services/ai/providers'
import { processJobs } from '../src/main/services/jobs'
import { storeMessage, parseRaw } from '../src/main/services/mail/store'
import { createAccount } from '../src/main/services/mail/accounts'
import { emit } from '../src/main/services/events'
import { updateSettings } from '../src/main/services/meta'

// ---------------------------------------------------------------- fake Anthropic Messages API (SSE)

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'thinking'; signature: string }
interface Scripted {
  blocks: Block[]
  stop: string
}

const requests: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = []
let script: Scripted[] = []

function sse(s: Scripted): string {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  let out = ev('message_start', {
    type: 'message_start',
    message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 40 } }
  })
  s.blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      for (const part of b.text.match(/.{1,5}/g) ?? []) out += ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } })
    } else if (b.type === 'thinking') {
      out += ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      out += ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } })
    } else {
      out += ev('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      const json = JSON.stringify(b.input)
      for (const part of json.match(/.{1,7}/g) ?? []) out += ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } })
    }
    out += ev('content_block_stop', { type: 'content_block_stop', index })
  })
  out += ev('message_delta', { type: 'message_delta', delta: { stop_reason: s.stop, stop_sequence: null }, usage: { output_tokens: 42 } })
  out += ev('message_stop', { type: 'message_stop' })
  return out
}

let server: Server
let baseURL = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>
      requests.push({ headers: req.headers, body })
      const next = script.shift() ?? { blocks: [{ type: 'text', text: 'OK' }], stop: 'end_turn' }
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(sse(next))
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        const content = next.blocks.map((b) => (b.type === 'thinking' ? { type: 'thinking', thinking: '', signature: b.signature } : b))
        res.end(JSON.stringify({ id: 'msg_y', type: 'message', role: 'assistant', model: body.model, content, stop_reason: next.stop, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 10 } }))
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  baseURL = `http://127.0.0.1:${addr.port}`
})

afterAll(() => {
  server.close()
  setProviderFactory(null)
})

beforeEach(() => {
  closeDb()
  openDb(':memory:')
  requests.length = 0
  script = []
  setProviderFactory((_p, model) => anthropicProvider('test-key', model, 'medium', baseURL))
})

async function settle(id: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const s = get<{ status: string }>('SELECT status FROM ai_conversations WHERE id = ?', id)!.status
    if (s !== 'running') return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('chat did not settle')
}

function setup() {
  const space = h.createSpace({ name: 'Work' })
  const list = h.createList({ space_id: space.id, name: 'Inbox' })
  return { space, list }
}

describe('Claude provider + assistant loop', () => {
  it('runs read tools, pauses for approval, then executes and continues — append-only, with the right request shape', async () => {
    const { list } = setup()
    script = [
      { blocks: [{ type: 'thinking', signature: 'sig-1' }, { type: 'text', text: 'Let me check your lists.' }, { type: 'tool_use', id: 'tu_1', name: 'list_workspace', input: {} }], stop: 'tool_use' },
      { blocks: [{ type: 'tool_use', id: 'tu_2', name: 'create_task', input: { list_id: list.id, title: 'Call the bank', due_date: '2026-10-20', priority: 'high' } }], stop: 'tool_use' },
      { blocks: [{ type: 'text', text: 'Added **Call the bank** for Tuesday.' }], stop: 'end_turn' }
    ]
    const deltas: string[] = []
    chat.setAiEmitter((e) => e.kind === 'delta' && deltas.push(e.text))
    const id = chat.sendChat(null, 'Remind me to call the bank on Tuesday, it is important')
    expect(await settle(id)).toBe('awaiting_approval')
    expect(deltas.join('')).toBe('Let me check your lists.')

    let detail = chat.getChat(id)!
    const pending = detail.messages.at(-1)!.toolCalls[0]
    expect(pending).toMatchObject({ name: 'create_task', status: 'pending', needsApproval: true })
    expect(pending.summary).toBe('Create task “Call the bank” in Inbox, due 2026-10-20, high priority')
    expect(t.queryTasks({})).toHaveLength(0) // nothing written before approval

    chat.resolveChatTools(id, { tu_2: true })
    expect(await settle(id)).toBe('idle')
    const [task] = t.queryTasks({})
    expect(task).toMatchObject({ title: 'Call the bank', due_date: '2026-10-20', priority: 'high' })
    detail = chat.getChat(id)!
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant', 'assistant'])
    expect(detail.messages.at(-1)!.text).toBe('Added **Call the bank** for Tuesday.')

    // request shape
    const [r1, r2, r3] = requests
    expect(r1.headers['anthropic-beta']).toContain('thinking-binding-controls-2026-08-01')
    expect(r1.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
    expect(r1.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      stream: true
    })
    expect((r1.body.tools as { eager_input_streaming: boolean }[]).every((x) => x.eager_input_streaming)).toBe(true)
    expect(r1.body).not.toHaveProperty('tool_choice')

    // append-only: each request starts with the previous one's messages byte-for-byte, and the
    // thinking block (with its signature) is replayed unchanged
    const m1 = r1.body.messages as unknown[]
    const m2 = r2.body.messages as unknown[]
    const m3 = r3.body.messages as unknown[]
    expect(JSON.stringify(m2.slice(0, m1.length))).toBe(JSON.stringify(m1))
    expect(JSON.stringify(m3.slice(0, m2.length))).toBe(JSON.stringify(m2))
    expect(JSON.stringify(r2.body.system)).toBe(JSON.stringify(r1.body.system))
    expect(JSON.stringify(r3.body.tools)).toBe(JSON.stringify(r1.body.tools))
    expect((m2[1] as { content: { type: string; signature?: string }[] }).content[0]).toMatchObject({ type: 'thinking', signature: 'sig-1' })
    expect(m2[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: false }] })
    expect(String((m1[0] as { content: string }).content)).toMatch(/^<context>Now: /)

    expect(features.aiUsageSummary()).toMatchObject({ input_tokens: 300, output_tokens: 126 })
  })

  it('reports declined actions back to the model and handles refusals', async () => {
    const { list } = setup()
    script = [
      { blocks: [{ type: 'tool_use', id: 'tu_9', name: 'create_task', input: { list_id: list.id, title: 'Spam' } }], stop: 'tool_use' },
      { blocks: [{ type: 'text', text: 'Okay, not added.' }], stop: 'end_turn' },
      { blocks: [], stop: 'refusal' }
    ]
    const id = chat.sendChat(null, 'add spam')
    await settle(id)
    chat.resolveChatTools(id, { tu_9: false })
    expect(await settle(id)).toBe('idle')
    expect(t.queryTasks({})).toHaveLength(0)
    const results = (requests[1].body.messages as { content: unknown }[]).at(-1)!.content as { content: string }[]
    expect(results[0].content).toMatch(/declined/)

    chat.sendChat(id, 'something it refuses')
    await settle(id)
    expect(chat.getChat(id)!.messages.at(-1)!.notice).toMatch(/declined to continue/)
    // the refused (empty) turn is not replayed; history still alternates correctly
    chat.sendChat(id, 'ok, never mind')
    await settle(id)
    const last = requests.at(-1)!.body.messages as { role: string }[]
    expect(last.at(-1)!.role).toBe('user')
  })

  it('rejects invalid tool input instead of running it', async () => {
    setup()
    script = [
      { blocks: [{ type: 'tool_use', id: 'tu_bad', name: 'search_tasks', input: { query: 5 } }], stop: 'tool_use' },
      { blocks: [{ type: 'text', text: 'sorry' }], stop: 'end_turn' }
    ]
    const id = chat.sendChat(null, 'find stuff')
    await settle(id)
    const tc = chat.getChat(id)!.messages[1].toolCalls[0]
    expect(tc).toMatchObject({ status: 'error' })
    expect(tc.result).toMatch(/Invalid input/)
  })

  it('omits fallbacks for Haiku, which has no server-side fallback', async () => {
    const p = anthropicProvider('k', 'claude-haiku-5-5', 'low', baseURL)
    await p.complete({ system: 's', prompt: 'p' })
    expect(requests[0].body).not.toHaveProperty('fallbacks')
    expect(requests[0].headers['anthropic-beta']).not.toContain('server-side-fallback')
  })

  it('uses structured output for one-shot features', async () => {
    setup()
    script = [{ blocks: [{ type: 'text', text: JSON.stringify({ title: 'Call John', due_date: '2026-10-20T15:00', priority: 'high', tags: ['sales'] }) }], stop: 'end_turn' }]
    const r = await features.aiParseQuickAdd('Call John next Tue 3pm #sales important')
    expect(r).toEqual({ title: 'Call John', due_date: '2026-10-20T15:00', priority: 'high', tags: ['sales'] })
    expect(requests[0].body).toMatchObject({ output_config: { format: { type: 'json_schema' } } })
  })
})

describe('keys', () => {
  it('stores API keys encrypted and never in plain text', () => {
    setAiKey('anthropic', 'sk-ant-secret')
    const raw = get<{ value: string }>("SELECT value FROM settings WHERE key = 'secret:anthropic'")!.value
    expect(raw).not.toContain('sk-ant-secret')
    expect(getAiKey('anthropic')).toBe('sk-ant-secret')
    setAiKey('anthropic', null)
    expect(getAiKey('anthropic')).toBe('')
  })
})

describe('triage, automations and the OpenAI-compatible provider', () => {
  const fake = (answers: string[]): AiProvider => ({
    id: 'ollama',
    model: 'fake',
    turn: async () => ({ text: '', toolCalls: [], stop: 'end', native: null, usage: { input: 0, output: 0, cacheRead: 0 } }),
    complete: async () => ({ text: answers.shift() ?? '{}', usage: { input: 5, output: 5, cacheRead: 0 } }),
    userMessage: (x) => x,
    toolResults: (x) => x,
    flatten: (x) => x
  })

  it('auto-triages new mail and lets automations react to the category', async () => {
    const { list } = setup()
    const answers = [JSON.stringify({ category: 'action', priority: 1, summary: 'Client needs the contract signed by Friday.' })]
    setProviderFactory(() => fake(answers))
    updateSettings({ ai: { ...(await import('../src/main/services/meta')).getSettings().ai, autoTriage: true } })
    const acc = createAccount({
      kind: 'mail',
      name: 'Me',
      email: 'me@x.com',
      password: 'p',
      config: { imap: { host: 'h', port: 993, secure: true, user: 'u' }, smtp: { host: 'h', port: 465, secure: true, user: 'u' }, syncDays: 30, appendSent: true }
    })
    auto.createAutomation({
      name: 'Action mail → task',
      enabled: true,
      scope: null,
      trigger: { type: 'email_triaged', category: 'action' },
      conditions: [],
      actions: [{ type: 'create_task_from_email', list_id: list.id }]
    })
    const parsed = await parseRaw(Buffer.from('From: a@client.com\r\nSubject: Contract\r\nMessage-ID: <c1@client.com>\r\n\r\nPlease sign by Friday.'))
    const r = storeMessage(acc.id, parsed, { accountEmail: 'me@x.com', folder: 'INBOX', uid: 1, seen: false, inInbox: true })
    emit({ type: 'mail.received', threadId: r.threadId, messageId: r.messageRowId })
    await processJobs()
    expect(get('SELECT ai_category, ai_priority, ai_summary FROM mail_threads WHERE id = ?', r.threadId)).toEqual({
      ai_category: 'action',
      ai_priority: 1,
      ai_summary: 'Client needs the contract signed by Friday.'
    })
    expect(t.queryTasks({}).map((x) => x.title)).toEqual(['Contract'])
  })

  it('answers an automation AI prompt as a task comment', async () => {
    const { list } = setup()
    setProviderFactory(() => fake(['Break it into: research, outline, draft.']))
    auto.createAutomation({ name: 'Plan it', enabled: true, scope: null, trigger: { type: 'task_created' }, conditions: [], actions: [{ type: 'ai_prompt', prompt: 'How should I approach “{{task.title}}”?' }] })
    const task = t.createTask({ list_id: list.id, title: 'Write the report' })
    await processJobs()
    expect(t.getTask(task.id)!.comments).toMatchObject([{ author: 'ai', body: 'Break it into: research, outline, draft.' }])
  })

  it('accumulates streamed OpenAI-style tool calls', async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { role: 'assistant', content: 'Looking' } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_tasks', arguments: '{"que' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"bank"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
    ]
    const oa = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(chunks.map((c) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', ...c })}\n\n`).join('') + 'data: [DONE]\n\n')
      })
    })
    await new Promise<void>((r) => oa.listen(0, '127.0.0.1', r))
    const p = openAiCompatibleProvider('ollama', 'ollama', 'llama3.1', `http://127.0.0.1:${(oa.address() as { port: number }).port}/v1`)
    const turn = await p.turn({ system: 's', messages: [p.userMessage('hi')], tools: [], onText: () => {} })
    oa.close()
    expect(turn).toMatchObject({ text: 'Looking', stop: 'tool_use', toolCalls: [{ id: 'call_1', name: 'search_tasks', input: { query: 'bank' } }] })
    expect(p.flatten([p.userMessage('hi'), turn.native, p.toolResults([{ id: 'call_1', content: '[]', isError: false }])])).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Looking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_tasks', arguments: '{"query":"bank"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '[]' }
    ])
  })
})
