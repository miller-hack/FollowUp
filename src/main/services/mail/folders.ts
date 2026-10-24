import type { FolderRole, MailAccountConfig, MailFolderInfo } from '@shared/mail'
import { all, get, marks, now, run, tx, uuid } from '../../db'
import { enqueue, registerJobHandler } from '../jobs'
import { parseRaw, storeMessage } from './store'
import type { ImapSession } from './transport'

/**
 * Every server folder (ADR-014). Messages are stored once per account (by Message-ID) and
 * `mail_locations` records each folder a message is in, with its UID there. Known messages
 * are matched from their envelope, so a message seen in several folders (Gmail labels,
 * All Mail) is downloaded only once.
 */

const MAX_INITIAL = 500

// ---------------------------------------------------------------- roles

const SPECIAL_USE: Record<string, FolderRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Junk': 'spam',
  '\\Trash': 'trash',
  '\\Archive': 'archive',
  '\\All': 'all'
}

/** Gmail's views of the same mail that would only add duplicates. */
const SKIPPED_SPECIAL = new Set(['\\Flagged', '\\Important'])

export function folderRole(path: string, name: string, specialUse: string | null): FolderRole | null {
  if (path.toUpperCase() === 'INBOX') return 'inbox'
  if (specialUse && SPECIAL_USE[specialUse]) return SPECIAL_USE[specialUse]
  const n = name.toLowerCase()
  if (/^(sent|sent items|sent messages|sent mail)$/.test(n)) return 'sent'
  if (/^drafts?$/.test(n)) return 'drafts'
  if (/^(junk|spam|junk e-?mail|bulk mail)$/.test(n)) return 'spam'
  if (/^(trash|deleted|deleted items|deleted messages|bin)$/.test(n)) return 'trash'
  if (/^archives?$/.test(n)) return 'archive'
  return null
}

const ROLE_ORDER: Record<FolderRole, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, all: 4, spam: 5, trash: 6 }

// ---------------------------------------------------------------- sync

interface FolderRow {
  id: string
  path: string
  role: FolderRole | null
  uid_validity: string | null
  last_uid: number
}

export interface FolderSyncResult {
  added: number
  skipped: number
  /** threads with new or removed messages (for follow-up recomputation) */
  touched: Set<string>
  /** new mail in the inbox after the first sync: [threadId, messageRowId] */
  received: [string, string][]
}

/** Bring the folder list up to date; returns the folders to sync. */
async function refreshFolders(s: ImapSession, accountId: string, legacy: Record<string, { uidValidity: string; lastUid: number }>): Promise<FolderRow[]> {
  const listed = (await s.folders()).filter((f) => f.selectable && !(f.specialUse && SKIPPED_SPECIAL.has(f.specialUse)))
  tx(() => {
    for (const f of listed) {
      const role = folderRole(f.path, f.name, f.specialUse)
      const position = role ? ROLE_ORDER[role] : 10
      const existing = get<{ id: string }>('SELECT id FROM mail_folders WHERE account_id = ? AND path = ?', accountId, f.path)
      if (existing) {
        run('UPDATE mail_folders SET name = ?, delimiter = ?, role = ?, position = ?, updated_at = ? WHERE id = ?', f.name, f.delimiter, role, position, now(), existing.id)
      } else {
        // carry over where 1.0 left off in INBOX and Sent (no re-download, no repeated "new mail")
        const prev = legacy[f.path]
        run(
          'INSERT INTO mail_folders (id, account_id, path, name, delimiter, role, uid_validity, last_uid, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          uuid(), accountId, f.path, f.name, f.delimiter, role, prev?.uidValidity ?? null, prev?.lastUid ?? 0, position
        )
      }
    }
    // folders deleted on the server
    const paths = listed.map((f) => f.path)
    const gone = all<{ path: string }>(`SELECT path FROM mail_folders WHERE account_id = ? AND path NOT IN (${paths.length ? marks(paths.length) : "''"})`, accountId, ...paths)
    for (const g of gone) {
      run('DELETE FROM mail_locations WHERE account_id = ? AND folder = ?', accountId, g.path)
      run('DELETE FROM mail_folders WHERE account_id = ? AND path = ?', accountId, g.path)
    }
  })
  return all<FolderRow>('SELECT id, path, role, uid_validity, last_uid FROM mail_folders WHERE account_id = ? ORDER BY position, path', accountId)
}

const addLocation = (messageId: string, accountId: string, folder: string, uid: number) =>
  run('INSERT INTO mail_locations (message_id, account_id, folder, uid) VALUES (?, ?, ?, ?) ON CONFLICT(message_id, folder) DO UPDATE SET uid = excluded.uid', messageId, accountId, folder, uid)

/**
 * Sync every folder of a mail account. The first sync of a folder imports the last
 * `syncDays` (at most 500 messages); later syncs fetch only new UIDs, refresh read flags of
 * recent inbox mail, and notice messages that were moved or deleted elsewhere.
 */
export async function syncFolders(
  s: ImapSession,
  acc: { id: string; email: string; config: MailAccountConfig; legacyState: Record<string, { uidValidity: string; lastUid: number }> }
): Promise<FolderSyncResult> {
  const result: FolderSyncResult = { added: 0, skipped: 0, touched: new Set(), received: [] }
  const folders = await refreshFolders(s, acc.id, acc.legacyState)
  const lost = new Set<string>()
  for (const folder of folders) {
    const box = await s.open(folder.path)
    const initial = !folder.uid_validity || folder.uid_validity !== box.uidValidity
    if (initial && folder.uid_validity) {
      // UIDVALIDITY changed: every old UID in this folder is meaningless
      for (const r of all<{ message_id: string }>('SELECT message_id FROM mail_locations WHERE account_id = ? AND folder = ?', acc.id, folder.path)) lost.add(r.message_id)
      run('DELETE FROM mail_locations WHERE account_id = ? AND folder = ?', acc.id, folder.path)
    }
    let lastUid = initial ? 0 : folder.last_uid
    let range: string | null = null
    if (lastUid === 0) {
      const since = new Date(Date.now() - acc.config.syncDays * 86_400_000)
      const uids = (await s.searchSince(since)).sort((a, b) => a - b).slice(-MAX_INITIAL)
      if (uids.length) range = uids.join(',')
    } else if (box.exists > 0) {
      range = `${lastUid + 1}:*`
    }
    const isInbox = folder.role === 'inbox'
    if (range) {
      // pass 1: envelopes; known messages only get a location
      const unknown: { uid: number; seen: boolean; draft: boolean }[] = []
      for await (const e of s.envelopes(range)) {
        if (e.uid <= lastUid) continue // "n:*" always returns the newest message
        lastUid = Math.max(lastUid, e.uid)
        const known = e.messageId ? get<{ id: string; thread_id: string }>('SELECT id, thread_id FROM mail_messages WHERE account_id = ? AND message_id = ?', acc.id, e.messageId) : undefined
        if (known) {
          addLocation(known.id, acc.id, folder.path, e.uid)
          if (isInbox) run('UPDATE mail_messages SET is_read = ? WHERE id = ?', e.flags.has('\\Seen'), known.id)
          result.touched.add(known.thread_id)
        } else unknown.push({ uid: e.uid, seen: e.flags.has('\\Seen'), draft: e.flags.has('\\Draft') || folder.role === 'drafts' })
      }
      // pass 2: download what's new
      for (let i = 0; i < unknown.length; i += 50) {
        const batch = unknown.slice(i, i + 50)
        const meta = new Map(batch.map((b) => [b.uid, b]))
        for await (const msg of s.fetch(batch.map((b) => b.uid).join(','))) {
          const m = meta.get(msg.uid)
          if (!m) continue
          try {
            const parsed = await parseRaw(msg.source)
            const r = storeMessage(acc.id, parsed, { accountEmail: acc.email, folder: folder.path, uid: msg.uid, seen: m.seen, inInbox: isInbox })
            addLocation(r.messageRowId, acc.id, folder.path, msg.uid)
            if (m.draft) run('UPDATE mail_messages SET is_draft = 1 WHERE id = ?', r.messageRowId)
            result.touched.add(r.threadId)
            if (!r.isNew) continue
            result.added++
            if (!initial && isInbox && !r.isOutbound) result.received.push([r.threadId, r.messageRowId])
          } catch (e) {
            result.skipped++
            console.warn(`Skipped message UID ${msg.uid} in ${folder.path}`, e)
          }
        }
      }
    }
    // moved or deleted elsewhere: drop locations whose UID is gone
    if (!initial) {
      const present = new Set(await s.allUids())
      const stored = all<{ message_id: string; uid: number }>('SELECT message_id, uid FROM mail_locations WHERE account_id = ? AND folder = ?', acc.id, folder.path)
      // uid -1 = just moved here by FollowUp, waiting for this sync to learn the real UID
      const missing = stored.filter((l) => l.uid > 0 && !present.has(l.uid))
      if (missing.length) {
        tx(() => {
          for (const l of missing) {
            run('DELETE FROM mail_locations WHERE message_id = ? AND folder = ?', l.message_id, folder.path)
            lost.add(l.message_id)
          }
        })
      }
      // read/unread changes made on another device
      if (isInbox && lastUid > 0) {
        const from = Math.max(1, lastUid - 300)
        for await (const msg of s.fetch(`${from}:${lastUid}`, false)) {
          run(
            'UPDATE mail_messages SET is_read = ? WHERE id = (SELECT message_id FROM mail_locations WHERE account_id = ? AND folder = ? AND uid = ?)',
            msg.flags.has('\\Seen'), acc.id, folder.path, msg.uid
          )
        }
      }
    }
    run('UPDATE mail_folders SET uid_validity = ?, last_uid = ?, updated_at = ? WHERE id = ?', box.uidValidity, lastUid, now(), folder.id)
  }
  tx(() => {
    // messages that left every folder were deleted on the server
    for (const id of lost) {
      const m = get<{ thread_id: string }>('SELECT thread_id FROM mail_messages WHERE id = ? AND NOT EXISTS (SELECT 1 FROM mail_locations WHERE message_id = ?)', id, id)
      if (!m) continue
      run('DELETE FROM mail_fts WHERE message_id = ?', id)
      run('DELETE FROM mail_messages WHERE id = ?', id)
      result.touched.add(m.thread_id)
    }
    // an empty conversation goes too
    run('DELETE FROM mail_threads WHERE account_id = ? AND NOT EXISTS (SELECT 1 FROM mail_messages WHERE thread_id = mail_threads.id)', acc.id)
    // "in the inbox" follows the server
    run(
      `UPDATE mail_messages SET is_inbox = (is_outbound = 0 AND EXISTS (
         SELECT 1 FROM mail_locations l JOIN mail_folders f ON f.account_id = l.account_id AND f.path = l.folder
         WHERE l.message_id = mail_messages.id AND f.role = 'inbox'))
       WHERE account_id = ?`,
      acc.id
    )
  })
  return result
}

// ---------------------------------------------------------------- folder list

export function listMailFolders(accountId: string | null): MailFolderInfo[] {
  const rows = all<{ account_id: string; path: string; name: string; delimiter: string; role: FolderRole | null; unread: number }>(
    `SELECT f.account_id, f.path, f.name, f.delimiter, f.role,
       (SELECT COUNT(*) FROM mail_locations l JOIN mail_messages m ON m.id = l.message_id
        WHERE l.account_id = f.account_id AND l.folder = f.path AND m.is_read = 0 AND m.is_outbound = 0) unread
     FROM mail_folders f ${accountId ? 'WHERE f.account_id = ?' : ''} ORDER BY f.account_id, f.position, f.path COLLATE NOCASE`,
    ...(accountId ? [accountId] : [])
  )
  return rows.map((r) => ({ account_id: r.account_id, path: r.path, name: r.name, role: r.role, depth: r.delimiter ? r.path.split(r.delimiter).length - 1 : 0, unread: r.unread }))
}

// ---------------------------------------------------------------- moving and deleting

/** `from` / `to`: a role ('inbox', 'archive', 'spam', 'trash', …) or 'folder:<path>'. */
function resolve(accountId: string, target: string): string | null {
  if (target.startsWith('folder:')) {
    const path = target.slice(7)
    return get('SELECT 1 FROM mail_folders WHERE account_id = ? AND path = ?', accountId, path) ? path : null
  }
  if (target === 'archive') {
    // a real Archive folder, else Gmail's All Mail (moving there removes the Inbox label)
    return (
      get<{ path: string }>("SELECT path FROM mail_folders WHERE account_id = ? AND role = 'archive' ORDER BY position LIMIT 1", accountId)?.path ??
      get<{ path: string }>("SELECT path FROM mail_folders WHERE account_id = ? AND role = 'all' LIMIT 1", accountId)?.path ??
      null
    )
  }
  return get<{ path: string }>('SELECT path FROM mail_folders WHERE account_id = ? AND role = ? ORDER BY position LIMIT 1', accountId, target)?.path ?? null
}

const ROLE_NAME: Record<string, string> = { inbox: 'Inbox', archive: 'Archive', spam: 'Spam', trash: 'Trash', sent: 'Sent', drafts: 'Drafts' }

/**
 * Move the thread's messages that are in `from` to `to` on the server. The local copy updates
 * at once; the server move runs as a retried job, followed by a sync.
 */
export function moveThread(threadId: string, from: string, to: string): void {
  const th = get<{ account_id: string }>('SELECT account_id FROM mail_threads WHERE id = ?', threadId)
  if (!th) throw new Error('Email thread not found')
  const src = resolve(th.account_id, from)
  const dest = resolve(th.account_id, to)
  if (!src) throw new Error(`This account has no ${ROLE_NAME[from] ?? from.replace(/^folder:/, '')} folder`)
  if (!dest) throw new Error(`This account has no ${ROLE_NAME[to] ?? to.replace(/^folder:/, '')} folder on the server`)
  if (src === dest) return
  const locs = all<{ message_id: string; uid: number }>(
    'SELECT l.message_id, l.uid FROM mail_locations l JOIN mail_messages m ON m.id = l.message_id WHERE m.thread_id = ? AND l.folder = ?',
    threadId,
    src
  )
  if (!locs.length) throw new Error(`Nothing in this conversation is in ${ROLE_NAME[from] ?? src}`)
  tx(() => {
    for (const l of locs) run('DELETE FROM mail_locations WHERE message_id = ? AND folder = ?', l.message_id, src)
    // shown in the destination straight away; the next sync records the real UID there
    for (const l of locs) addLocation(l.message_id, th.account_id, dest, -1)
    const destRole = get<{ role: string | null }>('SELECT role FROM mail_folders WHERE account_id = ? AND path = ?', th.account_id, dest)?.role
    if (destRole === 'inbox') run('UPDATE mail_threads SET done = 0 WHERE id = ?', threadId)
    run(
      `UPDATE mail_messages SET is_inbox = (is_outbound = 0 AND EXISTS (
         SELECT 1 FROM mail_locations l JOIN mail_folders f ON f.account_id = l.account_id AND f.path = l.folder
         WHERE l.message_id = mail_messages.id AND f.role = 'inbox'))
       WHERE thread_id = ?`,
      threadId
    )
    enqueue('mail_move', { accountId: th.account_id, from: src, to: dest, uids: locs.map((l) => l.uid).filter((u) => u > 0) }, { maxAttempts: 5 })
  })
}

/** Permanently delete a conversation from Spam or Trash (server and this PC). */
export function deleteThreadForever(threadId: string): void {
  const th = get<{ account_id: string }>('SELECT account_id FROM mail_threads WHERE id = ?', threadId)
  if (!th) return
  const locs = all<{ folder: string; uid: number; role: string | null }>(
    `SELECT l.folder, l.uid, f.role FROM mail_locations l JOIN mail_messages m ON m.id = l.message_id
     LEFT JOIN mail_folders f ON f.account_id = l.account_id AND f.path = l.folder WHERE m.thread_id = ?`,
    threadId
  )
  if (locs.some((l) => l.role !== 'spam' && l.role !== 'trash')) throw new Error('Move it to Trash first; only Spam and Trash can be deleted for good')
  tx(() => {
    const byFolder = new Map<string, number[]>()
    for (const l of locs) if (l.uid > 0) byFolder.set(l.folder, [...(byFolder.get(l.folder) ?? []), l.uid])
    for (const [folder, uids] of byFolder) enqueue('mail_delete', { accountId: th.account_id, folder, uids }, { maxAttempts: 5 })
    run('DELETE FROM mail_fts WHERE message_id IN (SELECT id FROM mail_messages WHERE thread_id = ?)', threadId)
    run('DELETE FROM mail_threads WHERE id = ?', threadId)
  })
}

// ---------------------------------------------------------------- jobs

/** Set by accounts.ts (avoids an import cycle): run `fn` with an IMAP session for the account. */
let withAccountImap: <T>(accountId: string, fn: (s: ImapSession) => Promise<T>) => Promise<T> = () => Promise.reject(new Error('IMAP not ready'))
export function setAccountImap(fn: typeof withAccountImap): void {
  withAccountImap = fn
}

registerJobHandler<{ accountId: string; from: string; to: string; uids: number[] }>(
  'mail_move',
  async ({ payload }) => {
    await withAccountImap(payload.accountId, async (s) => {
      await s.open(payload.from)
      await s.move(payload.uids, payload.to)
    })
    enqueue('account_sync', { accountId: payload.accountId }, { maxAttempts: 1 })
  },
  // the server refused: forget the optimistic move and rescan both folders
  (job) => {
    tx(() => {
      run('DELETE FROM mail_locations WHERE account_id = ? AND folder = ? AND uid = -1', job.payload.accountId, job.payload.to)
      run('UPDATE mail_folders SET uid_validity = NULL, last_uid = 0 WHERE account_id = ? AND path IN (?, ?)', job.payload.accountId, job.payload.from, job.payload.to)
      enqueue('account_sync', { accountId: job.payload.accountId }, { maxAttempts: 1 })
    })
  }
)

registerJobHandler<{ accountId: string; folder: string; uids: number[] }>(
  'mail_delete',
  async ({ payload }) => {
    await withAccountImap(payload.accountId, async (s) => {
      await s.open(payload.folder)
      await s.remove(payload.uids)
    })
  }
)

/** A location for a message FollowUp uploaded itself (e.g. a saved draft). */
export function recordUpload(messageRowId: string, accountId: string, folder: string, uid: number | null): void {
  addLocation(messageRowId, accountId, folder, uid ?? -1)
}

export function folderForRole(accountId: string, role: FolderRole): string | null {
  return get<{ path: string }>('SELECT path FROM mail_folders WHERE account_id = ? AND role = ? ORDER BY position LIMIT 1', accountId, role)?.path ?? null
}

export { parseRaw }
