import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '@shared/integrations'
import { getSettings } from './meta'

/**
 * Auto-update via electron-updater (NSIS). The update server is either built into
 * the installer (app-update.yml, from FOLLOWUP_UPDATE_URL at build time) or set in
 * Settings → Updates. Updates download in the background and install on restart.
 */

let status: UpdateStatus = { state: 'dev', current: app.getVersion() }
let emit: (s: UpdateStatus) => void = () => {}
let started = false

export function setUpdateEmitter(fn: (s: UpdateStatus) => void): void {
  emit = fn
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  emit(status)
}

/** URL of the feed built into this installation, if any. */
function builtInFeed(): string | null {
  const file = join(process.resourcesPath, 'app-update.yml')
  if (!existsSync(file)) return null
  return /^url:\s*(\S+)/m.exec(readFileSync(file, 'utf8'))?.[1] ?? 'built in'
}

const overrideFeed = () => process.env['FOLLOWUP_UPDATE_URL']?.trim() || getSettings().updates.feedUrl.trim() || null

function applyFeed(): boolean {
  const url = overrideFeed()
  if (url) {
    autoUpdater.setFeedURL({ provider: 'generic', url })
    status.source = url
    return true
  }
  const built = builtInFeed()
  status.source = built ?? undefined
  return !!built
}

function friendly(e: unknown): string {
  const msg = String((e as Error)?.message ?? e).split('\n')[0]
  if (/ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(msg)) return 'Could not reach the update server. Check your internet connection.'
  if (/404|latest\.yml/.test(msg)) return 'No release was found on the update server (latest.yml is missing).'
  if (/sha512 checksum mismatch|signature/i.test(msg)) return `The downloaded update failed verification and was discarded. ${msg.slice(0, 120)}`
  return msg.slice(0, 240)
}

/** Called once at startup (installed app only). */
export function initUpdater(): void {
  if (!app.isPackaged || started) return
  started = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', next: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'none', checked_at: new Date().toISOString() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', next: info.version, percent: 100, checked_at: new Date().toISOString() }))
  autoUpdater.on('error', (e) => set({ state: 'error', error: friendly(e), checked_at: new Date().toISOString() }))
  status = { state: applyFeed() ? 'idle' : 'unconfigured', current: app.getVersion(), source: status.source }
  // first check shortly after startup, then every 6 hours
  setTimeout(() => autoCheck(), 15_000)
  setInterval(() => autoCheck(), 6 * 3600_000)
}

function autoCheck(): void {
  if (!getSettings().updates.auto || status.state === 'ready' || status.state === 'downloading') return
  void check()
}

async function check(): Promise<void> {
  if (!applyFeed()) {
    set({ state: 'unconfigured' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: friendly(e), checked_at: new Date().toISOString() })
  }
}

export function checkForUpdates(): void {
  if (!app.isPackaged) throw new Error('Updates work in the installed app, not in development mode')
  if (status.state === 'downloading' || status.state === 'checking') return
  void check()
}

/** Settings changed (feed URL): re-evaluate without waiting for the next check. */
export function refreshUpdater(): void {
  if (!started) return
  const ok = applyFeed()
  if (!ok) set({ state: 'unconfigured' })
  else if (status.state === 'unconfigured') set({ state: 'idle' })
}

/** Quit, run the downloaded installer silently and start the new version. */
export function installUpdate(beforeQuit: () => void): void {
  if (status.state !== 'ready') throw new Error('No update is ready to install')
  beforeQuit()
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
