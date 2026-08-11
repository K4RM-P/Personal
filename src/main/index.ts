import { app, shell, BrowserWindow } from 'electron'
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

// .env (dev-only, gitignored) is the only thing that sets DATABASE_URL, and it's
// intentionally excluded from the packaged app. Without this fallback, Prisma has
// no database to connect to at all in a production install. userData survives
// every reinstall/update, unlike the app's own install directory.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${join(app.getPath('userData'), 'pharmapos.db')}`
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
    ...(process.platform === 'linux' ? { icon } : {}),
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
})

app.on('window-all-closed', () => {
  closeDb().finally(() => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
})
