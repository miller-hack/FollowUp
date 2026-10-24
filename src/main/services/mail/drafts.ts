import MailComposer from 'nodemailer/lib/mail-composer'
import type { ComposeInput, MailAccountConfig } from '@shared/mail'
import { all, get, run, tx, uuid } from '../../db'
import { enqueue, registerJobHandler } from '../jobs'
import { authFor, getAccountFull } from './accounts'
import { folderForRole, recordUpload } from './folders'
import { textToHtml } from './send'
import { getMessageRow, parseRaw, storeMessage } from './store'
import { withImap } from './transport'

/**
 * Drafts (ADR-014): Compose → "Save draft" keeps the email in the server's Drafts folder (so it
 * shows on the phone too) and in FollowUp. Saving again replaces the previous version; sending
 * or discarding removes it.
 */

async function buildRaw(input: ComposeInput, from: { name: string; address: string }): Promise<{ raw: Buffer; messageId: string }> {
  const parent = input.reply_to ? getMessageRow(input.reply_to) : undefined
  const refs = parent ? [...(JSON.parse(get<{ refs: string }>('SELECT refs FROM mail_messages WHERE id = ?', parent.id)?.refs ?? '[]') as string[]), parent.message_id] : []
  const messageId = `<draft-${uuid()}@${from.address.split('@')[1] ?? 'followup.local'}>`
  const raw = await new MailComposer({
    from,
    to: input.to || undefined,
    cc: input.cc || undefined,
    subject: input.subject,
    text: input.body,
    html: textToHtml(input.body),
    messageId,
    inReplyTo: parent?.message_id,
    references: refs.join(' ') || undefined,
    date: new Date()
  })
    .compile()
    .build()
  return { raw, messageId }
}

/** Save (or replace) a draft. Returns the draft's message row id. */
export async function saveDraft(input: ComposeInput, replaces?: string | null): Promise<string> {
  const acc = getAccountFull(input.account_id)
  if (!acc || acc.kind !== 'mail') throw new Error('Choose an email account')
  const { raw } = await buildRaw(input, { name: acc.name, address: acc.email })
  const folder = folderForRole(acc.id, 'drafts')
  let uid: number | null = null
  let uploaded = false
  if (folder) {
    try {
      uid = await withImap((acc.config as MailAccountConfig).imap, await authFor(acc), (s) => s.append(folder, raw, ['\\Draft', '\\Seen']))
      uploaded = true
    } catch (e) {
      // offline or refused: keep it on this PC; it is saved again next time
      console.warn('Could not save the draft on the server', e)
    }
  }
  const parsed = await parseRaw(raw)
  const id = tx(() => {
    const r = storeMessage(acc.id, parsed, { accountEmail: acc.email, folder: uploaded ? folder : null, uid, seen: true, inInbox: false })
    run('UPDATE mail_messages SET is_draft = 1 WHERE id = ?', r.messageRowId)
    if (uploaded && folder) recordUpload(r.messageRowId, acc.id, folder, uid)
    return r.messageRowId
  })
  if (replaces && replaces !== id) discardDraft(replaces)
  return id
}

/** is_draft = 2: discarded, hidden everywhere, deleted here once the server copy is gone. */
export const DISCARDED = 2

function forget(messageRowId: string): void {
  const m = get<{ thread_id: string }>('SELECT thread_id FROM mail_messages WHERE id = ?', messageRowId)
  if (!m) return
  tx(() => {
    run('DELETE FROM mail_fts WHERE message_id = ?', messageRowId)
    run('DELETE FROM mail_messages WHERE id = ?', messageRowId)
    run('DELETE FROM mail_threads WHERE id = ? AND NOT EXISTS (SELECT 1 FROM mail_messages WHERE thread_id = ?)', m.thread_id, m.thread_id)
  })
}

/**
 * Delete a draft here and on the server. It is hidden at once; the local copy is removed after the
 * server deleted it, so a sync in between can't bring it back.
 */
export function discardDraft(messageRowId: string): void {
  const m = get<{ account_id: string; message_id: string; is_draft: number }>('SELECT account_id, message_id, is_draft FROM mail_messages WHERE id = ?', messageRowId)
  if (!m || m.is_draft !== 1) return
  const locs = all<{ folder: string; uid: number }>('SELECT folder, uid FROM mail_locations WHERE message_id = ?', messageRowId)
  if (!locs.length) return forget(messageRowId)
  tx(() => {
    run('UPDATE mail_messages SET is_draft = ? WHERE id = ?', DISCARDED, messageRowId)
    for (const l of locs) enqueue('draft_delete', { accountId: m.account_id, folder: l.folder, uid: l.uid, messageId: m.message_id, rowId: messageRowId }, { maxAttempts: 5 })
  })
}

registerJobHandler<{ accountId: string; folder: string; uid: number; messageId: string; rowId: string }>('draft_delete', async ({ payload }) => {
  const acc = getAccountFull(payload.accountId)
  if (acc) {
    await withImap((acc.config as MailAccountConfig).imap, await authFor(acc), async (s) => {
      await s.open(payload.folder)
      if (payload.uid > 0) return s.remove([payload.uid])
      // saved without UIDPLUS: find it by its Message-ID
      const uids: number[] = []
      for await (const e of s.envelopes('1:*')) if (e.messageId === payload.messageId) uids.push(e.uid)
      await s.remove(uids)
    })
  }
  run('DELETE FROM mail_locations WHERE message_id = ? AND folder = ?', payload.rowId, payload.folder)
  if (!get('SELECT 1 FROM mail_locations WHERE message_id = ?', payload.rowId)) forget(payload.rowId)
})
