import MailComposer from 'nodemailer/lib/mail-composer'
import type { ComposeInput, MailAccountConfig, OutboxItem } from '@shared/mail'
import { all, get, now, run, tx, uuid } from '../../db'
import { enqueue, registerJobHandler } from '../jobs'
import { authFor, getAccountFull } from './accounts'
import { getMessageRow, parseRaw, storeMessage } from './store'
import { friendlyMailError, smtpTransport, withImap } from './transport'
import { stopEnrollmentsForThread } from './sequences'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text → simple HTML: paragraphs, line breaks, quoted lines, clickable links. */
export function textToHtml(text: string): string {
  const lines = escapeHtml(text).split(/\r?\n/)
  const out: string[] = []
  let quote: string[] = []
  const flush = () => {
    if (quote.length) out.push(`<blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555">${quote.join('<br>')}</blockquote>`)
    quote = []
  }
  for (const l of lines) {
    if (/^&gt; ?/.test(l)) quote.push(l.replace(/^&gt; ?/, ''))
    else {
      flush()
      out.push(l)
    }
  }
  flush()
  const html = out.join('<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">${html}</div>`
}

/** "Ana <ana@x.com>, bob@y.com" → valid list (throws on junk). */
export function parseRecipients(text: string): string[] {
  const parts = text
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const p of parts) {
    const addr = /<([^>]+)>/.exec(p)?.[1] ?? p
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new Error(`“${p}” is not a valid email address`)
  }
  return parts
}

export interface QueueOptions {
  source?: OutboxItem['source']
  enrollmentId?: string | null
  /** for sequence/automation replies: thread to reply into */
  threadId?: string | null
}

/** Put an email in the outbox and schedule the send. Works inside a transaction. */
export function queueEmail(input: ComposeInput, opts: QueueOptions = {}): OutboxItem {
  const acc = getAccountFull(input.account_id)
  if (!acc || acc.kind !== 'mail') throw new Error('Choose an email account to send from')
  const to = parseRecipients(input.to)
  if (!to.length) throw new Error('Add at least one recipient')
  const cc = input.cc ? parseRecipients(input.cc) : []
  let inReplyTo: string | null = null
  let refs: string[] = []
  let threadId = opts.threadId ?? null
  const parent = input.reply_to ? getMessageRow(input.reply_to) : undefined
  if (parent) {
    const parentRefs = (get<{ refs: string }>('SELECT refs FROM mail_messages WHERE id = ?', parent.id)?.refs ?? '[]')
    inReplyTo = parent.message_id
    refs = [...(JSON.parse(parentRefs) as string[]), parent.message_id].slice(-20)
    threadId = parent.thread_id
  }
  const domain = acc.email.split('@')[1] ?? 'followup.local'
  const item = {
    id: uuid(),
    message_id: `<${uuid()}@${domain}>`
  }
  run(
    `INSERT INTO outbox (id, account_id, to_addrs, cc_addrs, subject, body, in_reply_to, refs, thread_id, source, enrollment_id, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id, acc.id, to.join(', '), cc.join(', '), input.subject, input.body, inReplyTo, refs, threadId, opts.source ?? 'manual', opts.enrollmentId ?? null, item.message_id
  )
  // replying yourself ends an automatic follow-up
  if ((opts.source ?? 'manual') === 'manual' && threadId) stopEnrollmentsForThread(threadId, 'stopped', 'You replied')
  enqueue('mail_send', { outboxId: item.id }, { maxAttempts: 5 })
  return getOutboxItem(item.id)!
}

export function getOutboxItem(id: string): OutboxItem | null {
  return (
    get<OutboxItem>(
      'SELECT id, account_id, to_addrs "to", subject, status, error, source, created_at, sent_at FROM outbox WHERE id = ?',
      id
    ) ?? null
  )
}

export function listOutbox(threadId?: string): (OutboxItem & { thread_id: string | null })[] {
  return all(
    `SELECT id, account_id, to_addrs "to", subject, status, error, source, created_at, sent_at, thread_id FROM outbox
     ${threadId ? 'WHERE thread_id = ? AND' : 'WHERE'} status <> 'sent' ORDER BY created_at DESC LIMIT 100`,
    ...(threadId ? [threadId] : [])
  )
}

export function retryOutbox(id: string): void {
  run("UPDATE outbox SET status = 'queued', error = NULL WHERE id = ? AND status = 'failed'", id)
  enqueue('mail_send', { outboxId: id }, { maxAttempts: 5 })
}

export function cancelOutbox(id: string): void {
  run("DELETE FROM outbox WHERE id = ? AND status <> 'sent'", id)
}

interface OutboxRow {
  id: string
  account_id: string
  to_addrs: string
  cc_addrs: string
  subject: string
  body: string
  in_reply_to: string | null
  refs: string
  status: string
  enrollment_id: string | null
  message_id: string
}

async function sendOutbox({ payload }: { payload: { outboxId: string } }): Promise<void> {
  const o = get<OutboxRow>('SELECT * FROM outbox WHERE id = ?', payload.outboxId)
  if (!o || o.status === 'sent') return
  const acc = getAccountFull(o.account_id)
  if (!acc) throw new Error('Account was removed')
  const cfg = acc.config as MailAccountConfig
  const raw = await new MailComposer({
    from: { name: acc.name, address: acc.email },
    to: o.to_addrs,
    cc: o.cc_addrs || undefined,
    subject: o.subject,
    text: o.body,
    html: textToHtml(o.body),
    messageId: o.message_id,
    inReplyTo: o.in_reply_to ?? undefined,
    references: (JSON.parse(o.refs) as string[]).join(' ') || undefined,
    date: new Date()
  })
    .compile()
    .build()

  const auth = await authFor(acc)
  const transport = smtpTransport(cfg.smtp, auth)
  try {
    await transport.sendMail({
      envelope: { from: acc.email, to: [...parseRecipients(o.to_addrs), ...(o.cc_addrs ? parseRecipients(o.cc_addrs) : [])] },
      raw
    })
  } catch (e) {
    throw new Error(friendlyMailError(e, !!cfg.oauth, cfg.preset))
  } finally {
    transport.close()
  }

  // The server accepted it: record that first, so nothing below can cause a second send (ADR-004).
  tx(() => {
    run("UPDATE outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", now(), o.id)
    if (o.enrollment_id) run('UPDATE sequence_enrollments SET last_sent_at = ? WHERE id = ?', now(), o.enrollment_id)
  })

  // keep a copy in the server's Sent folder (Gmail does this on its own) — best effort
  if (cfg.appendSent) {
    try {
      await withImap(cfg.imap, auth, async (s) => {
        const folders = await s.folders()
        const sent = folders.find((f) => f.specialUse === '\\Sent')?.path ?? folders.find((f) => /^sent( items)?$/i.test(f.path))?.path
        if (sent) await s.append(sent, raw, ['\\Seen'])
      })
    } catch (e) {
      console.warn('Could not save to Sent folder', e)
    }
  }

  // show it in the thread right away — best effort (the Sent folder sync brings it in otherwise)
  try {
    const parsed = await parseRaw(raw)
    const r = storeMessage(acc.id, parsed, { accountEmail: acc.email, folder: null, uid: null, seen: true, inInbox: false })
    run('UPDATE outbox SET thread_id = ? WHERE id = ?', r.threadId, o.id)
  } catch (e) {
    console.warn('Sent, but could not add the message to its thread', e)
  }
}

registerJobHandler<{ outboxId: string }>(
  'mail_send',
  async (job) => {
    try {
      await sendOutbox(job)
    } catch (e) {
      // visible in the UI while the job retries
      run('UPDATE outbox SET error = ? WHERE id = ?', (e as Error).message, job.payload.outboxId)
      throw e
    }
  },
  (job, error) => {
  run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", error, job.payload.outboxId)
  const o = get<{ enrollment_id: string | null }>('SELECT enrollment_id FROM outbox WHERE id = ?', job.payload.outboxId)
  if (o?.enrollment_id)
    run("UPDATE sequence_enrollments SET status = 'failed', stopped_reason = ?, next_run_at = NULL WHERE id = ?", `Send failed: ${error}`, o.enrollment_id)
  }
)

export { escapeHtml }
