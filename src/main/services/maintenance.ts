import { isAppDate } from '@shared/dates'
import { all, conn, run, tx, uuid } from '../db'
import { migrateLegacyInlineImages, pruneInlineFiles } from './mail/store'

/**
 * Housekeeping that keeps the database bounded (ADR-007): retention for logs and
 * fire-once keys, removal of orphaned rows, and repair of dates stored before
 * validation existed (ADR-005). Runs shortly after startup and once a day. Since 1.0 it also
 * moves images out of stored email HTML and reclaims free space (ADR-010).
 */

const RETENTION_DAYS = {
  readNotifications: 90,
  notifyLog: 120,
  automationFired: 400,
  failedJobs: 30,
  doneJobs: 7,
  aiUsage: 400,
  slackImported: 30
}
const MAX_NOTIFICATIONS = 1000

export function runMaintenance(at: Date = new Date()): Record<string, number> {
  const before = (days: number) => new Date(at.getTime() - days * 86_400_000).toISOString()
  const r = tx(() => {
    const r: Record<string, number> = {
      notifications:
        run('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?', before(RETENTION_DAYS.readNotifications)) +
        run(`DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT ${MAX_NOTIFICATIONS})`),
      notifyLog: run('DELETE FROM notify_log WHERE created_at < ?', before(RETENTION_DAYS.notifyLog)),
      automationFired: run('DELETE FROM automation_fired WHERE created_at < ?', before(RETENTION_DAYS.automationFired)),
      jobs:
        run("DELETE FROM jobs WHERE status = 'failed' AND updated_at < ?", before(RETENTION_DAYS.failedJobs)) +
        run("DELETE FROM jobs WHERE status = 'done' AND updated_at < ?", before(RETENTION_DAYS.doneJobs)),
      aiUsage: run('DELETE FROM ai_usage WHERE created_at < ?', before(RETENTION_DAYS.aiUsage)),
      slackImported: run('DELETE FROM slack_imported WHERE created_at < ?', before(RETENTION_DAYS.slackImported)),
      orphans:
        run("DELETE FROM activity_log WHERE entity_type = 'task' AND entity_id NOT IN (SELECT id FROM tasks)") +
        run('DELETE FROM tasks_fts WHERE task_id NOT IN (SELECT id FROM tasks)') +
        run('DELETE FROM mail_fts WHERE message_id NOT IN (SELECT id FROM mail_messages)'),
      repairedDates: 0
    }
    for (const row of all<{ id: string; start_date: string | null; due_date: string | null }>(
      'SELECT id, start_date, due_date FROM tasks WHERE start_date IS NOT NULL OR due_date IS NOT NULL'
    )) {
      for (const [col, label] of [['start_date', 'start'], ['due_date', 'due']] as const) {
        const v = row[col]
        if (v === null || isAppDate(v)) continue
        run(`UPDATE tasks SET ${col} = NULL WHERE id = ?`, row.id)
        run(
          "INSERT INTO activity_log (id, entity_type, entity_id, action, detail) VALUES (?, 'task', ?, 'repaired', ?)",
          uuid(),
          row.id,
          `Cleared an invalid ${label} date (“${String(v).slice(0, 40)}”)`
        )
        r.repairedDates++
      }
    }
    return r
  })
  r.inlineImages = migrateLegacyInlineImages().images
  r.inlineFiles = pruneInlineFiles()
  return r
}

const pragma = (sql: string): number => Number(Object.values(conn().prepare(sql).get() ?? { v: 0 })[0])

/**
 * Give free pages back to the disk. The first run switches the file to incremental
 * auto-vacuum with one full VACUUM; later runs only release what was freed since.
 * Must run outside a transaction.
 */
export function compactDb(): { mode: 'full' | 'incremental' | 'none'; freedPages: number } {
  const d = conn()
  const free = pragma('PRAGMA freelist_count')
  let mode: 'full' | 'incremental' | 'none' = 'none'
  if (pragma('PRAGMA auto_vacuum') !== 2) {
    d.exec('PRAGMA auto_vacuum = INCREMENTAL')
    d.exec('VACUUM')
    mode = 'full'
  } else if (free > 0) {
    d.exec('PRAGMA incremental_vacuum')
    mode = 'incremental'
  }
  if (mode !== 'none') d.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return { mode, freedPages: free }
}

export const BACKUP_POLICY = { keep: 14, keepAlways: 3, budgetBytes: 2 * 1024 ** 3 }

/** Backups to delete (list is newest first): beyond 14, or beyond the newest 3 once all of them exceed 2 GB. */
export function backupsToPrune<T extends { size: number }>(newestFirst: T[], policy = BACKUP_POLICY): T[] {
  let total = 0
  return newestFirst.filter((b, i) => {
    total += b.size
    if (i < policy.keepAlways) return false
    return i >= policy.keep || total > policy.budgetBytes
  })
}
