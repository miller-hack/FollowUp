import { app, BrowserWindow, dialog, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Attachment, BackupInfo } from '@shared/types'
import { conn, get, now, run, uuid } from '../db'
import { getSettings, updateSettings } from './meta'
import { timeEntriesCsv } from './time'
import { calendarIcs } from './calendar'
import { buildExport } from './exporter'
import { isDangerousFile, markFromInternet } from './mail/store'
import { backupsToPrune } from './maintenance'
import { addDays, localDate } from '@shared/dates'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip'
}

export const dataDir = (): string => app.getPath('userData')
const attachmentsDir = (): string => join(dataDir(), 'attachments')
const backupsDir = (): string => join(dataDir(), 'backups')

// ---------------------------------------------------------------- attachments

export function addAttachments(taskId: string): Attachment[] {
  const win = BrowserWindow.getFocusedWindow()
  const opts = { title: 'Attach files', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
  const paths = (win ? dialog.showOpenDialogSync(win, opts) : dialog.showOpenDialogSync(opts)) ?? []
  const dir = join(attachmentsDir(), taskId)
  mkdirSync(dir, { recursive: true })
  return paths.map((src) => {
    const id = uuid()
    const name = basename(src)
    const stored = join(dir, `${id}${extname(name)}`)
    copyFileSync(src, stored)
    const a: Attachment = {
      id,
      task_id: taskId,
      file_name: name,
      mime: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
      size: statSync(stored).size,
      created_at: now()
    }
    run(
      'INSERT INTO attachments (id, task_id, file_name, mime, size, stored_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      a.id, a.task_id, a.file_name, a.mime, a.size, stored, a.created_at
    )
    return a
  })
}

/**
 * Open a file that came from someone else (ADR-001). Programs and scripts are never
 * launched from the app: the user is warned and offered the folder instead, where
 * Windows checks the file (Mark of the Web) before running it.
 */
export function openUntrustedFile(file: string, displayName: string): void {
  if (!existsSync(file)) throw new Error('The attachment file is missing. Sync the account again to restore it.')
  markFromInternet(file)
  if (isDangerousFile(displayName) || isDangerousFile(file)) {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.MessageBoxSyncOptions = {
      type: 'warning',
      title: 'Potentially dangerous attachment',
      message: `“${displayName}” can run programs on your PC.`,
      detail:
        'FollowUp does not open programs, scripts or shortcuts from email. Only open it if you know the sender and expected this file — Windows will check it when you open it from the folder.',
      buttons: ['Show in folder', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const choice = win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)
    if (choice === 0) shell.showItemInFolder(file)
    return
  }
  void shell.openPath(file)
}

export function openAttachment(id: string): void {
  const row = get<{ stored_path: string }>('SELECT stored_path FROM attachments WHERE id = ?', id)
  if (row) void shell.openPath(row.stored_path)
}

export function deleteAttachment(id: string): void {
  const row = get<{ stored_path: string }>('SELECT stored_path FROM attachments WHERE id = ?', id)
  run('DELETE FROM attachments WHERE id = ?', id)
  if (row) rmSync(row.stored_path, { force: true })
}

// ---------------------------------------------------------------- backups

export function listBackups(): BackupInfo[] {
  mkdirSync(backupsDir(), { recursive: true })
  return readdirSync(backupsDir())
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = statSync(join(backupsDir(), f))
      return { file: join(backupsDir(), f), size: st.size, created_at: st.mtime.toISOString() }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function backupNow(): BackupInfo {
  mkdirSync(backupsDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(backupsDir(), `followup-${stamp}.db`)
  conn().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  updateSettings({ lastBackupAt: now() })
  for (const old of backupsToPrune(listBackups())) rmSync(old.file, { force: true })
  return listBackups()[0]
}

/** Run a backup if the last one is older than 24 hours. */
export function autoBackup(): void {
  const last = getSettings().lastBackupAt
  if (!last || Date.now() - Date.parse(last) > 24 * 3600_000) backupNow()
}

// ---------------------------------------------------------------- export

export function exportJson(): string | null {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: 'Export data',
    defaultPath: `followup-export-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const file = win ? dialog.showSaveDialogSync(win, opts) : dialog.showSaveDialogSync(opts)
  if (!file) return null
  writeFileSync(file, JSON.stringify(buildExport(), null, 2))
  return file
}

export function exportTimeCsv(from: string, to: string): string | null {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: 'Export time entries',
    defaultPath: `timesheet-${from.slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }
  const file = win ? dialog.showSaveDialogSync(win, opts) : dialog.showSaveDialogSync(opts)
  if (!file) return null
  // BOM so Excel opens UTF-8 correctly
  writeFileSync(file, '﻿' + timeEntriesCsv(from, to))
  return file
}

export function openDataFolder(): void {
  void shell.openPath(dataDir())
}

export function exportIcs(): string | null {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: 'Export calendar',
    defaultPath: `followup-calendar-${new Date().toISOString().slice(0, 10)}.ics`,
    filters: [{ name: 'iCalendar', extensions: ['ics'] }]
  }
  const file = win ? dialog.showSaveDialogSync(win, opts) : dialog.showSaveDialogSync(opts)
  if (!file) return null
  const today = localDate()
  writeFileSync(file, calendarIcs(addDays(today, -90), addDays(today, 366), { includeTasks: true }))
  return file
}