import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { addFunds, adjustCredit, createCustomer, getCustomerDebtBreakdown } from '../main/db/queries/customerQueries'
import { createTransaction } from '../main/db/queries/posQueries'

describe('debt settlement (bring in outstanding balance)', () => {
  const db = new PrismaClient()
  let productId: number
  let number = Date.now() % 1_000_000
  const customer = async () =>
    createCustomer(db, {
      firstName: 'Debt',
      lastName: `Test${++number}`,
      phone: `647-${number}`,
      address: '1 Test Lane'
    })

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    const product = await db.product.upsert({
      where: { sku: 'DEBT-SETTLE-TEST' },
      update: { priceCents: 4000, costCents: 2000, name: 'Debt test item' },
      create: { sku: 'DEBT-SETTLE-TEST', name: 'Debt test item', costCents: 2000, priceCents: 4000 }
    })
    productId = product.id
  })
  afterAll(async () => db.$disconnect())

  it('reconstructs a short-pay and a full-charge sale with correct labels and sums to the balance', async () => {
    const c = await customer()
    // Short-pay: $40 sale, $8 goes to tab.
    const shortSale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'SPLIT',
      tenderedCents: 3200,
      customerId: c.id,
      tabAmountCents: 800
    })
    // Full charge to tab: $40 sale, all $40 to tab.
    const fullSale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })

    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(4800)

    const shortEntry = breakdown.entries.find((e) => e.transactionId === shortSale.id)
    expect(shortEntry).toMatchObject({
      type: 'SALE_CHARGE',
      chargeKind: 'SHORT_PAY',
      amountCents: 800,
      tabAmountCents: 800,
      transactionTotalCents: 4000
    })

    const fullEntry = breakdown.entries.find((e) => e.transactionId === fullSale.id)
    expect(fullEntry).toMatchObject({
      type: 'SALE_CHARGE',
      chargeKind: 'FULL_CHARGE',
      amountCents: 4000
    })

    const sumOfEntries = breakdown.entries.reduce((sum, e) => sum + e.amountCents, 0)
    expect(sumOfEntries).toBe(breakdown.totalOutstandingCents)
  })

  it('includes an unoffset manual adjustment in the breakdown with its note', async () => {
    const c = await customer()
    await adjustCredit(db, c.id, -1500, 'Owed from a paper invoice', true)
    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(1500)
    expect(breakdown.entries).toHaveLength(1)
    expect(breakdown.entries[0]).toMatchObject({
      type: 'MANUAL_ADJUSTMENT',
      amountCents: 1500,
      note: 'Owed from a paper invoice'
    })
  })

  it('FIFO-offsets older debits first and reflects a reduced remainder after a partial payoff', async () => {
    const c = await customer()
    const sale1 = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })
    const sale2 = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })
    // Pays down exactly the first sale.
    await addFunds(db, c.id, 4000, 'partial payment')

    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(4000)
    expect(breakdown.entries).toHaveLength(1)
    expect(breakdown.entries[0].transactionId).toBe(sale2.id)
    expect(breakdown.entries.find((e) => e.transactionId === sale1.id)).toBeUndefined()
  })

  it('brings in a partial amount, excludes it from tax and bill discount, and writes a DEBT_SETTLED entry atomically', async () => {
    const c = await customer()
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })

    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000, hstApplied: true }],
      taxRatePercent: 13,
      tenderType: 'CASH',
      tenderedCents: 6520, // 4000 product + 520 tax (13% of 4000) + 2000 partial debt settlement
      customerId: c.id,
      debtSettlementCents: 2000
    })

    // Tax computed only on the product line, not the debt line.
    expect(sale.taxCents).toBe(520)
    expect(sale.totalCents).toBe(4000 + 520 + 2000)

    const debtItem = sale.items.find((i) => i.lineType === 'DEBT_SETTLEMENT')
    expect(debtItem).toMatchObject({ totalCents: 2000, hstApplied: false, discountCents: 0, productId: null })

    const ledgerEntry = await db.creditLedgerEntry.findFirst({
      where: { transactionId: sale.id, type: 'DEBT_SETTLED' }
    })
    expect(ledgerEntry).toMatchObject({ amountCents: 2000 })
    expect(ledgerEntry?.note).toMatch(/covers/)

    // $4000 owed, $2000 brought in → $2000 remains.
    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(2000)
  })

  it('rejects bringing in more than the customers current outstanding balance', async () => {
    const c = await customer()
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })

    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
        taxRatePercent: 0,
        tenderType: 'CASH',
        tenderedCents: 9000,
        customerId: c.id,
        debtSettlementCents: 5000 // only $4000 owed
      })
    ).rejects.toThrow(/outstanding balance/i)

    // Nothing partial was written — rejected before the transaction, no ledger row, no sale.
    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(4000)
  })

  it('blocks Pharmacy Credit as the tender when a debt-settlement amount is present', async () => {
    const c = await customer()
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })

    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
        taxRatePercent: 0,
        tenderType: 'PHARMACY_CREDIT',
        tenderedCents: 0,
        customerId: c.id,
        debtSettlementCents: 2000
      })
    ).rejects.toThrow(/Cannot use Pharmacy Credit/i)
  })

  it('leaves no DEBT_SETTLED entry and no debt line when the transaction fails', async () => {
    const c = await customer()
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })

    // Invalid item discount forces createTransaction to throw before the $transaction commits.
    await expect(
      createTransaction(db, {
        items: [
          { productId, quantity: 1, costCents: 2000, unitPriceCents: 4000, discountCents: 999999 }
        ],
        taxRatePercent: 0,
        tenderType: 'CASH',
        tenderedCents: 6000,
        customerId: c.id,
        debtSettlementCents: 2000
      })
    ).rejects.toThrow()

    const entries = await db.creditLedgerEntry.findMany({ where: { customerId: c.id, type: 'DEBT_SETTLED' } })
    expect(entries).toHaveLength(0)
  })
})
