import { PrismaClient } from '@prisma/client'
import {
  copyFileSync,
  Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { sha256File } from './checksum'
import {
  exportSales,
  exportCustomers,
  exportUsers,
  exportDiscounts,
  exportRefunds,
  exportInventorySnapshot,
  exportSettings,
  exportFeatureFlags,
  exportPricingTiers,
  exportInventoryAdjustments,
  exportCompleteSalesReportCsv
} from './exporters'
import type {
  BackupLogSummary,
  BackupRunResult,
  RestorableBackup,
  RestoreBackupResult
} from '../../shared/types'

const JSON_FILES = [
  'sales.json',
  'customers.json',
  'users.json',
  'discounts.json',
  'refunds.json',
  'inventory-snapshot.json',
  'settings.json',
  'feature-flags.json',
  'pricing-tiers.json',
  'inventory-adjustments.json'
] as const
const ALL_FILES = [
  'backup.sqlite',
  ...JSON_FILES,
  'complete-sales-report.csv',
  'backup-metadata.json'
] as const

/**
 * Everything about the running app that performBackup needs but shouldn't reach for
 * itself — keeps this module free of an `electron` import so it can run under plain
 * Node (Vitest). The IPC handler builds this from `electron`'s `app` module.
 */
export interface BackupEnv {
  /** Absolute path to the live SQLite database file to copy. */
  dbFilePath: string
  posVersion: string
  /** Absolute path to prisma/migrations, used to report a schema version count. */
  migrationsDir: string
  hostname: string
}

function timestampForDirName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

const RETENTION_DAYS = 30

/**
 * Deletes only `PHARMACY_POS_BACKUP_*` folders on this drive whose own timestamp
 * (parsed from the folder name) is more than RETENTION_DAYS old — never based on
 * how many other backups exist. Each expired folder's matching `BackupLog` row
 * (matched by `backupPath`) is kept but marked `EXPIRED_AND_DELETED`, never removed.
 * Best-effort: a cleanup failure doesn't fail the backup that just succeeded, and a
 * folder that can't be positively confirmed as 30+ days old is left alone.
 */
async function cleanupExpiredBackups(db: PrismaClient, drivePath: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = readdirSync(drivePath, { withFileTypes: true })
  } catch {
    // drive not currently reachable — never assume anything is safe to delete
    return
  }

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('PHARMACY_POS_BACKUP_')) continue
    const entryPath = join(drivePath, entry.name)

    const metadataPath = join(entryPath, 'backup-metadata.json')
    let timestamp: number | null = null
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as { timestamp?: string }
      if (metadata.timestamp) timestamp = Date.parse(metadata.timestamp)
    } catch {
      // metadata missing/unreadable — fall back to folder mtime below
    }
    if (timestamp === null || Number.isNaN(timestamp)) {
      try {
        timestamp = statSync(entryPath).birthtimeMs || statSync(entryPath).mtimeMs
      } catch {
        continue // can't positively confirm age — leave it alone
      }
    }

    if (timestamp >= cutoff) continue // not yet 30 days old

    try {
      rmSync(entryPath, { recursive: true, force: true })
    } catch {
      continue // couldn't delete — don't mark the log row as deleted
    }

    try {
      await db.backupLog.updateMany({
        where: { backupPath: entryPath },
        data: { status: 'EXPIRED_AND_DELETED' }
      })
    } catch {
      // best-effort — the folder is already gone; the log row can be reconciled later
    }
  }
}

/** Strips the McKesson catalogue from a *copy* of the database — never touches the live db. */
async function stripCatalogueFromCopy(copiedDbPath: string): Promise<void> {
  const tempDb = new PrismaClient({ datasources: { db: { url: `file:${copiedDbPath}` } } })
  try {
    await tempDb.catalogDeal.deleteMany()
    await tempDb.catalogProduct.deleteMany()
    await tempDb.catalogImportBatch.deleteMany()
  } finally {
    await tempDb.$disconnect()
  }
}

async function insertBackupLog(
  db: PrismaClient,
  params: {
    backupPath: string
    driveName: string
    drivePath: string
    backupSizeBytes: number
    dataSnapshot: Record<string, number>
    initiatedByUserId: number
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL'
    errorMessage?: string
  }
): Promise<void> {
  await db.backupLog.create({
    data: {
      backupPath: params.backupPath,
      driveName: params.driveName,
      drivePath: params.drivePath,
      backupSizeBytes: params.backupSizeBytes,
      dataSnapshot: JSON.stringify(params.dataSnapshot),
      initiatedByUserId: params.initiatedByUserId,
      status: params.status,
      errorMessage: params.errorMessage
    }
  })
}

export async function performBackup(
  db: PrismaClient,
  args: { drivePath: string; driveName: string; initiatedByUserId: number },
  env: BackupEnv
): Promise<BackupRunResult> {
  const { drivePath, driveName, initiatedByUserId } = args
  const startedAt = new Date()
  const backupDir = join(drivePath, `PHARMACY_POS_BACKUP_${timestampForDirName(startedAt)}`)

  try {
    mkdirSync(backupDir, { recursive: true })

    // 1. Copy the live database, then strip the catalogue from the copy only.
    const destDb = join(backupDir, 'backup.sqlite')
    copyFileSync(env.dbFilePath, destDb)
    for (const ext of ['-wal', '-shm']) {
      if (existsSync(env.dbFilePath + ext)) {
        try {
          copyFileSync(env.dbFilePath + ext, destDb + ext)
        } catch {
          // best-effort — a missing/locked WAL sidecar file doesn't invalidate the backup
        }
      }
    }
    await stripCatalogueFromCopy(destDb)

    // 2. Human-readable JSON exports, straight from the live (connected) db.
    const [
      sales,
      customers,
      users,
      discounts,
      refunds,
      inventory,
      settings,
      featureFlags,
      pricingTiers,
      inventoryAdjustments
    ] = await Promise.all([
      exportSales(db),
      exportCustomers(db),
      exportUsers(db),
      exportDiscounts(db),
      exportRefunds(db),
      exportInventorySnapshot(db),
      exportSettings(db),
      exportFeatureFlags(db),
      exportPricingTiers(db),
      exportInventoryAdjustments(db)
    ])
    const salesReportCsv = await exportCompleteSalesReportCsv(db)

    writeFileSync(join(backupDir, 'sales.json'), JSON.stringify(sales, null, 2))
    writeFileSync(join(backupDir, 'customers.json'), JSON.stringify(customers, null, 2))
    writeFileSync(join(backupDir, 'users.json'), JSON.stringify(users, null, 2))
    writeFileSync(join(backupDir, 'discounts.json'), JSON.stringify(discounts, null, 2))
    writeFileSync(join(backupDir, 'refunds.json'), JSON.stringify(refunds, null, 2))
    writeFileSync(join(backupDir, 'inventory-snapshot.json'), JSON.stringify(inventory, null, 2))
    writeFileSync(join(backupDir, 'settings.json'), JSON.stringify(settings, null, 2))
    writeFileSync(join(backupDir, 'feature-flags.json'), JSON.stringify(featureFlags, null, 2))
    writeFileSync(join(backupDir, 'pricing-tiers.json'), JSON.stringify(pricingTiers, null, 2))
    writeFileSync(
      join(backupDir, 'inventory-adjustments.json'),
      JSON.stringify(inventoryAdjustments, null, 2)
    )
    writeFileSync(join(backupDir, 'complete-sales-report.csv'), salesReportCsv)

    // 3. Checksum every file written so far (metadata excluded — it can't checksum itself).
    const checksums: Record<string, string> = {}
    for (const file of ['backup.sqlite', ...JSON_FILES, 'complete-sales-report.csv'] as const) {
      checksums[file] = `sha256:${await sha256File(join(backupDir, file))}`
    }

    const initiatedBy = await db.user.findUnique({
      where: { id: initiatedByUserId },
      select: { fullName: true }
    })
    const dataSnapshot = {
      salesCount: sales.sales.length,
      customersCount: customers.customers.length,
      usersCount: users.users.length,
      discountsCount: discounts.discounts.length,
      refundsCount: refunds.refunds.length,
      creditLedgerEntriesCount: (customers.customers as Array<{ creditLedger: unknown[] }>).reduce(
        (sum, c) => sum + c.creditLedger.length,
        0
      ),
      loyaltyPointEventsCount: (customers.customers as Array<{ loyaltyHistory: unknown[] }>).reduce(
        (sum, c) => sum + c.loyaltyHistory.length,
        0
      ),
      productsCount: inventory.products.length,
      settingsCount: settings.settings.length,
      featureFlagsCount: featureFlags.featureFlags.length,
      pricingTiersCount: pricingTiers.pricingTiers.length,
      inventoryAdjustmentsCount: inventoryAdjustments.inventoryAdjustments.length
    }

    let databaseVersion = 0
    try {
      databaseVersion = readdirSync(env.migrationsDir, { withFileTypes: true }).filter((f) =>
        f.isDirectory()
      ).length
    } catch {
      databaseVersion = 0
    }

    const metadata = {
      timestamp: startedAt.toISOString(),
      backupVersion: '1.0',
      posVersion: env.posVersion,
      databaseVersion,
      dataSnapshot,
      backupLocation: backupDir,
      backupHost: env.hostname,
      backupUser: initiatedBy?.fullName ?? 'Unknown',
      filesIncluded: [...ALL_FILES],
      checksums
    }
    writeFileSync(join(backupDir, 'backup-metadata.json'), JSON.stringify(metadata, null, 2))

    // 4. Verify every file landed on disk, and build the size list for the success screen.
    const files = ALL_FILES.map((name) => {
      const path = join(backupDir, name)
      if (!existsSync(path)) throw new Error(`Backup file missing after write: ${name}`)
      return { name, sizeBytes: statSync(path).size }
    })
    const backupSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)

    await insertBackupLog(db, {
      backupPath: backupDir,
      driveName,
      drivePath,
      backupSizeBytes,
      dataSnapshot,
      initiatedByUserId,
      status: 'SUCCESS'
    })

    // 5. Retention: sweep this drive for backups whose own timestamp is 30+ days old.
    //    Never deletes anything just because a newer backup was made.
    await cleanupExpiredBackups(db, drivePath)

    return { backupDir, files, createdAt: startedAt.toISOString() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await insertBackupLog(db, {
        backupPath: backupDir,
        driveName,
        drivePath,
        backupSizeBytes: 0,
        dataSnapshot: {},
        initiatedByUserId,
        status: 'FAILED',
        errorMessage: message
      })
    } catch {
      // logging the failure is best-effort — the original error is what matters to the caller
    }
    throw new Error(message)
  }
}

/** Suffix appended to `dbFilePath` for a validated-but-not-yet-swapped-in restore. Checked on app startup. */
export function pendingRestoreMarkerPath(dbFilePath: string): string {
  return `${dbFilePath}.pending-restore`
}

/** Reads and validates a single candidate backup folder; null if it isn't a real backup. */
function readRestorableBackup(backupDir: string): RestorableBackup | null {
  const metadataPath = join(backupDir, 'backup-metadata.json')
  if (!existsSync(metadataPath) || !existsSync(join(backupDir, 'backup.sqlite'))) return null
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
    return {
      backupDir,
      timestamp: metadata.timestamp,
      posVersion: metadata.posVersion,
      dataSnapshot: metadata.dataSnapshot ?? {}
    }
  } catch {
    // unreadable/corrupt metadata — not a valid backup
    return null
  }
}

/**
 * Scans a drive for `PHARMACY_POS_BACKUP_*` folders that have a readable,
 * checksummed `backup-metadata.json` — i.e. backups actually restorable, not
 * a folder that merely looks like one.
 *
 * `drivePath` itself is also checked directly: a user browsing with the native
 * folder picker will often navigate *into* a `PHARMACY_POS_BACKUP_*` folder and
 * select that folder itself rather than its parent — that selection is just as
 * valid as picking the parent, so it must resolve to that one backup instead of
 * reporting "no backups found" because it has no matching subfolders.
 */
export function listRestorableBackups(drivePath: string): RestorableBackup[] {
  const results: RestorableBackup[] = []

  const selfBackup = readRestorableBackup(drivePath)
  if (selfBackup) results.push(selfBackup)

  let entries: Dirent[]
  try {
    entries = readdirSync(drivePath, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('PHARMACY_POS_BACKUP_')) continue
    const backup = readRestorableBackup(join(drivePath, entry.name))
    if (backup) results.push(backup)
  }
  return results.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
}

/**
 * Validates a backup folder against its own checksums, then stages the
 * database file next to the live one as `<dbFilePath>.pending-restore`.
 *
 * The live process already holds the current SQLite file open (via Prisma),
 * so the swap itself cannot happen in this process — `applyPendingRestore`
 * performs it on the next app startup, before Prisma connects. This function
 * only validates and stages; it never touches the live database file.
 */
export async function restoreBackup(
  args: { backupDir: string; dbFilePath: string },
  requesterRole: 'MANAGER' | 'CASHIER'
): Promise<RestoreBackupResult> {
  if (requesterRole !== 'MANAGER')
    throw new Error('Restoring from backup must be authorized by a Manager.')

  const { backupDir, dbFilePath } = args
  const metadataPath = join(backupDir, 'backup-metadata.json')
  const dbBackupPath = join(backupDir, 'backup.sqlite')
  if (!existsSync(metadataPath))
    throw new Error('This folder is missing backup-metadata.json — not a valid backup.')
  if (!existsSync(dbBackupPath))
    throw new Error('This folder is missing backup.sqlite — not a valid backup.')

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as {
    checksums?: Record<string, string>
  }
  const expectedChecksum = metadata.checksums?.['backup.sqlite']
  if (!expectedChecksum)
    throw new Error('Backup metadata has no checksum for backup.sqlite — cannot verify integrity.')

  const actualChecksum = `sha256:${await sha256File(dbBackupPath)}`
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      'backup.sqlite failed checksum verification — the file may be corrupt or tampered with. Restore aborted.'
    )
  }

  const stagedPath = pendingRestoreMarkerPath(dbFilePath)
  copyFileSync(dbBackupPath, stagedPath)
  for (const ext of ['-wal', '-shm']) {
    const src = dbBackupPath + ext
    if (existsSync(src)) {
      try {
        copyFileSync(src, stagedPath + ext)
      } catch {
        // best-effort sidecar copy — the main .sqlite file is what's authoritative
      }
    }
  }

  return { backupDir, restoredAt: new Date().toISOString(), restartRequired: true }
}

/**
 * Runs at app startup, before Prisma connects. If a validated restore was
 * staged by `restoreBackup`, swaps it into place as the live database —
 * keeping a `.pre-restore-backup` safety copy of whatever was live before,
 * so a bad restore is itself recoverable.
 */
export function applyPendingRestoreIfStaged(dbFilePath: string): { applied: boolean } {
  const stagedPath = pendingRestoreMarkerPath(dbFilePath)
  if (!existsSync(stagedPath)) return { applied: false }

  if (existsSync(dbFilePath)) {
    copyFileSync(dbFilePath, `${dbFilePath}.pre-restore-backup`)
  }
  copyFileSync(stagedPath, dbFilePath)
  rmSync(stagedPath, { force: true })

  // Stale WAL/SHM sidecars from the pre-restore database would otherwise be
  // replayed on top of the just-restored file and corrupt it.
  for (const ext of ['-wal', '-shm']) {
    rmSync(dbFilePath + ext, { force: true })
    const stagedSidecar = stagedPath + ext
    if (existsSync(stagedSidecar)) {
      copyFileSync(stagedSidecar, dbFilePath + ext)
      rmSync(stagedSidecar, { force: true })
    }
  }

  return { applied: true }
}

export async function getLastBackupLog(db: PrismaClient): Promise<BackupLogSummary | null> {
  const row = await db.backupLog.findFirst({ orderBy: { timestamp: 'desc' } })
  if (!row) return null
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    backupPath: row.backupPath,
    driveName: row.driveName,
    drivePath: row.drivePath,
    backupSizeBytes: row.backupSizeBytes,
    status: row.status,
    errorMessage: row.errorMessage
  }
}
