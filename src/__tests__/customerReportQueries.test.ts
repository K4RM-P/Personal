import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync, execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCustomer, saveCreditSettings } from '../main/db/queries/customerQueries'
import { createTransaction } from '../main/db/queries/posQueries'
import {
  getCustomerActivityReport,
  getCustomerDebtReport,
  getCreditHealth,
  clearReportCache
} from '../main/db/queries/reportQueries'

describe('customer reports — activity and debt-age warnings', () => {
  const db = new PrismaClient()
  let productId: number
  let number = Date.now() % 1_000_000
  const customer = async () =>
    createCustomer(db, {
      firstName: 'Report',
      lastName: `Test${++number}`,
      phone: `647-${number}`,
      address: '1 Report Lane'
    })

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    const product = await db.product.upsert({
      where: { sku: 'REPORT-TEST' },
      update: { priceCents: 1000, costCents: 500, name: 'Report test item' },
      create: { sku: 'REPORT-TEST', name: 'Report test item', costCents: 500, priceCents: 1000 }
    })
    productId = product.id
    // Restore the default threshold after any prior test run left it modified.
    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 30 })
  })
  afterAll(async () => {
    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 30 })
    await db.$disconnect()
  })

  it('ranks customers by transaction count within the date range, excluding out-of-range sales', async () => {
    clearReportCache()
    const c = await customer()
    const inRange = new Date()
    const outOfRange = new Date(Date.now() - 90 * 86400000)

    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenders: [{ method: 'CASH', amountCents: 1000 }],
      customerId: c.id
    })
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenders: [{ method: 'CASH', amountCents: 1000 }],
      customerId: c.id
    })
    const outOfRangeTx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenders: [{ method: 'CASH', amountCents: 1000 }],
      customerId: c.id
    })
    // Backdate one sale outside the report's date range.
    await db.transaction.update({
      where: { id: outOfRangeTx.id },
      data: { createdAt: outOfRange }
    })

    const from = new Date(inRange)
    from.setDate(from.getDate() - 1)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr = inRange.toISOString().slice(0, 10)

    const report = await getCustomerActivityReport(db, fromStr, toStr, 25)
    const row = report.find((r) => r.customerId === c.id)
    expect(row).toBeDefined()
    expect(row!.transactionCount).toBe(2)
    expect(row!.totalSpentCents).toBe(2000)
  })

  it('flags a customer as a debt warning once their oldest unpaid charge exceeds the threshold', async () => {
    clearReportCache()
    const c = await customer()
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenders: [{ method: 'PHARMACY_CREDIT', amountCents: 1000 }],
      customerId: c.id
    })
    // Backdate the SALE_CHARGE ledger entry to simulate a debt that's been open a while.
    const entry = await db.creditLedgerEntry.findFirstOrThrow({ where: { transactionId: sale.id } })
    const fortyDaysAgo = new Date(Date.now() - 40 * 86400000)
    await db.creditLedgerEntry.update({ where: { id: entry.id }, data: { createdAt: fortyDaysAgo } })

    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 30 })
    clearReportCache()
    const report = await getCustomerDebtReport(db)
    expect(report.thresholdDays).toBe(30)

    const balanceRow = report.byBalance.find((r) => r.customerId === c.id)
    expect(balanceRow).toBeDefined()
    expect(balanceRow!.balanceOwedCents).toBe(1000)
    expect(balanceRow!.daysOverdue).toBeGreaterThanOrEqual(40)

    const warningRow = report.warnings.find((r) => r.customerId === c.id)
    expect(warningRow).toBeDefined()

    // Raising the threshold above the debt's age clears the warning.
    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 90 })
    clearReportCache()
    const raised = await getCustomerDebtReport(db)
    expect(raised.warnings.find((r) => r.customerId === c.id)).toBeUndefined()
    expect(raised.byBalance.find((r) => r.customerId === c.id)).toBeDefined()

    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 30 })
  })

})

// getCreditHealth's overdue count is a global aggregate, so it needs a clean,
// isolated database — the shared dev.db used above may carry other debtors
// from unrelated app usage/tests that would make an aggregate-count
// assertion flaky.
describe('getCreditHealth — configurable overdue threshold', () => {
  let db: PrismaClient
  let workDir: string
  let productId: number
  let customerId: number

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'credit-health-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe'
    })
    db = new PrismaClient({ datasources: { db: { url } } })
    await db.$connect()

    const product = await db.product.create({
      data: { sku: 'CREDIT-HEALTH-TEST', name: 'Credit health test item', costCents: 500, priceCents: 1000 }
    })
    productId = product.id
    const c = await createCustomer(db, {
      firstName: 'Overdue',
      lastName: 'Debtor',
      phone: '416-5550100',
      address: '1 Overdue Ave'
    })
    customerId = c.id

    await db.featureFlag.create({
      data: { key: 'customerTabs', enabled: true, label: 'Customer Tabs' }
    })
  })
  afterAll(async () => {
    await db.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('follows the configured threshold, not a hardcoded 30 days', async () => {
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      customerId,
      tenders: [{ method: 'PHARMACY_CREDIT', amountCents: 1000 }]
    })
    const entry = await db.creditLedgerEntry.findFirstOrThrow({ where: { transactionId: sale.id } })
    const fortyDaysAgo = new Date(Date.now() - 40 * 86400000)
    await db.creditLedgerEntry.update({ where: { id: entry.id }, data: { createdAt: fortyDaysAgo } })

    // At the default 30-day threshold, a 40-day-old debt counts as overdue.
    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 30 })
    clearReportCache()
    const at30 = await getCreditHealth(db)
    expect(at30.overdueAccounts).toBe(1)
    expect(at30.overdueCents).toBe(-1000)

    // Raising the threshold past 40 days removes it from the overdue count.
    await saveCreditSettings(db, { loyaltyPointsPerDollar: 1, debtWarningThresholdDays: 90 })
    clearReportCache()
    const at90 = await getCreditHealth(db)
    expect(at90.overdueAccounts).toBe(0)
  })
})
