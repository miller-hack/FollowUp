import MailComposer from 'nodemailer/lib/mail-composer'
import type { ComposeInput, MailAccountConfig, MailAddress, OutboxItem } from '@shared/mail'
import { all, get, now, run, uuid } from '../../db'
import { enqueue, registerJobHandler } from '../jobs'
import { authFor, getAccountFull } from './accounts'
import { getMessageRow, parseRaw, storeMessage } from './store'
import { friendlyMailError, smtpTransport, withImap } from './transport'
import { recomputeFollowUps } from './followups'

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

/** A plain mailbox address: no spaces, quotes, brackets or separators that a mail parser could reinterpret. */
const PLAIN_ADDRESS = /^[^\s@<>()",;:[\]\\]+@[^\s@<>()",;:[\]\\]+\.[^\s@<>()",;:[\]\\]+$/

/**
 * '"Lima, Ana" <ana@x.com>; bob@y.com' → [{ name: 'Lima, Ana', address: 'ana@x.com' }, { name: '', address: 'bob@y.com' }].
 * Commas and semicolons inside quotes or <…> don't split. Throws on anything that isn't a plain address,
 * so text from an email (a sender's display name) can never turn into an extra recipient.
 */
export function parseAddressList(text: string): MailAddress[] {
  const parts: string[] = []
  let cur = ''
  let quoted = false
  let angle = false
  for (const c of text) {
    if (c === '"' && !angle) quoted = !quoted
    else if (c === '<' && !quoted) angle = true
    else if (c === '>' && !quoted) angle = false
    if ((c === ',' || c === ';') && !quoted && !angle) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  parts.push(cur)
  const out: MailAddress[] = []
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.*)<([^<>]*)>\s*$/.exec(raw)
    const address = (m ? m[2] : raw).trim().toLowerCase()
    const name = m ? m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim() : ''
    if (!PLAIN_ADDRESS.test(address)) throw new Error(`“${raw}” is not a valid email address`)
    out.push({ name, address })
  }
  return out
}

/** "Ana <ana@x.com>, bob@y.com" → the same list, normalised (throws on junk). */
export function parseRecipients(text: string): string[] {
  return parseAddressList(text).map(formatAddress)
}

/** Display form, quoting names that contain characters with a meaning in address lists. */
export function formatAddress(a: MailAddress): string {
  if (!a.name) return a.address
  const name = a.name.replace(/[\r\n"\\]/g, '').trim()
  return /[,;<>()@:[\]]/.test(name) ? `"${name}" <${a.address}>` : `${name} <${a.address}>`
}

export interface QueueOptions {
  source?: OutboxItem['source']
  /** for automation replies: thread to reply into */
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
    `INSERT INTO outbox (id, account_id, to_addrs, cc_addrs, subject, body, in_reply_to, refs, thread_id, source, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id, acc.id, to.join(', '), cc.join(', '), input.subject, input.body, inReplyTo, refs, threadId, opts.source ?? 'manual', item.message_id
  )
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
  message_id: string
}

async function sendOutbox({ payload }: { payload: { outboxId: string } }): Promise<void> {
  const o = get<OutboxRow>('SELECT * FROM outbox WHERE id = ?', payload.outboxId)
  if (!o || o.status === 'sent') return
  const acc = getAccountFull(o.account_id)
  if (!acc) throw new Error('Account was removed')
  const cfg = acc.config as MailAccountConfig
  const to = parseAddressList(o.to_addrs)
  const cc = o.cc_addrs ? parseAddressList(o.cc_addrs) : []
  const raw = await new MailComposer({
    from: { name: acc.name, address: acc.email },
    // structured recipients: nodemailer never re-parses text that came from an email (display names)
    to: to.map((a) => ({ name: a.name, address: a.address })),
    cc: cc.length ? cc.map((a) => ({ name: a.name, address: a.address })) : undefined,
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
      // delivery goes to exactly these bare addresses
      envelope: { from: acc.email, to: [...to, ...cc].map((a) => a.address) },
      raw
    })
  } catch (e) {
    throw new Error(friendlyMailError(e, !!cfg.oauth, cfg.preset))
  } finally {
    transport.close()
  }

  // The server accepted it: record that first, so nothing below can cause a second send (ADR-004).
  run("UPDATE outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", now(), o.id)

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
    // our answer takes the conversation out of "reply needed" (and starts the "waiting on them" clock)
    recomputeFollowUps([r.threadId])
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
  }
)

export { escapeHtml }
