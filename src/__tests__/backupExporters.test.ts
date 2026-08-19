import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  exportSettings,
  exportFeatureFlags,
  exportPricingTiers,
  exportInventoryAdjustments,
  exportCompleteSalesReportCsv
} from '../main/backup/exporters'

describe('backup exporters — new file set', () => {
  let db: PrismaClient
  let workDir: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'backup-exporters-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }

    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })

    db = new PrismaClient({ datasources: { db: { url } } })
    await db.$connect()
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('exportSettings excludes any *Enc secret key', async () => {
    await db.setting.create({ data: { key: 'store.name', value: 'Test Pharmacy' } })
    await db.setting.create({
      data: { key: 'backup.driveRefreshTokenEnc', value: 'super-secret' }
    })
    const { settings } = await exportSettings(db)
    const keys = (settings as Array<{ key: string }>).map((s) => s.key)
    expect(keys).toContain('store.name')
    expect(keys).not.toContain('backup.driveRefreshTokenEnc')
  })

  it('exportFeatureFlags returns all rows', async () => {
    await db.featureFlag.create({ data: { key: 'testFlag', enabled: true, label: 'Test' } })
    const { featureFlags } = await exportFeatureFlags(db)
    expect(featureFlags).toHaveLength(1)
  })

  it('exportPricingTiers returns all rows', async () => {
    await db.pricingTier.create({ data: { minCostCents: 0, maxCostCents: 100, markupPercent: 20 } })
    const { pricingTiers } = await exportPricingTiers(db)
    expect(pricingTiers).toHaveLength(1)
  })

  it('exportInventoryAdjustments returns an array (possibly empty)', async () => {
    const { inventoryAdjustments } = await exportInventoryAdjustments(db)
    expect(Array.isArray(inventoryAdjustments)).toBe(true)
  })

  it('exportCompleteSalesReportCsv returns a CSV string with a header row', async () => {
    const csv = await exportCompleteSalesReportCsv(db)
    expect(csv).toContain('Date')
  })
})
