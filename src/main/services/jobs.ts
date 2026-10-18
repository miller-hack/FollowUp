import { all, get, now, run, uuid } from '../db'

/**
 * Persistent job queue (SQLite). Jobs survive restarts, retry with exponential
 * backoff and end as `done` or `failed`. Handlers are registered per job type.
 */

export interface Job<P = unknown> {
  id: string
  type: string
  payload: P
  attempts: number
  max_attempts: number
}

type Handler = (job: Job<never>) => void | Promise<void>
/** Called with the final error when a job gives up. */
type FailHandler = (job: Job<never>, error: string) => void

const handlers = new Map<string, { run: Handler; onFail?: FailHandler }>()
let wake: (() => void) | null = null

export function registerJobHandler<P>(type: string, run: (job: Job<P>) => void | Promise<void>, onFail?: (job: Job<P>, error: string) => void): void {
  handlers.set(type, { run: run as Handler, onFail: onFail as FailHandler | undefined })
}

/** The desktop runtime sets this so new jobs are processed right away. */
export function setJobWaker(fn: (() => void) | null): void {
  wake = fn
}

export function enqueue(type: string, payload: unknown, opts: { runAt?: Date; maxAttempts?: number } = {}): string {
  const id = uuid()
  run(
    'INSERT INTO jobs (id, type, payload, run_at, max_attempts) VALUES (?, ?, ?, ?, ?)',
    id,
    type,
    JSON.stringify(payload),
    (opts.runAt ?? new Date()).toISOString(),
    opts.maxAttempts ?? 3
  )
  wake?.()
  return id
}

/** Backoff before attempt n+1: 30 s, 2 min, 8 min, … capped at 1 h. */
export const backoffMs = (attempts: number): number => Math.min(3600_000, 30_000 * 4 ** Math.max(0, attempts - 1))

let running = false

/** Process every job that is due. Safe to call repeatedly; re-entrant calls are ignored. */
export async function processJobs(at: Date = new Date()): Promise<number> {
  if (running) return 0
  running = true
  let processed = 0
  try {
    for (;;) {
      // jobs queued while processing (e.g. chained automations) are due too
      const cutoff = new Date(Math.max(at.getTime(), Date.now()))
      const due = all<{ id: string; type: string; payload: string; attempts: number; max_attempts: number }>(
        "SELECT id, type, payload, attempts, max_attempts FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT 25",
        cutoff.toISOString()
      )
      if (!due.length) break
      for (const row of due) {
        const job: Job<never> = { ...row, payload: JSON.parse(row.payload) as never, attempts: row.attempts + 1 }
        run("UPDATE jobs SET status = 'running', attempts = ?, updated_at = ? WHERE id = ?", job.attempts, now(), job.id)
        const handler = handlers.get(job.type)
        try {
          if (!handler) throw new Error(`No handler for job type "${job.type}"`)
          await handler.run(job)
          run("UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?", now(), job.id)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (job.attempts < job.max_attempts) {
            run(
              "UPDATE jobs SET status = 'pending', run_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
              new Date(at.getTime() + backoffMs(job.attempts)).toISOString(),
              msg,
              now(),
              job.id
            )
          } else {
            run("UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", msg, now(), job.id)
            try {
              handler?.onFail?.(job, msg)
            } catch (err) {
              console.error('Job failure handler threw', err)
            }
          }
        }
        processed++
      }
    }
  } finally {
    running = false
  }
  return processed
}

/** After a crash, jobs left "running" are retried. Old finished jobs are pruned. */
export function recoverJobs(): void {
  run("UPDATE jobs SET status = 'pending' WHERE status = 'running'")
  run("DELETE FROM jobs WHERE status = 'done' AND updated_at < ?", new Date(Date.now() - 7 * 86_400_000).toISOString())
}

export function jobStats(): { pending: number; failed: number } {
  const r = get<{ pending: number; failed: number }>(
    "SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed FROM jobs"
  )
  return { pending: r?.pending ?? 0, failed: r?.failed ?? 0 }
}
