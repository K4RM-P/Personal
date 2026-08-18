import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import http from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb, closeDb } from './db/prisma'
import { runPendingMigrations } from './db/migrate'
import { registerAllHandlers } from './ipc'
import { applyPendingRestoreIfStaged } from './backup/backupService'
import { resolveDbFilePath } from './backup/dbPath'
import { initLogger, log } from './logging/logger'
import { initAutoUpdater, setUpdateWindow } from './update/autoUpdate'
import { initCustomerDisplayWindow, teardownCustomerDisplayWindow } from './customerDisplayWindow'
import { initReportEmailScheduler } from './reports/reportEmailScheduler'
import { join as joinPath } from 'path'

// .env (dev-only, gitignored) is the only thing that sets DATABASE_URL under normal
// circumstances, and it's intentionally excluded from the packaged app.
//
// `app.relaunch()` (used for staged backup restores) spawns a bare `electron` process
// outside electron-vite's dev orchestration, so `.env` never gets reinjected into
// `process.env` on the relaunched process — see the loadRenderer() comment below for the
// same gotcha. That means `process.env.DATABASE_URL` can legitimately be unset here even
// in dev, right after a relaunch. Falling back to the packaged-style userData path in
// that case would silently connect to a brand-new, unmigrated database instead of the
// real `prisma/dev.db` — so the dev fallback below must match what `.env` normally provides.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = is.dev
    ? `file:${joinPath(app.getAppPath(), 'prisma', 'dev.db')}`
    : `file:${joinPath(app.getPath('userData'), 'pharmapos.db')}`
}

/**
 * Checks that the electron-vite dev server is actually reachable before pointing the
 * window at it. Necessary because `app.relaunch()` (used after a staged restore) spawns
 * a fresh `electron .` process outside electron-vite's dev orchestration — that process
 * still inherits `ELECTRON_RENDERER_URL` from the original session even after the dev
 * server behind it has been torn down, which otherwise leaves the window loading a dead
 * URL and showing a permanently blank screen.
 */
function isDevServerReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 800 }, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

async function loadRenderer(mainWindow: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl && (await isDevServerReachable(devUrl))) {
    await mainWindow.loadURL(devUrl)
    return
  }

  const builtIndex = join(__dirname, '../renderer/index.html')
  if (existsSync(builtIndex)) {
    await mainWindow.loadFile(builtIndex)
    return
  }

  // Neither the dev server nor a built renderer is available (e.g. relaunched after a
  // restore while only `electron-vite dev` was running) — show a clear message instead
  // of a silent blank window that looks like the restore wiped the data.
  await mainWindow.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<body style="font-family:sans-serif;padding:2rem">
          <h2>App restarted, but the dev server isn't running</h2>
          <p>The database restore/backup completed successfully. This window can't reach the
          Vite dev server (it stops when the app restarts during <code>npm run dev</code>).</p>
          <p>Close this window and run <code>npm run dev</code> again to continue.</p>
        </body>`
      )
  )
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  void loadRenderer(mainWindow)
  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.pharmacy.pos')

  // BrowserWindow's `icon` option is a no-op on macOS (window icons aren't a thing there) —
  // only the Dock icon is visible, and in dev that defaults to Electron's own atom icon
  // since there's no packaged .app bundle to source it from. Packaged builds get the right
  // icon automatically from build/icon.icns via electron-builder, so this only matters here.
  if (process.platform === 'darwin' && is.dev) {
    app.dock?.setIcon(nativeImage.createFromPath(icon))
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initLogger(join(app.getPath('userData'), 'logs'))

  const restore = applyPendingRestoreIfStaged(resolveDbFilePath())
  if (restore.applied) log('RESTORE_STAGED', { dbFilePath: resolveDbFilePath() })

  const db = getDb()
  if (!is.dev) {
    await runPendingMigrations(db)
  }
  registerAllHandlers(db)

  process.on('uncaughtException', (error) => {
    log('ERROR', { message: error.message, stack: error.stack, source: 'uncaughtException' })
  })
  process.on('unhandledRejection', (reason) => {
    log('ERROR', {
      message: reason instanceof Error ? reason.message : String(reason),
      source: 'unhandledRejection'
    })
  })

  const mainWindow = createWindow()

  // Second, customer-facing kiosk window (no-op when only one display is present).
  initCustomerDisplayWindow(db)
  // The kiosk window is a BrowserWindow too, so leaving it open would stop
  // 'window-all-closed' from ever firing when the cashier closes the POS window.
  mainWindow.on('closed', () => {
    teardownCustomerDisplayWindow()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow()
      // Keep the updater pointed at whichever window is actually on screen, so status
      // broadcasts (banner/settings card) don't try to reach the destroyed original.
      setUpdateWindow(newWindow)
    }
  })

  // Checks GitHub Releases for a newer signed build and downloads it in the background;
  // installing only ever happens on quit/restart (see main/update/autoUpdate.ts), never
  // mid-session, so an update landing never interrupts an in-progress sale. Always called
  // (dev included) — it registers the update:* IPC handlers the renderer polls
  // unconditionally; the real autoUpdater wiring inside is itself gated on !is.dev.
  initAutoUpdater(mainWindow)

  // Polls for a due scheduled report-digest email and sends it — see
  // main/reports/reportEmailScheduler.ts. Fire-and-forget, same lifecycle as
  // initAutoUpdater above (no explicit teardown; Electron just kills the timer on quit).
  initReportEmailScheduler(db)

  // Polls for a due scheduled Complete Products Sales Report CSV export — see
  // main/reports/reportCsvExportScheduler.ts. Same fire-and-forget lifecycle.
  initReportCsvExportScheduler(db)
})

app.on('window-all-closed', () => {
  teardownCustomerDisplayWindow()
  closeDb().finally(() => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
})
