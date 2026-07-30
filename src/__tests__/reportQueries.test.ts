import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDailySalesSummary,
  getDailySalesBreakdown,
  getTopItems,
  getSlowItems,
  getSalesByTender,
  getCashierTotals,
  getCurrentInventoryValuation,
  getDashboardData,
  clearReportCache
} from '../main/db/queries/reportQueries'

describe('Reports System — MVP Phase 1 Queries', () => {
  let prisma: PrismaClient
  let workDir: string
  let productId1: number
  let productId2: number
  let productId3: number
  let userId: number

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'reports-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }

    // Build schema and seed minimal data
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })

    prisma = new PrismaClient({ datasources: { db: { url } } })
    await prisma.$connect()

    // Seed products
    const p1 = await prisma.product.create({
      data: { sku: 'RPT-001', name: 'Test Item A', costCents: 200, priceCents: 500, currentOnHand: 100, categoryCode: 'OTC' }
    })
    const p2 = await prisma.product.create({
      data: { sku: 'RPT-002', name: 'Test Item B', costCents: 500, priceCents: 1200, currentOnHand: 50, categoryCode: 'OTC' }
    })
    const p3 = await prisma.product.create({
      data: { sku: 'RPT-003', name: 'Test Item C', costCents: 1000, priceCents: 2500, currentOnHand: 20, categoryCode: 'RX' }
    })
    productId1 = p1.id
    productId2 = p2.id
    productId3 = p3.id

    // Seed a user
    const user = await prisma.user.create({ data: { fullName: `Test Cashier ${Date.now()}`, passwordHash: 'x', role: 'CASHIER' } })
    userId = user.id

    // Seed a customer
    const customer = await prisma.customer.create({
      data: { firstName: 'Test', lastName: 'Customer', phone: '555-9999', phoneNormalized: '5559999', address: '1 Test St' }
    })

    // Seed transactions with items
    // Day 1: 2 normal sales
    const tx1 = await prisma.transaction.create({
      data: {
        receiptNumber: 'RPT-001',
        status: 'COMPLETED',
        tenderType: 'CASH',
        subtotalCents: 500,
        taxCents: 50,
        totalCents: 550,
        tenderedCents: 550,
        changeCents: 0,
        userId,
        customerId: customer.id,
        tabAmountCents: 0,
        createdAt: new Date('2026-07-28T10:00:00'),
        items: {
          create: [
            { productId: productId1, quantity: 1, costCents: 200, unitPriceCents: 500, totalCents: 500 },
            { productId: productId2, quantity: 2, costCents: 500, unitPriceCents: 600, totalCents: 1200 }
          ]
        }
      }
    })

    // Update product onHand from sales
    await prisma.product.update({ where: { id: productId1 }, data: { currentOnHand: 99 } })
    await prisma.product.update({ where: { id: productId2 }, data: { currentOnHand: 48 } })

    // Day 2: a card sale and a cash sale
    await prisma.transaction.create({
      data: {
        receiptNumber: 'RPT-002',
        status: 'COMPLETED',
        tenderType: 'CARD',
        subtotalCents: 2500,
        taxCents: 250,
        totalCents: 2750,
        tenderedCents: 2750,
        changeCents: 0,
        userId,
        createdAt: new Date('2026-07-29T14:00:00'),
        items: {
          create: [
            { productId: productId3, quantity: 1, costCents: 1000, unitPriceCents: 2500, totalCents: 2500 }
          ]
        }
      }
    })
    await prisma.product.update({ where: { id: productId3 }, data: { currentOnHand: 19 } })

    // A cash sale on day 2
    await prisma.transaction.create({
      data: {
        receiptNumber: 'RPT-003',
        status: 'COMPLETED',
        tenderType: 'CASH',
        subtotalCents: 500,
        taxCents: 50,
        totalCents: 550,
        tenderedCents: 550,
        changeCents: 0,
        userId,
        createdAt: new Date('2026-07-29T15:00:00'),
        items: {
          create: [
            { productId: productId1, quantity: 2, costCents: 200, unitPriceCents: 250, totalCents: 500 }
          ]
        }
      }
    })
    await prisma.product.update({ where: { id: productId1 }, data: { currentOnHand: 97 } })

    // A voided transaction
    await prisma.transaction.create({
      data: {
        receiptNumber: 'RPT-004',
        status: 'VOIDED',
        tenderType: 'CASH',
        subtotalCents: 100,
        taxCents: 10,
        totalCents: 110,
        tenderedCents: 110,
        changeCents: 0,
        userId,
        voidReason: 'Test void',
        createdAt: new Date('2026-07-29T16:00:00'),
        items: {
          create: [
            { productId: productId2, quantity: 1, costCents: 500, unitPriceCents: 100, totalCents: 100 }
          ]
        }
      }
    })

    // Day 3: a SPLIT tender with tab
    await prisma.transaction.create({
      data: {
        receiptNumber: 'RPT-005',
        status: 'COMPLETED',
        tenderType: 'SPLIT',
        subtotalCents: 1000,
        taxCents: 100,
        totalCents: 1100,
        tenderedCents: 600,
        changeCents: 0,
        userId,
        customerId: customer.id,
        tabAmountCents: 500,
        createdAt: new Date('2026-07-30T09:00:00'),
        items: {
          create: [
            { productId: productId2, quantity: 1, costCents: 500, unitPriceCents: 1000, totalCents: 1000 }
          ]
        }
      }
    })
    await prisma.product.update({ where: { id: productId2 }, data: { currentOnHand: 47 } })

    // Seed a credit ledger entry for the customer
    await prisma.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'FUNDS_ADDED',
        amountCents: 1000,
        balanceAfterCents: 500,
        createdAt: new Date('2026-07-30T09:00:00')
      }
    })

    // Clear the report cache before tests
    clearReportCache()
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  // Test 1: Dashboard cards show correct totals
  it('dashboard totals match manually-calculated sums', async () => {
    const dashboard = await getDashboardData(prisma)
    const today = dashboard.today
    const month = dashboard.thisMonth

    // Gross = 550 (tx1) + 2750 (tx2) + 550 (tx3) + 1100 (tx5) = 4950
    // But tx4 (RPT-004) is VOIDED, so excluded from gross
    // Returns = 0
    // Net = 4950
    expect(today.sales.grossCents).toBeGreaterThan(0)

    // The month includes all transactions
    expect(month.sales.transactionCount).toBe(4) // 3 completed + 1 with tab (not the voided one)
    expect(month.sales.grossCents).toBe(550 + 2750 + 550 + 1100) // 4950
    expect(month.sales.netCents).toBe(month.sales.grossCents + month.sales.returnsCents)
  })

  // Test 2: Daily sales breakdown totals match dashboard "This Month" figure
  it('daily sales breakdown totals match dashboard this-month figure', async () => {
    const month = (await getDashboardData(prisma)).thisMonth
    const daily = await getDailySalesBreakdown(prisma, '2026-07-28', '2026-07-30')

    // Sum all daily rows
    const sumNet = daily.reduce((s, r) => s + r.netCents, 0)
    const sumGross = daily.reduce((s, r) => s + r.grossCents, 0)
    const sumTrans = daily.reduce((s, r) => s + r.transactionCount, 0)

    expect(sumNet).toBe(month.sales.netCents)
    expect(sumGross).toBe(month.sales.grossCents)
    expect(sumTrans).toBe(month.sales.transactionCount)
  })

  // Test 3: Sales by tender adds up to net sales
  it('sales by tender adds up to net sales', async () => {
    const [tender, summary] = await Promise.all([
      getSalesByTender(prisma, '2026-07-28', '2026-07-30'),
      getDailySalesSummary(prisma, '2026-07-28', '2026-07-30')
    ])

    const tenderTotal = tender.reduce((s, r) => s + r.amountCents, 0)
    expect(tenderTotal).toBeGreaterThan(0)
    // Tender total should match net sales (approximately)
    expect(tenderTotal).toBeCloseTo(summary.netCents, -2) // within cents
  })

  // Test 4: Top items revenue matches sum of all line items from checkout
  it('top items revenue matches sum of line items', async () => {
    const topItems = await getTopItems(prisma, '2026-07-28', '2026-07-30', 10)
    const topRevenue = topItems.reduce((s, i) => s + i.revenueCents, 0)

    // Expected: Item A sold 3 units (1+2) at 500+500 = 1000 revenue
    // Item B sold 3 units (2+1) at 1200+1000 = 2200 revenue
    // Item C sold 1 unit at 2500 revenue
    // Total = 5700
    expect(topRevenue).toBe(5700)

    // Verify individual items
    const itemA = topItems.find((i) => i.sku === 'RPT-001')
    expect(itemA).toBeDefined()
    expect(itemA!.quantity).toBe(3) // 1 + 2
    expect(itemA!.revenueCents).toBe(1000) // 500 + 500

    const itemB = topItems.find((i) => i.sku === 'RPT-002')
    expect(itemB).toBeDefined()
    expect(itemB!.quantity).toBe(3) // 2 + 1
    expect(itemB!.revenueCents).toBe(2200) // 1200 + 1000

    const itemC = topItems.find((i) => i.sku === 'RPT-003')
    expect(itemC).toBeDefined()
    expect(itemC!.quantity).toBe(1)
    expect(itemC!.revenueCents).toBe(2500)
  })

  // Test 5: Cashier totals add up to grand total
  it('cashier totals add up to grand total', async () => {
    const [cashiers, summary] = await Promise.all([
      getCashierTotals(prisma, '2026-07-28', '2026-07-30'),
      getDailySalesSummary(prisma, '2026-07-28', '2026-07-30')
    ])

    const cashierTotal = cashiers.reduce((s, c) => s + c.totalSalesCents, 0)
    // Cashier totals should include sales - voids
    const expectedSales = summary.grossCents + summary.returnsCents
    expect(cashierTotal).toBe(expectedSales)
  })

  // Test 6: Inventory valuation at cost + retail is accurate
  it('inventory valuation at cost and retail is accurate', async () => {
    const valuation = await getCurrentInventoryValuation(prisma)

    // Item A: 97 on-hand, cost=200, retail=500 → cost=19400, retail=48500
    // Item B: 47 on-hand, cost=500, retail=1200 → cost=23500, retail=56400
    // Item C: 19 on-hand, cost=1000, retail=2500 → cost=19000, retail=47500
    expect(valuation.totalCostValueCents).toBe(19400 + 23500 + 19000)
    expect(valuation.totalRetailValueCents).toBe(48500 + 56400 + 47500)
    expect(valuation.totalItemCount).toBe(3)

    // Check categorization
    expect(valuation.rows.length).toBeGreaterThanOrEqual(2) // OTC and RX
    const otcRow = valuation.rows.find((r) => r.category === 'OTC')
    expect(otcRow).toBeDefined()
    expect(otcRow!.itemCount).toBe(2) // Items A and B
    expect(otcRow!.costValueCents).toBe(19400 + 23500)
    expect(otcRow!.retailValueCents).toBe(48500 + 56400)
  })

  // Test 7: Date-range picker works (different ranges show correct filtered results)
  it('date-range filtering returns correct filtered results', async () => {
    // Day 1 only (2026-07-28)
    const day1 = await getDailySalesSummary(prisma, '2026-07-28', '2026-07-28')
    expect(day1.transactionCount).toBe(1) // Only tx1
    expect(day1.grossCents).toBe(550) // tx1 total

    // Day 2 only (2026-07-29)
    const day2 = await getDailySalesSummary(prisma, '2026-07-29', '2026-07-29')
    expect(day2.transactionCount).toBe(2) // tx2 (CARD) + tx3 (CASH) — tx4 is VOIDED
    expect(day2.grossCents).toBe(2750 + 550) // 3300

    // Day 3 only (2026-07-30)
    const day3 = await getDailySalesSummary(prisma, '2026-07-30', '2026-07-30')
    expect(day3.transactionCount).toBe(1) // tx5 (SPLIT with tab)
    expect(day3.grossCents).toBe(1100)
  })

  // Test 8: Slow items correctly identifies items with < threshold sales
  it('slow items shows items with zero or near-zero sales', async () => {
    // Create a product with no sales
    await prisma.product.create({
      data: { sku: 'RPT-SLOW', name: 'Slow Item', costCents: 100, priceCents: 300, currentOnHand: 10, categoryCode: 'OTC' }
    })

    const slowItems = await getSlowItems(prisma, '2026-07-28', '2026-07-30', 1)
    const slowNames = slowItems.map((i) => i.name)
    expect(slowNames).toContain('Slow Item')
    expect(slowItems.every((i) => i.quantitySold < 1)).toBe(true)
  })
})