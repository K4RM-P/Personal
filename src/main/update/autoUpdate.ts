import { BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../../shared/channels'
import type { UpdateStatus } from '../../shared/types'
import { log } from '../logging/logger'

/**
 * B4/B5 — checks GitHub Releases for a newer signed build. Deliberately never installs
 * mid-session: downloads happen in the background, the actual swap only happens via
 * `quitAndInstall` (autoInstallOnAppQuit / the logout-time prompt / an explicit user
 * click), so a cashier mid-sale is never interrupted by files changing under the app.
 */

const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // every 4 hours while the app is open

// States in which a fresh checkForUpdates() call would be redundant or actively harmful:
// re-checking while a download is running can interfere with it, and re-checking once an
// update is already staged just re-fires 'checking' and briefly clobbers the 'ready'
// status the UI is showing (the banner/settings card would flicker away and back).
const CHECK_BLOCKED_STATES: ReadonlySet<UpdateStatus['state']> = new Set([
  'checking',
  'downloading',
  'ready'
])

let status: UpdateStatus = { state: 'idle' }
let mainWindow: BrowserWindow | null = null
let initialized = false

function broadcast(next: UpdateStatus): void {
  status = next
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UPDATE_STATUS_CHANGED, status)
  }
}

/** Keeps the update module pointed at whichever window is currently on screen, so a
 *  window recreated after all windows close (e.g. macOS 'activate') still receives
 *  status broadcasts instead of hitting a destroyed BrowserWindow. */
export function setUpdateWindow(window: BrowserWindow): void {
  mainWindow = window
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function isUpdateReadyToInstall(): boolean {
  return status.state === 'ready'
}

export function installUpdateNow(): void {
  if (status.state !== 'ready') return
  // Explicit (isSilent=true, isForceRunAfter=true): the default quitAndInstall() leaves
  // isSilent false, which lets the NSIS installer show its own UI — exactly the "manual
  // file handling" / installer-window experience this feature exists to eliminate.
  autoUpdater.quitAndInstall(true, true)
}

export function initAutoUpdater(window: BrowserWindow): void {
  if (initialized) return
  initialized = true
  mainWindow = window

  // Download automatically as soon as a newer version is found — no interaction
  // required from a cashier — but always paired with the 'available' broadcast below so
  // the renderer can show a non-blocking "update downloading" banner. Installing is the
  // step that's gated on user/quit timing, not downloading.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    // autoDownload is true, so electron-updater starts pulling the update immediately
    // after this fires; the renderer banner tells the cashier it's happening in the
    // background rather than leaving them unaware an update is in flight.
    broadcast({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => broadcast({ state: 'idle' }))

  autoUpdater.on('download-progress', () => {
    if (status.state !== 'downloading') broadcast({ state: 'downloading', version: status.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'ready', version: info.version })
  })

  // Routine background failures (no internet, GitHub unreachable) are logged, not shown
  // to the cashier — a scary popup over a failed background check would train staff to
  // ignore real errors.
  autoUpdater.on('error', (err) => {
    log('ERROR', { message: err.message, source: 'autoUpdater' })
    broadcast({ state: 'error', error: err.message })
  })

  const checkNow = async (): Promise<void> => {
    if (CHECK_BLOCKED_STATES.has(status.state)) return
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      log('ERROR', {
        message: err instanceof Error ? err.message : String(err),
        source: 'autoUpdater'
      })
    }
  }

  void checkNow()
  setInterval(() => void checkNow(), PERIODIC_CHECK_INTERVAL_MS)

  // Awaits the real check so the renderer's "Checking…" button state reflects how long
  // the check actually took, instead of resolving instantly and lying about progress.
  ipcMain.handle(IPC.UPDATE_CHECK_NOW, () => checkNow())
  ipcMain.handle(IPC.UPDATE_INSTALL_NOW, () => {
    installUpdateNow()
  })
  ipcMain.handle(IPC.UPDATE_GET_STATUS, () => status)
}
