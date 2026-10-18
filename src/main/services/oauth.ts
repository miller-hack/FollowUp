import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { OAuthClientStatus, OAuthProvider } from '@shared/integrations'
import { run } from '../db'
import { getSecretSetting, getSettings, setSecretSetting, updateSettings } from './meta'
import { encryptSecret } from './mail/secrets'

/**
 * "Sign in with Google / Microsoft" for desktop apps: authorization code flow with
 * PKCE and a one-off loopback redirect (http://127.0.0.1:<random port>), as Google
 * and Microsoft recommend for installed apps. Refresh tokens are stored encrypted
 * in the account's secret; access tokens live only in memory.
 */

interface ProviderDef {
  authUrl: string
  tokenUrl: string
  scopes: string[]
  extra: Record<string, string>
  redirectHost: string
}

const DEFS: Record<OAuthProvider, ProviderDef> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // full mail access is what IMAP/SMTP need; calendar for CalDAV
    scopes: ['openid', 'email', 'profile', 'https://mail.google.com/', 'https://www.googleapis.com/auth/calendar'],
    extra: { access_type: 'offline', prompt: 'consent' },
    redirectHost: '127.0.0.1'
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send'],
    extra: { prompt: 'select_account' },
    // Microsoft accepts any port for http://localhost redirects of desktop apps
    redirectHost: 'localhost'
  }
}

export const PROVIDER_NAME: Record<OAuthProvider, string> = { google: 'Google', microsoft: 'Microsoft' }

/** Test hook: replace endpoints (fake OAuth server) and the browser. */
export function setOAuthTestHooks(hooks: { endpoints?: Partial<Record<OAuthProvider, { authUrl: string; tokenUrl: string }>>; openBrowser?: ((url: string) => void) | null }): void {
  for (const [p, e] of Object.entries(hooks.endpoints ?? {})) Object.assign(DEFS[p as OAuthProvider], e)
  if (hooks.openBrowser !== undefined) opener = hooks.openBrowser
}

let opener: ((url: string) => void) | null = null
export function setBrowserOpener(fn: (url: string) => void): void {
  if (!opener) opener = fn
}

// ---------------------------------------------------------------- client ids

const BUILT_IN: Record<OAuthProvider, { id?: string; secret?: string }> = {
  google: {
    id: process.env['FOLLOWUP_GOOGLE_CLIENT_ID'] || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
    secret: process.env['FOLLOWUP_GOOGLE_CLIENT_SECRET'] || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
  },
  microsoft: { id: process.env['FOLLOWUP_MICROSOFT_CLIENT_ID'] || import.meta.env.MAIN_VITE_MICROSOFT_CLIENT_ID }
}

function client(p: OAuthProvider): { id: string; secret: string; builtIn: boolean } {
  const s = getSettings().oauth
  const own = p === 'google' ? s.googleClientId : s.microsoftClientId
  if (own) return { id: own, secret: getSecretSetting(`oauth_${p}`), builtIn: false }
  return { id: BUILT_IN[p].id ?? '', secret: BUILT_IN[p].secret ?? '', builtIn: !!BUILT_IN[p].id }
}

export function getOAuthClients(): Record<OAuthProvider, OAuthClientStatus> {
  const out = {} as Record<OAuthProvider, OAuthClientStatus>
  for (const p of ['google', 'microsoft'] as OAuthProvider[]) {
    const c = client(p)
    out[p] = { clientId: c.id, hasSecret: !!c.secret, builtIn: c.builtIn }
  }
  return out
}

export function setOAuthClient(p: OAuthProvider, clientId: string, secret?: string | null): void {
  const id = clientId.trim()
  if (id && p === 'google' && !/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('A Google client ID ends with .apps.googleusercontent.com')
  if (id && p === 'microsoft' && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('A Microsoft application (client) ID looks like 00000000-0000-0000-0000-000000000000')
  const cur = getSettings().oauth
  updateSettings({ oauth: { ...cur, [p === 'google' ? 'googleClientId' : 'microsoftClientId']: id } })
  if (secret !== undefined) setSecretSetting(`oauth_${p}`, secret?.trim() || null)
  if (!id) setSecretSetting(`oauth_${p}`, null)
}

// ---------------------------------------------------------------- sign-in

export interface OAuthResult {
  provider: OAuthProvider
  email: string
  name: string
  refreshToken: string
  accessToken: string
  expiresAt: number
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let pending: { server: Server; reject: (e: Error) => void } | null = null

/** Abort a sign-in that is waiting for the browser. */
export function cancelOAuth(): void {
  pending?.reject(new Error('Sign-in was cancelled'))
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>FollowUp</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#222"><div style="text-align:center"><h2>${title}</h2><p>${text}</p></div></body>`

/** Run the browser sign-in and return tokens plus the signed-in address. */
export async function authorize(p: OAuthProvider, loginHint?: string): Promise<OAuthResult> {
  const c = client(p)
  if (!c.id) throw new Error(`NEEDS_CLIENT: Set up a ${PROVIDER_NAME[p]} client ID first`)
  if (!opener) throw new Error('No browser available')
  cancelOAuth()
  const def = DEFS[p]
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as { port: number }).port
  const redirectUri = `http://${def.redirectHost}:${port}/callback`

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out. Try again.')), 5 * 60_000)
    const finish = (fn: () => void) => {
      clearTimeout(timer)
      pending = null
      fn()
    }
    pending = { server, reject: (e) => finish(() => reject(e)) }
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (u.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = u.searchParams.get('error')
      const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code')
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ok ? PAGE('You are signed in', 'You can close this tab and return to FollowUp.') : PAGE('Sign-in did not complete', 'Return to FollowUp and try again.'))
      if (ok) finish(() => resolve(u.searchParams.get('code')!))
      else finish(() => reject(new Error(err === 'access_denied' ? 'Sign-in was cancelled in the browser' : `Sign-in failed${err ? `: ${err}` : ''}`)))
    })
    const params = new URLSearchParams({
      client_id: c.id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: def.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...def.extra,
      ...(loginHint ? { login_hint: loginHint } : {})
    })
    try {
      opener!(`${def.authUrl}?${params}`)
    } catch (e) {
      finish(() => reject(e as Error))
    }
  }).finally(() => {
    server.close()
    server.closeAllConnections()
  })

  const tokens = await tokenRequest(p, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  })
  if (!tokens.refresh_token) throw new Error(`${PROVIDER_NAME[p]} did not grant offline access. Remove FollowUp from your account's connected apps and try again.`)
  const claims = decodeJwt(tokens.id_token)
  const email = String(claims['email'] ?? claims['preferred_username'] ?? '').toLowerCase()
  if (!email.includes('@')) throw new Error(`${PROVIDER_NAME[p]} did not share the email address`)
  return {
    provider: p,
    email,
    name: String(claims['name'] ?? email),
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000
  }
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  error?: string
  error_description?: string
}

async function tokenRequest(p: OAuthProvider, body: Record<string, string>): Promise<TokenResponse> {
  const c = client(p)
  const form = new URLSearchParams({ client_id: c.id, ...body, ...(c.secret ? { client_secret: c.secret } : {}) })
  if (p === 'microsoft') form.set('scope', DEFS.microsoft.scopes.join(' '))
  let res: Response
  try {
    res = await fetch(DEFS[p].tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    throw new Error(`Could not reach ${PROVIDER_NAME[p]}. Check your internet connection.`)
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') throw new OAuthExpiredError(p)
    if (data.error === 'invalid_client' || data.error === 'unauthorized_client')
      throw new Error(`${PROVIDER_NAME[p]} rejected the client ID${p === 'google' ? ' or secret' : ''}. Check it in Settings → Accounts.`)
    throw new Error(`${PROVIDER_NAME[p]} sign-in failed: ${data.error_description || data.error || res.status}`)
  }
  return data
}

export class OAuthExpiredError extends Error {
  constructor(p: OAuthProvider) {
    super(`${PROVIDER_NAME[p]} sign-in expired or was revoked. Sign in again in Settings → Accounts.`)
  }
}

/** id_token payload. It comes straight from the token endpoint over TLS, so its signature needn't be checked here. */
function decodeJwt(token?: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------- tokens for accounts

/** What is stored (encrypted) as the secret of an OAuth account. */
export interface StoredOAuth {
  oauth: OAuthProvider
  refresh_token: string
}

export const oauthSecret = (r: OAuthResult): string => JSON.stringify({ oauth: r.provider, refresh_token: r.refreshToken } satisfies StoredOAuth)

export function parseOAuthSecret(secret: string): StoredOAuth | null {
  if (!secret.startsWith('{')) return null
  try {
    const s = JSON.parse(secret) as StoredOAuth
    return s.oauth && s.refresh_token ? s : null
  } catch {
    return null
  }
}

const cache = new Map<string, { token: string; exp: number }>()

/** Seed the cache right after sign-in so the first sync needs no extra refresh. */
export function primeAccessToken(accountId: string, r: OAuthResult): void {
  cache.set(accountId, { token: r.accessToken, exp: r.expiresAt })
}

const inflight = new Map<string, Promise<string>>()

/** A valid access token for an OAuth account, refreshed when (nearly) expired. */
export function accessToken(accountId: string, stored: StoredOAuth): Promise<string> {
  const hit = cache.get(accountId)
  if (hit && hit.exp - Date.now() > 60_000) return Promise.resolve(hit.token)
  // one refresh at a time per account (sync and send may ask together)
  let p = inflight.get(accountId)
  if (!p) {
    p = (async () => {
      const t = await tokenRequest(stored.oauth, { grant_type: 'refresh_token', refresh_token: stored.refresh_token })
      cache.set(accountId, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 })
      // Microsoft rotates refresh tokens
      if (t.refresh_token && t.refresh_token !== stored.refresh_token)
        run('UPDATE accounts SET secret = ? WHERE id = ?', encryptSecret(JSON.stringify({ oauth: stored.oauth, refresh_token: t.refresh_token })), accountId)
      return t.access_token
    })().finally(() => inflight.delete(accountId))
    inflight.set(accountId, p)
  }
  return p
}

export function forgetAccessToken(accountId: string): void {
  cache.delete(accountId)
}
