import type { CreditEntryType, LoyaltyEventType, Prisma, PrismaClient } from '@prisma/client'
import { getSession } from '../../auth/session'
import type { DebtBreakdown, DebtBreakdownEntry } from '../../../shared/types'

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
  if (!term)
    return db.customer.findMany({
      take: 25,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: customerInclude
    })
  const textWhere: Prisma.CustomerWhereInput = {
    OR: [
      { firstName: { contains: term } },
      { lastName: { contains: term } },
      { address: { contains: term } },
      { email: { contains: term } }
    ]
  }
  if (digits.length) {
    const phoneMatches = await db.customer.findMany({
      where: { phoneNormalized: { contains: digits } },
      take: 25,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: customerInclude
    })
    if (phoneMatches.length) return phoneMatches
  }
  return db.customer.findMany({
    where: textWhere,
    take: 25,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    include: customerInclude
  })
}

export async function findDuplicatePhone(db: PrismaClient, phone: string, excludeId?: number) {
  const phoneNormalized = normalizePhone(phone)
  if (!phoneNormalized) return null
  return db.customer.findFirst({
    where: { phoneNormalized, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    orderBy: { createdAt: 'asc' }
  })
}

function validateCustomer(input: CustomerInput): void {
  if (
    ![input.firstName, input.lastName, input.phone, input.address].every((value) => value?.trim())
  )
    throw new Error('First name, last name, phone, and address are required.')
}

export async function createCustomer(db: PrismaClient, input: CustomerInput) {
  validateCustomer(input)
  const createdByUserId = getSession()?.userId ?? null
  return db.customer.create({
    data: {
      ...input,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone.trim(),
      phoneNormalized: normalizePhone(input.phone),
      address: input.address.trim(),
      email: input.email?.trim() || null,
      createdByUserId
    }
  })
}

export async function updateCustomer(db: PrismaClient, id: number, input: CustomerInput) {
  validateCustomer(input)
  return db.customer.update({
    where: { id },
    data: {
      ...input,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone.trim(),
      phoneNormalized: normalizePhone(input.phone),
      address: input.address.trim(),
      email: input.email?.trim() || null
    }
  })
}

/**
 * B7 (PIPEDA) — a full export of everything held about a customer, for a
 * data-access request. Includes ledger/loyalty/transaction history since
 * that's personal information too, not just the profile fields.
 */
export async function exportCustomerData(db: PrismaClient, id: number) {
  const customer = await db.customer.findUniqueOrThrow({
    where: { id },
    include: {
      ledgerEntries: { orderBy: { createdAt: 'desc' } },
      pointEvents: { orderBy: { createdAt: 'desc' } },
      transactions: { orderBy: { createdAt: 'desc' }, include: { items: true, refunds: true } }
    }
  })
  return { exportedAt: new Date().toISOString(), customer }
}

/**
 * B7 (PIPEDA) — deletion on request. Financial records (ledger entries,
 * transactions, refunds) are kept for accounting integrity and are never
 * deleted; only personally-identifying fields are scrubbed and the record is
 * marked deletedAt. A previously-deleted customer cannot be re-scrubbed.
 */
export async function deleteCustomerData(db: PrismaClient, id: number) {
  const customer = await db.customer.findUniqueOrThrow({ where: { id } })
  if (customer.deletedAt) throw new Error('This customer’s data has already been deleted.')
  return db.customer.update({
    where: { id },
    data: {
      firstName: '[deleted]',
      lastName: '[deleted]',
      phone: '',
      phoneNormalized: '',
      address: '[deleted]',
      email: null,
      notes: null,
      deletedAt: new Date()
    }
  })
}

/**
 * Reconstructs exactly which SALE_CHARGE / debit MANUAL_ADJUSTMENT entries make up a
 * customer's current outstanding (owed) balance, so a pharmacist can show concrete
 * proof of what a debt is for. Walks the full ledger chronologically and offsets each
 * debit FIFO against later credits (FUNDS_ADDED, DEBT_SETTLED, REFUND_CREDIT, or a
 * positive MANUAL_ADJUSTMENT) — the same order the running `balanceAfterCents` was
 * built in, just attributed per-entry instead of only tracked as a running total.
 *
 * Never time-bounded: truncating history risks silently dropping an entry that is
 * still part of the current balance, and the entries actually returned are already
 * bounded to whatever remains unpaid (typically small), not the customer's full history.
 */
export async function getCustomerDebtBreakdown(
  db: PrismaClient,
  customerId: number
): Promise<DebtBreakdown> {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } })
  const ledgerEntries = await db.creditLedgerEntry.findMany({
    where: { customerId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  })

  type DebitRecord = {
    ledgerEntryId: number
    type: 'SALE_CHARGE' | 'MANUAL_ADJUSTMENT'
    remainingCents: number
    createdAt: Date
    note: string | null
    transactionId: string | null
  }
  const outstanding: DebitRecord[] = []

  for (const entry of ledgerEntries) {
    if (entry.amountCents < 0) {
      if (entry.type === 'SALE_CHARGE' || entry.type === 'MANUAL_ADJUSTMENT') {
        outstanding.push({
          ledgerEntryId: entry.id,
          type: entry.type,
          remainingCents: -entry.amountCents,
          createdAt: entry.createdAt,
          note: entry.note,
          transactionId: entry.transactionId
        })
      }
      // REFUND_CREDIT and FUNDS_ADDED/DEBT_SETTLED are never negative in practice;
      // any other negative type is not debt this breakdown reconstructs.
      continue
    }
    // A credit (positive amountCents) pays down the oldest outstanding debits first.
    let creditRemaining = entry.amountCents
    for (const debit of outstanding) {
      if (creditRemaining <= 0) break
      if (debit.remainingCents <= 0) continue
      const offset = Math.min(creditRemaining, debit.remainingCents)
      debit.remainingCents -= offset
      creditRemaining -= offset
    }
  }

  const remaining = outstanding.filter((d) => d.remainingCents > 0)
  const totalOutstandingCents = remaining.reduce((sum, d) => sum + d.remainingCents, 0)

  const entries: DebtBreakdownEntry[] = []
  for (const debit of remaining) {
    if (debit.type === 'MANUAL_ADJUSTMENT') {
      entries.push({
        ledgerEntryId: debit.ledgerEntryId,
        type: 'MANUAL_ADJUSTMENT',
        amountCents: debit.remainingCents,
        createdAt: debit.createdAt,
        note: debit.note
      })
      continue
    }
    // SALE_CHARGE — trace back to the originating transaction's items and whether it
    // was a short-pay or a full charge to the tab.
    if (!debit.transactionId) {
      throw new Error(`SALE_CHARGE ledger entry ${debit.ledgerEntryId} is missing its transactionId.`)
    }
    const transaction = await db.transaction.findUniqueOrThrow({
      where: { id: debit.transactionId },
      include: { items: { where: { lineType: 'PRODUCT' }, include: { product: true } } }
    })
    const tabAmountCents = transaction.tabAmountCents ?? 0
    entries.push({
      ledgerEntryId: debit.ledgerEntryId,
      type: 'SALE_CHARGE',
      amountCents: debit.remainingCents,
      createdAt: debit.createdAt,
      note: debit.note,
      transactionId: transaction.id,
      receiptNumber: transaction.receiptNumber,
      transactionDate: transaction.createdAt,
      transactionTotalCents: transaction.totalCents,
      tabAmountCents,
      chargeKind: tabAmountCents >= transaction.totalCents ? 'FULL_CHARGE' : 'SHORT_PAY',
      items: transaction.items.map((item) => ({
        productName: item.product?.name ?? '(item)',
        quantity: item.quantity
      }))
    })
  }

  const currentBalanceCents = (
    await db.creditLedgerEntry.findFirst({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    })
  )?.balanceAfterCents ?? 0
  const expectedOutstanding = currentBalanceCents < 0 ? -currentBalanceCents : 0
  if (totalOutstandingCents !== expectedOutstanding) {
    throw new Error(
      `Debt breakdown reconstruction (${totalOutstandingCents}) does not match customer ${customerId}'s current outstanding balance (${expectedOutstanding}). This is a bug in the reconstruction logic.`
    )
  }

  return { customerId: customer.id, totalOutstandingCents, entries }
}

export async function getCustomerDetail(db: PrismaClient, id: number) {
  const customer = await db.customer.findUniqueOrThrow({
    where: { id },
    include: {
      ledgerEntries: { orderBy: { createdAt: 'desc' } },
      pointEvents: { orderBy: { createdAt: 'desc' } },
      transactions: {
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: true } } }
      }
    }
  })
  return {
    ...customer,
    currentBalanceCents: customer.ledgerEntries[0]?.balanceAfterCents ?? 0,
    currentPoints: customer.pointEvents[0]?.pointsAfter ?? 0
  }
}

async function appendCreditEntry(
  tx: Prisma.TransactionClient,
  customerId: number,
  type: CreditEntryType,
  amountCents: number,
  options: {
    transactionId?: string
    refundId?: number
    note?: string
    createdByUserId?: number
  } = {}
) {
  if (!Number.isInteger(amountCents) || amountCents === 0)
    throw new Error('Ledger amounts must be a non-zero integer number of cents.')
  if (type === 'MANUAL_ADJUSTMENT' && !options.note?.trim())
    throw new Error('A note is required for a manual balance adjustment.')
  const previous = await tx.creditLedgerEntry.findFirst({
    where: { customerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })
  const createdByUserId = options.createdByUserId ?? getSession()?.userId ?? null
  return tx.creditLedgerEntry.create({
    data: {
      customerId,
      type,
      amountCents,
      balanceAfterCents: (previous?.balanceAfterCents ?? 0) + amountCents,
      transactionId: options.transactionId,
      refundId: options.refundId,
      note: options.note?.trim() || null,
      createdByUserId
    }
  })
}

async function appendPointEvent(
  tx: Prisma.TransactionClient,
  customerId: number,
  type: LoyaltyEventType,
  points: number,
  options: { transactionId?: string; note?: string } = {}
) {
  if (!Number.isInteger(points) || points === 0)
    throw new Error('Point changes must be non-zero whole points.')
  if (type === 'MANUAL_ADJUSTMENT' && !options.note?.trim())
    throw new Error('A note is required for a manual points adjustment.')
  const previous = await tx.loyaltyPointEvent.findFirst({
    where: { customerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })
  return tx.loyaltyPointEvent.create({
    data: {
      customerId,
      type,
      points,
      pointsAfter: (previous?.pointsAfter ?? 0) + points,
      transactionId: options.transactionId,
      note: options.note?.trim() || null
    }
  })
}

export async function addFunds(
  db: PrismaClient,
  customerId: number,
  amountCents: number,
  note?: string
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw new Error('Funds added must be greater than zero.')
  return db.$transaction((tx) =>
    appendCreditEntry(tx, customerId, 'FUNDS_ADDED', amountCents, { note })
  )
}

export async function adjustCredit(
  db: PrismaClient,
  customerId: number,
  amountCents: number,
  note: string,
  managerGranted: boolean
) {
  if (!managerGranted) throw new Error('Manager override is required for balance adjustments.')
  return db.$transaction((tx) =>
    appendCreditEntry(tx, customerId, 'MANUAL_ADJUSTMENT', amountCents, { note })
  )
}

export async function adjustPoints(
  db: PrismaClient,
  customerId: number,
  points: number,
  note: string,
  managerGranted: boolean
) {
  if (!managerGranted) throw new Error('Manager override is required for points adjustments.')
  return db.$transaction((tx) =>
    appendPointEvent(tx, customerId, 'MANUAL_ADJUSTMENT', points, { note })
  )
}

export async function getCreditSettings(db: Pick<PrismaClient, 'setting'>) {
  const read = async (key: string, fallback: string) =>
    (await db.setting.findUnique({ where: { key } }))?.value ?? fallback
  return {
    loyaltyPointsPerDollar: Number(await read('customer.loyaltyPointsPerDollar', '1')) || 0,
    debtWarningThresholdDays:
      Number(await read('customer.debtWarningThresholdDays', '30')) || 30
  }
}

export async function saveCreditSettings(
  db: PrismaClient,
  input: { loyaltyPointsPerDollar: number; debtWarningThresholdDays: number }
) {
  if (!Number.isFinite(input.loyaltyPointsPerDollar) || input.loyaltyPointsPerDollar < 0)
    throw new Error('Loyalty rate must be non-negative.')
  if (
    !Number.isFinite(input.debtWarningThresholdDays) ||
    !Number.isInteger(input.debtWarningThresholdDays) ||
    input.debtWarningThresholdDays < 1
  )
    throw new Error('Debt warning threshold must be a whole number of days, at least 1.')
  await db.setting.upsert({
    where: { key: 'customer.loyaltyPointsPerDollar' },
    update: { value: String(input.loyaltyPointsPerDollar) },
    create: { key: 'customer.loyaltyPointsPerDollar', value: String(input.loyaltyPointsPerDollar) }
  })
  await db.setting.upsert({
    where: { key: 'customer.debtWarningThresholdDays' },
    update: { value: String(input.debtWarningThresholdDays) },
    create: {
      key: 'customer.debtWarningThresholdDays',
      value: String(input.debtWarningThresholdDays)
    }
  })
  return getCreditSettings(db)
}

export async function refundTabAmount(
  db: PrismaClient,
  transactionId: string,
  amountCents?: number
) {
  return db.$transaction(async (tx) => {
    const sale = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } })
    if (!sale.customerId || !sale.tabAmountCents)
      throw new Error('This sale has no Pharmacy Credit amount to restore.')
    const existing = await tx.creditLedgerEntry.aggregate({
      where: { transactionId, type: 'REFUND_CREDIT' },
      _sum: { amountCents: true }
    })
    const available = sale.tabAmountCents - (existing._sum.amountCents ?? 0)
    const refund = amountCents ?? available
    if (!Number.isInteger(refund) || refund <= 0 || refund > available)
      throw new Error('Refund amount exceeds the remaining Pharmacy Credit payment.')
    return appendCreditEntry(tx, sale.customerId, 'REFUND_CREDIT', refund, {
      transactionId,
      note: `Refund for ${sale.receiptNumber}`
    })
  })
}

export const customerLedgerInternals = { appendCreditEntry, appendPointEvent }
