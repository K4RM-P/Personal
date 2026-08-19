import { PrismaClient } from '@prisma/client'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDriveStatus, uploadBackupToDrive } from './googleDrive'
import { performBackup, type BackupEnv } from './backupService'
import { log } from '../logging/logger'

/**
 * Polls every 15 minutes and backs up to Google Drive once the manager-configured
 * interval has elapsed since the last Drive backup — mirrors reportCsvExportScheduler.ts:
 * elapsed-time-since-lastBackup is the only check that survives the app being closed
 * overnight or over a weekend, unlike a single long setTimeout.
 */
const POLL_INTERVAL_MS = 15 * 60 * 1000

let initialized = false

async function checkAndBackup(db: PrismaClient, buildEnv: () => BackupEnv): Promise<void> {
  try {
    const status = await getDriveStatus(db)
    if (!status.connected || !status.autoBackupEnabled) return

    if (status.lastBackup) {
      const hoursSinceLast =
        (Date.now() - new Date(status.lastBackup.timestamp).getTime()) / 3_600_000
      if (hoursSinceLast < status.intervalHours) return
    }

    const stagingDir = mkdtempSync(join(tmpdir(), 'pharmacy-pos-backup-'))
    try {
      const result = await performBackup(
        db,
        { drivePath: stagingDir, driveName: 'Google Drive staging', initiatedByUserId: 0 },
        buildEnv()
      )
      await uploadBackupToDrive(db, result.backupDir, { initiatedByUserId: 0 })
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  } catch (err) {
    log('ERROR', {
      message: err instanceof Error ? err.message : String(err),
      source: 'driveBackupScheduler'
    })
  }
}

/** Called once from app.whenReady(), mirroring initReportCsvExportScheduler's lifecycle. */
export function initDriveBackupScheduler(db: PrismaClient, buildEnv: () => BackupEnv): void {
  if (initialized) return
  initialized = true

  void checkAndBackup(db, buildEnv)
  setInterval(() => void checkAndBackup(db, buildEnv), POLL_INTERVAL_MS)
}
