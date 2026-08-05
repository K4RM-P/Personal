import { PrismaClient } from '@prisma/client'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { sha256File } from './checksum'
import {
  exportSales,
  exportCustomers,
  exportUsers,
  exportDiscounts,
  exportRefunds,
  exportInventorySnapshot
} from './exporters'
import type { BackupLogSummary, BackupRunResult } from '../../shared/types'

const JSON_FILES = ['sales.json', 'customers.json', 'users.json', 'discounts.json', 'refunds.json', 'inventory-snapshot.json'] as const
const ALL_FILES = ['backup.sqlite', ...JSON_FILES, 'backup-metadata.json'] as const

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

/**
 * Only the most recent backup is kept on the destination drive — deletes every other
 * `PHARMACY_POS_BACKUP_*` directory there. Best-effort: a prune failure doesn't fail
 * the backup that just succeeded.
 */
function pruneOldBackups(drivePath: string, keepDir: string): void {
  try {
    for (const entry of readdirSync(drivePath, { withFileTypes: true })) {
      const entryPath = join(drivePath, entry.name)
      if (entry.isDirectory() && entry.name.startsWith('PHARMACY_POS_BACKUP_') && entryPath !== keepDir) {
        rmSync(entryPath, { recursive: true, force: true })
      }
    }
  } catch {
    // best-effort — failing to prune old backups doesn't invalidate the new one
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
    const [sales, customers, users, discounts, refunds, inventory] = await Promise.all([
      exportSales(db),
      exportCustomers(db),
      exportUsers(db),
      exportDiscounts(db),
      exportRefunds(db),
      exportInventorySnapshot(db)
    ])

    writeFileSync(join(backupDir, 'sales.json'), JSON.stringify(sales, null, 2))
    writeFileSync(join(backupDir, 'customers.json'), JSON.stringify(customers, null, 2))
    writeFileSync(join(backupDir, 'users.json'), JSON.stringify(users, null, 2))
    writeFileSync(join(backupDir, 'discounts.json'), JSON.stringify(discounts, null, 2))
    writeFileSync(join(backupDir, 'refunds.json'), JSON.stringify(refunds, null, 2))
    writeFileSync(join(backupDir, 'inventory-snapshot.json'), JSON.stringify(inventory, null, 2))

    // 3. Checksum every file written so far (metadata excluded — it can't checksum itself).
    const checksums: Record<string, string> = {}
    for (const file of ['backup.sqlite', ...JSON_FILES] as const) {
      checksums[file] = `sha256:${await sha256File(join(backupDir, file))}`
    }

    const initiatedBy = await db.user.findUnique({ where: { id: initiatedByUserId }, select: { fullName: true } })
    const dataSnapshot = {
      salesCount: sales.sales.length,
      customersCount: customers.customers.length,
      usersCount: users.users.length,
      discountsCount: discounts.discounts.length,
      refundsCount: refunds.refunds.length,
      creditLedgerEntriesCount: (customers.customers as Array<{ creditLedger: unknown[] }>).reduce((sum, c) => sum + c.creditLedger.length, 0),
      loyaltyPointEventsCount: (customers.customers as Array<{ loyaltyHistory: unknown[] }>).reduce((sum, c) => sum + c.loyaltyHistory.length, 0),
      productsCount: inventory.products.length
    }

    let databaseVersion = 0
    try {
      databaseVersion = readdirSync(env.migrationsDir, { withFileTypes: true }).filter((f) => f.isDirectory()).length
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

    // 5. Retention: this drive should only ever hold the backup that just completed.
    pruneOldBackups(drivePath, backupDir)

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
