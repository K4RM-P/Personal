import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { createTransaction } from '../main/db/queries/posQueries'
import { createUser, verifyManagerCredentials } from '../main/db/queries/userQueries'
import { getSaleDetailsForRefund, processRefund, searchSalesForRefund } from '../main/db/queries/refundQueries'
import type { CreateTransactionPayload } from '../shared/types'

describe('refund system', () => {
  const db = new PrismaClient()
  let productId: number
  let managerId: number
  let cashierId: number
  let managerFullName = ''
  let cashierFullName = ''
  let n = Date.now() % 1_000_000

  let originalPaymentProvider: string | null = null

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    // Force the offline mock processor regardless of whatever provider is
    // configured in this shared dev database, so the CARD refund path is
    // deterministic and never depends on real credentials being on file.
    // Restored in afterAll so this doesn't permanently change the app's config.
    originalPaymentProvider = (await db.setting.findUnique({ where: { key: 'payment.provider' } }))?.value ?? null
    await db.setting.upsert({
      where: { key: 'payment.provider' },
      update: { value: 'mock' },
      create: { key: 'payment.provider', value: 'mock' }
    })
    const product = await db.product.upsert({
      where: { sku: 'REFUND-TEST' },
      update: { priceCents: 1000, costCents: 500, name: 'Refund test item' },
      create: { sku: 'REFUND-TEST', name: 'Refund test item', costCents: 500, priceCents: 1000 }
    })
    productId = product.id

    managerFullName = `RefundMgr${++n}`
    const manager = await createUser(db, { fullName: managerFullName, password: 'password123', role: 'MANAGER' })
    managerId = manager.id

    cashierFullName = `RefundCashier${++n}`
    const cashier = await createUser(db, { fullName: cashierFullName, password: 'password123', role: 'CASHIER' })
    cashierId = cashier.id
  })
  afterAll(async () => {
    if (originalPaymentProvider === null) {
      await db.setting.deleteMany({ where: { key: 'payment.provider' } })
    } else {
      await db.setting.upsert({
        where: { key: 'payment.provider' },
        update: { value: originalPaymentProvider },
        create: { key: 'payment.provider', value: originalPaymentProvider }
      })
    }
    await db.$disconnect()
  })

  const sale = (overrides: Partial<CreateTransactionPayload> = {}) =>
    createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 1000,
      ...overrides
    })

  it('processes a cash refund, records the manager, and marks the sale REFUNDED once fully refunded', async () => {
    const tx = await sale()
    const refund = await processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 1000, refundedByUserId: managerId })
    expect(refund.status).toBe('COMPLETED')
    expect(refund.amountCents).toBe(1000)
    expect(refund.refundedByUserId).toBe(managerId)
    const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })
    expect(updated.status).toBe('REFUNDED')
  })

  it('rejects a refund authorized by a non-manager, even with a real user id', async () => {
    const tx = await sale()
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 1000, refundedByUserId: cashierId })
    ).rejects.toThrow(/Manager/)
  })

  it('processes a card refund through the payment adapter using the stored processor transaction id', async () => {
    const tx = await sale({ tenderType: 'CARD', processorTransactionId: 'proc_abc123', cardLast4: '4242' })
    const refund = await processRefund(db, { transactionId: tx.id, type: 'CARD', amountCents: 1000, refundedByUserId: managerId })
    expect(refund.status).toBe('COMPLETED')
    expect(refund.providerRefundId).toBeTruthy()
  })

  it('rejects a card refund when the sale has no processor transaction id on file', async () => {
    const tx = await sale({ tenderType: 'CARD' })
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'CARD', amountCents: 1000, refundedByUserId: managerId })
    ).rejects.toThrow(/card charge on file/)
  })

  it('requires an email and records an e-transfer refund as PENDING', async () => {
    const tx = await sale()
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'E_TRANSFER', amountCents: 1000, refundedByUserId: managerId })
    ).rejects.toThrow(/email/)
    const refund = await processRefund(db, {
      transactionId: tx.id,
      type: 'E_TRANSFER',
      amountCents: 1000,
      customerEmail: 'a@b.com',
      refundedByUserId: managerId
    })
    expect(refund.status).toBe('PENDING')
    expect(refund.customerEmail).toBe('a@b.com')
  })

  it('deposits a tab-credit refund and writes a REFUND_CREDIT ledger entry', async () => {
    const customer = await db.customer.create({
      data: { firstName: 'Refund', lastName: `Cust${++n}`, phone: `416-${n}`, phoneNormalized: `416${n}`, address: '1 Test Lane' }
    })
    const tx = await sale({ customerId: customer.id })
    const refund = await processRefund(db, { transactionId: tx.id, type: 'TAB_CREDIT', amountCents: 1000, refundedByUserId: managerId })
    expect(refund.status).toBe('COMPLETED')
    const entry = await db.creditLedgerEntry.findFirst({ where: { refundId: refund.id } })
    expect(entry).toMatchObject({ type: 'REFUND_CREDIT', amountCents: 1000, customerId: customer.id })
  })

  it('links a customer to an unattached sale for a tab-credit refund', async () => {
    const customer = await db.customer.create({
      data: { firstName: 'Link', lastName: `Cust${++n}`, phone: `416-${n}`, phoneNormalized: `416${n}`, address: '1 Test Lane' }
    })
    const tx = await sale()
    expect(tx.customerId).toBeNull()
    await processRefund(db, { transactionId: tx.id, type: 'TAB_CREDIT', amountCents: 1000, linkCustomerId: customer.id, refundedByUserId: managerId })
    const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })
    expect(updated.customerId).toBe(customer.id)
  })

  it('rejects a tab-credit refund when there is no customer to attach it to', async () => {
    const tx = await sale()
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'TAB_CREDIT', amountCents: 1000, refundedByUserId: managerId })
    ).rejects.toThrow(/customer/)
  })

  it('prevents refunding more than the remaining refundable balance, across multiple partial refunds', async () => {
    const tx = await sale()
    await processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 400, refundedByUserId: managerId })
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 700, refundedByUserId: managerId })
    ).rejects.toThrow(/exceeds/)
    const refund = await processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 600, refundedByUserId: managerId })
    expect(refund.status).toBe('COMPLETED')
    const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })
    expect(updated.status).toBe('REFUNDED')
  })

  it('rejects a refund on an already-fully-refunded sale', async () => {
    const tx = await sale()
    await processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 1000, refundedByUserId: managerId })
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 1, refundedByUserId: managerId })
    ).rejects.toThrow(/already been fully refunded/)
  })

  it('rejects a refund on a voided sale', async () => {
    const tx = await sale()
    await db.transaction.update({ where: { id: tx.id }, data: { status: 'VOIDED' } })
    await expect(
      processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 1000, refundedByUserId: managerId })
    ).rejects.toThrow(/voided/)
  })

  it('finds sales by receipt number prefix and reflects refunded amounts', async () => {
    const tx = await sale()
    await processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 300, refundedByUserId: managerId })
    const prefix = tx.receiptNumber.slice(0, 6)
    const results = await searchSalesForRefund(db, prefix)
    const match = results.find((r) => r.id === tx.id)
    expect(match).toBeDefined()
    expect(match?.refundedCents).toBe(300)
  })

  it('reports the remaining refundable balance via getSaleDetailsForRefund', async () => {
    const tx = await sale()
    await processRefund(db, { transactionId: tx.id, type: 'CASH', amountCents: 400, refundedByUserId: managerId })
    const detail = await getSaleDetailsForRefund(db, tx.id)
    expect(detail.refundedCents).toBe(400)
    expect(detail.refundableCents).toBe(600)
  })

  it('verifyManagerCredentials rejects a valid cashier login and accepts a valid manager login', async () => {
    expect(await verifyManagerCredentials(db, cashierFullName, 'password123')).toBeNull()
    expect(await verifyManagerCredentials(db, managerFullName, 'wrong-password')).toBeNull()
    const ok = await verifyManagerCredentials(db, managerFullName, 'password123')
    expect(ok?.id).toBe(managerId)
  })
})
