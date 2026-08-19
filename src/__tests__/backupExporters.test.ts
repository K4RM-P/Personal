import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  exportSettings,
  exportFeatureFlags,
  exportPricingTiers,
  exportInventoryAdjustments,
  exportCompleteSalesReportCsv
} from '../main/backup/exporters'

const db = new PrismaClient()

describe('backup exporters — new file set', () => {
  beforeEach(async () => {
    await db.setting.deleteMany()
    await db.featureFlag.deleteMany()
    await db.pricingTier.deleteMany()
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
