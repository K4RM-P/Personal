import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCompleteProductSales } from '../main/db/queries/reportQueries'

describe('getCompleteProductSales', () => {
  let prisma: PrismaClient
  let workDir: string
  let productId1: number
  let productId2: number
  let userId: number

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'complete-product-sales-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }

    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })

    prisma = new PrismaClient({ datasources: { db: { url } } })
    await prisma.$connect()

    const p1 = await prisma.product.create({
      data: {
        sku: 'CPS-001',
        name: 'Aspirin 500mg',
        costCents: 150,
        priceCents: 500,
        currentOnHand: 100,
        categoryCode: 'OTC'
      }
    })
    const p2 = await prisma.product.create({
      data: {
        sku: 'CPS-002',
        name: 'Vitamin C',
        costCents: 300,
        priceCents: 900,
        currentOnHand: 50,
        categoryCode: 'OTC'
      }
    })
    productId1 = p1.id
    productId2 = p2.id

    const user = await prisma.user.create({
      data: { fullName: `Test Cashier ${Date.now()}`, passwordHash: 'x', role: 'CASHIER' }
    })
    userId = user.id
  })

  afterAll(async () => {
    await prisma.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('returns one row per product line item with quantity-accurate profit and apportioned HST', async () => {
    // Two taxable lines: 3 x $5.00 aspirin (with $0.50 discount) + 1 x $9.00 vitamin C, tax = $1.72 total (13% of $13.50)
    await prisma.transaction.create({
      data: {
        receiptNumber: 'CPS-RCPT-001',
        status: 'COMPLETED',
        tenderType: 'CASH',
        subtotalCents: 1900,
        taxCents: 172,
        totalCents: 2072,
        tenderedCents: 2100,
        changeCents: 28,
        userId,
        tabAmountCents: 0,
        createdAt: new Date('2026-08-01T10:00:00'),
        items: {
          create: [
            {
              productId: productId1,
              quantity: 3,
              costCents: 150,
              unitPriceCents: 500,
              discountCents: 50,
              totalCents: 1450,
              hstApplied: true
            },
            {
              productId: productId2,
              quantity: 1,
              costCents: 300,
              unitPriceCents: 900,
              discountCents: 0,
              totalCents: 900,
              hstApplied: true
            }
          ]
        }
      }
    })

    const rows = await getCompleteProductSales(prisma, '2026-08-01', '2026-08-01')
    expect(rows).toHaveLength(2)

    const aspirin = rows.find((r) => r.productName === 'Aspirin 500mg')!
    expect(aspirin.quantity).toBe(3)
    expect(aspirin.supplierCostCents).toBe(150)
    expect(aspirin.retailCostCents).toBe(500)
    expect(aspirin.discountCents).toBe(50)
    expect(aspirin.totalPriceCents).toBe(1450)
    // taxable base 1450 of 2350 total taxable -> apportioned tax = round(172 * 1450/2350) = 106
    expect(aspirin.hstCents).toBe(106)
    // profit = totalPrice - cost*qty - hst = 1450 - 450 - 106 = 894
    expect(aspirin.profitCents).toBe(894)

    const vitaminC = rows.find((r) => r.productName === 'Vitamin C')!
    // remainder assigned to last taxable line: 172 - 106 = 66
    expect(vitaminC.hstCents).toBe(66)
    expect(vitaminC.profitCents).toBe(900 - 300 - 66)

    // HST sums exactly back to the transaction's stored taxCents
    expect(aspirin.hstCents + vitaminC.hstCents).toBe(172)
  })

  it('excludes tab-financed products until their debt is fully paid off, then attributes them to the payoff date', async () => {
    const customer = await prisma.customer.create({
      data: {
        firstName: 'Debt',
        lastName: 'Customer',
        phone: '555-0001',
        phoneNormalized: '5550001',
        address: '1 Test St'
      }
    })

    const saleTx = await prisma.transaction.create({
      data: {
        receiptNumber: 'CPS-RCPT-DEBT',
        status: 'COMPLETED',
        tenderType: 'PHARMACY_CREDIT',
        subtotalCents: 1000,
        taxCents: 130,
        totalCents: 1130,
        tenderedCents: 0,
        changeCents: 0,
        userId,
        customerId: customer.id,
        tabAmountCents: 1130,
        createdAt: new Date('2026-08-02T10:00:00'),
        items: {
          create: [
            {
              productId: productId1,
              quantity: 2,
              costCents: 150,
              unitPriceCents: 500,
              discountCents: 0,
              totalCents: 1000,
              hstApplied: true
            }
          ]
        }
      }
    })

    await prisma.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'SALE_CHARGE',
        amountCents: -1130,
        balanceAfterCents: -1130,
        transactionId: saleTx.id,
        createdAt: new Date('2026-08-02T10:00:00')
      }
    })

    // Not yet paid off — the sale date's report window should NOT include it.
    let rows = await getCompleteProductSales(prisma, '2026-08-02', '2026-08-02')
    expect(rows).toHaveLength(0)

    const settlementTx = await prisma.transaction.create({
      data: {
        receiptNumber: 'CPS-RCPT-PAYOFF',
        status: 'COMPLETED',
        tenderType: 'CASH',
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 1130,
        tenderedCents: 1130,
        changeCents: 0,
        userId,
        customerId: customer.id,
        tabAmountCents: 0,
        createdAt: new Date('2026-08-05T09:00:00'),
        items: {
          create: [
            {
              productId: null,
              quantity: 1,
              costCents: 0,
              unitPriceCents: 1130,
              discountCents: 0,
              totalCents: 1130,
              hstApplied: false,
              lineType: 'DEBT_SETTLEMENT'
            }
          ]
        }
      }
    })

    await prisma.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'DEBT_SETTLED',
        amountCents: 1130,
        balanceAfterCents: 0,
        transactionId: settlementTx.id,
        createdAt: new Date('2026-08-05T09:00:00')
      }
    })

    // The payoff date's report window should now include the original product line.
    rows = await getCompleteProductSales(prisma, '2026-08-05', '2026-08-05')
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-08-05')
    expect(rows[0].receiptNumber).toBe('CPS-RCPT-DEBT')
    expect(rows[0].productName).toBe('Aspirin 500mg')
    expect(rows[0].quantity).toBe(2)
    expect(rows[0].totalPriceCents).toBe(1000)

    // And still excluded from the original sale date's window.
    const saleWindowRows = await getCompleteProductSales(prisma, '2026-08-02', '2026-08-02')
    expect(saleWindowRows).toHaveLength(0)
  })

  it('leaves a partial payment unattributed', async () => {
    const customer = await prisma.customer.create({
      data: {
        firstName: 'Partial',
        lastName: 'Payer',
        phone: '555-0002',
        phoneNormalized: '5550002',
        address: '2 Test St'
      }
    })

    const saleTx = await prisma.transaction.create({
      data: {
        receiptNumber: 'CPS-RCPT-PARTIAL',
        status: 'COMPLETED',
        tenderType: 'PHARMACY_CREDIT',
        subtotalCents: 900,
        taxCents: 0,
        totalCents: 900,
        tenderedCents: 0,
        changeCents: 0,
        userId,
        customerId: customer.id,
        tabAmountCents: 900,
        createdAt: new Date('2026-08-06T10:00:00'),
        items: {
          create: [
            {
              productId: productId2,
              quantity: 1,
              costCents: 300,
              unitPriceCents: 900,
              discountCents: 0,
              totalCents: 900,
              hstApplied: false
            }
          ]
        }
      }
    })

    await prisma.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'SALE_CHARGE',
        amountCents: -900,
        balanceAfterCents: -900,
        transactionId: saleTx.id,
        createdAt: new Date('2026-08-06T10:00:00')
      }
    })

    const partialPaymentTx = await prisma.transaction.create({
      data: {
        receiptNumber: 'CPS-RCPT-PARTIAL-PAY',
        status: 'COMPLETED',
        tenderType: 'CASH',
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 400,
        tenderedCents: 400,
        changeCents: 0,
        userId,
        customerId: customer.id,
        tabAmountCents: 0,
        createdAt: new Date('2026-08-07T09:00:00'),
        items: {
          create: [
            {
              productId: null,
              quantity: 1,
              costCents: 0,
              unitPriceCents: 400,
              discountCents: 0,
              totalCents: 400,
              hstApplied: false,
              lineType: 'DEBT_SETTLEMENT'
            }
          ]
        }
      }
    })

    await prisma.creditLedgerEntry.create({
      data: {
        customerId: customer.id,
        type: 'DEBT_SETTLED',
        amountCents: 400,
        balanceAfterCents: -500,
        transactionId: partialPaymentTx.id,
        createdAt: new Date('2026-08-07T09:00:00')
      }
    })

    const rows = await getCompleteProductSales(prisma, '2026-08-07', '2026-08-07')
    expect(rows).toHaveLength(0)
  })
})
