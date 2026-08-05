import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb, closeDb } from './db/prisma'
import { registerAllHandlers } from './ipc'
import { applyPendingRestoreIfStaged } from './backup/backupService'
import { resolveDbFilePath } from './backup/dbPath'
import { initLogger, log } from './logging/logger'

function createWindow(): void {
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pharmacy.pos')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initLogger(join(app.getPath('userData'), 'logs'))

  const restore = applyPendingRestoreIfStaged(resolveDbFilePath())
  if (restore.applied) log('RESTORE_STAGED', { dbFilePath: resolveDbFilePath() })

  const db = getDb()
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

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDb().finally(() => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
})
