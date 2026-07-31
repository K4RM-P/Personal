import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { createTransaction } from '../main/db/queries/posQueries'

describe('checkout discounts', () => {
  const db = new PrismaClient()
  let productId: number

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    const product = await db.product.upsert({
      where: { sku: 'DISCOUNT-TEST' },
      update: { priceCents: 312, costCents: 150, name: 'Discount test item' },
      create: { sku: 'DISCOUNT-TEST', name: 'Discount test item', costCents: 150, priceCents: 312 }
    })
    productId = product.id
  })
  afterAll(async () => db.$disconnect())

  it('applies a per-item discount and reduces the subtotal + line total', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 2, costCents: 150, unitPriceCents: 312, discountCents: 62, discountReason: 'price match' }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 562
    })
    expect(tx.items[0].discountCents).toBe(62)
    expect(tx.items[0].totalCents).toBe(312 * 2 - 62)
    expect(tx.subtotalCents).toBe(312 * 2 - 62)
    expect(tx.totalCents).toBe(312 * 2 - 62)

    const discountRow = await db.discount.findFirst({ where: { transactionId: tx.id, type: 'ITEM' } })
    expect(discountRow).toMatchObject({ amountCents: -62, reason: 'price match', itemId: tx.items[0].id })
  })

  it('rejects an item discount larger than the line total', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 150, unitPriceCents: 312, discountCents: 500 }],
        taxRatePercent: 0,
        tenderType: 'CASH',
        tenderedCents: 0
      })
    ).rejects.toThrow(/exceed the line total/)
  })

  it('applies a whole-bill discount after item discounts, before tax', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 2, costCents: 150, unitPriceCents: 312 }],
      taxRatePercent: 13,
      tenderType: 'CASH',
      tenderedCents: 1000,
      billDiscountCents: 100,
      billDiscountReason: 'loyalty'
    })
    // subtotal 624, bill discount 100 -> pre-tax 524, tax = round(524 * 13%) = 68
    expect(tx.subtotalCents).toBe(624)
    expect(tx.billDiscountCents).toBe(100)
    expect(tx.taxCents).toBe(68)
    expect(tx.totalCents).toBe(524 + 68)

    const billDiscount = await db.discount.findFirst({ where: { transactionId: tx.id, type: 'BILL' } })
    expect(billDiscount).toMatchObject({ amountCents: -100, reason: 'loyalty', originalCents: 624, finalCents: 524 })
  })

  it('rejects a whole-bill discount larger than the subtotal', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 150, unitPriceCents: 312 }],
        taxRatePercent: 0,
        tenderType: 'CASH',
        tenderedCents: 0,
        billDiscountCents: 1000
      })
    ).rejects.toThrow(/exceed the subtotal/)
  })

  it('stacks item and bill discounts, and records their combined total in discountApplied for reporting', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 2, costCents: 150, unitPriceCents: 312, discountCents: 62 }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 500,
      billDiscountCents: 50
    })
    // subtotal = 624 - 62 = 562; pre-tax = 562 - 50 = 512
    expect(tx.subtotalCents).toBe(562)
    expect(tx.totalCents).toBe(512)
    expect(tx.discountApplied).toBe(62 + 50)
  })

  it('does not create a Discount row when no discount was applied', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 150, unitPriceCents: 312 }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 312
    })
    const rows = await db.discount.findMany({ where: { transactionId: tx.id } })
    expect(rows).toHaveLength(0)
    expect(tx.discountApplied).toBe(0)
  })
})
