import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS } from '../src/main/db/migrations'
import { all, closeDb, get, openDb } from '../src/main/db'
import * as store from '../src/main/services/mail/store'
import * as crm from '../src/main/services/crm'

/** A database exactly as FollowUp 1.0 left it (migrations 1–8), with mail, a sequence and a rule. */
function legacyDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'followup-upgrade-'))
  const file = join(dir, 'followup.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  for (let v = 0; v < 8; v++) db.exec(MIGRATIONS[v])
  db.exec('PRAGMA user_version = 8')
  const q = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p)
  q(`INSERT INTO accounts (id, kind, name, email, config, secret, sync_state) VALUES ('a1', 'mail', 'Me', 'me@talent.example', '{}', '', ?)`, JSON.stringify({ INBOX: { uidValidity: '7', lastUid: 41 } }))
  q(`INSERT INTO mail_threads (id, account_id, subject, norm_subject, last_message_at) VALUES ('t1', 'a1', 'Quote', 'quote', '2026-10-20T10:00:00.000Z')`)
  q(`INSERT INTO mail_messages (id, account_id, thread_id, folder, uid, message_id, from_addr, to_addrs, subject, date, is_outbound, is_inbox)
     VALUES ('m1', 'a1', 't1', 'INBOX', 41, '<q1@client.example>', 'ana@client.example', '[{"name":"","address":"me@talent.example"}]', 'Quote', '2026-10-20T10:00:00.000Z', 0, 1)`)
  q(`INSERT INTO sequences (id, name, send_window, daily_cap) VALUES ('s1', 'Nudge', '{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}', 10)`)
  q(`INSERT INTO sequence_enrollments (id, sequence_id, thread_id, account_id, to_addrs, status, current_step, next_run_at, enrolled_at)
     VALUES ('e1', 's1', 't1', 'a1', 'ana@client.example', 'active', 0, '2026-10-30T09:00:00.000Z', '2026-10-20T10:00:00.000Z')`)
  q(`INSERT INTO automations (id, name, enabled, trigger, conditions, actions, position) VALUES ('r1', 'Chase', 1, '{"type":"email_no_reply","days":3}', '[]', '[{"type":"start_sequence","sequence_id":"s1"}]', 1)`)
  q(`INSERT INTO automations (id, name, enabled, trigger, conditions, actions, position) VALUES ('r2', 'Other', 1, '{"type":"task_created"}', '[]', '[{"type":"notify","title":"x"}]', 2)`)
  db.close()
  return dir
}

let dir = ''
afterEach(() => {
  closeDb()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('upgrading a 1.0 database', () => {
  it('keeps mail where it was, stops sequences, switches off their rules and adds Clients', () => {
    dir = legacyDb()
    openDb(join(dir, 'followup.db'))
    expect(get<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(MIGRATIONS.length)
    // the message keeps its place on the server (no re-download at the first 1.1 sync)
    expect(all('SELECT message_id, account_id, folder, uid FROM mail_locations')).toEqual([{ message_id: 'm1', account_id: 'a1', folder: 'INBOX', uid: 41 }])
    expect(store.listThreads({ folder: 'inbox' }).map((t) => t.subject)).toEqual(['Quote'])
    // nothing is sent automatically any more
    expect(get<{ status: string; next_run_at: string | null; stopped_reason: string }>("SELECT status, next_run_at, stopped_reason FROM sequence_enrollments WHERE id = 'e1'")).toMatchObject({
      status: 'stopped',
      next_run_at: null,
      stopped_reason: expect.stringMatching(/replaced by Follow-up/)
    })
    expect(all<{ id: string; enabled: number }>('SELECT id, enabled FROM automations ORDER BY id')).toEqual([
      { id: 'r1', enabled: 0 },
      { id: 'r2', enabled: 1 }
    ])
    // Clients are ready, with the default stages
    expect(crm.listStages().map((s) => s.name)).toEqual(['Lead', 'Contacted', 'Meeting held', 'Proposal sent', 'Negotiation', 'Won', 'Lost', 'On hold'])
    expect(crm.listClients()).toEqual([])
  })
})
