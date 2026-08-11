import { PrismaClient, Product, Transaction } from '@prisma/client'
import {
  calculateRetailPriceCents,
  previewTierChangeImpact,
  PricingTier as EnginePricingTier,
  TierChangePreviewItem
} from '../../../shared/pricingEngine'
import { CreateTransactionPayload, BulkImportProductInput, TransactionWithItems } from '../../../shared/types'
import { customerLedgerInternals, getCreditSettings } from './customerQueries'
import { getCardSurchargePercent } from './settingsQueries'
import { getSession } from '../../auth/session'

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
    where: { origin: 'MANUAL' },
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

export async function getProductByBarcode(db: PrismaClient, barcode: string): Promise<Product | null> {
  return db.product.findFirst({
    where: {
      OR: [{ barcode: barcode }, { sku: barcode }]
    }
  })
}

export async function createProduct(
  db: PrismaClient,
  data: { sku: string; name: string; costCents: number; priceCents?: number; barcode?: string; isPinned?: boolean }
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
      isPinned: data.isPinned || false
    }
  })
}

export async function updateProduct(
  db: PrismaClient,
  id: number,
  data: { sku?: string; name?: string; costCents?: number; priceCents?: number; barcode?: string; isPinned?: boolean }
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

  // Recalculate prices for non-pinned products
  const products = await db.product.findMany({ where: { isPinned: false } })
  for (const p of products) {
    const newPriceCents = calculateRetailPriceCents(p.costCents, tiers)
    if (newPriceCents !== p.priceCents) {
      await db.product.update({
        where: { id: p.id },
        data: { priceCents: newPriceCents }
      })
    }
  }

  return getAllPricingTiers(db)
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
  if (!Number.isInteger(billDiscountCents) || billDiscountCents < 0 || billDiscountCents > subtotalCents) {
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
    subtotalCents > 0 ? taxableSubtotalCents - (billDiscountCents * taxableSubtotalCents) / subtotalCents : 0
  const taxCents = Math.round((taxableAfterBillDiscountCents * payload.taxRatePercent) / 100)
  const sessionUserId = getSession()?.userId ?? null
  const requestedSurchargeCents = payload.surchargeCents ?? 0
  // Surcharge is only legitimate on a CARD sale, and must match the configured rate applied
  // to the post-discount, pre-tax amount — never trust a client-supplied surcharge outright,
  // since nothing else validates it before this point.
  if (requestedSurchargeCents > 0 && payload.tenderType !== 'CARD') {
    throw new Error('Card surcharge cannot be applied to a non-card tender.')
  }
  let surchargeCents = 0
  if (payload.tenderType === 'CARD' && requestedSurchargeCents > 0) {
    const surchargePercent = await getCardSurchargePercent(db)
    const expectedSurchargeCents = Math.floor((preTaxCents * surchargePercent) / 100)
    if (requestedSurchargeCents !== expectedSurchargeCents) {
      throw new Error('Card surcharge does not match the configured rate.')
    }
    surchargeCents = expectedSurchargeCents
  }
  const totalCents = preTaxCents + taxCents + surchargeCents
  const cashOverageToCreditCents = payload.cashOverageToCreditCents ?? 0
  const changeCents = cashOverageToCreditCents > 0 ? 0 : Math.max(0, payload.tenderedCents - totalCents)
  const receiptNumber = `RX-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`

  const tabAmountCents = payload.tabAmountCents ?? 0
  if (!Number.isInteger(surchargeCents) || surchargeCents < 0) throw new Error('Invalid surcharge amount.')
  if (!Number.isInteger(tabAmountCents) || tabAmountCents < 0 || tabAmountCents > totalCents) throw new Error('Invalid Pharmacy Credit amount.')
  if (!Number.isInteger(cashOverageToCreditCents) || cashOverageToCreditCents < 0 || cashOverageToCreditCents > Math.max(0, payload.tenderedCents - totalCents)) throw new Error('Invalid cash deposit amount.')
  if (tabAmountCents > 0 && !payload.customerId) throw new Error('Attach a customer before using Pharmacy Credit.')
  if (cashOverageToCreditCents > 0 && !payload.customerId) throw new Error('Attach a customer before depositing cash to Pharmacy Credit.')

  if (payload.tenderType === 'PHARMACY_CREDIT' && tabAmountCents !== totalCents) {
    throw new Error('Pharmacy Credit standalone must charge the full sale total to the tab.')
  }

  return db.$transaction(async (tx) => {
    if (tabAmountCents > 0 && payload.customerId) {
      await tx.customer.findUniqueOrThrow({ where: { id: payload.customerId } })
    }

    if (payload.tenderType === 'PHARMACY_CREDIT' && payload.customerId) {
      const settings = await db.setting.findUnique({ where: { key: 'customer.allowShortPayToTab' } })
      const allowShortPay = settings?.value === 'true'
      const detail = await tx.customer.findUniqueOrThrow({ where: { id: payload.customerId }, select: { id: true, ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 } } })
      const currentBalance = detail.ledgerEntries[0]?.balanceAfterCents ?? 0
      if (currentBalance < totalCents && !allowShortPay) {
        throw new Error('Balance insufficient for full Pharmacy Credit payment. Add another tender or enable short-pay to tab in settings.')
      }
    }

    const transaction = await tx.transaction.create({
      data: {
        receiptNumber,
        status: payload.status || 'COMPLETED',
        subtotalCents,
        taxCents,
        totalCents,
        tenderType: payload.tenderType,
        tenderedCents: payload.tenderedCents,
        changeCents,
        customerId: payload.customerId || null,
        tabAmountCents,
        surchargeCents,
        billDiscountCents,
        discountApplied: itemDiscountTotal + billDiscountCents,
        processorTransactionId: payload.processorTransactionId || null,
        cardLast4: payload.cardLast4 || null,
        email: payload.email || null,
        // Audit: attribute the sale to the signed-in cashier (server session,
        // not renderer-supplied). Null in tests / when no session is active.
        userId: sessionUserId,
        cashierId: sessionUserId
      },
      include: { customer: true }
    })

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

    if (tabAmountCents > 0 && payload.customerId) {
      await customerLedgerInternals.appendCreditEntry(tx, payload.customerId, 'SALE_CHARGE', -tabAmountCents, { transactionId: transaction.id })
      const loyaltyFlag = await tx.featureFlag.findUnique({ where: { key: 'rewardPoints' } })
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: payload.customerId } })
      if (loyaltyFlag?.enabled && customer.loyaltyEnabled) {
        const creditSettings = await getCreditSettings(tx)
        const points = Math.floor((totalCents / 100) * creditSettings.loyaltyPointsPerDollar)
        if (points > 0) await customerLedgerInternals.appendPointEvent(tx, customer.id, 'EARNED', points, { transactionId: transaction.id })
      }
    } else if (payload.customerId) {
      const loyaltyFlag = await tx.featureFlag.findUnique({ where: { key: 'rewardPoints' } })
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: payload.customerId } })
      if (loyaltyFlag?.enabled && customer.loyaltyEnabled) {
        const creditSettings = await getCreditSettings(tx)
        const points = Math.floor((totalCents / 100) * creditSettings.loyaltyPointsPerDollar)
        if (points > 0) await customerLedgerInternals.appendPointEvent(tx, customer.id, 'EARNED', points, { transactionId: transaction.id })
      }
    }

    if (cashOverageToCreditCents > 0 && payload.customerId) {
      await customerLedgerInternals.appendCreditEntry(tx, payload.customerId, 'FUNDS_ADDED', cashOverageToCreditCents, { transactionId: transaction.id, note: `Cash overpayment deposited from ${transaction.receiptNumber}` })
    }

    return { ...transaction, items }
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
