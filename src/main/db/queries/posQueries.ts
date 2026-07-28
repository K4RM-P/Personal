import { PrismaClient, Product, Transaction } from '@prisma/client'
import { calculateRetailPriceCents, PricingTier as EnginePricingTier } from '../../../shared/pricingEngine'
import { CreateTransactionPayload, BulkImportProductInput, TransactionWithItems } from '../../../shared/types'

// Product Queries
export async function getAllProducts(db: PrismaClient): Promise<Product[]> {
  return db.product.findMany({
    orderBy: { name: 'asc' }
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
  const subtotalCents = payload.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  )
  const taxCents = Math.round((subtotalCents * payload.taxRatePercent) / 100)
  const totalCents = subtotalCents + taxCents
  const changeCents = Math.max(0, payload.tenderedCents - totalCents)
  const receiptNumber = `RX-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`

  return db.transaction.create({
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
      items: {
        create: payload.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          costCents: item.costCents,
          unitPriceCents: item.unitPriceCents,
          totalCents: item.unitPriceCents * item.quantity
        }))
      }
    },
    include: {
      items: {
        include: {
          product: true
        }
      },
      customer: true
    }
  })
}

export async function getAllTransactions(db: PrismaClient): Promise<TransactionWithItems[]> {
  return db.transaction.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: {
          product: true
        }
      },
      customer: true
    }
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
      voidReason: reason
    }
  })
}
