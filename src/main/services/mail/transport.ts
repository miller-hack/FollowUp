import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import type { ServerConfig } from '@shared/mail'

const isLocal = (host: string) => ['localhost', '127.0.0.1', '::1'].includes(host)

/** App password, or an OAuth access token (Google / Microsoft sign-in, sent as XOAUTH2). */
export type MailAuth = { pass: string } | { accessToken: string }

export interface FolderInfo {
  path: string
  specialUse: string | null
}

export interface FetchedMessage {
  uid: number
  flags: Set<string>
  source: Buffer
}

/** Thin wrapper around ImapFlow with the handful of operations the sync needs. */
export class ImapSession {
  private client: ImapFlow

  constructor(cfg: ServerConfig, auth: MailAuth) {
    this.client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // never send credentials in clear text to a remote server
      doSTARTTLS: cfg.secure ? undefined : !isLocal(cfg.host),
      auth: { user: cfg.user, ...auth },
      logger: false,
      emitLogs: false,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000
    })
    // without a listener, a dropped connection would crash the process
    this.client.on('error', () => {})
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect()
    } catch (e) {
      // a failed login leaves the socket open otherwise
      this.client.close()
      throw e
    }
  }

  async folders(): Promise<FolderInfo[]> {
    return (await this.client.list()).map((f) => ({ path: f.path, specialUse: f.specialUse ?? null }))
  }

  /** Select a folder; returns its UIDVALIDITY as a string (it is a BigInt in imapflow). */
  async open(path: string): Promise<{ uidValidity: string; exists: number }> {
    const box = await this.client.mailboxOpen(path)
    return { uidValidity: String(box.uidValidity), exists: box.exists }
  }

  async searchSince(since: Date): Promise<number[]> {
    const r = await this.client.search({ since }, { uid: true })
    return Array.isArray(r) ? r : []
  }

  async *fetch(range: string, withSource = true): AsyncGenerator<FetchedMessage> {
    for await (const m of this.client.fetch(range, { uid: true, flags: true, source: withSource }, { uid: true })) {
      yield { uid: m.uid, flags: m.flags ?? new Set(), source: (m.source as Buffer) ?? Buffer.alloc(0) }
    }
  }

  async setSeen(uids: number[], seen: boolean): Promise<void> {
    if (!uids.length) return
    const range = uids.join(',')
    if (seen) await this.client.messageFlagsAdd(range, ['\\Seen'], { uid: true })
    else await this.client.messageFlagsRemove(range, ['\\Seen'], { uid: true })
  }

  async append(path: string, raw: Buffer, flags: string[]): Promise<void> {
    await this.client.append(path, raw, flags)
  }

  async close(): Promise<void> {
    try {
      await this.client.logout()
    } catch {
      this.client.close()
    }
  }
}

export async function withImap<T>(cfg: ServerConfig, auth: MailAuth, fn: (s: ImapSession) => Promise<T>): Promise<T> {
  const s = new ImapSession(cfg, auth)
  await s.connect()
  try {
    return await fn(s)
  } finally {
    await s.close()
  }
}

export function smtpTransport(cfg: ServerConfig, auth: MailAuth) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && !isLocal(cfg.host),
    auth: 'accessToken' in auth ? { type: 'OAuth2', user: cfg.user, accessToken: auth.accessToken } : { user: cfg.user, pass: auth.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000
  })
}

/** Turn library errors into something a person can act on. */
type LibError = { message?: string; code?: string; responseText?: string; authenticationFailed?: boolean; response?: string }
const errText = (err: LibError) => `${err.responseText ?? ''} ${err.response ?? ''} ${err.message ?? ''}`.trim()

/** The server refused the login (wrong password, expired / revoked token). */
export function isAuthError(e: unknown): boolean {
  const err = (e ?? {}) as LibError
  return !!err.authenticationFailed || err.code === 'EAUTH' || /auth|credentials|login|password|535|534/i.test(errText(err))
}

export function friendlyMailError(e: unknown, oauth = false): string {
  const err = e as LibError
  const text = errText(err)
  if (isAuthError(e))
    return oauth
      ? 'The server refused the sign-in. Sign in again in Settings → Accounts (and check that IMAP is enabled for the mailbox).'
      : 'Sign-in failed. Check the username and app password (a normal password usually does not work).'
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'Server not found. Check the host name and your internet connection.'
  if (err.code === 'ECONNREFUSED') return 'Connection refused. Check the port and TLS setting.'
  if (err.code === 'ETIMEDOUT' || /timed? ?out/i.test(text)) return 'The server did not respond in time.'
  if (/certificate|self.signed|TLS|SSL/i.test(text)) return `Secure connection failed: ${text}`
  return text || 'Unknown error'
}
