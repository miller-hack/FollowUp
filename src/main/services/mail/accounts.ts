import type { Account, AccountInput, CalDavConfig, MailAccountConfig } from '@shared/mail'
import { all, get, now, run, tx, uuid } from '../../db'
import { emit } from '../events'
import { enqueue, registerJobHandler } from '../jobs'
import { decryptSecret, encryptSecret } from './secrets'
import { parseRaw, removeAccountFiles, storeMessage } from './store'
import { friendlyMailError, isAuthError, smtpTransport, withImap, type ImapSession, type MailAuth } from './transport'
import type { OAuthProvider } from '@shared/integrations'
import { accessToken, authorize, forgetAccessToken, oauthSecret, parseOAuthSecret, primeAccessToken } from '../oauth'
import { onInboundReply } from './sequences'

interface Row {
  id: string
  kind: Account['kind']
  name: string
  email: string
  config: string
  secret: string
  enabled: number
  sync_state: string
  last_sync_at: string | null
  last_error: string | null
  created_at: string
}

type FolderState = { uidValidity: string; lastUid: number }
type SyncState = Record<string, FolderState>

const toAccount = (r: Row): Account => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  email: r.email,
  config: JSON.parse(r.config),
  enabled: !!r.enabled,
  last_sync_at: r.last_sync_at,
  last_error: r.last_error,
  created_at: r.created_at
})

export function listAccounts(): Account[] {
  return all<Row>('SELECT * FROM accounts ORDER BY created_at').map(toAccount)
}

export function getAccountFull(id: string): (Account & { password: string; state: SyncState }) | null {
  const r = get<Row>('SELECT * FROM accounts WHERE id = ?', id)
  return r ? { ...toAccount(r), password: decryptSecret(r.secret), state: JSON.parse(r.sync_state) as SyncState } : null
}

/** How to log in to an account's servers: its app password, or a fresh OAuth access token. */
export async function authFor(acc: { id: string; password: string }): Promise<MailAuth> {
  const o = parseOAuthSecret(acc.password)
  return o ? { accessToken: await accessToken(acc.id, o) } : { pass: acc.password }
}

/** Sync / send failed: if it was a login problem on an OAuth account, drop the cached token. */
function onAuthError(acc: { id: string; password: string }, e: unknown): void {
  if (parseOAuthSecret(acc.password) && isAuthError(e)) forgetAccessToken(acc.id)
}

function validate(input: AccountInput): void {
  if (input.kind === 'mail') {
    const c = input.config as MailAccountConfig
    if (!/^\S+@\S+\.\S+$/.test(input.email)) throw new Error('Enter a valid email address')
    if (!c.imap?.host || !c.smtp?.host) throw new Error('Enter the IMAP and SMTP servers')
    if (!c.imap.user || !c.smtp.user) throw new Error('Enter the username')
  } else {
    const c = input.config as CalDavConfig
    if (!/^https?:\/\//.test(c.url ?? '')) throw new Error('Enter the CalDAV server URL (https://…)')
    if (!c.user) throw new Error('Enter the username')
  }
}

export function createAccount(input: AccountInput): Account {
  validate(input)
  if (!input.password) throw new Error('Enter the app password')
  const id = uuid()
  run(
    'INSERT INTO accounts (id, kind, name, email, config, secret) VALUES (?, ?, ?, ?, ?, ?)',
    id, input.kind, input.name.trim() || input.email, input.email.trim().toLowerCase(), input.config, encryptSecret(input.password)
  )
  enqueue('account_sync', { accountId: id }, { maxAttempts: 1 })
  return toAccount(get<Row>('SELECT * FROM accounts WHERE id = ?', id)!)
}

export function updateAccount(id: string, patch: Partial<AccountInput> & { enabled?: boolean }): Account {
  const cur = getAccountFull(id)
  if (!cur) throw new Error('Account not found')
  const next: AccountInput = { kind: cur.kind, name: patch.name ?? cur.name, email: patch.email ?? cur.email, config: patch.config ?? cur.config }
  validate(next)
  run(
    'UPDATE accounts SET name = ?, email = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ?',
    next.name, next.email.toLowerCase(), next.config, patch.enabled ?? cur.enabled, now(), id
  )
  if (patch.password) run('UPDATE accounts SET secret = ? WHERE id = ?', encryptSecret(patch.password), id)
  return toAccount(get<Row>('SELECT * FROM accounts WHERE id = ?', id)!)
}

// ---------------------------------------------------------------- Google / Microsoft sign-in

function oauthConfigs(p: OAuthProvider, email: string): { kind: Account['kind']; config: MailAccountConfig | CalDavConfig }[] {
  if (p === 'google')
    return [
      {
        kind: 'mail',
        config: {
          imap: { host: 'imap.gmail.com', port: 993, secure: true, user: email },
          smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: email },
          syncDays: 30,
          appendSent: false,
          preset: 'gmail',
          oauth: 'google'
        }
      },
      { kind: 'caldav', config: { url: 'https://apidata.googleusercontent.com/caldav/v2/', user: email, oauth: 'google' } }
    ]
  return [
    {
      kind: 'mail',
      config: {
        imap: { host: 'outlook.office365.com', port: 993, secure: true, user: email },
        smtp: { host: 'smtp.office365.com', port: 587, secure: false, user: email },
        syncDays: 30,
        // Exchange keeps a copy of SMTP-sent mail in Sent Items itself
        appendSent: false,
        preset: 'outlook',
        oauth: 'microsoft'
      }
    }
  ]
}

/**
 * Sign in with Google (Gmail + Google Calendar) or Microsoft (Outlook mail) in the browser,
 * then add the accounts, or refresh the sign-in of existing ones with the same address.
 */
export async function signInWithProvider(p: OAuthProvider, reconnectAccountId?: string): Promise<Account[]> {
  const hint = reconnectAccountId ? getAccountFull(reconnectAccountId)?.email : undefined
  const r = await authorize(p, hint)
  const secret = encryptSecret(oauthSecret(r))
  const ids = tx(() =>
    oauthConfigs(p, r.email).map(({ kind, config }) => {
      const existing = get<{ id: string; config: string }>('SELECT id, config FROM accounts WHERE kind = ? AND email = ?', kind, r.email)
      if (existing) {
        // keep sync options the user changed; switch the login to OAuth
        const prev = JSON.parse(existing.config) as Partial<MailAccountConfig>
        const next = kind === 'mail' ? { ...config, syncDays: prev.syncDays ?? 30 } : config
        run('UPDATE accounts SET secret = ?, config = ?, enabled = 1, last_error = NULL, updated_at = ? WHERE id = ?', secret, next, now(), existing.id)
        return existing.id
      }
      const id = uuid()
      run(
        'INSERT INTO accounts (id, kind, name, email, config, secret) VALUES (?, ?, ?, ?, ?, ?)',
        id, kind, kind === 'mail' ? r.name : `${r.name} (Google Calendar)`, r.email, config, secret
      )
      return id
    })
  )
  for (const id of ids) {
    primeAccessToken(id, r)
    enqueue('account_sync', { accountId: id }, { maxAttempts: 1 })
  }
  return ids.map((id) => toAccount(get<Row>('SELECT * FROM accounts WHERE id = ?', id)!))
}

export function deleteAccount(id: string): void {
  forgetAccessToken(id)
  tx(() => {
    // FTS rows aren't covered by the foreign-key cascade
    run('DELETE FROM mail_fts WHERE message_id IN (SELECT id FROM mail_messages WHERE account_id = ?)', id)
    run('DELETE FROM accounts WHERE id = ?', id)
  })
  removeAccountFiles(id)
}

// ---------------------------------------------------------------- connection test

export async function testMailConnection(input: AccountInput & { accountId?: string }): Promise<{ imap: string | null; smtp: string | null }> {
  const c = input.config as MailAccountConfig
  let imap: string | null = null
  let smtp: string | null = null
  const saved = input.accountId ? getAccountFull(input.accountId) : null
  let auth: MailAuth
  try {
    auth = input.password ? { pass: input.password } : saved ? await authFor(saved) : { pass: '' }
  } catch (e) {
    const msg = (e as Error).message
    return { imap: msg, smtp: msg }
  }
  try {
    await withImap(c.imap, auth, async (s) => {
      await s.folders()
    })
  } catch (e) {
    imap = friendlyMailError(e, !!c.oauth, c.preset)
  }
  const t = smtpTransport(c.smtp, auth)
  try {
    await t.verify()
  } catch (e) {
    smtp = friendlyMailError(e, !!c.oauth, c.preset)
  } finally {
    t.close()
  }
  return { imap, smtp }
}

// ---------------------------------------------------------------- mail sync

const MAX_INITIAL = 500

async function findSentFolder(s: ImapSession): Promise<string | null> {
  const folders = await s.folders()
  return folders.find((f) => f.specialUse === '\\Sent')?.path ?? folders.find((f) => /^(sent|sent items|sent mail|\[gmail\]\/sent mail)$/i.test(f.path))?.path ?? null
}

/**
 * Pull new messages from INBOX and Sent. The first sync imports `syncDays` of history
 * silently; later syncs emit `mail.received` for new inbound mail (automations,
 * follow-up reply detection).
 */
export async function syncMailAccount(accountId: string): Promise<{ added: number }> {
  const acc = getAccountFull(accountId)
  if (!acc || acc.kind !== 'mail') throw new Error('Mail account not found')
  const cfg = acc.config as MailAccountConfig
  const state: SyncState = { ...acc.state }
  let added = 0
  // a message that can't be parsed or stored is skipped, never retried forever (ADR-003)
  let skipped = 0
  try {
    await withImap(cfg.imap, await authFor(acc), async (s) => {
      const sent = await findSentFolder(s)
      for (const [folder, inInbox] of [['INBOX', true], [sent, false]] as [string | null, boolean][]) {
        if (!folder) continue
        const box = await s.open(folder)
        const prev = state[folder]
        const initial = !prev || prev.uidValidity !== box.uidValidity
        const fs: FolderState = initial ? { uidValidity: box.uidValidity, lastUid: 0 } : { ...prev }
        let range: string | null = null
        if (fs.lastUid === 0) {
          const since = new Date(Date.now() - cfg.syncDays * 86_400_000)
          const uids = (await s.searchSince(since)).sort((a, b) => a - b).slice(-MAX_INITIAL)
          if (uids.length) range = uids.join(',')
        } else if (box.exists > 0) {
          range = `${fs.lastUid + 1}:*`
        }
        if (range) {
          for await (const msg of s.fetch(range)) {
            if (msg.uid <= fs.lastUid) continue // "n:*" always returns the newest message
            fs.lastUid = Math.max(fs.lastUid, msg.uid)
            try {
              const parsed = await parseRaw(msg.source)
              const r = storeMessage(accountId, parsed, { accountEmail: acc.email, folder, uid: msg.uid, seen: msg.flags.has('\\Seen'), inInbox })
              if (!r.isNew) continue
              added++
              if (!initial && !r.isOutbound) {
                tx(() => {
                  onInboundReply(r.threadId, parsed.from.address, parsed.subject)
                  emit({ type: 'mail.received', threadId: r.threadId, messageId: r.messageRowId })
                })
              }
            } catch (e) {
              skipped++
              console.warn(`Skipped message UID ${msg.uid} in ${folder}`, e)
            }
          }
        }
        // refresh read/unread for recent inbox mail (read on another device)
        if (inInbox && fs.lastUid > 0) {
          const from = Math.max(1, fs.lastUid - 300)
          for await (const msg of s.fetch(`${from}:${fs.lastUid}`, false)) {
            run('UPDATE mail_messages SET is_read = ? WHERE account_id = ? AND folder = ? AND uid = ?', msg.flags.has('\\Seen'), accountId, folder, msg.uid)
          }
        }
        state[folder] = fs
        run('UPDATE accounts SET sync_state = ? WHERE id = ?', state, accountId)
      }
    })
    run(
      'UPDATE accounts SET last_sync_at = ?, last_error = ? WHERE id = ?',
      now(),
      skipped ? `Skipped ${skipped} message${skipped === 1 ? '' : 's'} that could not be read (still on the server).` : null,
      accountId
    )
  } catch (e) {
    onAuthError(acc, e)
    run('UPDATE accounts SET last_error = ? WHERE id = ?', friendlyMailError(e, !!cfg.oauth, cfg.preset), accountId)
    throw e
  }
  return { added }
}

/** Push read/unread changes made in the app to the server. */
registerJobHandler<{ accountId: string; folder: string; uids: number[]; seen: boolean }>(
  'mail_flags',
  async ({ payload }) => {
    const acc = getAccountFull(payload.accountId)
    if (!acc) return
    await withImap((acc.config as MailAccountConfig).imap, await authFor(acc), async (s) => {
      await s.open(payload.folder)
      await s.setSeen(payload.uids, payload.seen)
    })
  }
)

export function markThreadRead(threadId: string, read: boolean): void {
  tx(() => {
    const msgs = all<{ account_id: string; folder: string | null; uid: number | null }>(
      'SELECT account_id, folder, uid FROM mail_messages WHERE thread_id = ? AND is_outbound = 0 AND is_read = ?',
      threadId,
      !read
    )
    run('UPDATE mail_messages SET is_read = ? WHERE thread_id = ? AND is_outbound = 0', read, threadId)
    const byFolder = new Map<string, { accountId: string; folder: string; uids: number[] }>()
    for (const m of msgs) {
      if (!m.folder || !m.uid) continue
      const k = `${m.account_id}|${m.folder}`
      const e = byFolder.get(k) ?? { accountId: m.account_id, folder: m.folder, uids: [] }
      e.uids.push(m.uid)
      byFolder.set(k, e)
    }
    for (const e of byFolder.values()) enqueue('mail_flags', { ...e, seen: read }, { maxAttempts: 5 })
  })
}

export function setThreadDone(threadId: string, done: boolean): void {
  run('UPDATE mail_threads SET done = ?, updated_at = ? WHERE id = ?', done, now(), threadId)
}
