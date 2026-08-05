import type { PrismaClient, Refund, RefundStatus } from '@prisma/client'
import type { RefundType, SaleRefundDetail, SaleSearchResult } from '../../../shared/types'
import { getActiveProvider } from '../../payment/paymentService'
import { customerLedgerInternals } from './customerQueries'

/**
 * Sales list backing both the "Refund Past Sales" flow and the Past Sales tab
 * — searchable by receipt number (the human-facing "Sale #") and optionally
 * bounded to a date range (managers pick one; cashiers are pinned to the last
 * 24 hours by the caller). Capped so nobody is shipped the entire sales
 * history over IPC on every keystroke.
 */
export async function searchSalesForRefund(
  db: PrismaClient,
  query?: string,
  options?: { fromDate?: Date; toDate?: Date; limit?: number }
): Promise<SaleSearchResult[]> {
  const q = query?.trim()
  const textFilter = q ? { OR: [{ receiptNumber: { contains: q } }, { id: { contains: q } }] } : undefined
  const dateFilter =
    options?.fromDate || options?.toDate
      ? {
          createdAt: {
            ...(options.fromDate ? { gte: options.fromDate } : {}),
            ...(options.toDate ? { lte: options.toDate } : {})
          }
        }
      : undefined

  const transactions = await db.transaction.findMany({
    where: textFilter && dateFilter ? { AND: [textFilter, dateFilter] } : (textFilter ?? dateFilter),
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 300,
    include: {
      customer: { select: { firstName: true, lastName: true } },
      user: { select: { fullName: true } },
      refunds: { select: { amountCents: true } },
      _count: { select: { items: true } }
    }
  })
  return transactions.map((tx) => ({
    id: tx.id,
    receiptNumber: tx.receiptNumber,
    createdAt: tx.createdAt.toISOString(),
    customerName: tx.customer ? `${tx.customer.firstName} ${tx.customer.lastName}` : null,
    cashierName: tx.user?.fullName ?? null,
    itemCount: tx._count.items,
    totalCents: tx.totalCents,
    tenderType: tx.tenderType,
    status: tx.status,
    refundedCents: tx.refunds.reduce((sum, r) => sum + r.amountCents, 0)
  }))
}

export async function getSaleDetailsForRefund(db: PrismaClient, transactionId: string): Promise<SaleRefundDetail> {
  const tx = await db.transaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: {
      items: { include: { product: true } },
      customer: true,
      user: { select: { id: true, fullName: true, role: true } },
      refunds: { orderBy: { createdAt: 'desc' } }
    }
  })
  const refundedCents = tx.refunds.reduce((sum, r) => sum + r.amountCents, 0)
  return { ...tx, refundedCents, refundableCents: Math.max(0, tx.totalCents - refundedCents) }
}

export interface ProcessRefundInput {
  transactionId: string
  type: RefundType
  amountCents: number
  reason?: string
  /** Required for E_TRANSFER. */
  customerEmail?: string
  /** Required for TAB_CREDIT when the sale has no customer attached. */
  linkCustomerId?: number
  /** The manager who re-authenticated for this refund (see verifyManagerCredentials). */
  refundedByUserId: number
}

/**
 * Create a Refund record for a past sale, reversing money via the appropriate
 * channel: CASH is a plain record (cash handed over at the till), CARD reverses
 * the original charge through the payment adapter, E_TRANSFER is recorded
 * PENDING until the manager sends the transfer manually, and TAB_CREDIT posts a
 * REFUND_CREDIT ledger entry to the customer's Pharmacy Credit balance.
 */
export async function processRefund(db: PrismaClient, input: ProcessRefundInput): Promise<Refund> {
  // Server-side re-check: never trust a renderer-supplied "I authenticated as a
  // manager" claim without confirming the id is actually a Manager right now.
  const manager = await db.user.findUnique({ where: { id: input.refundedByUserId } })
  if (!manager || manager.role !== 'MANAGER') throw new Error('Refunds must be authorized by a Manager.')
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Refund amount must be a positive integer number of cents.')
  }

  return db.$transaction(async (tx) => {
    const sale = await tx.transaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      include: { refunds: true }
    })
    if (sale.status === 'VOIDED') throw new Error('This sale was voided and cannot be refunded.')

    const alreadyRefundedCents = sale.refunds.reduce((sum, r) => sum + r.amountCents, 0)
    const refundableCents = sale.totalCents - alreadyRefundedCents
    if (refundableCents <= 0) throw new Error('This sale has already been fully refunded.')
    if (input.amountCents > refundableCents) {
      throw new Error(`Refund amount exceeds the remaining refundable balance of ${(refundableCents / 100).toFixed(2)}.`)
    }

    let status: RefundStatus = 'COMPLETED'
    let providerRefundId: string | undefined
    let tabCustomerId: number | undefined

    if (input.type === 'CARD') {
      if (!sale.processorTransactionId) throw new Error('This sale has no card charge on file to reverse.')
      const provider = await getActiveProvider(db)
      const result = await provider.refund(sale.processorTransactionId, input.amountCents)
      if (result.status !== 'approved') throw new Error(result.message || 'Card refund was declined by the processor.')
      providerRefundId = result.refundId
    } else if (input.type === 'E_TRANSFER') {
      if (!input.customerEmail?.trim()) throw new Error('An email address is required for an E-Transfer refund.')
      status = 'PENDING'
    } else if (input.type === 'TAB_CREDIT') {
      tabCustomerId = sale.customerId ?? input.linkCustomerId ?? undefined
      if (!tabCustomerId) throw new Error('Attach or link a customer before depositing a refund to their tab.')
      if (!sale.customerId) {
        // Link the customer to the sale permanently, matching how a normal
        // customer-attached sale would read from now on.
        await tx.transaction.update({ where: { id: sale.id }, data: { customerId: tabCustomerId } })
      }
    }

    const refund = await tx.refund.create({
      data: {
        transactionId: sale.id,
        type: input.type,
        amountCents: input.amountCents,
        reason: input.reason?.trim() || null,
        customerEmail: input.type === 'E_TRANSFER' ? input.customerEmail?.trim() : null,
        providerRefundId,
        refundedByUserId: input.refundedByUserId,
        status
      }
    })

    if (input.type === 'TAB_CREDIT' && tabCustomerId) {
      await customerLedgerInternals.appendCreditEntry(tx, tabCustomerId, 'REFUND_CREDIT', input.amountCents, {
        transactionId: sale.id,
        refundId: refund.id,
        note: `Refund for ${sale.receiptNumber}`,
        createdByUserId: input.refundedByUserId
      })
    }

    if (alreadyRefundedCents + input.amountCents >= sale.totalCents) {
      await tx.transaction.update({ where: { id: sale.id }, data: { status: 'REFUNDED' } })
    }

    return refund
  })
}
