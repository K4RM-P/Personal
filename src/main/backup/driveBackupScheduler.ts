import { PrismaClient } from '@prisma/client'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { performBackup, type BackupEnv } from './backupService'
import { uploadBackupFolderToDrive, cleanupExpiredDriveBackups } from './googleDrive'
import { getDriveBackupSettings, saveDriveBackupLastRunAt } from '../db/queries/settingsQueries'
import { decryptSecret } from '../payment/credentialStore'
import { log } from '../logging/logger'

const POLL_INTERVAL_MS = 15 * 60 * 1000
const DRIVE_RETENTION_DAYS = 30

let initialized = false

/** Builds a fresh temp dir, runs the normal local-backup pipeline into it, uploads
 *  the result to Drive, then deletes the temp dir — the temp copy never persists. */
export async function runDriveBackupNow(
  db: PrismaClient,
  env: BackupEnv,
  initiatedByUserId: number
): Promise<{ fileCount: number }> {
  const settings = await getDriveBackupSettings(db)
  if (!settings.enabled || !settings.refreshTokenEnc) {
    throw new Error('Google Drive backup is not connected.')
  }
  const refreshToken = decryptSecret(settings.refreshTokenEnc)

  const scratchRoot = mkdtempSync(join(tmpdir(), 'pharmacy-pos-drive-backup-'))
  try {
    const result = await performBackup(
      db,
      { drivePath: scratchRoot, driveName: 'Google Drive (staging)', initiatedByUserId },
      env
    )
    const upload = await uploadBackupFolderToDrive(refreshToken, result.backupDir)
    await cleanupExpiredDriveBackups(refreshToken, DRIVE_RETENTION_DAYS)
    await saveDriveBackupLastRunAt(db, new Date().toISOString())
    return { fileCount: upload.fileCount }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

/** Fire-and-forget poller mirroring reportCsvExportScheduler.ts — checks every 15 minutes
 *  whether it's time for a scheduled Drive backup and runs one if so. */
export function initDriveBackupScheduler(db: PrismaClient, env: BackupEnv): void {
  if (initialized) return
  initialized = true

  const tick = async (): Promise<void> => {
    try {
      const settings = await getDriveBackupSettings(db)
      if (!settings.enabled || !settings.refreshTokenEnc) return

      const intervalMs = settings.intervalHours * 60 * 60 * 1000
      const now = Date.now()
      const lastRunAt = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0
      if (lastRunAt && now - lastRunAt < intervalMs) return

      const systemUser = await db.user.findFirst({
        where: { role: 'MANAGER' },
        orderBy: { id: 'asc' }
      })
      if (!systemUser) return

      await runDriveBackupNow(db, env, systemUser.id)
      log('BACKUP_RUN', { source: 'driveScheduler', intervalHours: settings.intervalHours })
    } catch (error) {
      log('ERROR', {
        message: error instanceof Error ? error.message : String(error),
        source: 'driveBackupScheduler'
      })
    }
  }

  void tick()
  setInterval(() => void tick(), POLL_INTERVAL_MS)
}
