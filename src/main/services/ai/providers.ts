import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { AiProviderId } from '@shared/ai'
import { get, run, uuid } from '../../db'
import { getSettings } from '../meta'
import { decryptSecret, encryptSecret } from '../mail/secrets'

// ---------------------------------------------------------------- common shapes

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the input (object, additionalProperties: false) */
  jsonSchema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export type StopKind = 'end' | 'tool_use' | 'refusal' | 'max_tokens'

export interface Usage {
  input: number
  output: number
  cacheRead: number
}

export interface TurnResult {
  text: string
  toolCalls: ToolCall[]
  stop: StopKind
  /** provider-native assistant message, replayed verbatim later; null when there is nothing to replay */
  native: unknown
  usage: Usage
}

export interface ToolResultInput {
  id: string
  content: string
  isError: boolean
}

export interface CompleteOptions {
  system: string
  prompt: string
  /** JSON Schema (object, all properties required, additionalProperties: false) for structured output */
  schema?: Record<string, unknown>
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
}

export interface AiProvider {
  id: AiProviderId
  model: string
  /** one assistant turn with tools, streaming text through `onText` */
  turn(p: { system: string; messages: unknown[]; tools: ToolSpec[]; onText: (delta: string) => void; signal?: AbortSignal }): Promise<TurnResult>
  /** single request → text (JSON text when `schema` is given) */
  complete(p: CompleteOptions): Promise<{ text: string; usage: Usage }>
  userMessage(text: string): unknown
  /** native message(s) carrying tool results; stored as one row */
  toolResults(results: ToolResultInput[]): unknown
  /** turn stored rows into the provider's `messages` array */
  flatten(rows: unknown[]): unknown[]
}

/** Errors meant to be shown to the user as-is. */
export class AiError extends Error {}

// ---------------------------------------------------------------- keys

export function getAiKey(provider: 'anthropic' | 'openai'): string {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', `secret:${provider}`)
  return row ? decryptSecret(JSON.parse(row.value) as string) : ''
}

export function setAiKey(provider: 'anthropic' | 'openai', key: string | null): void {
  const k = key?.trim()
  if (!k) run('DELETE FROM settings WHERE key = ?', `secret:${provider}`)
  else
    run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      `secret:${provider}`,
      JSON.stringify(encryptSecret(k))
    )
}

export function keyStatus(): { anthropic: boolean; openai: boolean } {
  return { anthropic: !!getAiKey('anthropic'), openai: !!getAiKey('openai') }
}

// ---------------------------------------------------------------- usage log

export function logUsage(feature: string, p: AiProvider, u: Usage): void {
  run(
    'INSERT INTO ai_usage (id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uuid(), feature, p.id, p.model, u.input, u.output, u.cacheRead
  )
}

// ---------------------------------------------------------------- Anthropic (Claude)

/** Models that accept server-side refusal fallback (`fallbacks: "default"`). Haiku has none. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5', 'claude-sonnet-5-5'])

function friendlyAnthropicError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new AiError('Your Anthropic API key was rejected. Check it in Settings → AI.')
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('This API key does not have access to the selected model.')
  if (e instanceof Anthropic.NotFoundError) return new AiError('The selected Claude model was not found. Pick another model in Settings → AI.')
  if (e instanceof Anthropic.RateLimitError) return new AiError('Claude is rate-limiting requests right now. Try again in a minute.')
  if (e instanceof Anthropic.BadRequestError) return new AiError(`Claude rejected the request: ${e.message}`)
  if (e instanceof Anthropic.APIConnectionError) return new AiError('Could not reach the Anthropic API. Check your internet connection.')
  if (e instanceof Anthropic.APIError) return new AiError(`Anthropic API error ${e.status ?? ''}: ${e.message}`)
  return e instanceof Error ? e : new Error(String(e))
}

export function anthropicProvider(apiKey: string, model: string, effort: 'low' | 'medium' | 'high', baseURL?: string): AiProvider {
  const client = new Anthropic({ apiKey, baseURL, maxRetries: 2 })
  const fallback = FALLBACK_MODELS.has(model)
  // append-only history is kept by the caller; drop_block degrades instead of failing if it ever isn't
  const betas = ['thinking-binding-controls-2026-08-01', ...(fallback ? ['server-side-fallback-2026-07-01'] : [])]
  const common = { ...(fallback ? { fallbacks: 'default' as const } : {}), betas }
  const usageOf = (m: Anthropic.Beta.BetaMessage): Usage => ({
    // cache reads are billed far lower, so they are counted separately
    input: m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0),
    output: m.usage.output_tokens,
    cacheRead: m.usage.cache_read_input_tokens ?? 0
  })

  return {
    id: 'anthropic',
    model,

    async turn({ system, messages, tools, onText, signal }) {
      let message: Anthropic.Beta.BetaMessage | null = null
      for (let attempt = 0; !message; attempt++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 32000,
            // tools + system are frozen per conversation, so this cached prefix stays warm
            cache_control: { type: 'ephemeral' },
            system,
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.jsonSchema as Anthropic.Beta.BetaTool.InputSchema,
              eager_input_streaming: true
            })),
            messages: messages as Anthropic.Beta.BetaMessageParam[],
            thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
            output_config: { effort },
            ...common
          },
          { signal }
        )
        stream.on('text', onText)
        try {
          message = await stream.finalMessage()
        } catch (e) {
          // with eager input streaming an unparseable tool input rejects here; re-issue the turn (max 2x)
          if (e instanceof Anthropic.APIError || signal?.aborted || attempt >= 2) throw friendlyAnthropicError(e)
        }
      }
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      const toolCalls = message.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }))
      const stop: StopKind =
        message.stop_reason === 'refusal' ? 'refusal' : message.stop_reason === 'max_tokens' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end'
      return {
        text,
        toolCalls,
        stop,
        // the full content (thinking blocks with signatures, fallback blocks, …) goes back unchanged
        native: message.content.length ? { role: 'assistant', content: message.content } : null,
        usage: usageOf(message)
      }
    },

    async complete({ system, prompt, schema, effort: e, maxTokens }) {
      let m: Anthropic.Beta.BetaMessage
      try {
        m = await client.beta.messages.create({
          model,
          max_tokens: maxTokens ?? 16000,
          system,
          messages: [{ role: 'user', content: prompt }],
          thinking: { type: 'adaptive' },
          output_config: { effort: e ?? effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
          ...common
        })
      } catch (err) {
        throw friendlyAnthropicError(err)
      }
      if (m.stop_reason === 'refusal') throw new AiError('Claude declined this request.')
      const text = m.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      return { text, usage: usageOf(m) }
    },

    userMessage: (text) => ({ role: 'user', content: text }),
    toolResults: (results) => ({
      role: 'user',
      content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError }))
    }),
    flatten: (rows) => rows
  }
}

// ---------------------------------------------------------------- OpenAI and Ollama (OpenAI-compatible API)

function friendlyOpenAiError(e: unknown, local: boolean): Error {
  if (local && e instanceof OpenAI.APIConnectionError) return new AiError('Could not reach Ollama. Is it running? (ollama serve)')
  if (e instanceof OpenAI.AuthenticationError) return new AiError('Your OpenAI API key was rejected. Check it in Settings → AI.')
  if (e instanceof OpenAI.NotFoundError) return new AiError(local ? 'Model not found in Ollama. Pull it first (ollama pull <model>).' : 'The selected model was not found.')
  if (e instanceof OpenAI.RateLimitError) return new AiError('The AI provider is rate-limiting requests. Try again shortly.')
  if (e instanceof OpenAI.APIError) return new AiError(`AI provider error ${e.status ?? ''}: ${e.message}`)
  return e instanceof Error ? e : new Error(String(e))
}

export function openAiCompatibleProvider(id: 'openai' | 'ollama', apiKey: string, model: string, baseURL?: string): AiProvider {
  const local = id === 'ollama'
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 2 })
  type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

  return {
    id,
    model,

    async turn({ system, messages, tools, onText, signal }) {
      const calls = new Map<number, { id: string; name: string; args: string }>()
      let text = ''
      let finish: string | null = null
      const usage: Usage = { input: 0, output: 0, cacheRead: 0 }
      try {
        const stream = await client.chat.completions.create(
          {
            model,
            stream: true,
            ...(local ? {} : { stream_options: { include_usage: true } }),
            messages: [{ role: 'system', content: system }, ...(messages as Msg[])],
            tools: tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.jsonSchema } }))
          },
          { signal }
        )
        for await (const chunk of stream) {
          const choice = chunk.choices[0]
          if (chunk.usage) {
            usage.input = chunk.usage.prompt_tokens
            usage.output = chunk.usage.completion_tokens
          }
          if (!choice) continue
          if (choice.delta?.content) {
            text += choice.delta.content
            onText(choice.delta.content)
          }
          for (const tc of choice.delta?.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            calls.set(tc.index, cur)
          }
          if (choice.finish_reason) finish = choice.finish_reason
        }
      } catch (e) {
        throw friendlyOpenAiError(e, local)
      }
      const list = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${i}_${uuid().slice(0, 8)}` }))
      const toolCalls: ToolCall[] = list.map((c) => {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(c.args || '{}') as Record<string, unknown>
        } catch {
          input = { __invalid_json: c.args }
        }
        return { id: c.id, name: c.name, input }
      })
      const native: Msg = {
        role: 'assistant',
        content: text || null,
        ...(list.length ? { tool_calls: list.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } })) } : {})
      }
      const stop: StopKind = finish === 'content_filter' ? 'refusal' : finish === 'length' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end'
      return { text, toolCalls, stop, native: text || list.length ? native : null, usage }
    },

    async complete({ system, prompt, schema, maxTokens }) {
      try {
        const r = await client.chat.completions.create({
          model,
          max_completion_tokens: maxTokens ?? 8000,
          messages: [
            { role: 'system', content: schema && local ? `${system}\n\nReply with JSON only, matching this schema:\n${JSON.stringify(schema)}` : system },
            { role: 'user', content: prompt }
          ],
          ...(schema
            ? { response_format: local ? { type: 'json_object' as const } : { type: 'json_schema' as const, json_schema: { name: 'result', schema, strict: true } } }
            : {})
        })
        const choice = r.choices[0]
        if (choice?.finish_reason === 'content_filter') throw new AiError('The AI provider declined this request.')
        return {
          text: choice?.message.content ?? '',
          usage: { input: r.usage?.prompt_tokens ?? 0, output: r.usage?.completion_tokens ?? 0, cacheRead: 0 }
        }
      } catch (e) {
        throw friendlyOpenAiError(e, local)
      }
    },

    userMessage: (text) => ({ role: 'user', content: text }),
    toolResults: (results) => results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content })),
    flatten: (rows) => rows.flatMap((r) => (Array.isArray(r) ? r : [r]))
  }
}

// ---------------------------------------------------------------- factory

type Factory = (provider: AiProviderId, model: string) => AiProvider
let factoryOverride: Factory | null = null

/** Tests inject a fake provider here. */
export function setProviderFactory(f: Factory | null): void {
  factoryOverride = f
}

/** Model name for the configured provider. */
export function currentModel(provider: AiProviderId = getSettings().ai.provider): string {
  const ai = getSettings().ai
  return provider === 'anthropic' ? ai.anthropicModel : provider === 'openai' ? ai.openaiModel : ai.ollamaModel
}

/** Provider for new work (or a conversation's own provider/model). */
export function getProvider(provider?: AiProviderId, model?: string): AiProvider {
  const ai = getSettings().ai
  const p = provider ?? ai.provider
  const m = model ?? currentModel(p)
  if (factoryOverride) return factoryOverride(p, m)
  if (p === 'anthropic') {
    const key = getAiKey('anthropic')
    if (!key) throw new AiError('Add your Anthropic API key in Settings → AI to use the assistant.')
    return anthropicProvider(key, m, ai.effort)
  }
  if (p === 'openai') {
    const key = getAiKey('openai')
    if (!key) throw new AiError('Add your OpenAI API key in Settings → AI.')
    return openAiCompatibleProvider('openai', key, m)
  }
  return openAiCompatibleProvider('ollama', 'ollama', m, `${ai.ollamaUrl.replace(/\/+$/, '')}/v1`)
}
