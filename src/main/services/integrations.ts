import type { Integration, IntegrationConfig, IntegrationInput, IntegrationKind, OutgoingMessage } from '@shared/integrations'
import type { AppNotification } from '@shared/types'
import { all, get, now, run, tx, uuid } from '../db'
import { enqueue, registerJobHandler } from './jobs'
import { onNotify } from './notify'
import { createTask } from './tasks'
import { decryptSecret, encryptSecret } from './mail/secrets'

/**
 * Slack and Microsoft Teams. Outgoing messages (automation actions, mirrored
 * notifications, "send to Slack") go through the job queue so they retry when
 * offline. Slack bot integrations can also watch a channel: messages that get a
 * chosen reaction become tasks (polled; a desktop app has no public webhook URL).
 */

let slackApi = process.env['FOLLOWUP_SLACK_API'] || 'https://slack.com/api'
/** Test hook: point the Slack Web API at a local fake. */
export function setSlackApiBase(url: string): void {
  slackApi = url.replace(/\/$/, '')
}

interface Row {
  id: string
  kind: IntegrationKind
  name: string
  secret: string
  config: string
  enabled: number
  last_error: string | null
  last_used_at: string | null
  created_at: string
}

const COLS = 'id, kind, name, secret, config, enabled, last_error, last_used_at, created_at'

function target(kind: IntegrationKind, secret: string): string {
  if (kind === 'slack_bot') return 'slack.com'
  try {
    return new URL(secret).host
  } catch {
    return ''
  }
}

function toIntegration(r: Row): Integration {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    config: { ...(JSON.parse(r.config) as Partial<IntegrationConfig>), mirrorNotifications: !!(JSON.parse(r.config) as Partial<IntegrationConfig>).mirrorNotifications },
    enabled: !!r.enabled,
    target: target(r.kind, decryptSecret(r.secret)),
    last_error: r.last_error,
    last_used_at: r.last_used_at,
    created_at: r.created_at
  }
}

const rowOf = (id: string) => get<Row>(`SELECT ${COLS} FROM integrations WHERE id = ?`, id)

export function listIntegrations(): Integration[] {
  return all<Row>(`SELECT ${COLS} FROM integrations ORDER BY created_at`).map(toIntegration)
}

const isLocal = (u: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)

/** Throws a readable error when the webhook URL / token can't be right. */
export function validateSecret(kind: IntegrationKind, secret: string): void {
  const s = secret.trim()
  if (!s) throw new Error(kind === 'slack_bot' ? 'Paste the bot token' : 'Paste the webhook URL')
  if (kind === 'slack_bot') {
    if (!/^xox[bp]-/.test(s)) throw new Error('A Slack bot token starts with "xoxb-"')
    return
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new Error('That is not a valid URL')
  }
  // webhook URLs carry their own credentials: never send them in clear text
  if (u.protocol !== 'https:' && !isLocal(u)) throw new Error('The webhook URL must start with https://')
  if (kind === 'slack_webhook' && u.hostname !== 'hooks.slack.com' && !isLocal(u))
    throw new Error('Slack webhook URLs start with https://hooks.slack.com/')
}

function validateConfig(kind: IntegrationKind, c: IntegrationConfig): void {
  if (kind === 'slack_bot' && !c.channel?.trim()) throw new Error('Choose the Slack channel')
  if (c.watch?.enabled) {
    if (kind !== 'slack_bot') throw new Error('Only Slack app integrations can create tasks from messages')
    if (!c.watch.list_id || !get('SELECT 1 FROM lists WHERE id = ?', c.watch.list_id)) throw new Error('Choose the list for new tasks')
    if (!normEmoji(c.watch.emoji)) throw new Error('Choose the reaction that turns a message into a task')
  }
}

const normEmoji = (e: string | undefined) => (e ?? '').trim().replace(/^:|:$/g, '')

function cleanConfig(c: IntegrationConfig): IntegrationConfig {
  return {
    ...c,
    channel: c.channel?.trim() || undefined,
    watch: c.watch ? { ...c.watch, emoji: normEmoji(c.watch.emoji) } : undefined
  }
}

export function createIntegration(input: IntegrationInput): Integration {
  if (!input.name.trim()) throw new Error('Give the integration a name')
  validateSecret(input.kind, input.secret ?? '')
  validateConfig(input.kind, input.config)
  const id = uuid()
  run(
    'INSERT INTO integrations (id, kind, name, secret, config) VALUES (?, ?, ?, ?, ?)',
    id, input.kind, input.name.trim(), encryptSecret(input.secret!.trim()), cleanConfig(input.config)
  )
  return toIntegration(rowOf(id)!)
}

export function updateIntegration(id: string, patch: Partial<IntegrationInput> & { enabled?: boolean }): Integration {
  const cur = rowOf(id)
  if (!cur) throw new Error('Integration not found')
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('Give the integration a name')
    run('UPDATE integrations SET name = ?, updated_at = ? WHERE id = ?', patch.name.trim(), now(), id)
  }
  if (patch.secret) {
    validateSecret(cur.kind, patch.secret)
    run('UPDATE integrations SET secret = ?, last_error = NULL, updated_at = ? WHERE id = ?', encryptSecret(patch.secret.trim()), now(), id)
  }
  if (patch.config) {
    validateConfig(cur.kind, patch.config)
    run('UPDATE integrations SET config = ?, updated_at = ? WHERE id = ?', cleanConfig(patch.config), now(), id)
  }
  if (patch.enabled !== undefined) run('UPDATE integrations SET enabled = ?, updated_at = ? WHERE id = ?', patch.enabled, now(), id)
  return toIntegration(rowOf(id)!)
}

export function deleteIntegration(id: string): void {
  run('DELETE FROM integrations WHERE id = ?', id)
}

// ---------------------------------------------------------------- sending

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

class IntegrationError extends Error {}

const SLACK_ERRORS: Record<string, string> = {
  invalid_auth: 'Slack rejected the token. Copy the "Bot User OAuth Token" again.',
  not_authed: 'Slack rejected the token. Copy the "Bot User OAuth Token" again.',
  token_revoked: 'The Slack app was removed from the workspace. Reinstall it and paste the new token.',
  account_inactive: 'The Slack app was removed from the workspace. Reinstall it and paste the new token.',
  channel_not_found: 'Slack channel not found. Check the channel, and invite the app to private channels.',
  not_in_channel: 'The app is not in that channel. In Slack, type /invite @your-app in the channel.',
  is_archived: 'That Slack channel is archived.',
  missing_scope: 'The Slack app is missing a permission (needs chat:write, channels:history, channels:read).',
  ratelimited: 'Slack is rate-limiting requests; it will retry.',
  invalid_token: 'This webhook URL is no longer valid (it was revoked or the app was removed).',
  no_service: 'This webhook URL is no longer valid (it was revoked or the app was removed).',
  no_team: 'This webhook URL is no longer valid.',
  action_prohibited: 'A Slack admin has restricted this webhook.',
  posting_to_general_channel_denied: 'Only admins can post to this channel.'
}

async function slackCall<T extends { ok: boolean; error?: string }>(token: string, method: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
  const url = `${slackApi}/${method}${query ? `?${new URLSearchParams(query)}` : ''}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 429) throw new Error(SLACK_ERRORS['ratelimited'])
  const data = (await res.json()) as T
  if (!data.ok) {
    const msg = SLACK_ERRORS[data.error ?? ''] ?? `Slack error: ${data.error ?? res.status}`
    // permanent problems should not be retried forever
    throw data.error && data.error !== 'ratelimited' ? new IntegrationError(msg) : new Error(msg)
  }
  return data
}

async function postWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  })
  if (res.ok) return
  const text = (await res.text().catch(() => '')).trim()
  const known = SLACK_ERRORS[text]
  if (known) throw new IntegrationError(known)
  if (res.status === 404 || res.status === 401 || res.status === 403 || res.status === 410)
    throw new IntegrationError(`The webhook was rejected (${res.status}). It may have been deleted; create a new one and paste its URL.`)
  throw new Error(`The webhook returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
}

function teamsCard(m: OutgoingMessage): unknown {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            ...(m.title ? [{ type: 'TextBlock', text: m.title, weight: 'Bolder', size: 'Medium', wrap: true }] : []),
            ...(m.body ? [{ type: 'TextBlock', text: m.body, wrap: true }] : [])
          ]
        }
      }
    ]
  }
}

async function deliver(kind: IntegrationKind, secret: string, config: IntegrationConfig, m: OutgoingMessage): Promise<void> {
  const slackText = [m.title && `*${slackEscape(m.title)}*`, m.body && slackEscape(m.body)].filter(Boolean).join('\n')
  if (kind === 'slack_webhook') return postWebhook(secret, { text: slackText })
  if (kind === 'teams_webhook') return postWebhook(secret, teamsCard(m))
  await slackCall(secret, 'chat.postMessage', { channel: config.channel, text: slackText, unfurl_links: false })
}

/** Send a test message with unsaved settings (or a saved integration's secret). Returns an error message or null. */
export async function testIntegration(input: IntegrationInput & { id?: string }): Promise<string | null> {
  try {
    const secret = input.secret?.trim() || (input.id ? decryptSecret(rowOf(input.id)?.secret ?? '') : '')
    validateSecret(input.kind, secret)
    if (input.kind === 'slack_bot') {
      if (!input.config.channel?.trim()) throw new Error('Choose the Slack channel')
      await slackCall(secret, 'auth.test')
    }
    await deliver(input.kind, secret, input.config, { title: 'FollowUp is connected', body: 'Notifications and automation messages will appear here.' })
    return null
  } catch (e) {
    return friendly(e)
  }
}

function friendly(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } }
  if (err.name === 'TimeoutError') return 'The service did not respond in time.'
  const code = err.cause?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not reach the service. Check your internet connection.'
  if (code === 'ECONNREFUSED') return 'Connection refused.'
  return err.message || String(e)
}

/** Queue a message for an integration (retried when offline). */
export function postToIntegration(id: string, m: OutgoingMessage): void {
  const r = rowOf(id)
  if (!r) throw new Error('Integration not found')
  if (!m.title.trim() && !m.body?.trim()) throw new Error('Write a message')
  enqueue('integration_post', { integrationId: id, message: { title: m.title.slice(0, 500), body: m.body?.slice(0, 3000) } }, { maxAttempts: 4 })
}

registerJobHandler<{ integrationId: string; message: OutgoingMessage }>(
  'integration_post',
  async ({ payload }) => {
    const r = rowOf(payload.integrationId)
    if (!r || !r.enabled) return
    try {
      await deliver(r.kind, decryptSecret(r.secret), JSON.parse(r.config) as IntegrationConfig, payload.message)
    } catch (e) {
      const msg = friendly(e)
      run('UPDATE integrations SET last_error = ? WHERE id = ?', msg, r.id)
      // a revoked webhook won't start working by retrying
      if (e instanceof IntegrationError) return
      throw new Error(msg)
    }
    run('UPDATE integrations SET last_error = NULL, last_used_at = ? WHERE id = ?', now(), r.id)
  },
  (job, error) => run('UPDATE integrations SET last_error = ? WHERE id = ?', error, job.payload.integrationId)
)

// notifications → every integration that mirrors them
onNotify((n: AppNotification) => {
  for (const i of listIntegrations()) {
    if (i.enabled && i.config.mirrorNotifications) postToIntegration(i.id, { title: n.title, body: n.body || undefined })
  }
})

// ---------------------------------------------------------------- Slack channel → tasks

/** Channels the bot can see, for the channel picker. */
export async function listSlackChannels(input: { token?: string; id?: string }): Promise<{ id: string; name: string; member: boolean }[]> {
  const token = input.token?.trim() || (input.id ? decryptSecret(rowOf(input.id)?.secret ?? '') : '')
  validateSecret('slack_bot', token)
  const out: { id: string; name: string; member: boolean }[] = []
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const r = await slackCall<{ ok: boolean; channels: { id: string; name: string; is_member: boolean }[]; response_metadata?: { next_cursor?: string } }>(
      token, 'conversations.list', undefined,
      { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) }
    )
    out.push(...r.channels.map((c) => ({ id: c.id, name: c.name, member: c.is_member })))
    cursor = r.response_metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  return out.sort((a, b) => Number(b.member) - Number(a.member) || a.name.localeCompare(b.name))
}

/** Slack markup → plain text. */
export function slackToText(s: string): string {
  return s
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_m, name: string | undefined) => `@${name ?? 'someone'}`)
    .replace(/<#[A-Z0-9]+(?:\|([^>]*))?>/g, (_m, name: string | undefined) => `#${name || 'channel'}`)
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface SlackMessage {
  ts: string
  text?: string
  subtype?: string
  reactions?: { name: string; count: number }[]
}

/** Turn reacted messages in the watched channel into tasks. Returns how many were created. */
export async function pollSlack(id: string): Promise<number> {
  const r = rowOf(id)
  if (!r || !r.enabled || r.kind !== 'slack_bot') return 0
  const cfg = JSON.parse(r.config) as IntegrationConfig
  const watch = cfg.watch
  if (!watch?.enabled || !watch.list_id || !cfg.channel) return 0
  if (!get('SELECT 1 FROM lists WHERE id = ?', watch.list_id)) throw new Error('The list for Slack tasks was deleted')
  const token = decryptSecret(r.secret)
  // a week back is enough: reactions are usually added soon after posting
  const oldest = String(Math.floor(Date.now() / 1000) - 7 * 86_400)
  let created = 0
  try {
    const history = await slackCall<{ ok: boolean; messages: SlackMessage[] }>(token, 'conversations.history', undefined, {
      channel: cfg.channel, oldest, limit: '200'
    })
    for (const m of history.messages) {
      if (m.subtype && m.subtype !== 'thread_broadcast' && m.subtype !== 'file_share') continue
      if (!m.reactions?.some((x) => x.name === watch.emoji)) continue
      if (get('SELECT 1 FROM slack_imported WHERE integration_id = ? AND ts = ?', id, m.ts)) continue
      const text = slackToText(m.text ?? '').trim()
      const firstLine = text.split('\n').find((l) => l.trim()) ?? 'Slack message'
      let link = ''
      try {
        link = (await slackCall<{ ok: boolean; permalink: string }>(token, 'chat.getPermalink', undefined, { channel: cfg.channel, message_ts: m.ts })).permalink
      } catch {
        /* the task is still useful without the link */
      }
      tx(() => {
        // re-check inside the transaction: two polls may overlap
        if (get('SELECT 1 FROM slack_imported WHERE integration_id = ? AND ts = ?', id, m.ts)) return
        const desc = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>${link ? `<p><a href="${escapeHtml(link)}">Open in Slack</a></p>` : ''}`
        const task = createTask(
          { list_id: watch.list_id!, title: firstLine.slice(0, 200), description: desc },
          { source: 'slack' }
        )
        run('INSERT INTO slack_imported (integration_id, ts, task_id, created_at) VALUES (?, ?, ?, ?)', id, m.ts, task.id, now())
        created++
      })
    }
    run('UPDATE integrations SET last_error = NULL, last_used_at = ? WHERE id = ?', now(), id)
  } catch (e) {
    run('UPDATE integrations SET last_error = ? WHERE id = ?', friendly(e), id)
    throw e
  }
  return created
}

registerJobHandler<{ integrationId: string }>('slack_poll', async ({ payload }) => {
  await pollSlack(payload.integrationId)
})

const lastPoll = new Map<string, number>()

/** Called by the scheduler; polls watched channels every two minutes. */
export function slackTick(at = Date.now()): void {
  for (const i of listIntegrations()) {
    if (!i.enabled || i.kind !== 'slack_bot' || !i.config.watch?.enabled) continue
    if (at - (lastPoll.get(i.id) ?? 0) < 2 * 60_000) continue
    lastPoll.set(i.id, at)
    enqueue('slack_poll', { integrationId: i.id }, { maxAttempts: 1 })
  }
}
