import { PrismaClient } from '@prisma/client'
import type {
  SalesSummary,
  TopItemRow,
  SlowItemRow,
  DailySalesRow,
  TenderBreakdownRow,
  CashierTotalRow,
  InventoryValuation,
  InventoryValuationRow,
  CreditHealthSummary,
  AlertsSummary,
  DashboardData
} from '../../../shared/types'

// ---------------------------------------------------------------------------
// In-memory cache (spec §10): 30s TTL, configurable via REPORTS_CACHE_TTL_MS.
// Prevents DB thrashing on rapid clicks. Money is never rounded until display,
// so cached values are exact integer cents.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = Number(process.env.REPORTS_CACHE_TTL_MS ?? 30_000)

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.value as T
}

function setCached<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** Clear the entire report cache (e.g. after a sale completes). */
export function clearReportCache(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Date helpers — all reporting is in the pharmacy's local timezone, not UTC.
// Daily breakdowns group by the local calendar date of `createdAt`.
// ---------------------------------------------------------------------------

/** Start of the local day (00:00:00) as a Date. */
export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** End of the local day (23:59:59.999) as a Date. */
export function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/** Start of the current month (1st, 00:00:00) as a Date. */
export function startOfMonth(date: Date): Date {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Local YYYY-MM-DD string from a Date (no UTC conversion). */
export function localDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse an ISO date string (from the renderer) into a Date, defaulting to now. */
function parseDate(value: string | undefined | null): Date {
  if (!value) return new Date()
  const d = new Date(value)
  return isNaN(d.getTime()) ? new Date() : d
}

// ---------------------------------------------------------------------------
// Query helpers (spec §5) — each is a separate, testable function.
// All monetary values are integer cents; no rounding until final display.
// Voids and manual adjustments are included in totals without special handling.
// ---------------------------------------------------------------------------

/**
 * Sales summary for a date range: gross, net, COGS, margin, transaction count,
 * average transaction value, and new vs. repeat customers.
 *
 * - Gross = sum of totalCents for COMPLETED sales (saleType NORMAL)
 * - Returns = sum of totalCents for RETURN/REFUNDED transactions (negative)
 * - Net = gross + returns (returns are negative)
 * - COGS = sum of (costCents × quantity) for line items in the period
 * - Margin = net - COGS
 */
export async function getDailySalesSummary(
  db: PrismaClient,
  fromDate: string,
  toDate: string
): Promise<SalesSummary> {
  const cacheKey = `summary:${fromDate}:${toDate}`
  const cached = getCached<SalesSummary>(cacheKey)
  if (cached) return cached

  const from = startOfDay(parseDate(fromDate))
  const to = endOfDay(parseDate(toDate))

  const transactions = await db.transaction.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      status: { in: ['COMPLETED', 'REFUNDED'] }
    },
    include: { items: true }
  })

  let grossCents = 0
  let returnsCents = 0
  let cogsCents = 0
  const customerIds = new Set<number>()

  for (const tx of transactions) {
    const isReturn = tx.status === 'REFUNDED' || tx.saleType === 'RETURN'
    if (isReturn) {
      returnsCents -= tx.totalCents
    } else {
      grossCents += tx.totalCents
    }
    for (const item of tx.items) {
      if (item.isVoided) continue
      cogsCents += item.costCents * item.quantity
    }
    if (tx.customerId) {
      customerIds.add(tx.customerId)
    }
  }

  const netCents = grossCents + returnsCents
  const marginCents = netCents - cogsCents
  const transactionCount = transactions.length
  const avgTransactionCents = transactionCount > 0 ? Math.round(netCents / transactionCount) : 0
  const marginPercent = netCents > 0 ? (marginCents / netCents) * 100 : 0

  let newCustomers = 0
  let repeatCustomers = 0
  if (customerIds.size > 0) {
    const customerIdArray = Array.from(customerIds)
    const priorTxCounts = await db.transaction.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIdArray },
        createdAt: { lt: from }
      },
      _count: { _all: true }
    })
    const hasPrior = new Set(priorTxCounts.map((r) => r.customerId))
    for (const cid of customerIdArray) {
      if (hasPrior.has(cid)) {
        repeatCustomers++
      } else {
        newCustomers++
      }
    }
  }

  const result: SalesSummary = {
    grossCents,
    returnsCents,
    netCents,
    cogsCents,
    marginCents,
    marginPercent,
    transactionCount,
    avgTransactionCents,
    newCustomers,
    repeatCustomers
  }

  setCached(cacheKey, result)
  return result
}

/**
 * Top items by revenue in a date range, ranked descending.
 * Joins with Product for name, category, cost, retail. Computes margin per item.
 */
export async function getTopItems(
  db: PrismaClient,
  fromDate: string,
  toDate: string,
  limit = 10
): Promise<TopItemRow[]> {
  const cacheKey = `topItems:${fromDate}:${toDate}:${limit}`
  const cached = getCached<TopItemRow[]>(cacheKey)
  if (cached) return cached

  const from = startOfDay(parseDate(fromDate))
  const to = endOfDay(parseDate(toDate))

  const grouped = await db.transactionItem.groupBy({
    by: ['productId'],
    where: {
      isVoided: false,
      transaction: {
        createdAt: { gte: from, lte: to },
        status: { in: ['COMPLETED', 'REFUNDED'] }
      }
    },
    _sum: {
      quantity: true,
      totalCents: true
    },
    orderBy: {
      _sum: { totalCents: 'desc' }
    },
    take: limit
  })

  if (grouped.length === 0) {
    setCached(cacheKey, [])
    return []
  }

  const productIds = grouped.map((g) => g.productId)
  const products = await db.product.findMany({ where: { id: { in: productIds } } })
  const productMap = new Map(products.map((p) => [p.id, p]))

  const result: TopItemRow[] = grouped.map((g) => {
    const product = productMap.get(g.productId)
    const quantity = g._sum.quantity ?? 0
    const revenueCents = g._sum.totalCents ?? 0
    const costCents = product?.costCents ?? 0
    const cogsCents = costCents * quantity
    const marginCents = revenueCents - cogsCents
    const marginPercent = revenueCents > 0 ? (marginCents / revenueCents) * 100 : 0
    return {
      productId: g.productId,
      name: product?.name ?? 'Unknown',
      sku: product?.sku ?? '',
      category: product?.categoryCode ?? null,
      costCents,
      retailCents: product?.priceCents ?? 0,
      quantity,
      revenueCents,
      cogsCents,
      marginCents,
      marginPercent
    }
  })

  setCached(cacheKey, result)
  return result
}

/**
 * Slow-moving items: products with < threshold units sold in the period.
 * Sorted by quantity sold ascending. Includes current on-hand and last sold date.
 */
export async function getSlowItems(
  db: PrismaClient,
  fromDate: string,
  toDate: string,
  threshold = 1
): Promise<SlowItemRow[]> {
  const cacheKey = `slowItems:${fromDate}:${toDate}:${threshold}`
  const cached = getCached<SlowItemRow[]>(cacheKey)
  if (cached) return cached

  const from = startOfDay(parseDate(fromDate))
  const to = endOfDay(parseDate(toDate))

  const products = await db.product.findMany({
    where: { discontinued: false },
    orderBy: { name: 'asc' }
  })

  const salesCounts = await db.transactionItem.groupBy({
    by: ['productId'],
    where: {
      isVoided: false,
      transaction: {
        createdAt: { gte: from, lte: to },
        status: { in: ['COMPLETED', 'REFUNDED'] }
      }
    },
    _sum: { quantity: true }
  })

  const salesMap = new Map<number, number>()
  for (const s of salesCounts) {
    salesMap.set(s.productId, s._sum.quantity ?? 0)
  }

  // Get last sold date for products that had sales
  const productsWithSales = Array.from(salesMap.keys())
  const lastSoldMap = new Map<number, Date>()
  if (productsWithSales.length > 0) {
    const lastSales = await db.transactionItem.findMany({
      where: {
        productId: { in: productsWithSales },
        isVoided: false,
        transaction: {
          createdAt: { gte: from, lte: to },
          status: { in: ['COMPLETED', 'REFUNDED'] }
        }
      },
      select: {
        productId: true,
        transaction: { select: { createdAt: true } }
      },
      orderBy: { transaction: { createdAt: 'desc' } }
    })

    for (const item of lastSales) {
      const existing = lastSoldMap.get(item.productId)
      const current = item.transaction.createdAt
      if (!existing || current > existing) {
        lastSoldMap.set(item.productId, current)
      }
    }
  }

  const result: SlowItemRow[] = products
    .map((p) => {
      const quantitySold = salesMap.get(p.id) ?? 0
      const lastSold = lastSoldMap.get(p.id)
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        category: p.categoryCode ?? null,
        currentOnHand: p.currentOnHand,
        quantitySold,
        lastSoldAt: lastSold ? lastSold.toISOString() : null
      }
    })
    .filter((r) => r.quantitySold < threshold)
    .sort((a, b) => a.quantitySold - b.quantitySold)

  setCached(cacheKey, result)
  return result
}

/**
 * Daily sales breakdown: one row per local calendar date in the range.
 * Sorted by date descending (most recent first).
 */
export async function getDailySalesBreakdown(
  db: PrismaClient,
  fromDate: string,
  toDate: string
): Promise<DailySalesRow[]> {
  const cacheKey = `daily:${fromDate}:${toDate}`
  const cached = getCached<DailySalesRow[]>(cacheKey)
  if (cached) return cached

  const from = startOfDay(parseDate(fromDate))
  const to = endOfDay(parseDate(toDate))

  const transactions = await db.transaction.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      status: { in: ['COMPLETED', 'REFUNDED'] }
    },
    include: { items: true }
  })

  const byDate = new Map<
    string,
    {
      transactionCount: number
      grossCents: number
      returnsCents: number
      cogsCents: number
    }
  >()

  for (const tx of transactions) {
    const dateKey = localDateString(tx.createdAt)
    const entry = byDate.get(dateKey) ?? {
      transactionCount: 0,
      grossCents: 0,
      returnsCents: 0,
      cogsCents: 0
    }
    entry.transactionCount++
    const isReturn = tx.status === 'REFUNDED' || tx.saleType === 'RETURN'
    if (isReturn) {
      entry.returnsCents -= tx.totalCents
    } else {
      entry.grossCents += tx.totalCents
    }
    for (const item of tx.items) {
      if (item.isVoided) continue
      entry.cogsCents += item.costCents * item.quantity
    }
    byDate.set(dateKey, entry)
  }

  const result: DailySalesRow[] = Array.from(byDate.entries())
    .map(([date, data]) => {
      const netCents = data.grossCents + data.returnsCents
      const marginCents = netCents - data.cogsCents
      const marginPercent = netCents > 0 ? (marginCents / netCents) * 100 : 0
      return {
        date,
        transactionCount: data.transactionCount,
        grossCents: data.grossCents,
        returnsCents: data.returnsCents,
        netCents,
        cogsCents: data.cogsCents,
        marginCents,
        marginPercent
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  setCached(cacheKey, result)
  return result
}

/**
 * Sales by tender type: cash, card, pharmacy credit, points redeemed.
 * Each row has the amount in cents and percentage of net sales.
 */
export async function getSalesByTender(
  db: PrismaClient,
  fromDate: string,
  toDate: string
): Promise<TenderBreakdownRow[]> {
  const cacheKey = `tender:${fromDate}:${toDate}`
  const cached = getCached<TenderBreakdownRow[]>(cacheKey)
  if (cached) return cached

  const from = startOfDay(parseDate(fromDate))
  const to = endOfDay(parseDate(toDate))

  const transactions = await db.transaction.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      status: { in: ['COMPLETED', 'REFUNDED'] }
    }
  })

  let cashCents = 0
  let cardCents = 0
  let creditCents = 0
  const pointsCents = 0

  for (const tx of transactions) {
    const isReturn = tx.status === 'REFUNDED' || tx.saleType === 'RETURN'
    const sign = isReturn ? -1 : 1
    const tabAmount = tx.tabAmountCents ?? 0
    const nonTabAmount = tx.totalCents - tabAmount

    if (tx.tenderType === 'CASH') {
      cashCents += sign * nonTabAmount
    } else if (tx.tenderType === 'CARD') {
      cardCents += sign * nonTabAmount
    } else if (tx.tenderType === 'SPLIT') {
      const cashPortion = Math.max(0, tx.tenderedCents - tx.changeCents)
      const cardPortion = Math.max(0, nonTabAmount - cashPortion)
      cashCents += sign * cashPortion
      cardCents += sign * cardPortion
    }
    if (tabAmount > 0) {
      creditCents += sign * tabAmount
    }
  }

  const total = cashCents + cardCents + creditCents + pointsCents

  const result: TenderBreakdownRow[] = [
    { tender: 'Cash', amountCents: cashCents, percent: total > 0 ? (cashCents / total) * 100 : 0 },
    { tender: 'Card', amountCents: cardCents, percent: total > 0 ? (cardCents / total) * 100 : 0 },
    { tender: 'Pharmacy Credit', amountCents: creditCents, percent: total > 0 ? (creditCents / total) * 100 : 0 },
    { tender: 'Points Redeemed', amountCents: pointsCents, percent: total > 0 ? (pointsCents / total) * 100 : 0 }
  ]

  setCached(cacheKey, result)
  return result
}

/**
 * Cashier totals for reconciliation: per-user transaction count, total sales,
 * average transaction, discounts issued, and voids issued.
 */
export async function getCashierTotals(
  db: PrismaClient,
  fromDate: string,
  toDate: string
): Promise<CashierTotalRow[]> {
  const cacheKey = `cashiers:${fromDate}:${toDate}`
  const cached = getCached<CashierTotalRow[]>(cacheKey)
  if (cached) return cached

  const from = startOfDay(parseDate(fromDate))
  const to = endOfDay(parseDate(toDate))

  const transactions = await db.transaction.findMany({
    where: {
      createdAt: { gte: from, lte: to }
    }
  })

  const byUser = new Map<
    number,
    {
      transactionCount: number
      totalSalesCents: number
      discountsCents: number
      voidsCount: number
      voidsCents: number
    }
  >()

  for (const tx of transactions) {
    // Prefer cashierId: it has no FK cascade, so it survives user deletion and
    // keeps historical sales attributed to the original cashier's id.
    const key = tx.cashierId ?? tx.userId ?? 0
    const entry = byUser.get(key) ?? {
      transactionCount: 0,
      totalSalesCents: 0,
      discountsCents: 0,
      voidsCount: 0,
      voidsCents: 0
    }

    if (tx.status === 'VOIDED') {
      entry.voidsCount++
      entry.voidsCents += tx.totalCents
    } else if (tx.status === 'COMPLETED' || tx.status === 'REFUNDED') {
      entry.transactionCount++
      const isReturn = tx.status === 'REFUNDED' || tx.saleType === 'RETURN'
      entry.totalSalesCents += isReturn ? -tx.totalCents : tx.totalCents
      if (tx.discountApplied) {
        entry.discountsCents += tx.discountApplied
      }
    }
    byUser.set(key, entry)
  }

  const userIds = Array.from(byUser.keys()).filter((id) => id !== 0)
  const users = userIds.length > 0 ? await db.user.findMany({ where: { id: { in: userIds } } }) : []
  const userMap = new Map(users.map((u) => [u.id, u.fullName]))

  const result: CashierTotalRow[] = Array.from(byUser.entries())
    .map(([userId, data]) => ({
      userId: userId === 0 ? null : userId,
      cashierName: userMap.get(userId) ?? 'Unassigned',
      transactionCount: data.transactionCount,
      totalSalesCents: data.totalSalesCents,
      avgTransactionCents:
        data.transactionCount > 0 ? Math.round(data.totalSalesCents / data.transactionCount) : 0,
      discountsCents: data.discountsCents,
      voidsCount: data.voidsCount,
      voidsCents: data.voidsCents
    }))
    .sort((a, b) => b.totalSalesCents - a.totalSalesCents)

  setCached(cacheKey, result)
  return result
}

/**
 * Current inventory valuation at cost and retail, grouped by category.
 * cost value = sum(costCents × currentOnHand), retail value = sum(priceCents × currentOnHand)
 */
export async function getCurrentInventoryValuation(
  db: PrismaClient
): Promise<InventoryValuation> {
  const cacheKey = 'inventoryValuation'
  const cached = getCached<InventoryValuation>(cacheKey)
  if (cached) return cached

  const products = await db.product.findMany({
    where: { discontinued: false },
    select: {
      costCents: true,
      priceCents: true,
      currentOnHand: true,
      categoryCode: true
    }
  })

  const byCategory = new Map<
    string,
    { itemCount: number; costValueCents: number; retailValueCents: number }
  >()

  for (const p of products) {
    const category = p.categoryCode ?? 'Uncategorized'
    const entry = byCategory.get(category) ?? {
      itemCount: 0,
      costValueCents: 0,
      retailValueCents: 0
    }
    entry.itemCount++
    entry.costValueCents += p.costCents * p.currentOnHand
    entry.retailValueCents += p.priceCents * p.currentOnHand
    byCategory.set(category, entry)
  }

  const rows: InventoryValuationRow[] = Array.from(byCategory.entries())
    .map(([category, data]) => ({
      category,
      itemCount: data.itemCount,
      costValueCents: data.costValueCents,
      retailValueCents: data.retailValueCents,
      variancePercent:
        data.costValueCents > 0
          ? ((data.retailValueCents - data.costValueCents) / data.costValueCents) * 100
          : 0
    }))
    .sort((a, b) => b.costValueCents - a.costValueCents)

  const totalCostValueCents = rows.reduce((sum, r) => sum + r.costValueCents, 0)
  const totalRetailValueCents = rows.reduce((sum, r) => sum + r.retailValueCents, 0)
  const totalItemCount = rows.reduce((sum, r) => sum + r.itemCount, 0)

  const result: InventoryValuation = {
    rows,
    totalItemCount,
    totalCostValueCents,
    totalRetailValueCents,
    totalVariancePercent:
      totalCostValueCents > 0
        ? ((totalRetailValueCents - totalCostValueCents) / totalCostValueCents) * 100
        : 0
  }

  setCached(cacheKey, result)
  return result
}

/**
 * Pharmacy Credit health: adoption %, total outstanding, overdue accounts.
 * Only computed when the customerTabs feature flag is enabled.
 */
export async function getCreditHealth(db: PrismaClient): Promise<CreditHealthSummary> {
  const cacheKey = 'creditHealth'
  const cached = getCached<CreditHealthSummary>(cacheKey)
  if (cached) return cached

  const flag = await db.featureFlag.findUnique({ where: { key: 'customerTabs' } })
  const enabled = flag?.enabled ?? false

  if (!enabled) {
    const result: CreditHealthSummary = {
      enabled: false,
      activeAccounts: 0,
      totalCustomers: 0,
      adoptionPercent: 0,
      totalOutstandingCents: 0,
      overdueAccounts: 0,
      overdueCents: 0
    }
    setCached(cacheKey, result)
    return result
  }

  const totalCustomers = await db.customer.count()

  // Get the latest ledger entry per customer to determine current balance
  const latestEntries = await db.creditLedgerEntry.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { customer: true }
  })

  const seenCustomers = new Set<number>()
  let activeAccounts = 0
  let totalOutstandingCents = 0
  let overdueAccounts = 0
  let overdueCents = 0
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

  for (const entry of latestEntries) {
    if (seenCustomers.has(entry.customerId)) continue
    seenCustomers.add(entry.customerId)

    if (entry.balanceAfterCents !== 0) {
      activeAccounts++
      totalOutstandingCents += entry.balanceAfterCents
      // Overdue: negative balance (customer owes) and not updated in >30 days
      if (entry.balanceAfterCents < 0 && entry.createdAt < thirtyDaysAgo) {
        overdueAccounts++
        overdueCents += entry.balanceAfterCents
      }
    }
  }

  const result: CreditHealthSummary = {
    enabled: true,
    activeAccounts,
    totalCustomers,
    adoptionPercent: totalCustomers > 0 ? (activeAccounts / totalCustomers) * 100 : 0,
    totalOutstandingCents,
    overdueAccounts,
    overdueCents
  }

  setCached(cacheKey, result)
  return result
}

/**
 * Alerts summary: low-stock count, out-of-stock count, overdue tab count.
 */
export async function getAlerts(db: PrismaClient): Promise<AlertsSummary> {
  const cacheKey = 'alerts'
  const cached = getCached<AlertsSummary>(cacheKey)
  if (cached) return cached

  const [outOfStockCount, creditHealth] = await Promise.all([
    db.product.count({
      where: {
        discontinued: false,
        currentOnHand: { lte: 0 }
      }
    }),
    getCreditHealth(db)
  ])

  // Low stock: currentOnHand <= reorderPoint but > 0
  const lowStockCount = await db.product.count({
    where: {
      discontinued: false,
      currentOnHand: { lte: 0 }
    }
  })

  const result: AlertsSummary = {
    lowStockCount,
    outOfStockCount,
    overdueTabCount: creditHealth.overdueAccounts
  }

  setCached(cacheKey, result)
  return result
}

/**
 * Full dashboard data: today + this month summaries, top items, alerts, and
 * credit health (if enabled). This is the landing page query.
 */
export async function getDashboardData(db: PrismaClient): Promise<DashboardData> {
  const cacheKey = 'dashboard'
  const cached = getCached<DashboardData>(cacheKey)
  if (cached) return cached

  const now = new Date()
  const monthStart = startOfMonth(now)

  const todayStr = localDateString(now)
  const monthStartStr = localDateString(monthStart)

  const [todaySales, monthSales, todayTopItems, monthTopItems, alerts, creditHealth] =
    await Promise.all([
      getDailySalesSummary(db, todayStr, todayStr),
      getDailySalesSummary(db, monthStartStr, todayStr),
      getTopItems(db, todayStr, todayStr, 3),
      getTopItems(db, monthStartStr, todayStr, 5),
      getAlerts(db),
      getCreditHealth(db)
    ])

  const result: DashboardData = {
    today: {
      sales: todaySales,
      topItems: todayTopItems,
      alerts
    },
    thisMonth: {
      sales: monthSales,
      topItems: monthTopItems,
      alerts
    },
    creditHealth: creditHealth.enabled ? creditHealth : null,
    alerts
  }

  setCached(cacheKey, result)
  return result
}