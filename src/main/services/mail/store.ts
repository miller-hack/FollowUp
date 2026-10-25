import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import type { EmailCategory } from '@shared/ai'
import type { FolderRole, FollowUpKind, MailAddress, MailAttachment, MailMessage, MailThread, ThreadDetail, ThreadQuery } from '@shared/mail'
import { all, get, marks, now, run, tx, uuid } from '../../db'
import { ftsQuery } from '../tasks'
import { DUE_SQL } from './followups'

let mailDir = join(tmpdir(), 'followup-mail')
/** Where attachment files are kept (set to the app data folder at startup). */
export function setMailDataDir(dir: string): void {
  mailDir = dir
}

const MAX_ATTACHMENT = 10 * 1024 * 1024

// ---------------------------------------------------------------- untrusted files (ADR-001)

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** A file name that is safe to create on Windows: no paths, reserved names, control characters or trailing dots. */
export function safeName(name: string | null | undefined): string {
  let n = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
  if (!n || /^\.+$/.test(n)) n = 'attachment'
  if (RESERVED.test(n)) n = `_${n}`
  if (n.length > 120) {
    const dot = n.lastIndexOf('.')
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : ''
    n = n.slice(0, 120 - ext.length) + ext
  }
  return n
}

/** Programs, scripts, shortcuts, installers and containers that Windows would run or mount on open. */
const DANGEROUS = new Set(
  (
    'exe com scr pif bat cmd ps1 psm1 psd1 ps1xml ps2 ps2xml psc1 psc2 vb vbs vbe js jse ws wsf wsh wsc hta msi msp mst msix msixbundle ' +
    'appx appxbundle lnk url reg jar cpl inf ins isp scf sct shb shs appref-ms application gadget msc chm hlp iso img vhd vhdx xll ' +
    'library-ms settingcontent-ms diagcab diagcfg diagpkg mshxml mhtml mht py pyw pl rb dll sys drv ocx'
  ).split(' ')
)

export function isDangerousFile(name: string): boolean {
  const ext = /\.([^.\\/]+)$/.exec(name.trim().replace(/[. ]+$/, ''))?.[1]?.toLowerCase()
  return !!ext && DANGEROUS.has(ext)
}

/** Windows "Mark of the Web": SmartScreen and Office Protected View then treat the file as downloaded. */
export function markFromInternet(file: string): void {
  if (process.platform !== 'win32') return
  try {
    writeFileSync(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
  } catch {
    /* not NTFS: the open gate still applies */
  }
}

// ---------------------------------------------------------------- parsing helpers

export interface ParsedEmail {
  messageId: string
  inReplyTo: string | null
  references: string[]
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  date: string
  text: string
  html: string | null
  /** auto-reply, mailing list, newsletter or bounce: automations never reply to these (ADR-008) */
  auto: boolean
  attachments: ParsedAttachment[]
}

export interface ParsedAttachment {
  filename: string
  mime: string
  size: number
  content: Buffer
  /** an image the HTML shows through `cid:` (kept as a file, not listed as an attachment) */
  inline?: boolean
  cid?: string | null
}

/** RFC 3834 and common list/robot markers. */
function isAutomated(p: ParsedMail, fromAddr: string): boolean {
  const h = p.headers
  const text = (k: string): string => {
    const v = h.get(k) as unknown
    if (v === undefined || v === null) return ''
    if (typeof v === 'string') return v
    return String((v as { value?: unknown; text?: unknown }).value ?? (v as { text?: unknown }).text ?? '')
  }
  const submitted = text('auto-submitted').trim().toLowerCase()
  if (submitted && submitted !== 'no') return true
  if (/^(bulk|junk|list|auto_reply)$/i.test(text('precedence').trim())) return true
  // mailparser folds every List-* header (List-Id, List-Unsubscribe, …) into one 'list' entry
  if (['x-autoreply', 'x-autorespond', 'list', 'x-auto-response-suppress'].some((k) => h.has(k))) return true
  return /^(mailer-daemon|postmaster|mail-daemon|no-?reply|do-?not-?reply)@/i.test(fromAddr)
}

const addresses = (a: AddressObject | AddressObject[] | undefined): MailAddress[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).filter((v) => v.address).map((v) => ({ name: v.name ?? '', address: v.address!.toLowerCase() }))

const angle = (id: string) => (id.startsWith('<') ? id : `<${id}>`)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Readable plain text from HTML (keeps case, drops images and markup). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|table|section|article)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)
    )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Remove active content; images and styles stay (remote images are blocked at render time by CSP). */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|frameset|frame|applet)\b[\s\S]*?(<\/\1>|$)/gi, '')
    .replace(/<(script|iframe|object|embed|base|link|input|button)\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"')
}

const hasPlainPart = (raw: Buffer): boolean => /^content-type:\s*text\/plain/im.test(raw.toString('latin1', 0, Math.min(raw.length, 512 * 1024)))

export async function parseRaw(raw: Buffer): Promise<ParsedEmail> {
  const p: ParsedMail = await simpleParser(raw, { skipImageLinks: true })
  const html = typeof p.html === 'string' ? p.html : null
  const lowerHtml = html?.toLowerCase() ?? ''
  const attachments: ParsedEmail['attachments'] = []
  for (const a of p.attachments ?? []) {
    // images the body shows through cid: stay referenced; they are stored as files and
    // turned into data: URIs only when the thread is opened (ADR-010)
    const cid = a.cid ? normCid(a.cid) : null
    const inline = !!(cid && a.contentType.startsWith('image/') && lowerHtml.includes(`cid:${cid}`))
    attachments.push({ filename: a.filename ?? (inline ? 'image' : 'attachment'), mime: a.contentType, size: a.size, content: a.content, inline, cid: inline ? cid : null })
  }
  const refs = Array.isArray(p.references) ? p.references : p.references ? p.references.split(/\s+/) : []
  const from = addresses(p.from)[0] ?? { name: '', address: '' }
  return {
    messageId: p.messageId ? angle(p.messageId) : `<generated-${uuid()}@followup.local>`,
    inReplyTo: p.inReplyTo ? angle(p.inReplyTo.split(/\s+/)[0]) : null,
    references: refs.filter(Boolean).map(angle),
    from,
    to: addresses(p.to),
    cc: addresses(p.cc),
    subject: p.subject ?? '',
    date: (p.date ?? new Date()).toISOString(),
    // use the real text/plain part when there is one; mailparser's own HTML→text conversion
    // upper-cases headings and adds [image-url] markers
    text: hasPlainPart(raw) && p.text ? p.text : html ? htmlToText(html) : (p.text ?? ''),
    html: html ? sanitizeHtml(html) : null,
    auto: isAutomated(p, from.address),
    attachments
  }
}

/** "Re: Fwd: Hello" → "hello" */
export const normalizeSubject = (s: string): string =>
  s.replace(/^(\s*(re|fw|fwd|aw|wg|sv|vs)(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase()

/** First lines of the new text, without quoted history. */
export function snippetOf(text: string): string {
  const lines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) continue
    if (/^On .+wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim())) break
    lines.push(line)
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 220)
}

// ---------------------------------------------------------------- inline images (ADR-010)

/** `<Image001.png@01D9>` → `image001.png@01d9` */
const normCid = (cid: string): string => cid.trim().replace(/^<|>$/g, '').toLowerCase()

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/svg+xml': '.svg'
}
const MAX_INLINE_PER_MESSAGE = 20 * 1024 * 1024
/** Embedded data: images at least this long (characters) move out of the HTML. */
const MIN_DATA_URI = 4096

export interface InlineImage {
  cid: string
  mime: string
  size: number
  path: string | null
}

/** Content-addressed per account: identical images (logos, signatures) are stored once. */
function storeInlineFile(accountId: string, mime: string, bytes: Buffer): { path: string | null; hash: string } {
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length > MAX_ATTACHMENT) return { path: null, hash }
  try {
    const dir = join(mailDir, accountId, 'inline')
    const file = join(dir, `${hash}${IMAGE_EXT[mime.toLowerCase()] ?? '.bin'}`)
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true })
      // write then rename: a crash never leaves a half-written image under its final name
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, bytes)
      renameSync(tmp, file)
      markFromInternet(file)
    }
    return { path: file, hash }
  } catch (e) {
    console.warn('Could not save inline image', e)
    return { path: null, hash }
  }
}

const DATA_IMAGE = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi

/** Moves large embedded `data:` images out of the HTML into files and points the HTML at them. */
export function extractDataImages(accountId: string, html: string): { html: string; images: InlineImage[] } {
  const images = new Map<string, InlineImage>()
  const out = html.replace(DATA_IMAGE, (uri, mime: string, b64: string) => {
    if (uri.length < MIN_DATA_URI) return uri
    const bytes = Buffer.from(b64, 'base64')
    if (!bytes.length) return uri
    const { path, hash } = storeInlineFile(accountId, mime, bytes)
    if (!path) return uri
    const cid = `fu-${hash.slice(0, 16)}`
    images.set(cid, { cid, mime: mime.toLowerCase(), size: bytes.length, path })
    return `cid:${cid}`
  })
  return { html: out, images: [...images.values()] }
}

function insertInline(messageId: string, img: InlineImage): void {
  run(
    `INSERT INTO mail_attachments (id, message_id, filename, mime, size, stored_path, inline, content_id)
     SELECT ?, ?, ?, ?, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM mail_attachments WHERE message_id = ? AND content_id = ?)`,
    uuid(), messageId, `image${IMAGE_EXT[img.mime] ?? ''}`, img.mime, img.size, img.path, img.cid, messageId, img.cid
  )
}

/** Turns `cid:` references back into `data:` URIs for display (only the thread being opened). */
export function resolveInlineImages(html: string | null, images: { content_id: string | null; mime: string; stored_path: string | null }[]): string | null {
  if (!html || !images.length || !/cid:/i.test(html)) return html
  const byCid = new Map(images.filter((i) => i.content_id).map((i) => [normCid(i.content_id!), i]))
  const done = new Map<string, string>()
  let budget = MAX_INLINE_PER_MESSAGE
  return html.replace(/cid:([^"'\s)>]+)/gi, (whole, ref: string) => {
    let key: string
    try {
      key = normCid(decodeURIComponent(ref))
    } catch {
      key = normCid(ref)
    }
    const known = done.get(key)
    if (known) return known
    const img = byCid.get(key)
    if (!img?.stored_path) return whole
    try {
      const bytes = readFileSync(img.stored_path)
      if (bytes.length > budget) return whole
      budget -= bytes.length
      const uri = `data:${img.mime};base64,${bytes.toString('base64')}`
      done.set(key, uri)
      return uri
    } catch {
      return whole
    }
  })
}

const LEGACY_FLAG = 'maintenance:inline-images-v1'

/** Messages stored before 1.0 kept their images inside the HTML. */
export function legacyInlinePending(): boolean {
  if (get('SELECT 1 FROM settings WHERE key = ?', LEGACY_FLAG)) return false
  return !!get("SELECT 1 FROM mail_messages WHERE LENGTH(body_html) >= ? AND body_html LIKE '%data:image/%' LIMIT 1", MIN_DATA_URI)
}

/**
 * One-time rewrite of pre-1.0 bodies (ADR-010): embedded images become shared files.
 * Batched and time-boxed; picks up where it left off on the next run.
 */
export function migrateLegacyInlineImages(deadlineMs = 20_000): { messages: number; images: number; done: boolean } {
  const result = { messages: 0, images: 0, done: false }
  if (get('SELECT 1 FROM settings WHERE key = ?', LEGACY_FLAG)) return { ...result, done: true }
  const start = Date.now()
  let after = ''
  for (;;) {
    const rows = all<{ id: string; account_id: string; body_html: string }>(
      `SELECT id, account_id, body_html FROM mail_messages
       WHERE id > ? AND LENGTH(body_html) >= ? AND body_html LIKE '%data:image/%' ORDER BY id LIMIT 25`,
      after,
      MIN_DATA_URI
    )
    if (!rows.length) {
      run("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO NOTHING", LEGACY_FLAG)
      return { ...result, done: true }
    }
    for (const r of rows) {
      try {
        tx(() => {
          const { html, images } = extractDataImages(r.account_id, r.body_html)
          if (!images.length) return
          for (const img of images) insertInline(r.id, img)
          run('UPDATE mail_messages SET body_html = ? WHERE id = ?', html, r.id)
          result.messages++
          result.images += images.length
        })
      } catch (e) {
        console.warn('Could not move images out of message', r.id, e)
      }
    }
    after = rows[rows.length - 1].id
    if (Date.now() - start > deadlineMs) return result
  }
}

/** Inline image files no message refers to any more. */
export function pruneInlineFiles(): number {
  if (!existsSync(mailDir)) return 0
  // compare by name: content-addressed names are unique, and absolute paths change if the data folder moves
  const used = new Set(
    all<{ stored_path: string }>('SELECT stored_path FROM mail_attachments WHERE inline = 1 AND stored_path IS NOT NULL').map((r) =>
      basename(r.stored_path).toLowerCase()
    )
  )
  let removed = 0
  for (const account of readdirSync(mailDir)) {
    const dir = join(mailDir, account, 'inline')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (used.has(f.toLowerCase())) continue
      rmSync(join(dir, f), { force: true })
      removed++
    }
  }
  return removed
}

// ---------------------------------------------------------------- storing

export interface StoreMeta {
  accountEmail: string
  folder: string | null
  uid: number | null
  seen: boolean
  inInbox: boolean
}

export interface StoreResult {
  messageRowId: string
  threadId: string
  isNew: boolean
  isOutbound: boolean
}

function findThread(accountId: string, m: ParsedEmail): string | null {
  const ids = [m.inReplyTo, ...m.references].filter(Boolean) as string[]
  if (ids.length) {
    const hit = get<{ thread_id: string }>(
      `SELECT thread_id FROM mail_messages WHERE account_id = ? AND message_id IN (${marks(ids.length)}) ORDER BY date DESC LIMIT 1`,
      accountId,
      ...ids
    )
    if (hit) return hit.thread_id
  }
  // a reply that arrived before its parent
  const child = get<{ thread_id: string }>('SELECT thread_id FROM mail_messages WHERE account_id = ? AND in_reply_to = ? LIMIT 1', accountId, m.messageId)
  if (child) return child.thread_id
  // replies whose headers were stripped: same normalized subject, recent, shared participant
  if (m.inReplyTo || /^\s*(re|aw|sv)\s*:/i.test(m.subject)) {
    const norm = normalizeSubject(m.subject)
    if (norm) {
      const people = [m.from.address, ...m.to.map((t) => t.address)]
      const cand = all<{ id: string }>(
        `SELECT DISTINCT th.id FROM mail_threads th JOIN mail_messages mm ON mm.thread_id = th.id
         WHERE th.account_id = ? AND th.norm_subject = ? AND th.last_message_at >= ?
           AND (mm.from_addr IN (${marks(people.length)}))`,
        accountId,
        norm,
        new Date(Date.parse(m.date) - 30 * 86_400_000).toISOString(),
        ...people
      )
      if (cand.length === 1) return cand[0].id
    }
  }
  return null
}

/** Insert a parsed message (or update flags if it is already stored). */
export function storeMessage(accountId: string, m: ParsedEmail, meta: StoreMeta): StoreResult {
  return tx(() => {
    const existing = get<{ id: string; thread_id: string; is_outbound: number }>(
      'SELECT id, thread_id, is_outbound FROM mail_messages WHERE account_id = ? AND message_id = ?',
      accountId,
      m.messageId
    )
    if (existing) {
      // same message seen again (e.g. in Sent after we stored it ourselves)
      run(
        `UPDATE mail_messages SET folder = COALESCE(folder, ?), uid = COALESCE(uid, ?), is_read = ?, is_inbox = MAX(is_inbox, ?) WHERE id = ?`,
        meta.folder, meta.uid, meta.seen, meta.inInbox, existing.id
      )
      return { messageRowId: existing.id, threadId: existing.thread_id, isNew: false, isOutbound: !!existing.is_outbound }
    }
    const isOutbound = m.from.address === meta.accountEmail.toLowerCase()
    let threadId = findThread(accountId, m)
    if (!threadId) {
      threadId = uuid()
      run(
        'INSERT INTO mail_threads (id, account_id, subject, norm_subject, last_message_at) VALUES (?, ?, ?, ?, ?)',
        threadId, accountId, m.subject, normalizeSubject(m.subject), m.date
      )
    } else {
      run('UPDATE mail_threads SET last_message_at = MAX(last_message_at, ?), updated_at = ? WHERE id = ?', m.date, now(), threadId)
      // new inbound mail brings a "done" thread back to the inbox
      if (!isOutbound && meta.inInbox) run('UPDATE mail_threads SET done = 0 WHERE id = ?', threadId)
    }
    const id = uuid()
    const attachments = m.attachments.filter((a) => !a.inline)
    // images shown by the body live in files, never inside body_html (ADR-010)
    const inline: InlineImage[] = []
    for (const a of m.attachments) {
      if (!a.inline || !a.cid) continue
      const { path } = storeInlineFile(accountId, a.mime, a.content)
      inline.push({ cid: a.cid, mime: a.mime.toLowerCase(), size: a.size, path })
    }
    const extracted = m.html ? extractDataImages(accountId, m.html) : { html: null, images: [] }
    inline.push(...extracted.images)
    run(
      `INSERT INTO mail_messages (id, account_id, thread_id, folder, uid, message_id, in_reply_to, refs, from_name, from_addr,
         to_addrs, cc_addrs, subject, date, snippet, body_text, body_html, is_read, is_outbound, is_inbox, has_attachments, is_auto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, accountId, threadId, meta.folder, meta.uid, m.messageId, m.inReplyTo, m.references, m.from.name, m.from.address,
      m.to, m.cc, m.subject, m.date, snippetOf(m.text), m.text, extracted.html, meta.seen || isOutbound, isOutbound, meta.inInbox && !isOutbound,
      attachments.length > 0,
      !isOutbound && !!m.auto
    )
    for (const img of inline) insertInline(id, img)
    for (const a of attachments) {
      // each attachment gets its own folder: same-named files never collide
      const attId = uuid()
      let stored: string | null = null
      if (a.size <= MAX_ATTACHMENT) {
        try {
          const dir = join(mailDir, accountId, id, attId)
          mkdirSync(dir, { recursive: true })
          stored = join(dir, safeName(a.filename))
          writeFileSync(stored, a.content)
          markFromInternet(stored)
        } catch (e) {
          console.warn('Could not save attachment', a.filename, e)
          stored = null
        }
      }
      run('INSERT INTO mail_attachments (id, message_id, filename, mime, size, stored_path) VALUES (?, ?, ?, ?, ?, ?)', attId, id, a.filename, a.mime, a.size, stored)
    }
    run('INSERT INTO mail_fts (message_id, subject, sender, body) VALUES (?, ?, ?, ?)', id, m.subject, `${m.from.name} ${m.from.address}`, m.text.slice(0, 20_000))
    return { messageRowId: id, threadId, isNew: true, isOutbound }
  })
}

export function removeAccountFiles(accountId: string): void {
  rmSync(join(mailDir, accountId), { recursive: true, force: true })
}

// ---------------------------------------------------------------- queries

interface MsgRow {
  id: string
  thread_id: string
  account_id: string
  message_id: string
  from_name: string
  from_addr: string
  to_addrs: string
  cc_addrs: string
  subject: string
  date: string
  snippet: string
  body_text: string
  body_html: string | null
  is_read: number
  is_outbound: number
  is_draft?: number
}

/** The client company of each thread's outside participants (people by address, then companies by domain). */
function companiesFor(threadIds: string[]): Map<string, MailThread['company']> {
  const out = new Map<string, MailThread['company']>()
  if (!threadIds.length) return out
  const rows = all<{ thread_id: string; id: string; name: string; stage: string | null; color: string | null }>(
    `SELECT x.thread_id, c.id, c.name, st.name stage, st.color FROM (
       SELECT DISTINCT m.thread_id, m.from_addr addr FROM mail_messages m WHERE m.thread_id IN (${marks(threadIds.length)}) AND m.is_outbound = 0
     ) x
     JOIN companies c ON c.id = COALESCE(
       (SELECT p.company_id FROM people p WHERE p.email = x.addr OR p.other_emails LIKE '%"' || x.addr || '"%' LIMIT 1),
       (SELECT c2.id FROM companies c2 WHERE c2.domains LIKE '%"' || substr(x.addr, instr(x.addr, '@') + 1) || '"%' LIMIT 1))
     LEFT JOIN crm_stages st ON st.id = c.stage_id`,
    ...threadIds
  )
  for (const r of rows) if (!out.has(r.thread_id)) out.set(r.thread_id, { id: r.id, name: r.name, stage: r.stage, color: r.color })
  return out
}

interface ThreadRow {
  id: string
  account_id: string
  subject: string
  done: number
  last_message_at: string
  ai_category: EmailCategory | null
  ai_priority: number | null
  ai_summary: string | null
  followup_kind: FollowUpKind | null
  followup_since: string | null
  followup_due_at: string | null
  followup_snoozed_until: string | null
  followup_dismissed: number
  message_count: number
  unread_count: number
  has_attachments: number
}

/** A message of the thread is in a server folder with this role. */
const IN_ROLE = (role: string) =>
  `EXISTS (SELECT 1 FROM mail_messages rx JOIN mail_locations l ON l.message_id = rx.id
    JOIN mail_folders f ON f.account_id = l.account_id AND f.path = l.folder WHERE rx.thread_id = th.id AND f.role = '${role}')`

/** Not everything in the thread is in Spam or Trash. */
const NOT_BINNED = `EXISTS (SELECT 1 FROM mail_messages bx WHERE bx.thread_id = th.id AND (
    NOT EXISTS (SELECT 1 FROM mail_locations l WHERE l.message_id = bx.id)
    OR EXISTS (SELECT 1 FROM mail_locations l JOIN mail_folders f ON f.account_id = l.account_id AND f.path = l.folder
               WHERE l.message_id = bx.id AND COALESCE(f.role, '') NOT IN ('spam', 'trash'))))`

export function listThreads(q: ThreadQuery): MailThread[] {
  const where: string[] = []
  const having: string[] = []
  const params: unknown[] = []
  if (q.account_id) {
    where.push('th.account_id = ?')
    params.push(q.account_id)
  }
  const nowIso = new Date().toISOString()
  let order = 'th.last_message_at DESC'
  switch (q.folder) {
    case 'inbox':
      where.push('th.done = 0')
      having.push('MAX(m.is_inbox) = 1')
      break
    case 'followups':
      where.push(DUE_SQL)
      params.push(nowIso, nowIso)
      if (q.followup_kind) {
        where.push('th.followup_kind = ?')
        params.push(q.followup_kind)
      }
      // most important first (AI priority when sorted), then longest waiting
      order = 'COALESCE(th.ai_priority, 2), th.followup_due_at'
      break
    case 'sent':
      where.push(NOT_BINNED)
      having.push('MAX(m.is_outbound * (1 - m.is_draft)) = 1')
      break
    case 'done':
      where.push('th.done = 1', NOT_BINNED)
      break
    case 'all':
      where.push(NOT_BINNED)
      break
    case 'drafts':
      where.push(`(EXISTS (SELECT 1 FROM mail_messages dx WHERE dx.thread_id = th.id AND dx.is_draft = 1) OR ${IN_ROLE('drafts')})`)
      break
    case 'spam':
    case 'trash':
      where.push(IN_ROLE(q.folder))
      break
    case 'archive':
      // a server Archive folder, or Gmail's All Mail minus the inbox
      where.push(`(${IN_ROLE('archive')} OR ${IN_ROLE('all')})`, NOT_BINNED)
      having.push('MAX(m.is_inbox) = 0')
      break
    default:
      if (q.folder.startsWith('folder:')) {
        const [accountId, path] = q.folder.slice(7).split('|')
        where.push(`EXISTS (SELECT 1 FROM mail_messages fx JOIN mail_locations l ON l.message_id = fx.id WHERE fx.thread_id = th.id AND l.account_id = ? AND l.folder = ?)`)
        params.push(accountId, path ?? '')
      }
  }
  const fq = q.search ? ftsQuery(q.search) : null
  if (fq) {
    where.push('th.id IN (SELECT mm.thread_id FROM mail_messages mm WHERE mm.id IN (SELECT message_id FROM mail_fts WHERE mail_fts MATCH ?))')
    params.push(fq)
  }
  if (q.ai_category) {
    where.push('th.ai_category = ?')
    params.push(q.ai_category)
  }
  if (q.unread_only) having.push('SUM(CASE WHEN m.is_read = 0 AND m.is_outbound = 0 THEN 1 ELSE 0 END) > 0')
  const rows = all<ThreadRow>(
    `SELECT th.id, th.account_id, th.subject, th.done, th.last_message_at, th.ai_category, th.ai_priority, th.ai_summary,
       th.followup_kind, th.followup_since, th.followup_due_at, th.followup_snoozed_until,
       COALESCE(th.followup_dismissed_for, '') = COALESCE(th.followup_anchor, '-') followup_dismissed, COUNT(m.id) message_count,
       SUM(CASE WHEN m.is_read = 0 AND m.is_outbound = 0 THEN 1 ELSE 0 END) unread_count, MAX(m.has_attachments) has_attachments
     FROM mail_threads th JOIN mail_messages m ON m.thread_id = th.id AND m.is_draft < 2
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY th.id ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
     ORDER BY ${order} LIMIT ${Math.min(500, q.limit ?? 200)}`,
    ...params
  )
  return decorate(rows)
}

function decorate(
  rows: ThreadRow[]
): MailThread[] {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = all<{ thread_id: string; from_name: string; from_addr: string; to_addrs: string; is_outbound: number; snippet: string; date: string }>(
    `SELECT thread_id, from_name, from_addr, to_addrs, is_outbound, snippet, date FROM mail_messages WHERE thread_id IN (${marks(ids.length)}) AND is_draft < 2 ORDER BY date`,
    ...ids
  )
  const links = all<{ thread_id: string; task_id: string }>(`SELECT thread_id, task_id FROM email_task_links WHERE thread_id IN (${marks(ids.length)})`, ...ids)
  const companies = companiesFor(ids)
  const nowIso = new Date().toISOString()
  return rows.map((r) => {
    const mine = msgs.filter((m) => m.thread_id === r.id)
    const people = new Map<string, MailAddress>()
    for (const m of mine) people.set(m.from_addr, { name: m.is_outbound ? 'me' : m.from_name, address: m.from_addr })
    // a conversation only you have written in: show who you wrote to
    if (mine.every((m) => m.is_outbound))
      for (const m of mine) for (const a of JSON.parse(m.to_addrs) as MailAddress[]) if (!people.has(a.address)) people.set(a.address, { name: a.name, address: a.address })
    return {
      id: r.id,
      account_id: r.account_id,
      subject: r.subject || '(no subject)',
      snippet: mine.at(-1)?.snippet ?? '',
      last_message_at: r.last_message_at,
      message_count: r.message_count,
      unread_count: r.unread_count,
      participants: [...people.values()],
      has_attachments: !!r.has_attachments,
      done: !!r.done,
      task_ids: links.filter((l) => l.thread_id === r.id).map((l) => l.task_id),
      followup:
        r.followup_kind && r.followup_since && r.followup_due_at
          ? {
              kind: r.followup_kind,
              since: r.followup_since,
              due_at: r.followup_due_at,
              snoozed_until: r.followup_snoozed_until,
              dismissed: !!r.followup_dismissed,
              due: r.followup_due_at <= nowIso && !r.followup_dismissed && (!r.followup_snoozed_until || r.followup_snoozed_until <= nowIso)
            }
          : null,
      company: companies.get(r.id) ?? null,
      ai: r.ai_category ? { category: r.ai_category, priority: (r.ai_priority ?? 2) as 1 | 2 | 3, summary: r.ai_summary ?? '' } : null
    }
  })
}

export function getThread(id: string): ThreadDetail | null {
  const row = get<ThreadRow>(
    `SELECT th.id, th.account_id, th.subject, th.done, th.last_message_at, th.ai_category, th.ai_priority, th.ai_summary,
       th.followup_kind, th.followup_since, th.followup_due_at, th.followup_snoozed_until,
       COALESCE(th.followup_dismissed_for, '') = COALESCE(th.followup_anchor, '-') followup_dismissed, COUNT(m.id) message_count,
       SUM(CASE WHEN m.is_read = 0 AND m.is_outbound = 0 THEN 1 ELSE 0 END) unread_count, MAX(m.has_attachments) has_attachments
     FROM mail_threads th JOIN mail_messages m ON m.thread_id = th.id WHERE th.id = ? GROUP BY th.id`,
    id
  )
  if (!row) return null
  const [thread] = decorate([row])
  const msgs = all<MsgRow>(
    `SELECT id, thread_id, account_id, message_id, from_name, from_addr, to_addrs, cc_addrs, subject, date, snippet, body_text, body_html, is_read, is_outbound, is_draft
     FROM mail_messages WHERE thread_id = ? AND is_draft < 2 ORDER BY date`,
    id
  )
  const atts = msgs.length
    ? all<MailAttachment & { message_id: string; inline: number; content_id: string | null; stored_path: string | null }>(
        `SELECT id, message_id, filename, mime, size, inline, content_id, stored_path FROM mail_attachments WHERE message_id IN (${marks(msgs.length)})`,
        ...msgs.map((m) => m.id)
      )
    : []
  const locations = all<{ path: string; name: string; role: FolderRole | null }>(
    `SELECT DISTINCT f.path, f.name, f.role FROM mail_locations l JOIN mail_messages m ON m.id = l.message_id
     JOIN mail_folders f ON f.account_id = l.account_id AND f.path = l.folder WHERE m.thread_id = ? AND m.is_draft < 2 ORDER BY f.position, f.path`,
    id
  )
  return {
    ...thread,
    locations,
    messages: msgs.map((m) => {
      const own = atts.filter((a) => a.message_id === m.id)
      const html = resolveInlineImages(m.body_html, own.filter((a) => a.inline))
      return toMessage({ ...m, body_html: html }, own.filter((a) => !a.inline))
    })
  }
}

export function toMessage(m: MsgRow, attachments: MailAttachment[] = []): MailMessage {
  return {
    id: m.id,
    thread_id: m.thread_id,
    account_id: m.account_id,
    message_id: m.message_id,
    from: { name: m.from_name, address: m.from_addr },
    to: JSON.parse(m.to_addrs) as MailAddress[],
    cc: JSON.parse(m.cc_addrs) as MailAddress[],
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
    body_text: m.body_text,
    body_html: m.body_html,
    is_read: !!m.is_read,
    is_outbound: !!m.is_outbound,
    is_draft: !!m.is_draft,
    attachments: attachments.map(({ id, filename, mime, size }) => ({ id, filename, mime, size }))
  }
}

export function getMessageRow(id: string): MsgRow | undefined {
  return get<MsgRow>(
    `SELECT id, thread_id, account_id, message_id, from_name, from_addr, to_addrs, cc_addrs, subject, date, snippet, body_text, body_html, is_read, is_outbound
     FROM mail_messages WHERE id = ?`,
    id
  )
}

export function unreadInboxCount(): number {
  return (
    get<{ n: number }>(
      `SELECT COUNT(DISTINCT m.thread_id) n FROM mail_messages m JOIN mail_threads th ON th.id = m.thread_id
       WHERE m.is_read = 0 AND m.is_outbound = 0 AND m.is_inbox = 1 AND th.done = 0`
    )?.n ?? 0
  )
}

export function attachmentFile(id: string): { path: string | null; filename: string } | null {
  const r = get<{ stored_path: string | null; filename: string }>('SELECT stored_path, filename FROM mail_attachments WHERE id = ?', id)
  return r ? { path: r.stored_path, filename: r.filename } : null
}
