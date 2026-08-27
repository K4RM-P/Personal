import { Prisma, PrismaClient, Product, Transaction } from '@prisma/client'
import {
  calculateRetailPriceCents,
  findPricingTier,
  previewTierChangeImpact,
  PricingTier as EnginePricingTier,
  TierChangePreviewItem
} from '../../../shared/pricingEngine'
import {
  CreateTransactionPayload,
  BulkImportProductInput,
  TransactionWithItems
} from '../../../shared/types'
import {
  customerLedgerInternals,
  getCreditSettings,
  getCustomerDebtBreakdown
} from './customerQueries'
import { getCardSurchargePercent } from './settingsQueries'
import { getSession } from '../../auth/session'
import { gtinNorm } from '../../catalog/webcatParser'

// Product Queries
/**
 * Manually-added products only — this backs the "Custom Products" panel, which
 * is explicitly scoped to products the pharmacy entered by hand, separate from
 * the (potentially 50k+ row) McKesson catalogue-origin products in this same
 * table. Fetching unfiltered here previously loaded every catalogue-promoted
 * product too, freezing the Products screen once any catalogue items had been
 * promoted into inventory.
 */
export async function getAllProducts(db: PrismaClient): Promise<Product[]> {
  return db.product.findMany({
    where: { origin: 'MANUAL', excludeFromCatalog: false },
    orderBy: { name: 'asc' }
  })
}

/**
 * Server-side product search. With 50k+ products, the renderer must never load
 * the whole table: it searches here and receives only the matches (capped).
 * An empty query returns pinned items first, then alphabetical — a sensible
 * default grid without shipping everything over IPC.
 */
export async function searchProducts(
  db: PrismaClient,
  query: string,
  limit = 50
): Promise<Product[]> {
  const q = query.trim()
  if (!q) {
    return db.product.findMany({
      orderBy: [{ isPinned: 'desc' }, { name: 'asc' }],
      take: limit
    })
  }
  // Stored barcodes are GTINs with leading zeros stripped (see gtinNorm), so a
  // printed 12/13-digit UPC ("012345678905") must be normalized the same way to
  // match the stored value ("12345678905").
  const queryDigits = q.replace(/\D/g, '').replace(/^0+/, '')
  return db.product.findMany({
    where: {
      OR: [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } },
        ...(queryDigits ? [{ barcode: { contains: queryDigits } }] : [])
      ]
    },
    orderBy: { name: 'asc' },
    take: limit
  })
}

/**
 * Compute the impact of a proposed tier table entirely in the main process,
 * returning only a count plus a bounded sample. This keeps 50k product rows off
 * the IPC boundary and out of the renderer.
 */
export async function previewTierImpact(
  db: PrismaClient,
  newTiers: EnginePricingTier[],
  sampleSize = 200
): Promise<{ affectedCount: number; sample: TierChangePreviewItem[] }> {
  const products = await db.product.findMany({
    select: { id: true, sku: true, name: true, costCents: true, priceCents: true }
  })
  const impact = previewTierChangeImpact(products, newTiers)
  return { affectedCount: impact.length, sample: impact.slice(0, sampleSize) }
}

export async function getProductByBarcode(
  db: PrismaClient,
  barcode: string
): Promise<Product | null> {
  // Catalogue-promoted products store `barcode` leading-zero-stripped (see
  // catalog/webcatParser.ts gtinNorm, used consistently at promote-time). A scanner
  // emitting the same item as a longer code with a leading-zero padding convention
  // (e.g. a UPC-A read out as its 13-digit EAN-13 form) would otherwise never match —
  // normalize the scanned value the same way and match against that too, alongside
  // the plain exact match (which still covers manually-entered barcodes/SKUs as-is).
  const normalized = gtinNorm(barcode)
  return db.product.findFirst({
    where: {
      OR: [
        { barcode: barcode },
        { sku: barcode },
        ...(normalized && normalized !== barcode ? [{ barcode: normalized }] : [])
      ]
    }
  })
}

export async function createProduct(
  db: PrismaClient,
  data: {
    sku: string
    name: string
    costCents: number
    priceCents?: number
    barcode?: string
    isPinned?: boolean
    excludeFromCatalog?: boolean
  }
): Promise<Product> {
  let priceCents = data.priceCents

  if (!data.isPinned && priceCents === undefined) {
    const tiers = await getAllPricingTiers(db)
    priceCents = calculateRetailPriceCents(data.costCents, tiers)
  } else if (priceCents === undefined) {
    priceCents = data.costCents
  }

  return db.product.create({
    data: {
      sku: data.sku,
      name: data.name,
      costCents: data.costCents,
      priceCents,
      barcode: data.barcode || null,
      isPinned: data.isPinned || false,
      excludeFromCatalog: data.excludeFromCatalog || false
    }
  })
}

export async function updateProduct(
  db: PrismaClient,
  id: number,
  data: {
    sku?: string
    name?: string
    costCents?: number
    priceCents?: number
    barcode?: string
    isPinned?: boolean
  }
): Promise<Product> {
  const existing = await db.product.findUniqueOrThrow({ where: { id } })

  const costCents = data.costCents !== undefined ? data.costCents : existing.costCents
  const isPinned = data.isPinned !== undefined ? data.isPinned : existing.isPinned
  let priceCents = data.priceCents

  // Recalculate price on cost change if not pinned and price not explicitly overridden
  if (costCents !== existing.costCents && !isPinned && priceCents === undefined) {
    const tiers = await getAllPricingTiers(db)
    priceCents = calculateRetailPriceCents(costCents, tiers)
  } else if (priceCents === undefined) {
    priceCents = existing.priceCents
  }

  return db.product.update({
    where: { id },
    data: {
      ...(data.sku && { sku: data.sku }),
      ...(data.name && { name: data.name }),
      costCents,
      priceCents,
      ...(data.barcode !== undefined && { barcode: data.barcode || null }),
      isPinned
    }
  })
}

export async function deleteProduct(db: PrismaClient, id: number): Promise<Product> {
  return db.product.delete({ where: { id } })
}

export async function bulkImportProducts(
  db: PrismaClient,
  inputs: BulkImportProductInput[]
): Promise<{ count: number }> {
  const tiers = await getAllPricingTiers(db)
  let count = 0

  for (const item of inputs) {
    const isPinned = item.isPinned || false
    let priceCents = item.priceCents
    if (!isPinned && priceCents === undefined) {
      priceCents = calculateRetailPriceCents(item.costCents, tiers)
    } else if (priceCents === undefined) {
      priceCents = item.costCents
    }

    await db.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        costCents: item.costCents,
        priceCents,
        barcode: item.barcode || null,
        isPinned
      },
      create: {
        sku: item.sku,
        name: item.name,
        costCents: item.costCents,
        priceCents,
        barcode: item.barcode || null,
        isPinned
      }
    })
    count++
  }

  return { count }
}

// Pricing Tier Queries
export async function getAllPricingTiers(db: PrismaClient): Promise<EnginePricingTier[]> {
  const dbTiers = await db.pricingTier.findMany({
    orderBy: { orderIndex: 'asc' }
  })
  return dbTiers.map((t) => ({
    id: t.id,
    minCostCents: t.minCostCents,
    maxCostCents: t.maxCostCents,
    markupPercent: t.markupPercent
  }))
}

export async function saveAllPricingTiers(
  db: PrismaClient,
  tiers: EnginePricingTier[]
): Promise<EnginePricingTier[]> {
  // Clear and rewrite tiers
  await db.pricingTier.deleteMany()

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]
    await db.pricingTier.create({
      data: {
        id: t.id,
        minCostCents: t.minCostCents,
        maxCostCents: t.maxCostCents,
        markupPercent: t.markupPercent,
        orderIndex: i
      }
    })
  }

  // Recalculate prices for non-pinned products, plus catalogue items that were
  // pinned only because no tier matched their cost at promote time (fallbackPinned) —
  // those should re-enter the tier engine the moment a matching tier exists.
  const products = await db.product.findMany({
    where: { OR: [{ isPinned: false }, { fallbackPinned: true }] },
    select: { id: true, costCents: true, priceCents: true, fallbackPinned: true }
  })

  // With 50k+ catalogue products, most are unpinned, so a tier save previously
  // issued one `db.product.update()` per affected product sequentially — up
  // to tens of thousands of individual round trips per save. Products that
  // land on the same recalculated price (the overwhelming majority, since a
  // handful of tiers apply to a huge cost range each) are now updated in one
  // batched `updateMany` per distinct target price instead.
  const releaseFallback = new Map<number, number[]>() // newPriceCents -> product ids
  const repriceOnly = new Map<number, number[]>()

  for (const p of products) {
    if (p.fallbackPinned) {
      const tierNowMatches = findPricingTier(p.costCents, tiers) !== undefined
      if (!tierNowMatches) continue // still nothing to compute from — stays pinned to McKesson list price
      const newPriceCents = calculateRetailPriceCents(p.costCents, tiers)
      const ids = releaseFallback.get(newPriceCents) ?? []
      ids.push(p.id)
      releaseFallback.set(newPriceCents, ids)
      continue
    }

    const newPriceCents = calculateRetailPriceCents(p.costCents, tiers)
    if (newPriceCents !== p.priceCents) {
      const ids = repriceOnly.get(newPriceCents) ?? []
      ids.push(p.id)
      repriceOnly.set(newPriceCents, ids)
    }
  }

  await Promise.all([
    ...Array.from(repriceOnly.entries()).map(([priceCents, ids]) =>
      db.product.updateMany({ where: { id: { in: ids } }, data: { priceCents } })
    ),
    ...Array.from(releaseFallback.entries()).map(([priceCents, ids]) =>
      db.product.updateMany({
        where: { id: { in: ids } },
        data: { priceCents, isPinned: false, fallbackPinned: false }
      })
    )
  ])

  return getAllPricingTiers(db)
}

/**
 * Read-only fetch of a single past transaction's product line items, for the debt
 * breakdown's [View] action and the cart's [Details] action on a brought-in-balance
 * line — deliberately not the refund system's getSaleDetailsForRefund, which carries
 * refund-specific fields (refunds, refundedCents, refundableCents) this view has no
 * use for.
 */
export async function getTransactionDetail(
  db: PrismaClient,
  transactionId: string
): Promise<TransactionWithItems> {
  return db.transaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: {
      items: { include: { product: true } },
      tenders: { orderBy: { sequence: 'asc' } },
      customer: true,
      user: { select: { id: true, fullName: true, role: true } }
    }
  })
}

/**
 * Receipt number format: YYYYMM followed by a 5-digit counter that resets
 * each calendar month (local time) — e.g. the first sale of August 2026 is
 * `20260800001`. The counter is stored in `ReceiptSequence`, keyed by
 * "YYYYMM", and incremented via `upsert` inside the same DB transaction that
 * creates the sale, so two concurrent checkouts can never collide.
 */
export async function generateReceiptNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date()
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const sequence = await tx.receiptSequence.upsert({
    where: { yearMonth },
    create: { yearMonth, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } }
  })
  return `${yearMonth}${String(sequence.lastNumber).padStart(5, '0')}`
}

// Transaction & Checkout Queries
export async function createTransaction(
  db: PrismaClient,
  payload: CreateTransactionPayload
): Promise<TransactionWithItems> {
  const rawSubtotalCents = payload.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  )

  // Item discounts reduce the subtotal directly; the whole-bill discount then
  // reduces that further before tax is computed — tax is never charged on a
  // discounted amount that was given back to the customer.
  let itemDiscountTotal = 0
  for (const item of payload.items) {
    const discountCents = item.discountCents ?? 0
    const lineRawCents = item.unitPriceCents * item.quantity
    if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > lineRawCents) {
      throw new Error('Item discount cannot exceed the line total.')
    }
    itemDiscountTotal += discountCents
  }
  const subtotalCents = rawSubtotalCents - itemDiscountTotal

  const billDiscountCents = payload.billDiscountCents ?? 0
  if (
    !Number.isInteger(billDiscountCents) ||
    billDiscountCents < 0 ||
    billDiscountCents > subtotalCents
  ) {
    throw new Error('Whole-bill discount cannot exceed the subtotal.')
  }
  const preTaxCents = subtotalCents - billDiscountCents

  // Only items with HST applied contribute to the taxable amount; the whole-bill
  // discount is spread proportionally across taxable vs. non-taxable lines.
  const taxableSubtotalCents = payload.items.reduce((sum, item) => {
    if (item.hstApplied === false) return sum
    const discountCents = item.discountCents ?? 0
    return sum + (item.unitPriceCents * item.quantity - discountCents)
  }, 0)
  const taxableAfterBillDiscountCents =
    subtotalCents > 0
      ? taxableSubtotalCents - (billDiscountCents * taxableSubtotalCents) / subtotalCents
      : 0
  const taxCents = Math.round((taxableAfterBillDiscountCents * payload.taxRatePercent) / 100)
  const sessionUserId = getSession()?.userId ?? null
  const debtSettlementLedgerEntryIds = payload.debtSettlementLedgerEntryIds ?? []

  // Resolve the selected entries against a fresh breakdown up front so totalCents
  // (needed for every downstream validation below) reflects the real, current
  // contribution of exactly what the cashier picked — never a client-supplied amount.
  let debtSettlementCents = 0
  let debtSettlementNote: string | null = null
  if (debtSettlementLedgerEntryIds.length > 0) {
    if (!payload.customerId)
      throw new Error('A customer must be linked to bring in an outstanding balance.')
    const breakdown = await getCustomerDebtBreakdown(db, payload.customerId)
    const selected = debtSettlementLedgerEntryIds.map((id) => {
      const entry = breakdown.entries.find((e) => e.ledgerEntryId === id)
      if (!entry) {
        throw new Error(
          'One or more selected balance items are no longer outstanding — reopen the balance breakdown.'
        )
      }
      return entry
    })
    debtSettlementCents = selected.reduce((sum, e) => sum + e.amountCents, 0)
    const covered = selected.map((entry) => {
      const label =
        entry.type === 'SALE_CHARGE' ? `sale ${entry.receiptNumber}` : 'a manual adjustment'
      return `${label} (${(entry.amountCents / 100).toFixed(2)})`
    })
    debtSettlementNote = `Debt settled via this sale — covers ${covered.join(', ')}`
  }
  const tenders = payload.tenders ?? []
  // A genuine $0 sale (fully-discounted or free item(s)) needs no tender line at
  // all — surcharge never applies with no tenders, so this total is already final.
  const preliminaryTotalCents = preTaxCents + taxCents + debtSettlementCents
  if (tenders.length === 0 && preliminaryTotalCents > 0) {
    throw new Error('At least one tender line is required.')
  }

  // Every CARD line's surcharge is validated (and totalled) independently — the
  // surcharge inflates the sale total itself, so it must be known before the
  // sum(tenders) === totalCents check below can mean anything.
  const surchargePercent = await getCardSurchargePercent(db)
  let totalSurchargeCents = 0
  for (const t of tenders) {
    if (!Number.isInteger(t.amountCents) || t.amountCents <= 0) {
      throw new Error('Every tender line must have a positive whole-cent amount.')
    }
    if (t.method === 'CARD') {
      const lineSurchargeCents = t.surchargeCents ?? 0
      if (lineSurchargeCents > 0) {
        const baseCents = t.amountCents - lineSurchargeCents
        const expectedSurchargeCents = Math.floor((baseCents * surchargePercent) / 100)
        if (baseCents <= 0 || lineSurchargeCents !== expectedSurchargeCents) {
          throw new Error('Card surcharge does not match the configured rate.')
        }
      }
      if (!t.processorTransactionId) {
        throw new Error(
          'A card tender line must have a processor transaction id — it must be charged before being added.'
        )
      }
      totalSurchargeCents += lineSurchargeCents
    } else if (t.surchargeCents) {
      throw new Error('Surcharge can only be applied to a card tender line.')
    }
    if (t.method === 'E_TRANSFER' && !t.eTransferConfirmed) {
      throw new Error('An e-transfer tender line must be confirmed before being added.')
    }
    if (t.method === 'CASH') {
      const cashGivenCents = t.cashGivenCents ?? t.amountCents
      if (!Number.isInteger(cashGivenCents) || cashGivenCents < t.amountCents) {
        throw new Error('Cash given cannot be less than the amount applied to the bill.')
      }
      const overageCents = cashGivenCents - t.amountCents
      const changeCents = t.changeCents ?? (t.depositedToTabCents ? 0 : overageCents)
      const depositedToTabCents = t.depositedToTabCents ?? 0
      if (changeCents + depositedToTabCents !== overageCents) {
        throw new Error('Cash change and tab deposit must together equal the overage.')
      }
      if (depositedToTabCents > 0 && !payload.customerId) {
        throw new Error('Attach a customer before depositing cash to Pharmacy Credit.')
      }
    } else if (t.cashGivenCents != null || t.changeCents != null || t.depositedToTabCents != null) {
      throw new Error('Cash-specific fields can only be set on a cash tender line.')
    }
    if (t.method === 'PHARMACY_CREDIT' && !payload.customerId) {
      throw new Error('Attach a customer before using Pharmacy Credit.')
    }
  }

  const totalCents = preTaxCents + taxCents + debtSettlementCents + totalSurchargeCents
  const tabAmountCents = tenders
    .filter((t) => t.method === 'PHARMACY_CREDIT')
    .reduce((sum, t) => sum + t.amountCents, 0)

  // Paying off tab debt by charging it back to the same tab is circular — block it
  // outright rather than trusting the renderer to have hidden the option. Checked
  // before the sum-equality check below so this specific reason always wins over a
  // generic "doesn't add up" error, regardless of what amount was on the line.
  if (debtSettlementCents > 0) {
    if (!payload.customerId)
      throw new Error('A customer must be linked to bring in an outstanding balance.')
    if (tabAmountCents > 0) {
      throw new Error(
        'Cannot use Pharmacy Credit to pay off an outstanding balance — choose another payment method.'
      )
    }
  }

  const appliedCents = tenders.reduce((sum, t) => sum + t.amountCents, 0)
  if (appliedCents !== totalCents) {
    throw new Error(
      `Tender lines total ${(appliedCents / 100).toFixed(2)} but the sale total is ${(totalCents / 100).toFixed(2)} — every cent must be covered before completing the sale.`
    )
  }

  const tenderType =
    tenders.length === 0 ? 'NONE' : tenders.length === 1 ? tenders[0].method : 'SPLIT'
  const tenderedCents = tenders.reduce(
    (sum, t) => sum + (t.method === 'CASH' ? (t.cashGivenCents ?? t.amountCents) : t.amountCents),
    0
  )
  const changeCents = tenders
    .filter((t) => t.method === 'CASH')
    .reduce((sum, t) => sum + (t.changeCents ?? 0), 0)
  const lastCardTender = [...tenders].reverse().find((t) => t.method === 'CARD')
  const firstETransferTender = tenders.find((t) => t.method === 'E_TRANSFER')

  return db.$transaction(async (tx) => {
    if (payload.customerId) {
      await tx.customer.findUniqueOrThrow({ where: { id: payload.customerId } })
    }

    const receiptNumber = await generateReceiptNumber(tx)

    const transaction = await tx.transaction.create({
      data: {
        receiptNumber,
        status: payload.status || 'COMPLETED',
        subtotalCents,
        taxCents,
        totalCents,
        tenderType,
        tenderedCents,
        changeCents,
        customerId: payload.customerId || null,
        tabAmountCents,
        surchargeCents: totalSurchargeCents,
        billDiscountCents,
        discountApplied: itemDiscountTotal + billDiscountCents,
        processorTransactionId: lastCardTender?.processorTransactionId || null,
        cardLast4: lastCardTender?.cardLastFour || null,
        email: payload.email || firstETransferTender?.eTransferEmail || null,
        // Audit: attribute the sale to the signed-in cashier (server session,
        // not renderer-supplied). Null in tests / when no session is active.
        userId: sessionUserId,
        cashierId: sessionUserId
      },
      include: { customer: true }
    })

    let cashOverageToCreditCents = 0
    for (const [index, t] of tenders.entries()) {
      const depositedToTabCents = t.method === 'CASH' ? (t.depositedToTabCents ?? 0) : null
      if (depositedToTabCents) cashOverageToCreditCents += depositedToTabCents

      let creditLedgerEntryId: number | null = null
      if (t.method === 'PHARMACY_CREDIT') {
        const entry = await customerLedgerInternals.appendCreditEntry(
          tx,
          payload.customerId!,
          'SALE_CHARGE',
          -t.amountCents,
          { transactionId: transaction.id }
        )
        creditLedgerEntryId = entry.id
      }

      await tx.transactionTender.create({
        data: {
          transactionId: transaction.id,
          sequence: index + 1,
          method: t.method,
          amountCents: t.amountCents,
          cashGivenCents: t.method === 'CASH' ? (t.cashGivenCents ?? t.amountCents) : null,
          changeCents: t.method === 'CASH' ? (t.changeCents ?? 0) : null,
          depositedToTabCents,
          cardType: t.method === 'CARD' ? (t.cardType ?? null) : null,
          surchargeCents: t.method === 'CARD' ? (t.surchargeCents ?? 0) : null,
          processorTransactionId: t.processorTransactionId ?? null,
          cardLastFour: t.cardLastFour ?? null,
          eTransferEmail: t.method === 'E_TRANSFER' ? (t.eTransferEmail ?? null) : null,
          eTransferConfirmed: t.method === 'E_TRANSFER' ? (t.eTransferConfirmed ?? false) : null,
          customerId: t.method === 'PHARMACY_CREDIT' ? (payload.customerId ?? null) : null,
          creditLedgerEntryId,
          status: 'COMPLETED',
          completedAt: new Date()
        }
      })
    }

    // Created one at a time (rather than a nested `items: { create: [...] }`)
    // so each item's discount audit row can link back to its real id and
    // reason — a batch create's returned order isn't a safe key for that.
    const items: TransactionWithItems['items'] = []
    for (const item of payload.items) {
      const discountCents = item.discountCents ?? 0
      const lineRawCents = item.unitPriceCents * item.quantity
      const created = await tx.transactionItem.create({
        data: {
          transactionId: transaction.id,
          productId: item.productId,
          quantity: item.quantity,
          costCents: item.costCents,
          unitPriceCents: item.unitPriceCents,
          discountCents,
          totalCents: lineRawCents - discountCents,
          hstApplied: item.hstApplied !== false
        },
        include: { product: true }
      })
      items.push(created)

      if (discountCents > 0) {
        await tx.discount.create({
          data: {
            transactionId: transaction.id,
            type: 'ITEM',
            itemId: created.id,
            amountCents: -discountCents,
            originalCents: lineRawCents,
            finalCents: lineRawCents - discountCents,
            reason: item.discountReason?.trim() || null,
            appliedByUserId: sessionUserId
          }
        })
      }
    }

    if (billDiscountCents > 0) {
      await tx.discount.create({
        data: {
          transactionId: transaction.id,
          type: 'BILL',
          amountCents: -billDiscountCents,
          originalCents: subtotalCents,
          finalCents: subtotalCents - billDiscountCents,
          reason: payload.billDiscountReason?.trim() || null,
          appliedByUserId: sessionUserId
        }
      })
    }

    if (debtSettlementCents > 0 && payload.customerId) {
      // Re-validate against a fresh balance read — the balance shown when the cashier
      // added this line could have changed since (e.g. a manual adjustment on another
      // terminal). Failure here rolls back the whole transaction: nothing is written.
      const latestEntry = await tx.creditLedgerEntry.findFirst({
        where: { customerId: payload.customerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
      const currentOutstandingCents =
        (latestEntry?.balanceAfterCents ?? 0) < 0 ? -(latestEntry?.balanceAfterCents ?? 0) : 0
      if (debtSettlementCents > currentOutstandingCents) {
        throw new Error(
          'Outstanding balance changed and no longer covers this amount — reopen the balance breakdown.'
        )
      }

      const debtItem = await tx.transactionItem.create({
        data: {
          transactionId: transaction.id,
          productId: null,
          lineType: 'DEBT_SETTLEMENT',
          quantity: 1,
          costCents: 0,
          unitPriceCents: debtSettlementCents,
          discountCents: 0,
          totalCents: debtSettlementCents,
          hstApplied: false
        }
      })
      items.push({ ...debtItem, product: null })

      await customerLedgerInternals.appendCreditEntry(
        tx,
        payload.customerId,
        'DEBT_SETTLED',
        debtSettlementCents,
        {
          transactionId: transaction.id,
          note: debtSettlementNote ?? undefined
        }
      )
    }

    if (payload.customerId) {
      const loyaltyFlag = await tx.featureFlag.findUnique({ where: { key: 'rewardPoints' } })
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: payload.customerId } })
      if (loyaltyFlag?.enabled && customer.loyaltyEnabled) {
        const creditSettings = await getCreditSettings(tx)
        const points = Math.floor((totalCents / 100) * creditSettings.loyaltyPointsPerDollar)
        if (points > 0)
          await customerLedgerInternals.appendPointEvent(tx, customer.id, 'EARNED', points, {
            transactionId: transaction.id
          })
      }
    }

    if (cashOverageToCreditCents > 0 && payload.customerId) {
      await customerLedgerInternals.appendCreditEntry(
        tx,
        payload.customerId,
        'FUNDS_ADDED',
        cashOverageToCreditCents,
        {
          transactionId: transaction.id,
          note: `Cash overpayment deposited from ${transaction.receiptNumber}`
        }
      )
    }

    const createdTenders = await tx.transactionTender.findMany({
      where: { transactionId: transaction.id },
      orderBy: { sequence: 'asc' }
    })

    return { ...transaction, items, tenders: createdTenders }
  })
}

export async function voidTransaction(
  db: PrismaClient,
  id: string,
  reason: string
): Promise<Transaction> {
  return db.transaction.update({
    where: { id },
    data: {
      status: 'VOIDED',
      voidReason: reason,
      voidedByUserId: getSession()?.userId ?? null
    }
  })
}
