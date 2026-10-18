import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrate } from './migrations'

type Param = string | number | bigint | null | Uint8Array
type Row = Record<string, unknown>

let db: DatabaseSync | null = null

export function openDb(file: string): DatabaseSync {
  db?.close()
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

export function conn(): DatabaseSync {
  if (!db) throw new Error('Database not opened')
  return db
}

function norm(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    if (typeof p === 'object' && !(p instanceof Uint8Array)) return JSON.stringify(p)
    return p as Param
  })
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return conn().prepare(sql).all(...norm(params)) as T[]
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return conn().prepare(sql).get(...norm(params)) as T | undefined
}

export function run(sql: string, ...params: unknown[]): number {
  return Number(conn().prepare(sql).run(...norm(params)).changes)
}

let txDepth = 0
export function tx<T>(fn: () => T): T {
  const d = conn()
  if (txDepth > 0) return fn()
  d.exec('BEGIN')
  txDepth++
  try {
    const result = fn()
    d.exec('COMMIT')
    return result
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  } finally {
    txDepth--
  }
}

export const uuid = (): string => randomUUID()
export const now = (): string => new Date().toISOString()

/** `?, ?, ?` placeholder list for an IN clause. */
export const marks = (n: number): string => Array(n).fill('?').join(', ')
