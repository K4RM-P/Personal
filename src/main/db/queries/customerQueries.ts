import type { CreditEntryType, LoyaltyEventType, Prisma, PrismaClient } from '@prisma/client'
import { getSession } from '../../auth/session'

export const normalizePhone = (phone: string): string => phone.replace(/\D/g, '')

export type CustomerInput = {
  firstName: string
  lastName: string
  phone: string
  address: string
  email?: string | null
  loyaltyEnabled?: boolean
  notes?: string | null
}

const customerInclude = {
  ledgerEntries: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  pointEvents: { orderBy: { createdAt: 'desc' as const }, take: 1 }
}

export async function searchCustomers(db: PrismaClient, rawQuery: string) {
  const term = rawQuery.trim()
  const digits = normalizePhone(term)
  if (!term) return db.customer.findMany({ take: 25, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], include: customerInclude })
  const textWhere: Prisma.CustomerWhereInput = {
    OR: [
      { firstName: { contains: term } }, { lastName: { contains: term } },
      { address: { contains: term } }, { email: { contains: term } }
    ]
  }
  if (digits.length) {
    const phoneMatches = await db.customer.findMany({ where: { phoneNormalized: { contains: digits } }, take: 25, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], include: customerInclude })
    if (phoneMatches.length) return phoneMatches
  }
  return db.customer.findMany({ where: textWhere, take: 25, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], include: customerInclude })
}

export async function findDuplicatePhone(db: PrismaClient, phone: string, excludeId?: number) {
  const phoneNormalized = normalizePhone(phone)
  if (!phoneNormalized) return null
  return db.customer.findFirst({ where: { phoneNormalized, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, orderBy: { createdAt: 'asc' } })
}

function validateCustomer(input: CustomerInput): void {
  if (![input.firstName, input.lastName, input.phone, input.address].every((value) => value?.trim())) throw new Error('First name, last name, phone, and address are required.')
}

export async function createCustomer(db: PrismaClient, input: CustomerInput) {
  validateCustomer(input)
  const createdByUserId = getSession()?.userId ?? null
  return db.customer.create({ data: { ...input, firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone.trim(), phoneNormalized: normalizePhone(input.phone), address: input.address.trim(), email: input.email?.trim() || null, createdByUserId } })
}

export async function updateCustomer(db: PrismaClient, id: number, input: CustomerInput) {
  validateCustomer(input)
  return db.customer.update({ where: { id }, data: { ...input, firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone.trim(), phoneNormalized: normalizePhone(input.phone), address: input.address.trim(), email: input.email?.trim() || null } })
}

export async function getCustomerDetail(db: PrismaClient, id: number) {
  const customer = await db.customer.findUniqueOrThrow({
    where: { id },
    include: {
      ledgerEntries: { orderBy: { createdAt: 'desc' } }, pointEvents: { orderBy: { createdAt: 'desc' } },
      transactions: { orderBy: { createdAt: 'desc' }, include: { items: { include: { product: true } } } }
    }
  })
  return { ...customer, currentBalanceCents: customer.ledgerEntries[0]?.balanceAfterCents ?? 0, currentPoints: customer.pointEvents[0]?.pointsAfter ?? 0 }
}

async function appendCreditEntry(tx: Prisma.TransactionClient, customerId: number, type: CreditEntryType, amountCents: number, options: { transactionId?: string; note?: string; createdByUserId?: number } = {}) {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new Error('Ledger amounts must be a non-zero integer number of cents.')
  if (type === 'MANUAL_ADJUSTMENT' && !options.note?.trim()) throw new Error('A note is required for a manual balance adjustment.')
  const previous = await tx.creditLedgerEntry.findFirst({ where: { customerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const createdByUserId = options.createdByUserId ?? getSession()?.userId ?? null
  return tx.creditLedgerEntry.create({ data: { customerId, type, amountCents, balanceAfterCents: (previous?.balanceAfterCents ?? 0) + amountCents, transactionId: options.transactionId, note: options.note?.trim() || null, createdByUserId } })
}

async function appendPointEvent(tx: Prisma.TransactionClient, customerId: number, type: LoyaltyEventType, points: number, options: { transactionId?: string; note?: string } = {}) {
  if (!Number.isInteger(points) || points === 0) throw new Error('Point changes must be non-zero whole points.')
  if (type === 'MANUAL_ADJUSTMENT' && !options.note?.trim()) throw new Error('A note is required for a manual points adjustment.')
  const previous = await tx.loyaltyPointEvent.findFirst({ where: { customerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return tx.loyaltyPointEvent.create({ data: { customerId, type, points, pointsAfter: (previous?.pointsAfter ?? 0) + points, transactionId: options.transactionId, note: options.note?.trim() || null } })
}

export async function addFunds(db: PrismaClient, customerId: number, amountCents: number, note?: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Funds added must be greater than zero.')
  return db.$transaction((tx) => appendCreditEntry(tx, customerId, 'FUNDS_ADDED', amountCents, { note }))
}

export async function adjustCredit(db: PrismaClient, customerId: number, amountCents: number, note: string, managerGranted: boolean) {
  if (!managerGranted) throw new Error('Manager override is required for balance adjustments.')
  return db.$transaction((tx) => appendCreditEntry(tx, customerId, 'MANUAL_ADJUSTMENT', amountCents, { note }))
}

export async function adjustPoints(db: PrismaClient, customerId: number, points: number, note: string, managerGranted: boolean) {
  if (!managerGranted) throw new Error('Manager override is required for points adjustments.')
  return db.$transaction((tx) => appendPointEvent(tx, customerId, 'MANUAL_ADJUSTMENT', points, { note }))
}

export async function getCreditSettings(db: Pick<PrismaClient, 'setting'>) {
  const read = async (key: string, fallback: string) => (await db.setting.findUnique({ where: { key } }))?.value ?? fallback
  return { loyaltyPointsPerDollar: Number(await read('customer.loyaltyPointsPerDollar', '1')) || 0 }
}

export async function getAllowShortPayToTab(db: Pick<PrismaClient, 'setting'>): Promise<boolean> {
  return (await db.setting.findUnique({ where: { key: 'customer.allowShortPayToTab' } }))?.value === 'true'
}

export async function saveCreditSettings(db: PrismaClient, input: { loyaltyPointsPerDollar: number }) {
  if (!Number.isFinite(input.loyaltyPointsPerDollar) || input.loyaltyPointsPerDollar < 0) throw new Error('Loyalty rate must be non-negative.')
  await db.setting.upsert({ where: { key: 'customer.loyaltyPointsPerDollar' }, update: { value: String(input.loyaltyPointsPerDollar) }, create: { key: 'customer.loyaltyPointsPerDollar', value: String(input.loyaltyPointsPerDollar) } })
  return getCreditSettings(db)
}

export async function refundTabAmount(db: PrismaClient, transactionId: string, amountCents?: number) {
  return db.$transaction(async (tx) => {
    const sale = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } })
    if (!sale.customerId || !sale.tabAmountCents) throw new Error('This sale has no Pharmacy Credit amount to restore.')
    const existing = await tx.creditLedgerEntry.aggregate({ where: { transactionId, type: 'REFUND_CREDIT' }, _sum: { amountCents: true } })
    const available = sale.tabAmountCents - (existing._sum.amountCents ?? 0)
    const refund = amountCents ?? available
    if (!Number.isInteger(refund) || refund <= 0 || refund > available) throw new Error('Refund amount exceeds the remaining Pharmacy Credit payment.')
    return appendCreditEntry(tx, sale.customerId, 'REFUND_CREDIT', refund, { transactionId, note: `Refund for ${sale.receiptNumber}` })
  })
}

export const customerLedgerInternals = { appendCreditEntry, appendPointEvent }
