import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { all, closeDb, conn, get, openDb, run } from '../src/main/db'
import * as store from '../src/main/services/mail/store'
import { createAccount } from '../src/main/services/mail/accounts'
import { backupsToPrune, compactDb, runMaintenance } from '../src/main/services/maintenance'
import * as meta from '../src/main/services/meta'

// 1.0 release (ADR-009, ADR-010): inline mail images, legacy rewrite, compaction, backups, close choice

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(6000, 7)])
const OTHER_PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(6000, 9)])
const meta1 = { accountEmail: 'me@example.com', folder: 'INBOX', uid: 1, seen: false, inInbox: true }

let dir = ''
let accountId = ''
beforeEach(() => {
  closeDb()
  openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'followup-rel-'))
  store.setMailDataDir(dir)
  accountId = createAccount({
    kind: 'mail', name: 'Me', email: 'me@example.com', password: 'x',
    config: { imap: { host: 'h', port: 993, secure: true, user: 'me' }, smtp: { host: 'h', port: 465, secure: true, user: 'me' }, syncDays: 30, appendSent: true }
  }).id
})

const rawWithInlineImage = (cid: string, id: string) =>
  Buffer.from(
    [
      'From: News <news@shop.com>',
      'To: me@example.com',
      'Subject: Our offers',
      `Message-ID: <${id}>`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      `<p>Hello</p><img src="cid:${cid}" alt="logo">`,
      '--b1',
      'Content-Type: image/png; name="logo.png"',
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${cid}>`,
      'Content-Disposition: inline; filename="logo.png"',
      '',
      PNG.toString('base64').replace(/.{76}/g, '$&\r\n'),
      '--b1--',
      ''
    ].join('\r\n')
  )

describe('inline mail images (ADR-010)', () => {
  it('stores cid: images as shared files, keeps them out of the body and resolves them on open', async () => {
    const a = store.storeMessage(accountId, await store.parseRaw(rawWithInlineImage('Logo@Shop', 'n1@shop.com')), meta1)
    store.storeMessage(accountId, await store.parseRaw(rawWithInlineImage('logo@shop', 'n2@shop.com')), { ...meta1, uid: 2 })

    const body = get<{ body_html: string; has_attachments: number }>('SELECT body_html, has_attachments FROM mail_messages WHERE id = ?', a.messageRowId)!
    expect(body.body_html).toContain('cid:Logo@Shop')
    expect(body.body_html).not.toContain('data:image')
    expect(body.has_attachments).toBe(0)

    // one file for the same picture in two messages
    const files = readdirSync(join(dir, accountId, 'inline'))
    expect(files).toHaveLength(1)
    expect(readFileSync(join(dir, accountId, 'inline', files[0]))).toEqual(PNG)

    const thread = store.getThread(a.threadId)!
    const shown = thread.messages.find((m) => m.id === a.messageRowId)!
    expect(shown.attachments).toEqual([])
    expect(shown.body_html).toContain(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(shown.body_html).not.toContain('cid:')
  })

  it('keeps regular attachments listed and leaves unknown cid: references alone', () => {
    const resolved = store.resolveInlineImages('<img src="cid:missing@x"><img src="cid:a%40b">', [
      { content_id: 'a@b', mime: 'image/png', stored_path: null }
    ])
    expect(resolved).toBe('<img src="cid:missing@x"><img src="cid:a%40b">')
    expect(store.resolveInlineImages(null, [])).toBeNull()
  })

  it('moves large embedded data: images of new mail into files', () => {
    const uri = `data:image/png;base64,${PNG.toString('base64')}`
    const small = `data:image/gif;base64,${Buffer.alloc(30).toString('base64')}`
    const r = store.storeMessage(
      accountId,
      {
        messageId: '<d1@x>', inReplyTo: null, references: [], from: { name: 'A', address: 'a@x.com' }, to: [], cc: [],
        subject: 'pic', date: new Date().toISOString(), text: 'hi', html: `<img src="${uri}"><img src="${small}"><img src="${uri}">`, auto: false, attachments: []
      },
      meta1
    )
    const html = get<{ body_html: string }>('SELECT body_html FROM mail_messages WHERE id = ?', r.messageRowId)!.body_html
    expect(html).not.toContain(PNG.toString('base64'))
    expect(html).toContain(small)
    expect(html.match(/cid:fu-[0-9a-f]{16}/g)).toHaveLength(2)
    expect(all('SELECT 1 FROM mail_attachments WHERE message_id = ? AND inline = 1', r.messageRowId)).toHaveLength(1)
  })
})

describe('legacy bodies (stored before 1.0)', () => {
  const legacy = (id: string, img: Buffer) => {
    const r = store.storeMessage(
      accountId,
      {
        messageId: `<${id}>`, inReplyTo: null, references: [], from: { name: 'A', address: 'a@x.com' }, to: [], cc: [],
        subject: id, date: new Date().toISOString(), text: 'hi', html: '<p>x</p>', auto: false, attachments: []
      },
      meta1
    )
    // what 0.6 wrote: the image base64-encoded inside the HTML
    run('UPDATE mail_messages SET body_html = ? WHERE id = ?', `<p>x</p><img src="data:image/png;base64,${img.toString('base64')}">`, r.messageRowId)
    return r
  }

  it('rewrites them once, idempotently, and they still render', () => {
    const a = legacy('l1@x', PNG)
    legacy('l2@x', PNG)
    legacy('l3@x', OTHER_PNG)
    expect(store.legacyInlinePending()).toBe(true)

    const first = store.migrateLegacyInlineImages()
    expect(first).toEqual({ messages: 3, images: 3, done: true })
    expect(store.legacyInlinePending()).toBe(false)
    expect(readdirSync(join(dir, accountId, 'inline'))).toHaveLength(2)
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM mail_messages WHERE body_html LIKE '%data:image%'")!.n).toBe(0)

    const again = store.migrateLegacyInlineImages()
    expect(again).toEqual({ messages: 0, images: 0, done: true })
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM mail_attachments WHERE inline = 1')!.n).toBe(3)

    const shown = store.getThread(a.threadId)!.messages[0]
    expect(shown.body_html).toBe(`<p>x</p><img src="data:image/png;base64,${PNG.toString('base64')}">`)
  })

  it('runs as part of maintenance and prunes image files nothing refers to', () => {
    legacy('m1@x', PNG)
    const r = runMaintenance()
    expect(r.inlineImages).toBe(1)
    const inlineDir = join(dir, accountId, 'inline')
    expect(readdirSync(inlineDir)).toHaveLength(1)
    run('DELETE FROM mail_attachments WHERE inline = 1')
    expect(runMaintenance().inlineFiles).toBe(1)
    expect(readdirSync(inlineDir)).toHaveLength(0)
  })
})

describe('database compaction', () => {
  it('switches to incremental auto-vacuum and returns freed space', () => {
    const file = join(dir, 'c.db')
    closeDb()
    openDb(file)
    run('CREATE TABLE blob_test (v TEXT)')
    for (let i = 0; i < 200; i++) run('INSERT INTO blob_test VALUES (?)', 'x'.repeat(20_000))
    run('DELETE FROM blob_test')
    const pages = () => Number(Object.values(conn().prepare('PRAGMA page_count').get()!)[0])
    const before = pages()
    expect(compactDb().mode).toBe('full')
    expect(Number(Object.values(conn().prepare('PRAGMA auto_vacuum').get()!)[0])).toBe(2)
    expect(pages()).toBeLessThan(before / 4)

    for (let i = 0; i < 100; i++) run('INSERT INTO blob_test VALUES (?)', 'y'.repeat(20_000))
    run('DELETE FROM blob_test')
    const grown = pages()
    expect(compactDb().mode).toBe('incremental')
    expect(pages()).toBeLessThan(grown / 2)
    expect(compactDb().mode).toBe('none')
    closeDb()
    expect(existsSync(file)).toBe(true)
  })
})

describe('backup retention', () => {
  const GB = 1024 ** 3
  const list = (sizes: number[]) => sizes.map((size, i) => ({ id: i, size }))

  it('keeps 14 small backups and drops the rest', () => {
    const pruned = backupsToPrune(list(Array(16).fill(1000)))
    expect(pruned.map((b) => b.id)).toEqual([14, 15])
  })

  it('drops old large backups beyond 2 GB but always keeps the newest 3', () => {
    expect(backupsToPrune(list([0.9 * GB, 0.9 * GB, 0.9 * GB, 0.1 * GB])).map((b) => b.id)).toEqual([3])
    expect(backupsToPrune(list([0.2 * GB, 0.2 * GB, 0.2 * GB, 0.9 * GB, 0.9 * GB, 0.01 * GB])).map((b) => b.id)).toEqual([4, 5])
  })
})

describe('close choice (ADR-009)', () => {
  it('defaults to asking once and remembers the answer', () => {
    expect(meta.getSettings()).toMatchObject({ closeToTray: true, closeAsked: false })
    meta.updateSettings({ closeToTray: false, closeAsked: true })
    expect(meta.getSettings()).toMatchObject({ closeToTray: false, closeAsked: true })
  })
})
