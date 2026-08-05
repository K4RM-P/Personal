import { app, dialog, ipcMain, shell } from 'electron'
import { PrismaClient } from '@prisma/client'
import { hostname } from 'os'
import { basename, join } from 'path'
import { IPC } from '../../shared/channels'
import { getExternalDrives } from '../backup/drives'
import {
  performBackup,
  getLastBackupLog,
  listRestorableBackups,
  restoreBackup,
  type BackupEnv
} from '../backup/backupService'
import { resolveDbFilePath } from '../backup/dbPath'
import {
  getBackupPromptOnLogout,
  saveBackupPromptOnLogout,
  getBackupDestination,
  saveBackupDestination
} from '../db/queries/settingsQueries'
import { requireManager } from '../auth/session'
import { log } from '../logging/logger'

function buildBackupEnv(): BackupEnv {
  return {
    dbFilePath: resolveDbFilePath(),
    posVersion: app.getVersion(),
    migrationsDir: join(app.getAppPath(), 'prisma', 'migrations'),
    hostname: hostname()
  }
}

/** Wraps a handler so a thrown error surfaces as a clean message, not an unhandled rejection. */
function guard<A extends unknown[], R>(
  label: string,
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${label}: ${message}`)
    }
  }
}

export function registerBackupHandlers(db: PrismaClient): void {
  ipcMain.handle(
    IPC.BACKUP_GET_EXTERNAL_DRIVES,
    guard('List external drives', async () => getExternalDrives())
  )

  ipcMain.handle(
    IPC.BACKUP_PICK_FOLDER,
    guard('Pick backup folder', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Choose a backup destination',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
  )

  ipcMain.handle(
    IPC.BACKUP_RUN,
    guard(
      'Backup',
      async (
        _e: Electron.IpcMainInvokeEvent,
        args: { drivePath: string; driveName?: string; initiatedByUserId: number }
      ) => {
        const driveName = args.driveName ?? basename(args.drivePath) ?? args.drivePath
        try {
          const result = await performBackup(
            db,
            { drivePath: args.drivePath, driveName, initiatedByUserId: args.initiatedByUserId },
            buildBackupEnv()
          )
          log('BACKUP_RUN', { backupDir: result.backupDir, driveName })
          return result
        } catch (error) {
          log('BACKUP_FAILED', {
            driveName,
            message: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }
    )
  )

  ipcMain.handle(
    IPC.BACKUP_GET_LAST,
    guard('Get last backup', async () => getLastBackupLog(db))
  )

  ipcMain.handle(
    IPC.BACKUP_OPEN_FOLDER,
    guard('Open backup folder', async (_e: Electron.IpcMainInvokeEvent, path: string) => {
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    })
  )

  ipcMain.handle(
    IPC.BACKUP_GET_PROMPT_ON_LOGOUT,
    guard('Get backup prompt setting', async () => getBackupPromptOnLogout(db))
  )

  ipcMain.handle(
    IPC.BACKUP_SAVE_PROMPT_ON_LOGOUT,
    guard(
      'Save backup prompt setting',
      async (_e: Electron.IpcMainInvokeEvent, enabled: boolean) => {
        await saveBackupPromptOnLogout(db, enabled)
      }
    )
  )

  ipcMain.handle(
    IPC.BACKUP_GET_DRIVE_PATH,
    guard('Get backup destination', async () => getBackupDestination(db))
  )

  ipcMain.handle(
    IPC.BACKUP_SAVE_DRIVE_PATH,
    guard(
      'Save backup destination',
      async (_e: Electron.IpcMainInvokeEvent, args: { drivePath: string; driveName: string }) => {
        await saveBackupDestination(db, args.drivePath, args.driveName)
      }
    )
  )

  ipcMain.handle(
    IPC.BACKUP_LIST_RESTORABLE,
    guard('List restorable backups', async (_e: Electron.IpcMainInvokeEvent, drivePath: string) => {
      requireManager()
      return listRestorableBackups(drivePath)
    })
  )

  ipcMain.handle(
    IPC.BACKUP_RESTORE,
    guard(
      'Restore backup',
      async (_e: Electron.IpcMainInvokeEvent, args: { backupDir: string }) => {
        const session = requireManager()
        return restoreBackup(
          { backupDir: args.backupDir, dbFilePath: resolveDbFilePath() },
          session.role
        )
      }
    )
  )

  ipcMain.handle(
    IPC.BACKUP_RELAUNCH,
    guard('Restart application', async () => {
      requireManager()
      app.relaunch()
      app.exit(0)
    })
  )
}
