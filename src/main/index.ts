import { app, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { isReadOnly, type ApiMethod } from '@shared/api'
import { api } from './api'
import { closeDb, openDb } from './db'
import { dataDir } from './services/files'
import { getSettings } from './services/meta'
import { seedIfEmpty } from './services/seed'
import {
  APP_USER_MODEL_ID,
  applySettings,
  broadcastChanged,
  createTray,
  createWindow,
  housekeeping,
  isAppUrl,
  markQuitting,
  refreshTray,
  showWindow,
  startScheduler
} from './desktop'

// Optional data folder override (portable mode, E2E tests)
if (process.env['FOLLOWUP_DATA_DIR']) app.setPath('userData', process.env['FOLLOWUP_DATA_DIR'])

function registerIpc(): void {
  ipcMain.handle('api', (event, method: string, args: unknown[]) => {
    // only the app page itself may use the API (ADR-002)
    const frame = event.senderFrame
    if (!frame || frame.parent !== null || !isAppUrl(frame.url)) throw new Error('Blocked: request from an untrusted page')
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Unknown API method: ${method}`)
    const fn = api[method as ApiMethod] as (...a: unknown[]) => unknown
    const result = fn(...(Array.isArray(args) ? args : []))
    if (!isReadOnly(method)) {
      broadcastChanged(method)
      refreshTray()
      // async mutations (sign-in, Slack sync, AI) change data again when they finish
      if (result instanceof Promise)
        result.then(
          () => broadcastChanged(method),
          () => broadcastChanged(method)
        )
    }
    return result
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_USER_MODEL_ID)
    Menu.setApplicationMenu(null)
    openDb(join(dataDir(), 'followup.db'))
    seedIfEmpty()
    applySettings(getSettings())
    registerIpc()
    // the window comes first; backup, maintenance and compaction follow once it is on screen
    createWindow()
    createTray()
    startScheduler()
    setTimeout(housekeeping, 3000)
  })

  app.on('before-quit', markQuitting)
  // with close-to-tray the app keeps running; otherwise closing the window quits
  app.on('window-all-closed', () => {
    if (!getSettings().closeToTray) app.quit()
  })
  app.on('will-quit', closeDb)
}
