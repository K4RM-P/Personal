import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCustomer, getCustomerDebtBreakdown } from '../main/db/queries/customerQueries'
import { createTransaction } from '../main/db/queries/posQueries'

describe('general split tender (arbitrary combination of cash/card/e-transfer/pharmacy-credit lines)', () => {
  let db: PrismaClient
  let workDir: string
  let productId: number
  let number = Date.now() % 1_000_000
  const customer = async () =>
    createCustomer(db, {
      firstName: 'Split',
      lastName: `Tender${++number}`,
      phone: `416-${number}`,
      address: '1 Split Tender Ave'
    })

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'split-tender-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })
    db = new PrismaClient({ datasources: { db: { url } } })
    await db.$connect()
    const product = await db.product.create({
      data: {
        sku: 'SPLIT-TENDER-TEST',
        name: 'Split tender test item',
        costCents: 5000,
        priceCents: 10000
      }
    })
    productId = product.id
  }, 60_000)
  afterAll(async () => {
    await db?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  // Test 1: simple two-way split — $5 cash + rest on one card.
  it('splits a sale between cash and a single card line', async () => {
    // $100 item, 0% tax -> total 10000.
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [
        { method: 'CASH', amountCents: 500 },
        { method: 'CARD', amountCents: 9500, processorTransactionId: 'tx-1' }
      ]
    })
    expect(tx.totalCents).toBe(10000)
    expect(tx.tenderType).toBe('SPLIT')
    const tenders = await db.transactionTender.findMany({
      where: { transactionId: tx.id },
      orderBy: { sequence: 'asc' }
    })
    expect(tenders).toHaveLength(2)
    expect(tenders[0]).toMatchObject({ method: 'CASH', amountCents: 500, sequence: 1 })
    expect(tenders[1]).toMatchObject({
      method: 'CARD',
      amountCents: 9500,
      sequence: 2,
      processorTransactionId: 'tx-1'
    })
  })

  // Test 2: three-way split, arbitrary amounts summing exactly to total.
  it('splits a sale across cash + card + e-transfer', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [
        { method: 'CASH', amountCents: 3000 },
        { method: 'CARD', amountCents: 4000, processorTransactionId: 'tx-2' },
        {
          method: 'E_TRANSFER',
          amountCents: 3000,
          eTransferConfirmed: true,
          eTransferEmail: 'a@b.com'
        }
      ]
    })
    expect(tx.totalCents).toBe(10000)
    expect(tx.tenderType).toBe('SPLIT')
    expect(tx.tenderedCents).toBe(10000)
    const tenders = await db.transactionTender.findMany({ where: { transactionId: tx.id } })
    expect(tenders).toHaveLength(3)
  })

  // Test 3: two separate card lines (simulating two physical cards), each with its own processorTransactionId.
  it('charges two separate card lines independently, each with its own processorTransactionId', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [
        {
          method: 'CARD',
          amountCents: 4000,
          processorTransactionId: 'card-A',
          cardLastFour: '1111'
        },
        {
          method: 'CARD',
          amountCents: 6000,
          processorTransactionId: 'card-B',
          cardLastFour: '2222'
        }
      ]
    })
    const tenders = await db.transactionTender.findMany({
      where: { transactionId: tx.id },
      orderBy: { sequence: 'asc' }
    })
    expect(tenders).toHaveLength(2)
    expect(tenders[0]).toMatchObject({
      processorTransactionId: 'card-A',
      cardLastFour: '1111',
      amountCents: 4000
    })
    expect(tenders[1]).toMatchObject({
      processorTransactionId: 'card-B',
      cardLastFour: '2222',
      amountCents: 6000
    })
  })

  // Test 5: cash given exceeds amount applied — change, or deposit to a linked customer's Pharmacy Credit.
  it('computes change correctly when cash given exceeds the amount applied', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [{ method: 'CASH', amountCents: 10000, cashGivenCents: 12000, changeCents: 2000 }]
    })
    const tender = await db.transactionTender.findFirstOrThrow({ where: { transactionId: tx.id } })
    expect(tender).toMatchObject({
      cashGivenCents: 12000,
      amountCents: 10000,
      changeCents: 2000,
      depositedToTabCents: 0
    })
    expect(tx.changeCents).toBe(2000)
  })

  it('deposits cash overage to the linked customer Pharmacy Credit instead of returning change', async () => {
    const c = await customer()
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      customerId: c.id,
      tenders: [
        { method: 'CASH', amountCents: 10000, cashGivenCents: 12500, depositedToTabCents: 2500 }
      ]
    })
    const tender = await db.transactionTender.findFirstOrThrow({ where: { transactionId: tx.id } })
    expect(tender).toMatchObject({
      cashGivenCents: 12500,
      depositedToTabCents: 2500,
      changeCents: 0
    })
    const entry = await db.creditLedgerEntry.findFirst({
      where: { customerId: c.id, type: 'FUNDS_ADDED' }
    })
    expect(entry).toMatchObject({ amountCents: 2500 })
  })

  // Test 6: second card in a two-card split declines — first card's charge is server-side unaffected;
  // this models the retry as the cashier submitting a fresh line covering only the still-uncovered amount.
  it('lets a retried line cover exactly what a declined attempt left uncovered, without touching the already-completed line', async () => {
    // First card line ($40) "completes" in the renderer's flow (charged via the adapter — out of
    // scope for this server-only test) and is later submitted alongside the retry as the final
    // tender array; the point under test is that createTransaction has no memory of a failed
    // attempt at all — the failed line was simply never included, so nothing needs undoing.
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [
        { method: 'CARD', amountCents: 4000, processorTransactionId: 'card-first-ok' },
        // Retry on a different card for the remaining 6000 after a decline on the first attempt.
        { method: 'CARD', amountCents: 6000, processorTransactionId: 'card-retry-ok' }
      ]
    })
    expect(tx.totalCents).toBe(10000)
    const tenders = await db.transactionTender.findMany({ where: { transactionId: tx.id } })
    expect(tenders.reduce((s, t) => s + t.amountCents, 0)).toBe(10000)
  })

  // Test 7: surcharge on one card line in a multi-tender sale only affects that line's amount.
  it('applies the credit surcharge only to the card line it belongs to, not the whole sale', async () => {
    // $100 item, 0% tax. $50 cash + $50 card-with-2%-surcharge -> card line charges 50*1.02 = 51,
    // total becomes 10000 + 100 (surcharge) = 10100.
    const surchargeCents = Math.floor((5000 * 2) / 100) // 100
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [
        { method: 'CASH', amountCents: 5000 },
        {
          method: 'CARD',
          amountCents: 5000 + surchargeCents,
          surchargeCents,
          cardType: 'CREDIT',
          processorTransactionId: 'card-surcharge'
        }
      ]
    })
    expect(tx.totalCents).toBe(10000 + surchargeCents)
    expect(tx.surchargeCents).toBe(surchargeCents)
    const cashTender = await db.transactionTender.findFirst({
      where: { transactionId: tx.id, method: 'CASH' }
    })
    expect(cashTender?.amountCents).toBe(5000) // untouched by the other line's surcharge
  })

  it('rejects a card line surcharge that does not match the configured rate', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
        taxRatePercent: 0,
        tenders: [
          {
            method: 'CARD',
            amountCents: 10500,
            surchargeCents: 500,
            cardType: 'CREDIT',
            processorTransactionId: 'bad-surcharge'
          }
        ]
      })
    ).rejects.toThrow(/surcharge does not match/)
  })

  // Test 8: Pharmacy Credit tender line as one of several lines (no credit-limit system exists in
  // this codebase — confirmed by grep and the `remove_credit_limit` migration — so "respects the
  // limit" here means it simply adds to the tab like any single-line Pharmacy Credit charge does today).
  it('writes one SALE_CHARGE ledger entry for a Pharmacy Credit line that is only part of a multi-tender sale', async () => {
    const c = await customer()
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      customerId: c.id,
      tenders: [
        { method: 'PHARMACY_CREDIT', amountCents: 4000 },
        { method: 'CASH', amountCents: 6000 }
      ]
    })
    const entry = await db.creditLedgerEntry.findFirst({
      where: { customerId: c.id, type: 'SALE_CHARGE' }
    })
    expect(entry).toMatchObject({ amountCents: -4000, transactionId: tx.id })
    const tender = await db.transactionTender.findFirst({
      where: { transactionId: tx.id, method: 'PHARMACY_CREDIT' }
    })
    expect(tender?.creditLedgerEntryId).toBe(entry?.id)
  })

  // Test 9: Pharmacy Credit is unavailable as a tender when a brought-in-balance line is present —
  // regardless of how many other tender lines already exist on the sale.
  it('blocks a Pharmacy Credit tender line when debt settlement is active, even alongside other tender lines', async () => {
    const c = await customer()
    // Put $20 on the tab first so there's a debt to settle.
    await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      customerId: c.id,
      tenders: [{ method: 'PHARMACY_CREDIT', amountCents: 10000 }]
    })
    const breakdown = await getCustomerDebtBreakdown(db, c.id)
    expect(breakdown.totalOutstandingCents).toBe(10000)

    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
        taxRatePercent: 0,
        customerId: c.id,
        debtSettlementLedgerEntryIds: breakdown.entries.map((e) => e.ledgerEntryId),
        tenders: [
          { method: 'CASH', amountCents: 5000 },
          { method: 'PHARMACY_CREDIT', amountCents: 15000 }
        ]
      })
    ).rejects.toThrow(/Cannot use Pharmacy Credit to pay off an outstanding balance/)
  })

  // Test 11: server-side rejects a mismatched sum, independent of any UI-side disabled button.
  it('rejects sale completion server-side when tender lines do not sum to the total', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
        taxRatePercent: 0,
        tenders: [{ method: 'CASH', amountCents: 9999 }]
      })
    ).rejects.toThrow(/Tender lines total/)
  })

  it('rejects an empty tenders array when the sale has a nonzero total', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
        taxRatePercent: 0,
        tenders: []
      })
    ).rejects.toThrow(/At least one tender line/)
  })

  it('allows a genuine $0 sale (a fully-discounted item) with no tender lines at all', async () => {
    const tx = await createTransaction(db, {
      items: [
        { productId, quantity: 1, costCents: 5000, unitPriceCents: 10000, discountCents: 10000 }
      ],
      taxRatePercent: 13,
      tenders: []
    })
    expect(tx.totalCents).toBe(0)
    expect(tx.tenderType).toBe('NONE')
    expect(tx.tenderedCents).toBe(0)
    expect(tx.changeCents).toBe(0)
  })

  // Test 14: a single-tender-line sale (the common case) still works exactly as before — no regression.
  it('still supports the simple single-card-tender case with no regression', async () => {
    const tx = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
      taxRatePercent: 0,
      tenders: [
        {
          method: 'CARD',
          amountCents: 10000,
          processorTransactionId: 'single-card',
          cardLastFour: '4242'
        }
      ]
    })
    expect(tx.tenderType).toBe('CARD')
    expect(tx.processorTransactionId).toBe('single-card')
    expect(tx.cardLast4).toBe('4242')
    const tenders = await db.transactionTender.findMany({ where: { transactionId: tx.id } })
    expect(tenders).toHaveLength(1)
  })

  it('requires a processorTransactionId on every card line', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
        taxRatePercent: 0,
        tenders: [{ method: 'CARD', amountCents: 10000 }]
      })
    ).rejects.toThrow(/processor transaction id/)
  })

  it('requires eTransferConfirmed on every e-transfer line', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 5000, unitPriceCents: 10000 }],
        taxRatePercent: 0,
        tenders: [{ method: 'E_TRANSFER', amountCents: 10000 }]
      })
    ).rejects.toThrow(/must be confirmed/)
  })
})
