import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, safeStorage, shell, Tray, type NativeImage } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppEvent } from '@shared/api'
import type { AppNotification, Settings } from '@shared/types'
import { getSettings, updateSettings } from './services/meta'
import { collectDue, deliverNotification, setNotificationDelivery } from './services/notify'
import { automationTick } from './services/automation'
import { processJobs, recoverJobs, setJobWaker } from './services/jobs'
import { syncAllAccounts } from './services/mail/index'
import { legacyInlinePending } from './services/mail/store'
import { sequenceTick } from './services/mail/sequences'
import { setSecretCodec } from './services/mail/secrets'
import { setMailDataDir } from './services/mail/store'
import { recoverChats, setAiEmitter } from './services/ai/assistant'
import { setToolUiHandler } from './services/ai/tools'
import { getRunningTimer, stopTimer } from './services/time'
import { autoBackup, backupNow } from './services/files'
import { compactDb, runMaintenance } from './services/maintenance'
import { slackTick } from './services/integrations'
import { setBrowserOpener } from './services/oauth'
import { getUpdateStatus, initUpdater, installUpdate, refreshUpdater, setUpdateEmitter } from './services/updater'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let trayHintShown = false
let closePromptOpen = false

/**
 * Windows groups taskbar buttons, pins and notifications by this id (ADR-009). Only the
 * installed app uses the real one; dev and test runs of electron.exe must never claim it.
 */
export const APP_USER_MODEL_ID = app.isPackaged ? import.meta.env.MAIN_VITE_APP_ID || 'app.followup.desktop' : 'app.followup.desktop.dev'

const REOPEN_HINT = 'Open it again from FollowUp in the Start menu, the desktop icon or the tray icon next to the clock (click ^ if it is hidden).'

// ---------------------------------------------------------------- icon (drawn in code: purple disc + white check)

function drawIcon(size: number): NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  const c = size / 2
  const r = size / 2 - 0.5
  // check mark segments in unit coordinates
  const segs: [number, number, number, number][] = [
    [0.28, 0.52, 0.44, 0.68],
    [0.44, 0.68, 0.73, 0.36]
  ]
  const thick = size * 0.075
  const distSeg = (px: number, py: number, [x1, y1, x2, y2]: number[]) => {
    const [ax, ay, bx, by] = [x1 * size, y1 * size, x2 * size, y2 * size]
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const disc = Math.max(0, Math.min(1, r - Math.hypot(px - c, py - c) + 0.5))
      const check = Math.max(0, Math.min(1, thick - Math.min(...segs.map((s) => distSeg(px, py, s))) + 0.5))
      // BGRA: purple #7b68ee blended toward white by the check coverage
      const i = (y * size + x) * 4
      buf[i] = Math.round(0xee + (0xff - 0xee) * check)
      buf[i + 1] = Math.round(0x68 + (0xff - 0x68) * check)
      buf[i + 2] = Math.round(0x7b + (0xff - 0x7b) * check)
      buf[i + 3] = Math.round(255 * disc)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

let iconCache: NativeImage | null = null
export function appIcon(): NativeImage {
  if (!iconCache) {
    iconCache = drawIcon(32)
    iconCache.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: drawIcon(64).toBitmap() })
  }
  return iconCache
}

// ---------------------------------------------------------------- window

const RENDERER_FILE = join(__dirname, '../renderer/index.html')

/**
 * The only page allowed in the privileged main frame (ADR-002): the dev server in
 * development, the bundled index.html otherwise (any #route).
 */
export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (dev && u.origin === new URL(dev).origin) return true
    const own = new URL(pathToFileURL(RENDERER_FILE).href)
    return u.protocol === 'file:' && decodeURIComponent(u.pathname).toLowerCase() === decodeURIComponent(own.pathname).toLowerCase()
  } catch {
    return false
  }
}

export function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'FollowUp',
    icon: appIcon(),
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const startHidden = process.argv.includes('--hidden')
  win.once('ready-to-show', () => !startHidden && win?.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // the main frame never leaves the app page; web links open in the browser
  const keepOnApp = (e: Electron.Event, url: string) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  }
  win.webContents.on('will-navigate', (e, url) => keepOnApp(e, url))
  win.webContents.on('will-redirect', (e, url) => keepOnApp(e, url))
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  // email bodies render in sandboxed iframes; they must never navigate in place
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && e.url !== 'about:srcdoc' && e.url !== 'about:blank') e.preventDefault()
  })
  win.on('close', (e) => {
    if (quitting) return
    const s = getSettings()
    if (s.closeAsked && !s.closeToTray) return
    e.preventDefault()
    if (s.closeAsked) hideToTray(false)
    else void askOnClose()
  })
  win.on('closed', () => (win = null))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(RENDERER_FILE)
  return win
}

function hideToTray(explained: boolean): void {
  win?.hide()
  if (explained) trayHintShown = true
  if (!trayHintShown && tray) {
    trayHintShown = true
    tray.displayBalloon({ title: 'FollowUp is still running', content: `Reminders and timers keep working. ${REOPEN_HINT}`, iconType: 'info' })
  }
}

/** First close: let the user choose between running in the background and quitting (ADR-009). */
async function askOnClose(): Promise<void> {
  if (!win || closePromptOpen) return
  closePromptOpen = true
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'FollowUp',
      message: 'Keep FollowUp running in the background?',
      detail:
        'Reminders, timers and email follow-ups only work while FollowUp is running. ' +
        `In the background it sits in the tray next to the clock.\n\n${REOPEN_HINT}\n\nYou can change this later in Settings → Window & startup.`,
      buttons: ['Keep running in the background', 'Quit FollowUp', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: "Don't ask me again",
      checkboxChecked: true
    })
    if (response === 2) return
    const keep = response === 0
    updateSettings({ closeToTray: keep, closeAsked: checkboxChecked })
    broadcastChanged('updateSettings')
    if (keep) hideToTray(true)
    else {
      quitting = true
      app.quit()
    }
  } finally {
    closePromptOpen = false
  }
}

export function showWindow(): void {
  if (!win) createWindow()
  if (win!.isMinimized()) win!.restore()
  win!.show()
  win!.focus()
}

export function sendEvent(e: AppEvent): void {
  showWindow()
  const send = () => win?.webContents.send('app-event', e)
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

export function broadcastChanged(method: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('data-changed', { method })
}

export function markQuitting(): void {
  quitting = true
}

// ---------------------------------------------------------------- tray & timer display

const fmtElapsed = (startIso: string): string => {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 60000))
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

export function refreshTray(): void {
  const timer = getRunningTimer()
  const label = timer ? `⏱ ${fmtElapsed(timer.entry.started_at)} · ${timer.task.title}` : null
  win?.setTitle(label ? `${label} — FollowUp` : 'FollowUp')
  if (!tray) return
  tray.setToolTip(label ? `FollowUp\n${label}`.slice(0, 127) : 'FollowUp')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open FollowUp', click: showWindow },
      { label: 'New task…', click: () => sendEvent({ type: 'quick-add' }) },
      { type: 'separator' },
      ...(timer
        ? [
            { label, enabled: false } as Electron.MenuItemConstructorOptions,
            { label: 'Open timed task', click: () => sendEvent({ type: 'open-task', taskId: timer.task.id }) },
            {
              label: 'Stop timer',
              click: () => {
                stopTimer()
                refreshTray()
                broadcastChanged('stopTimer')
              }
            }
          ]
        : [{ label: 'No timer running', enabled: false }]),
      { type: 'separator' },
      { label: 'Time tracking', click: () => sendEvent({ type: 'navigate', path: '/time' }) },
      ...(getUpdateStatus().state === 'ready'
        ? [{ label: `Restart to update (${getUpdateStatus().next})`, click: () => installUpdate(markQuitting) } as Electron.MenuItemConstructorOptions]
        : []),
      { type: 'separator' },
      {
        label: 'Quit FollowUp',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

export function createTray(): void {
  tray = new Tray(appIcon().resize({ width: 16, height: 16 }))
  tray.on('click', showWindow)
  refreshTray()
}

// ---------------------------------------------------------------- scheduler

function showToast(n: AppNotification): void {
  // Windows would register a Start-menu shortcut for a dev electron.exe that shows a toast
  // (that is how "Electron" appeared next to FollowUp); in-app notifications still work.
  if (!app.isPackaged || !Notification.isSupported()) return
  const toast = new Notification({ title: n.title, body: n.body, icon: appIcon() })
  toast.on('click', () => (n.task_id ? sendEvent({ type: 'open-task', taskId: n.task_id }) : showWindow()))
  toast.show()
}

let processing = false
let rerun = false

/** Run due jobs; UI refreshes if anything ran. Calls during a run schedule one more pass. */
function runJobs(): void {
  if (processing) {
    rerun = true
    return
  }
  processing = true
  rerun = false
  processJobs()
    .then((n) => {
      if (n) {
        broadcastChanged('jobs')
        refreshTray()
      }
    })
    .catch((e) => console.error('Job processing failed', e))
    .finally(() => {
      processing = false
      if (rerun) setImmediate(runJobs)
    })
}

function tick(): void {
  try {
    const due = collectDue(new Date(), getSettings())
    due.forEach(deliverNotification)
    if (due.length) broadcastChanged('notifications')
  } catch (e) {
    console.error('Notification check failed', e)
  }
  try {
    automationTick()
    sequenceTick()
    slackTick()
  } catch (e) {
    console.error('Automation check failed', e)
  }
  // background account sync on the configured interval (calendars every 15 min)
  const nowMs = Date.now()
  if (nowMs - lastMailSync >= getSettings().mail.syncIntervalMin * 60_000) {
    lastMailSync = nowMs
    syncAllAccounts('mail')
  }
  if (nowMs - lastCalSync >= 15 * 60_000) {
    lastCalSync = nowMs
    syncAllAccounts('caldav')
  }
  runJobs()
  refreshTray()
}

let lastMailSync = 0
let lastCalSync = 0

export function startScheduler(): void {
  setSecretCodec({
    encrypt: (p) => (safeStorage.isEncryptionAvailable() ? `dpapi:${safeStorage.encryptString(p).toString('base64')}` : `b64:${Buffer.from(p).toString('base64')}`),
    decrypt: (s) =>
      s.startsWith('dpapi:') ? safeStorage.decryptString(Buffer.from(s.slice(6), 'base64')) : s.startsWith('b64:') ? Buffer.from(s.slice(4), 'base64').toString() : ''
  })
  setMailDataDir(join(app.getPath('userData'), 'mail'))
  recoverJobs()
  recoverChats()
  setAiEmitter((e) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('app-event', { type: 'ai', event: e })
    // approved tool calls change tasks/events outside an IPC call, so views must refetch
    if (e.kind === 'changed') broadcastChanged('ai')
  })
  setToolUiHandler((a) => sendEvent({ type: 'compose', draft: a }))
  // OAuth sign-in happens in the user's own browser (never an embedded window)
  setBrowserOpener((url) => void shell.openExternal(url))
  setUpdateEmitter((s) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('app-event', { type: 'update', status: s })
    refreshTray()
  })
  initUpdater()
  setNotificationDelivery(showToast)
  // new jobs run right after the transaction that queued them commits
  setJobWaker(() => setImmediate(runJobs))
  tick()
  setInterval(tick, 30_000)
  setInterval(() => attempt('Auto backup', autoBackup), 3600_000)
  // retention, cleanup and space reclaim once a day (also shortly after startup)
  setInterval(() => {
    attempt('Maintenance', () => runMaintenance())
    attempt('Compaction', compactDb)
  }, 24 * 3600_000)
}

function attempt(what: string, fn: () => void): void {
  try {
    fn()
  } catch (e) {
    console.error(`${what} failed`, e)
  }
}

/**
 * Startup housekeeping, run once the window is on screen (ADR-009). The backup comes first, and
 * is taken regardless of age before stored mail is rewritten for the first time (ADR-010).
 */
export function housekeeping(): void {
  attempt('Auto backup', () => void (legacyInlinePending() ? backupNow() : autoBackup()))
  attempt('Maintenance', () => runMaintenance())
  attempt('Compaction', compactDb)
  broadcastChanged('maintenance')
}

// ---------------------------------------------------------------- settings with OS side effects

export function applySettings(s: Settings): void {
  // only register the installed app, never the dev electron.exe
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.startAtLogin, args: ['--hidden'] })
  refreshUpdater()
}
