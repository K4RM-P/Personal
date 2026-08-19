import { PrismaClient } from '@prisma/client'
import { getCompleteProductSales } from '../db/queries/reportQueries'
import { buildCompleteProductSalesCsv } from '../../shared/completeProductSalesCsv'

/**
 * Human-readable JSON exports of operational data for the data backup system.
 * Field shapes follow the real schema (Transaction/TransactionItem/Discount/Refund/
 * Customer/User/Product) rather than the spec's illustrative "Sale" shape — see
 * docs/data-backup-system-spec.md §1.3 for the reference model this adapts.
 * No card data and no password hashes are ever included.
 */

export async function exportSales(db: PrismaClient): Promise<{ sales: unknown[] }> {
  const transactions = await db.transaction.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      user: { select: { fullName: true } },
      items: { include: { product: { select: { name: true } } } },
      discounts: true,
      refunds: true
    }
  })

  return {
    sales: transactions.map((tx) => ({
      id: tx.id,
      receiptNumber: tx.receiptNumber,
      createdAt: tx.createdAt,
      status: tx.status,
      customerId: tx.customerId,
      customerName: tx.customer ? `${tx.customer.firstName} ${tx.customer.lastName}` : null,
      cashierId: tx.cashierId,
      cashierName: tx.user?.fullName ?? null,
      subtotalCents: tx.subtotalCents,
      taxCents: tx.taxCents,
      totalCents: tx.totalCents,
      tenderType: tx.tenderType,
      tenderedCents: tx.tenderedCents,
      changeCents: tx.changeCents,
      surchargeCents: tx.surchargeCents,
      billDiscountCents: tx.billDiscountCents,
      discountApplied: tx.discountApplied,
      tabAmountCents: tx.tabAmountCents,
      voidReason: tx.voidReason,
      voidedByUserId: tx.voidedByUserId,
      category: tx.category,
      saleType: tx.saleType,
      lineItems: tx.items.map((item) => ({
        productId: item.productId,
        productName:
          item.lineType === 'DEBT_SETTLEMENT'
            ? 'Previous Balance'
            : (item.product?.name ?? '(item)'),
        quantity: item.quantity,
        costCents: item.costCents,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents,
        totalCents: item.totalCents,
        isVoided: item.isVoided
      })),
      discountIds: tx.discounts.map((d) => d.id),
      refundIds: tx.refunds.map((r) => r.id)
    }))
  }
}

export async function exportCustomers(db: PrismaClient): Promise<{ customers: unknown[] }> {
  const customers = await db.customer.findMany({
    orderBy: { id: 'asc' },
    include: {
      ledgerEntries: { orderBy: { createdAt: 'asc' } },
      pointEvents: { orderBy: { createdAt: 'asc' } }
    }
  })

  return {
    customers: customers.map((c) => {
      const lastLedger = c.ledgerEntries[c.ledgerEntries.length - 1]
      const lastPoints = c.pointEvents[c.pointEvents.length - 1]
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        address: c.address,
        email: c.email,
        loyaltyEnabled: c.loyaltyEnabled,
        createdAt: c.createdAt,
        currentBalance: {
          creditCents: lastLedger?.balanceAfterCents ?? 0,
          loyaltyPoints: lastPoints?.pointsAfter ?? 0
        },
        creditLedger: c.ledgerEntries.map((e) => ({
          entryId: e.id,
          type: e.type,
          amountCents: e.amountCents,
          balanceAfterCents: e.balanceAfterCents,
          transactionId: e.transactionId,
          refundId: e.refundId,
          note: e.note,
          createdAt: e.createdAt
        })),
        loyaltyHistory: c.pointEvents.map((e) => ({
          eventId: e.id,
          type: e.type,
          points: e.points,
          pointsAfter: e.pointsAfter,
          transactionId: e.transactionId,
          note: e.note,
          createdAt: e.createdAt
        }))
      }
    })
  }
}

export async function exportUsers(db: PrismaClient): Promise<{ users: unknown[] }> {
  const users = await db.user.findMany({ orderBy: { id: 'asc' } })
  // passwordHash is intentionally never included.
  return {
    users: users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin
    }))
  }
}

export async function exportDiscounts(db: PrismaClient): Promise<{ discounts: unknown[] }> {
  const discounts = await db.discount.findMany({
    orderBy: { createdAt: 'asc' },
    include: { transaction: { include: { items: true } } }
  })

  const userIds = [
    ...new Set(discounts.map((d) => d.appliedByUserId).filter((id): id is number => id !== null))
  ]
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, fullName: true }
  })
  const userLookup = Object.fromEntries(users.map((u) => [u.id, u.fullName]))

  return {
    discounts: discounts.map((d) => ({
      id: d.id,
      transactionId: d.transactionId,
      type: d.type,
      itemId: d.itemId,
      amountCents: d.amountCents,
      originalCents: d.originalCents,
      finalCents: d.finalCents,
      reason: d.reason,
      appliedByUserId: d.appliedByUserId,
      appliedByName: d.appliedByUserId ? (userLookup[d.appliedByUserId] ?? null) : null,
      createdAt: d.createdAt
    }))
  }
}

export async function exportRefunds(db: PrismaClient): Promise<{ refunds: unknown[] }> {
  const refunds = await db.refund.findMany({
    orderBy: { createdAt: 'asc' },
    include: { refundedBy: { select: { fullName: true } } }
  })

  return {
    refunds: refunds.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      type: r.type,
      amountCents: r.amountCents,
      reason: r.reason,
      customerEmail: r.customerEmail,
      providerRefundId: r.providerRefundId,
      refundedByUserId: r.refundedByUserId,
      refundedByName: r.refundedBy.fullName,
      status: r.status,
      createdAt: r.createdAt
    }))
  }
}

export async function exportInventorySnapshot(db: PrismaClient): Promise<{
  snapshotTimestamp: string
  products: unknown[]
  totalInventoryValueCost: number
  totalInventoryValueRetail: number
}> {
  const products = await db.product.findMany({ orderBy: { id: 'asc' } })

  let totalCost = 0
  let totalRetail = 0
  for (const p of products) {
    totalCost += p.costCents * p.currentOnHand
    totalRetail += p.priceCents * p.currentOnHand
  }

  return {
    snapshotTimestamp: new Date().toISOString(),
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      barcode: p.barcode,
      categoryCode: p.categoryCode,
      onHandQuantity: p.currentOnHand,
      costCents: p.costCents,
      retailCents: p.priceCents,
      reorderPoint: p.reorderPoint,
      discontinued: p.discontinued
    })),
    totalInventoryValueCost: totalCost,
    totalInventoryValueRetail: totalRetail
  }
}

/** Settings are exported allowlisted-by-exclusion: any key ending in "Enc" holds an
 * encrypted secret (payment API keys, SMTP password, Google Drive refresh token) and
 * must never appear in a backup file, encrypted or not. */
export async function exportSettings(db: PrismaClient): Promise<{ settings: unknown[] }> {
  const rows = await db.setting.findMany({ orderBy: { key: 'asc' } })
  return {
    settings: rows
      .filter((row) => !row.key.endsWith('Enc'))
      .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt }))
  }
}

export async function exportFeatureFlags(db: PrismaClient): Promise<{ featureFlags: unknown[] }> {
  const rows = await db.featureFlag.findMany({ orderBy: { key: 'asc' } })
  return { featureFlags: rows }
}

export async function exportPricingTiers(db: PrismaClient): Promise<{ pricingTiers: unknown[] }> {
  const rows = await db.pricingTier.findMany({ orderBy: { orderIndex: 'asc' } })
  return { pricingTiers: rows }
}

export async function exportInventoryAdjustments(
  db: PrismaClient
): Promise<{ inventoryAdjustments: unknown[] }> {
  const rows = await db.inventoryAdjustment.findMany({
    orderBy: { createdAt: 'asc' },
    include: { product: { select: { name: true } } }
  })
  return {
    inventoryAdjustments: rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product?.name ?? null,
      quantityDelta: r.quantityDelta,
      reason: r.reason,
      adjustedByUserId: r.adjustedByUserId,
      createdAt: r.createdAt
    }))
  }
}

/** All-time complete product sales report, reusing the same row builder and CSV
 * formatter the on-demand Reports-screen export uses. */
export async function exportCompleteSalesReportCsv(db: PrismaClient): Promise<string> {
  const earliest = await db.transaction.findFirst({ orderBy: { createdAt: 'asc' } })
  const from = earliest ? earliest.createdAt.toISOString().slice(0, 10) : '2000-01-01'
  const to = new Date().toISOString().slice(0, 10)
  const rows = await getCompleteProductSales(db, from, to)
  return buildCompleteProductSalesCsv(rows, { fromDate: from, toDate: to, generatedAt: new Date() })
}
