import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  performBackup,
  getLastBackupLog,
  restoreBackup,
  applyPendingRestoreIfStaged,
  listRestorableBackups,
  pendingRestoreMarkerPath,
  type BackupEnv
} from '../main/backup/backupService'
import { sha256File } from '../main/backup/checksum'

/**
 * End-to-end cover for the data backup system (docs/data-backup-system-spec.md)
 * against a real SQLite database — same isolated-temp-db approach as
 * complianceQueries.test.ts, since `prisma migrate dev` is interactive and
 * would mutate the developer's working database.
 */
describe('data backup system', () => {
  let db: PrismaClient
  let workDir: string
  let driveDir: string
  let dbFilePath: string
  let env: BackupEnv

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'backup-it-'))
    dbFilePath = join(workDir, 'test.db')
    const url = `file:${dbFilePath}`
    const execEnv = { ...process.env, DATABASE_URL: url }
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env: execEnv,
      stdio: 'pipe'
    })
    db = new PrismaClient({ datasources: { db: { url } } })

    driveDir = mkdtempSync(join(tmpdir(), 'backup-drive-'))
    env = {
      dbFilePath,
      posVersion: '1.0.0-test',
      migrationsDir: join(process.cwd(), 'prisma', 'migrations'),
      hostname: 'test-host'
    }

    // --- Fixtures: one of everything a backup should capture ---
    const user = await db.user.create({
      data: { fullName: 'Alice Manager', passwordHash: 'x', role: 'MANAGER' }
    })
    const product = await db.product.create({
      data: {
        sku: 'SKU-1',
        name: 'Cough Drops',
        costCents: 50,
        priceCents: 312,
        currentOnHand: 10,
        categoryCode: 'OTC'
      }
    })
    const customer = await db.customer.create({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '555-0100',
        phoneNormalized: '5550100',
        address: '123 Main St'
      }
    })
    await db.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'FUNDS_ADDED',
        amountCents: 5000,
        balanceAfterCents: 5000
      }
    })
    await db.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'SALE_CHARGE',
        amountCents: -3750,
        balanceAfterCents: 1250
      }
    })
    await db.loyaltyPointEvent.create({
      data: { customerId: customer.id, type: 'EARNED', points: 47, pointsAfter: 47 }
    })
    const transaction = await db.transaction.create({
      data: {
        receiptNumber: 'R-0001',
        customerId: customer.id,
        userId: user.id,
        cashierId: user.id,
        subtotalCents: 624,
        taxCents: 81,
        totalCents: 705,
        tenderedCents: 705,
        changeCents: 0,
        items: {
          create: [
            {
              productId: product.id,
              quantity: 2,
              costCents: 50,
              unitPriceCents: 312,
              totalCents: 624
            }
          ]
        }
      }
    })
    await db.discount.create({
      data: {
        transactionId: transaction.id,
        type: 'BILL',
        amountCents: 62,
        originalCents: 624,
        finalCents: 562,
        appliedByUserId: user.id
      }
    })
    await db.refund.create({
      data: {
        transactionId: transaction.id,
        type: 'CASH',
        amountCents: 100,
        refundedByUserId: user.id,
        status: 'COMPLETED'
      }
    })
    const batch = await db.catalogImportBatch.create({
      data: { filename: 'webcat.txt', fileSizeBytes: 1000, status: 'committed' }
    })
    await db.catalogProduct.create({
      data: {
        itemNumber: '123456',
        description: 'CATALOGUE ITEM',
        displayName: 'Catalogue Item',
        province: 'ONT',
        importBatchId: batch.id
      }
    })
  }, 120_000)

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
    rmSync(driveDir, { recursive: true, force: true })
  })

  it('writes all 13 backup files with correct, checksummed, catalogue-free content', async () => {
    const user = await db.user.findFirstOrThrow()
    const result = await performBackup(
      db,
      { drivePath: driveDir, driveName: 'Test Drive', initiatedByUserId: user.id },
      env
    )

    const requiredFiles = [
      'backup.sqlite',
      'sales.json',
      'customers.json',
      'users.json',
      'discounts.json',
      'refunds.json',
      'inventory-snapshot.json',
      'settings.json',
      'feature-flags.json',
      'pricing-tiers.json',
      'inventory-adjustments.json',
      'complete-sales-report.csv',
      'backup-metadata.json'
    ]
    expect(result.files.map((f) => f.name).sort()).toEqual([...requiredFiles].sort())
    for (const name of requiredFiles) {
      expect(existsSync(join(result.backupDir, name))).toBe(true)
    }

    const sales = JSON.parse(readFileSync(join(result.backupDir, 'sales.json'), 'utf-8'))
    expect(sales.sales).toHaveLength(1)
    expect(sales.sales[0].lineItems).toHaveLength(1)

    const customers = JSON.parse(readFileSync(join(result.backupDir, 'customers.json'), 'utf-8'))
    expect(customers.customers).toHaveLength(1)
    expect(customers.customers[0].creditLedger).toHaveLength(2)
    expect(customers.customers[0].loyaltyHistory).toHaveLength(1)
    expect(customers.customers[0].currentBalance.creditCents).toBe(1250)

    const users = JSON.parse(readFileSync(join(result.backupDir, 'users.json'), 'utf-8'))
    expect(users.users).toHaveLength(1)
    expect(users.users[0]).not.toHaveProperty('passwordHash')

    const discounts = JSON.parse(readFileSync(join(result.backupDir, 'discounts.json'), 'utf-8'))
    expect(discounts.discounts).toHaveLength(1)

    const refunds = JSON.parse(readFileSync(join(result.backupDir, 'refunds.json'), 'utf-8'))
    expect(refunds.refunds).toHaveLength(1)

    const inventory = JSON.parse(
      readFileSync(join(result.backupDir, 'inventory-snapshot.json'), 'utf-8')
    )
    expect(inventory.products).toHaveLength(1)
    expect(inventory.totalInventoryValueCost).toBe(500) // 50 cents cost * 10 on-hand

    const metadata = JSON.parse(
      readFileSync(join(result.backupDir, 'backup-metadata.json'), 'utf-8')
    )
    expect(metadata.dataSnapshot).toMatchObject({
      salesCount: 1,
      customersCount: 1,
      usersCount: 1,
      discountsCount: 1,
      refundsCount: 1,
      creditLedgerEntriesCount: 2,
      loyaltyPointEventsCount: 1,
      productsCount: 1
    })
    expect(typeof metadata.dataSnapshot.settingsCount).toBe('number')
    expect(typeof metadata.dataSnapshot.featureFlagsCount).toBe('number')
    expect(typeof metadata.dataSnapshot.pricingTiersCount).toBe('number')
    expect(typeof metadata.dataSnapshot.inventoryAdjustmentsCount).toBe('number')
    for (const name of [
      'backup.sqlite',
      'sales.json',
      'customers.json',
      'users.json',
      'discounts.json',
      'refunds.json',
      'inventory-snapshot.json',
      'settings.json',
      'feature-flags.json',
      'pricing-tiers.json',
      'inventory-adjustments.json',
      'complete-sales-report.csv'
    ]) {
      const recomputed = `sha256:${await sha256File(join(result.backupDir, name))}`
      expect(metadata.checksums[name]).toBe(recomputed)
    }

    // Catalogue is excluded from the copy...
    const copiedDb = new PrismaClient({
      datasources: { db: { url: `file:${join(result.backupDir, 'backup.sqlite')}` } }
    })
    try {
      expect(await copiedDb.catalogProduct.count()).toBe(0)
      expect(await copiedDb.catalogImportBatch.count()).toBe(0)
    } finally {
      await copiedDb.$disconnect()
    }
    // ...but the live database is untouched.
    expect(await db.catalogProduct.count()).toBe(1)

    const log = await getLastBackupLog(db)
    expect(log?.status).toBe('SUCCESS')
    expect(log?.backupPath).toBe(result.backupDir)
  })

  describe('retention (30-day age-based cleanup)', () => {
    it('does not delete a backup just because a newer one was created moments later', async () => {
      const user = await db.user.findFirstOrThrow()
      const dir = mkdtempSync(join(tmpdir(), 'backup-retention-'))
      try {
        const first = await performBackup(
          db,
          { drivePath: dir, driveName: 'Retention Drive', initiatedByUserId: user.id },
          env
        )
        const second = await performBackup(
          db,
          { drivePath: dir, driveName: 'Retention Drive', initiatedByUserId: user.id },
          env
        )
        expect(existsSync(first.backupDir)).toBe(true)
        expect(existsSync(second.backupDir)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('does not delete a 29-day-old backup, but deletes a 31-day-old one and marks its log EXPIRED_AND_DELETED', async () => {
      const user = await db.user.findFirstOrThrow()
      const dir = mkdtempSync(join(tmpdir(), 'backup-retention-age-'))
      try {
        const fresh = await performBackup(
          db,
          { drivePath: dir, driveName: 'Retention Drive', initiatedByUserId: user.id },
          env
        )
        const day29 = await performBackup(
          db,
          { drivePath: dir, driveName: 'Retention Drive', initiatedByUserId: user.id },
          env
        )
        const day31 = await performBackup(
          db,
          { drivePath: dir, driveName: 'Retention Drive', initiatedByUserId: user.id },
          env
        )

        // Backdate metadata timestamps to simulate age, since these were just created.
        const backdate = (backupDir: string, daysAgo: number): void => {
          const metadataPath = join(backupDir, 'backup-metadata.json')
          const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
          metadata.timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
          writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
        }
        backdate(day29.backupDir, 29)
        backdate(day31.backupDir, 31)

        const day31Log = await db.backupLog.findFirst({ where: { backupPath: day31.backupDir } })

        // Triggering cleanup: run one more backup, whose post-success sweep evaluates all folders.
        const trigger = await performBackup(
          db,
          { drivePath: dir, driveName: 'Retention Drive', initiatedByUserId: user.id },
          env
        )

        expect(existsSync(fresh.backupDir)).toBe(true)
        expect(existsSync(day29.backupDir)).toBe(true)
        expect(existsSync(day31.backupDir)).toBe(false)
        expect(existsSync(trigger.backupDir)).toBe(true)

        const updatedLog = await db.backupLog.findUnique({ where: { id: day31Log!.id } })
        expect(updatedLog).not.toBeNull()
        expect(updatedLog?.status).toBe('EXPIRED_AND_DELETED')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('retention at one drive does not affect backups at another drive', async () => {
      const user = await db.user.findFirstOrThrow()
      const driveA = mkdtempSync(join(tmpdir(), 'backup-retention-a-'))
      const driveB = mkdtempSync(join(tmpdir(), 'backup-retention-b-'))
      try {
        const oldOnA = await performBackup(
          db,
          { drivePath: driveA, driveName: 'Drive A', initiatedByUserId: user.id },
          env
        )
        const metadataPath = join(oldOnA.backupDir, 'backup-metadata.json')
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
        metadata.timestamp = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
        writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))

        const onB = await performBackup(
          db,
          { drivePath: driveB, driveName: 'Drive B', initiatedByUserId: user.id },
          env
        )
        // Trigger cleanup on drive A independently.
        const triggerA = await performBackup(
          db,
          { drivePath: driveA, driveName: 'Drive A', initiatedByUserId: user.id },
          env
        )

        expect(existsSync(oldOnA.backupDir)).toBe(false) // expired, drive A
        expect(existsSync(triggerA.backupDir)).toBe(true)
        expect(existsSync(onB.backupDir)).toBe(true) // untouched, drive B
      } finally {
        rmSync(driveA, { recursive: true, force: true })
        rmSync(driveB, { recursive: true, force: true })
      }
    })
  })

  it('logs a FAILED BackupLog and rethrows when the drive is unwritable', async () => {
    const user = await db.user.findFirstOrThrow()
    const badDrive = join(driveDir, 'does-not-exist', String.fromCharCode(0)) // invalid path segment
    await expect(
      performBackup(
        db,
        { drivePath: badDrive, driveName: 'Bad Drive', initiatedByUserId: user.id },
        env
      )
    ).rejects.toThrow()

    const log = await getLastBackupLog(db)
    expect(log?.status).toBe('FAILED')
    expect(log?.errorMessage).toBeTruthy()
  })

  // A9 — restore must actually work end-to-end against a real backup file,
  // not just exist as documentation.
  describe('restore', () => {
    it('rejects a restore requested by a non-manager', async () => {
      const user = await db.user.findFirstOrThrow()
      const backup = await performBackup(
        db,
        { drivePath: driveDir, driveName: 'Test Drive', initiatedByUserId: user.id },
        env
      )
      await expect(
        restoreBackup({ backupDir: backup.backupDir, dbFilePath: env.dbFilePath }, 'CASHIER')
      ).rejects.toThrow(/Manager/)
    })

    it('rejects a backup.sqlite that fails checksum verification', async () => {
      const user = await db.user.findFirstOrThrow()
      const backup = await performBackup(
        db,
        { drivePath: driveDir, driveName: 'Test Drive', initiatedByUserId: user.id },
        env
      )
      // Tamper with the database file after it was checksummed.
      writeFileSync(join(backup.backupDir, 'backup.sqlite'), Buffer.from('corrupted'))
      await expect(
        restoreBackup({ backupDir: backup.backupDir, dbFilePath: env.dbFilePath }, 'MANAGER')
      ).rejects.toThrow(/checksum verification/)
    })

    it('lists restorable backups on a drive, newest first', async () => {
      const user = await db.user.findFirstOrThrow()
      await performBackup(
        db,
        { drivePath: driveDir, driveName: 'Test Drive', initiatedByUserId: user.id },
        env
      )
      const found = listRestorableBackups(driveDir)
      expect(found.length).toBeGreaterThan(0)
      expect(found[0].backupDir).toBeTruthy()
      expect(found[0].dataSnapshot.salesCount).toBe(1)
    })

    it('finds a backup when the user browses directly into the PHARMACY_POS_BACKUP_* folder itself', async () => {
      const user = await db.user.findFirstOrThrow()
      const dir = mkdtempSync(join(tmpdir(), 'backup-selfpick-'))
      try {
        const backup = await performBackup(
          db,
          { drivePath: dir, driveName: 'Self-pick Drive', initiatedByUserId: user.id },
          env
        )
        // Simulate picking the backup folder itself, not its parent.
        const found = listRestorableBackups(backup.backupDir)
        expect(found).toHaveLength(1)
        expect(found[0].backupDir).toBe(backup.backupDir)
        expect(found[0].dataSnapshot.salesCount).toBe(1)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('stages a verified backup and applyPendingRestoreIfStaged swaps it into place end-to-end', async () => {
      const user = await db.user.findFirstOrThrow()
      const backup = await performBackup(
        db,
        { drivePath: driveDir, driveName: 'Test Drive', initiatedByUserId: user.id },
        env
      )

      const result = await restoreBackup(
        { backupDir: backup.backupDir, dbFilePath: env.dbFilePath },
        'MANAGER'
      )
      expect(result.restartRequired).toBe(true)
      expect(existsSync(pendingRestoreMarkerPath(env.dbFilePath))).toBe(true)

      // Simulate the app restarting: the staged file must become the live db,
      // and a safety copy of what was live before must be kept.
      const before = await sha256File(env.dbFilePath)
      const staged = await sha256File(pendingRestoreMarkerPath(env.dbFilePath))
      const { applied } = applyPendingRestoreIfStaged(env.dbFilePath)
      expect(applied).toBe(true)
      expect(existsSync(pendingRestoreMarkerPath(env.dbFilePath))).toBe(false)
      expect(existsSync(`${env.dbFilePath}.pre-restore-backup`)).toBe(true)

      const after = await sha256File(env.dbFilePath)
      expect(after).toBe(staged)
      const preserved = await sha256File(`${env.dbFilePath}.pre-restore-backup`)
      expect(preserved).toBe(before)

      // A second call with nothing staged is a safe no-op.
      const second = applyPendingRestoreIfStaged(env.dbFilePath)
      expect(second.applied).toBe(false)
    })
  })
})
