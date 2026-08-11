import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import {
  addFunds,
  adjustCredit,
  createCustomer,
  deleteCustomerData,
  exportCustomerData,
  findDuplicatePhone,
  getCustomerDetail,
  refundTabAmount
} from '../main/db/queries/customerQueries'
import { createTransaction } from '../main/db/queries/posQueries'

describe('customer credit ledger', () => {
  const db = new PrismaClient()
  let productId: number
  let number = Date.now() % 1_000_000
  const customer = async () =>
    createCustomer(db, {
      firstName: 'Ledger',
      lastName: `Test${++number}`,
      phone: `416-${number}`,
      address: '1 Test Lane'
    })

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    await db.setting.upsert({
      where: { key: 'customer.allowShortPayToTab' },
      update: { value: 'true' },
      create: { key: 'customer.allowShortPayToTab', value: 'true' }
    })
    const product = await db.product.upsert({
      where: { sku: 'CUSTOMER-TEST' },
      update: { priceCents: 1000, costCents: 500, name: 'Customer test item' },
      create: { sku: 'CUSTOMER-TEST', name: 'Customer test item', costCents: 500, priceCents: 1000 }
    })
    productId = product.id
  })
  afterAll(async () => db.$disconnect())

  it('keeps snapshot balances equal to the signed ledger sequence', async () => {
    const c = await customer()
    await addFunds(db, c.id, 1000)
    await adjustCredit(db, c.id, -250, 'correct overpayment', true)
    const detail = await getCustomerDetail(db, c.id)
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'SPLIT',
      tenderedCents: 500,
      customerId: c.id,
      tabAmountCents: 500
    })
    const after = await getCustomerDetail(db, c.id)
    expect(after.currentBalanceCents).toBe(250)
    expect(after.ledgerEntries[0].balanceAfterCents).toBe(250)
    expect(after.ledgerEntries.find((entry) => entry.transactionId === sale.id)?.amountCents).toBe(
      -500
    )
  })

  it('writes exactly one partial SALE_CHARGE for split tender', async () => {
    const c = await customer()
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'SPLIT',
      tenderedCents: 600,
      customerId: c.id,
      tabAmountCents: 400
    })
    const entries = await db.creditLedgerEntry.findMany({ where: { transactionId: sale.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'SALE_CHARGE', amountCents: -400 })
    expect(sale.tabAmountCents).toBe(400)
  })

  it('restores a tab-paid refund as REFUND_CREDIT', async () => {
    const c = await customer()
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'SPLIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 1000
    })
    await refundTabAmount(db, sale.id)
    const entries = await db.creditLedgerEntry.findMany({
      where: { transactionId: sale.id },
      orderBy: { id: 'asc' }
    })
    expect(entries.map((entry) => entry.type)).toEqual(['SALE_CHARGE', 'REFUND_CREDIT'])
    expect(entries[1].amountCents).toBe(1000)
  })

  it('warns on duplicate phone without blocking creation', async () => {
    const first = await customer()
    const duplicate = await findDuplicatePhone(db, first.phone)
    expect(duplicate?.id).toBe(first.id)
    await expect(
      createCustomer(db, {
        firstName: 'Also',
        lastName: 'Allowed',
        phone: first.phone,
        address: '2 Test Lane'
      })
    ).resolves.toBeTruthy()
  })

  it('rejects an unexplained manual adjustment before database write', async () => {
    const c = await customer()
    await expect(adjustCredit(db, c.id, 100, '  ', true)).rejects.toThrow('note is required')
    expect((await getCustomerDetail(db, c.id)).ledgerEntries).toHaveLength(0)
  })

  it('adds a credit-card surcharge into the transaction total (rounded down)', async () => {
    // subtotal 1000, tax 0, 2% surcharge = 20 cents
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'CARD',
      tenderedCents: 1020,
      surchargeCents: 20
    })
    expect(sale.surchargeCents).toBe(20)
    expect(sale.totalCents).toBe(1020)
    expect(sale.changeCents).toBe(0)
  })

  it('rejects a card surcharge on a non-card tender', async () => {
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
        taxRatePercent: 0,
        tenderType: 'CASH',
        tenderedCents: 1020,
        surchargeCents: 20
      })
    ).rejects.toThrow('Card surcharge cannot be applied to a non-card tender.')
  })

  it('rejects a card surcharge that does not match the configured rate', async () => {
    // Configured rate is 2%; 1000 * 2% = 20, so 999 is wrong regardless of what the client sent.
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
        taxRatePercent: 0,
        tenderType: 'CARD',
        tenderedCents: 1999,
        surchargeCents: 999
      })
    ).rejects.toThrow('Card surcharge does not match the configured rate.')
  })

  it('records an E-Transfer tender with email and no ledger entry', async () => {
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'E_TRANSFER',
      tenderedCents: 1000,
      email: 'buyer@example.com'
    })
    expect(sale.tenderType).toBe('E_TRANSFER')
    expect(sale.email).toBe('buyer@example.com')
    expect(sale.tabAmountCents).toBe(0)
  })

  it('charges a standalone Pharmacy Credit sale fully to the tab (one SALE_CHARGE)', async () => {
    const c = await customer()
    await addFunds(db, c.id, 5000)
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 1000
    })
    const entries = await db.creditLedgerEntry.findMany({ where: { transactionId: sale.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'SALE_CHARGE', amountCents: -1000 })
    expect((await getCustomerDetail(db, c.id)).currentBalanceCents).toBe(4000)
  })

  it('rejects a Pharmacy Credit standalone tender whose amount is not the full total', async () => {
    const c = await customer()
    await addFunds(db, c.id, 5000)
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
        taxRatePercent: 0,
        tenderType: 'PHARMACY_CREDIT',
        tenderedCents: 0,
        customerId: c.id,
        tabAmountCents: 400
      })
    ).rejects.toThrow('full sale total')
  })

  it('blocks an insufficient-balance Pharmacy Credit sale when short-pay to tab is off', async () => {
    await db.setting.upsert({
      where: { key: 'customer.allowShortPayToTab' },
      update: { value: 'false' },
      create: { key: 'customer.allowShortPayToTab', value: 'false' }
    })
    const c = await customer()
    await addFunds(db, c.id, 200)
    await expect(
      createTransaction(db, {
        items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
        taxRatePercent: 0,
        tenderType: 'PHARMACY_CREDIT',
        tenderedCents: 0,
        customerId: c.id,
        tabAmountCents: 1000
      })
    ).rejects.toThrow('Balance insufficient')
    await db.setting.upsert({
      where: { key: 'customer.allowShortPayToTab' },
      update: { value: 'true' },
      create: { key: 'customer.allowShortPayToTab', value: 'true' }
    })
  })

  it('allows an insufficient-balance Pharmacy Credit sale (negative tab) when short-pay is on', async () => {
    await db.setting.upsert({
      where: { key: 'customer.allowShortPayToTab' },
      update: { value: 'true' },
      create: { key: 'customer.allowShortPayToTab', value: 'true' }
    })
    const c = await customer()
    await addFunds(db, c.id, 200)
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'PHARMACY_CREDIT',
      tenderedCents: 0,
      customerId: c.id,
      tabAmountCents: 1000
    })
    expect(sale.tenderType).toBe('PHARMACY_CREDIT')
    expect((await getCustomerDetail(db, c.id)).currentBalanceCents).toBe(-800)
  })

  // B7 — export / delete-on-request admin feature.
  it('exports the full customer record including ledger and transaction history', async () => {
    const c = await customer()
    await addFunds(db, c.id, 500)
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 1000,
      customerId: c.id
    })
    const exported = await exportCustomerData(db, c.id)
    expect(exported.customer.id).toBe(c.id)
    expect(exported.customer.ledgerEntries.length).toBeGreaterThan(0)
    expect(exported.customer.transactions.some((t) => t.id === sale.id)).toBe(true)
    expect(typeof exported.exportedAt).toBe('string')
  })

  it('deletes only PII on request and keeps financial records intact', async () => {
    const c = await customer()
    await addFunds(db, c.id, 1000)
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenderType: 'CASH',
      tenderedCents: 1000,
      customerId: c.id
    })

    const deleted = await deleteCustomerData(db, c.id)
    expect(deleted.firstName).toBe('[deleted]')
    expect(deleted.phone).toBe('')
    expect(deleted.deletedAt).not.toBeNull()

    // Financial history survives, still linked to the (now-anonymized) customer.
    const detail = await getCustomerDetail(db, c.id)
    expect(detail.currentBalanceCents).toBe(1000) // CASH sale doesn't touch the credit ledger
    expect(detail.transactions.some((t) => t.id === sale.id)).toBe(true)

    // Cannot be scrubbed twice.
    await expect(deleteCustomerData(db, c.id)).rejects.toThrow(/already been deleted/)
  })
})
