import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { addFunds, adjustCredit, createCustomer, findDuplicatePhone, getCustomerDetail, refundTabAmount } from '../main/db/queries/customerQueries'
import { createTransaction } from '../main/db/queries/posQueries'

describe('customer credit ledger', () => {
  const db = new PrismaClient()
  let productId: number
  let number = Date.now() % 1_000_000
  const customer = async () => createCustomer(db, { firstName: 'Ledger', lastName: `Test${++number}`, phone: `416-${number}`, address: '1 Test Lane' })

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    await db.setting.upsert({ where: { key: 'customer.allowShortPayToTab' }, update: { value: 'true' }, create: { key: 'customer.allowShortPayToTab', value: 'true' } })
    const product = await db.product.upsert({ where: { sku: 'CUSTOMER-TEST' }, update: { priceCents: 1000, costCents: 500, name: 'Customer test item' }, create: { sku: 'CUSTOMER-TEST', name: 'Customer test item', costCents: 500, priceCents: 1000 } })
    productId = product.id
  })
  afterAll(async () => db.$disconnect())

  it('keeps snapshot balances equal to the signed ledger sequence', async () => {
    const c = await customer()
    await addFunds(db, c.id, 1000)
    await adjustCredit(db, c.id, -250, 'correct overpayment', true)
    const detail = await getCustomerDetail(db, c.id)
    const sale = await createTransaction(db, { items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }], taxRatePercent: 0, tenderType: 'SPLIT', tenderedCents: 500, customerId: c.id, tabAmountCents: 500 })
    const after = await getCustomerDetail(db, c.id)
    expect(after.currentBalanceCents).toBe(250)
    expect(after.ledgerEntries[0].balanceAfterCents).toBe(250)
    expect(after.ledgerEntries.find(entry => entry.transactionId === sale.id)?.amountCents).toBe(-500)
  })

  it('writes exactly one partial SALE_CHARGE for split tender', async () => {
    const c = await customer()
    const sale = await createTransaction(db, { items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }], taxRatePercent: 0, tenderType: 'SPLIT', tenderedCents: 600, customerId: c.id, tabAmountCents: 400 })
    const entries = await db.creditLedgerEntry.findMany({ where: { transactionId: sale.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'SALE_CHARGE', amountCents: -400 })
    expect(sale.tabAmountCents).toBe(400)
  })

  it('restores a tab-paid refund as REFUND_CREDIT', async () => {
    const c = await customer()
    const sale = await createTransaction(db, { items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }], taxRatePercent: 0, tenderType: 'SPLIT', tenderedCents: 0, customerId: c.id, tabAmountCents: 1000 })
    await refundTabAmount(db, sale.id)
    const entries = await db.creditLedgerEntry.findMany({ where: { transactionId: sale.id }, orderBy: { id: 'asc' } })
    expect(entries.map(entry => entry.type)).toEqual(['SALE_CHARGE', 'REFUND_CREDIT'])
    expect(entries[1].amountCents).toBe(1000)
  })

  it('warns on duplicate phone without blocking creation', async () => {
    const first = await customer()
    const duplicate = await findDuplicatePhone(db, first.phone)
    expect(duplicate?.id).toBe(first.id)
    await expect(createCustomer(db, { firstName: 'Also', lastName: 'Allowed', phone: first.phone, address: '2 Test Lane' })).resolves.toBeTruthy()
  })

  it('rejects an unexplained manual adjustment before database write', async () => {
    const c = await customer()
    await expect(adjustCredit(db, c.id, 100, '  ', true)).rejects.toThrow('note is required')
    expect((await getCustomerDetail(db, c.id)).ledgerEntries).toHaveLength(0)
  })
})
