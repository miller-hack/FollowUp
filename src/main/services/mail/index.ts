import type { Task } from '@shared/types'
import { all, get, run, tx } from '../../db'
import { enqueue, registerJobHandler } from '../jobs'
import { createTask } from '../tasks'
import { syncCalDav } from '../calendar'
import { listAccounts, syncMailAccount } from './accounts'
import { escapeHtml } from './send'

registerJobHandler<{ accountId: string }>('account_sync', async ({ payload }) => {
  const acc = get<{ kind: string; enabled: number }>('SELECT kind, enabled FROM accounts WHERE id = ?', payload.accountId)
  if (!acc?.enabled) return
  if (acc.kind === 'mail') await syncMailAccount(payload.accountId)
  else await syncCalDav(payload.accountId)
})

/** Queue a sync for every enabled account that doesn't already have one waiting. */
export function syncAllAccounts(kind?: 'mail' | 'caldav'): number {
  let n = 0
  for (const a of listAccounts()) {
    if (!a.enabled || (kind && a.kind !== kind)) continue
    const pending = get(
      `SELECT 1 FROM jobs WHERE type = 'account_sync' AND status IN ('pending', 'running') AND json_extract(payload, '$.accountId') = ?`,
      a.id
    )
    if (pending) continue
    enqueue('account_sync', { accountId: a.id }, { maxAttempts: 1 })
    n++
  }
  return n
}

export function syncAccountNow(accountId: string): void {
  enqueue('account_sync', { accountId }, { maxAttempts: 1 })
}

// ---------------------------------------------------------------- email ↔ task

export function linkThreadTask(threadId: string, taskId: string): void {
  run('INSERT OR IGNORE INTO email_task_links (thread_id, task_id) VALUES (?, ?)', threadId, taskId)
}

export function unlinkThreadTask(threadId: string, taskId: string): void {
  run('DELETE FROM email_task_links WHERE thread_id = ? AND task_id = ?', threadId, taskId)
}

/** New task from an email thread: subject as title, the latest message as description, linked both ways. */
export function createTaskFromThread(threadId: string, listId: string, opts: { source?: string } = {}): Task {
  return tx(() => {
    const th = get<{ subject: string }>('SELECT subject FROM mail_threads WHERE id = ?', threadId)
    if (!th) throw new Error('Email thread not found')
    const last = get<{ from_name: string; from_addr: string; date: string; body_text: string }>(
      'SELECT from_name, from_addr, date, body_text FROM mail_messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1',
      threadId
    )
    const body = (last?.body_text ?? '').trim().slice(0, 4000)
    const description = last
      ? `<p><strong>From:</strong> ${escapeHtml(last.from_name || last.from_addr)} &lt;${escapeHtml(last.from_addr)}&gt;</p>` +
        body
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
          .join('')
      : ''
    const task = createTask(
      { list_id: listId, title: th.subject.replace(/^(\s*(re|fwd?)\s*:\s*)+/i, '') || '(no subject)', description },
      { source: opts.source ?? 'email' }
    )
    run('UPDATE tasks SET source_ref = ? WHERE id = ?', threadId, task.id)
    linkThreadTask(threadId, task.id)
    return task
  })
}

export function threadsForTask(taskId: string): { id: string; subject: string; last_message_at: string }[] {
  return all(
    `SELECT th.id, th.subject, th.last_message_at FROM email_task_links l JOIN mail_threads th ON th.id = l.thread_id
     WHERE l.task_id = ? ORDER BY th.last_message_at DESC`,
    taskId
  )
}
