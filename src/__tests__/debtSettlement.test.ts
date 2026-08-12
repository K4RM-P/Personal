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

  it('brings in exactly one selected item out of several, excludes it from tax and bill discount, and writes a DEBT_SETTLED entry atomically', async () => {
    const c = await customer()
    // Two separate outstanding sales — the cashier will only select one of them.
    const saleA = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })

    const breakdownBefore = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdownBefore.totalOutstandingCents).toBe(8000)
    const entryForSaleA = breakdownBefore.entries.find((e) => e.transactionId === saleA.id)!

    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000, hstApplied: true }],
      taxRatePercent: 13,
      tenderType: 'CASH',
      tenderedCents: 8520, // 4000 product + 520 tax (13% of 4000) + 4000 for the one selected item
      customerId: c.id,
      debtSettlementLedgerEntryIds: [entryForSaleA.ledgerEntryId]
    })

    // Tax computed only on the product line, not the debt line.
    expect(sale.taxCents).toBe(520)
    expect(sale.totalCents).toBe(4000 + 520 + 4000)

    const debtItem = sale.items.find((i) => i.lineType === 'DEBT_SETTLEMENT')
    expect(debtItem).toMatchObject({ totalCents: 4000, hstApplied: false, discountCents: 0, productId: null })

    const ledgerEntry = await db.creditLedgerEntry.findFirst({
      where: { transactionId: sale.id, type: 'DEBT_SETTLED' }
    })
    expect(ledgerEntry).toMatchObject({ amountCents: 4000 })
    expect(ledgerEntry?.note).toMatch(/covers/)
    expect(ledgerEntry?.note).toContain(saleA.receiptNumber)

    // $8000 owed, only saleA's $4000 brought in → the other sale's $4000 remains.
    const breakdownAfter = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdownAfter.totalOutstandingCents).toBe(4000)
    expect(breakdownAfter.entries.find((e) => e.transactionId === saleA.id)).toBeUndefined()
  })

  it('brings in multiple selected items (a sale plus a manual adjustment) in a single sale', async () => {
    const c = await customer()
    const sale1 = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })
    await adjustCredit(db, c.id, -1500, 'Owed from a paper invoice', true)

    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(5500)
    const ids = breakdown.entries.map((e) => e.ledgerEntryId)
    expect(ids).toHaveLength(2)

    const settlingSale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 4000 + 5500,
      customerId: c.id,
      debtSettlementLedgerEntryIds: ids
    })

    expect(settlingSale.totalCents).toBe(4000 + 5500)
    const ledgerEntry = await db.creditLedgerEntry.findFirst({
      where: { transactionId: settlingSale.id, type: 'DEBT_SETTLED' }
    })
    expect(ledgerEntry).toMatchObject({ amountCents: 5500 })
    expect(ledgerEntry?.note).toContain(sale1.receiptNumber)
    expect(ledgerEntry?.note).toContain('manual adjustment')

    const breakdownAfter = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdownAfter.totalOutstandingCents).toBe(0)
  })

  it('rejects a selected item that is no longer outstanding (e.g. already settled elsewhere)', async () => {
    const c = await customer()
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })
    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    const staleId = breakdown.entries[0].ledgerEntryId

    // Fully pay it off through an unrelated channel first.
    await addFunds(db, c.id, 4000, 'paid off before the stale selection was used')

    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
        taxRatePercent: 0,
        tenderType: 'CASH',
        tenderedCents: 9000,
        customerId: c.id,
        debtSettlementLedgerEntryIds: [staleId]
      })
    ).rejects.toThrow(/no longer outstanding/i)
  })

  it('blocks Pharmacy Credit as the tender when a debt-settlement selection is present', async () => {
    const c = await customer()
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 4000
    })
    const breakdown = await getCustomerDebtBreakdown(db, c.id)

    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 2000, unitPriceCents: 4000 }],
        taxRatePercent: 0,
        tenderType: 'PHARMACY_CREDIT',
        tenderedCents: 0,
        customerId: c.id,
        debtSettlementLedgerEntryIds: [breakdown.entries[0].ledgerEntryId]
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
    const breakdown = await getCustomerDebtBreakdown(db, c.id)

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
        debtSettlementLedgerEntryIds: [breakdown.entries[0].ledgerEntryId]
      })
    ).rejects.toThrow()

    const entries = await db.creditLedgerEntry.findMany({ where: { customerId: c.id, type: 'DEBT_SETTLED' } })
    expect(entries).toHaveLength(0)
  })
})
