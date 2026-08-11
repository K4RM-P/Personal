/**
 * Catalogue read paths: status, FTS5 search, scan-to-find, promote-to-product
 * and read-only deals (spec §5, §7, §8).
 *
 * Rule of thumb: if a query answers "what do we sell / stock / owe money on",
 * it hits `Product`. If it answers "does this thing exist in the world", it
 * hits `CatalogProduct`.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import type {
  CatalogDealRow,
  CatalogScanResult,
  CatalogSearchRow,
  CatalogStatus,
  PromoteAllResult
} from '../../shared/catalogTypes'
import { gtinNorm } from './webcatParser'
import { calculateRetailPriceCents, findPricingTier } from '../../shared/pricingEngine'
import { getAllPricingTiers } from '../db/queries/posQueries'
import { getCatalogProvince, getCatalogStaleThresholdDays } from '../db/queries/settingsQueries'
import { ensureSearchIndex } from './importService'

const SEARCH_LIMIT = 200

const CATALOG_SELECT = {
  id: true,
  itemNumber: true,
  description: true,
  displayName: true,
  effectiveDate: true,
  din: true,
  province: true,
  strength: true,
  dosageForm: true,
  genericName: true,
  packSize: true,
  vendorCode: true,
  categoryCode: true,
  listPriceCents: true,
  costPriceCents: true,
  gtinPrimary: true,
  gtinPrimaryNorm: true,
  gtinCase: true,
  gtinCaseNorm: true
} as const

async function getActiveBatchId(db: PrismaClient): Promise<number | null> {
  const active = await db.catalogImportBatch.findFirst({
    where: { isActive: true },
    select: { id: true }
  })
  return active?.id ?? null
}

/**
 * Annotate catalogue rows with whether the pharmacy already stocks them, so the
 * UI can distinguish "in catalogue" from "in catalogue and on our shelves".
 */
async function attachStockedProducts(
  db: PrismaClient,
  rows: Omit<CatalogSearchRow, 'stockedProductId' | 'stockedPriceCents'>[]
): Promise<CatalogSearchRow[]> {
  if (rows.length === 0) return []
  const stocked = await db.product.findMany({
    where: { sourceItemNumber: { in: rows.map((r) => r.itemNumber) }, origin: 'CATALOG' },
    select: { id: true, sourceItemNumber: true, priceCents: true }
  })
  const byItemNumber = new Map(stocked.map((p) => [p.sourceItemNumber, p]))
  return rows.map((row) => {
    const match = byItemNumber.get(row.itemNumber)
    return {
      ...row,
      stockedProductId: match?.id ?? null,
      stockedPriceCents: match?.priceCents ?? null
    }
  })
}

export async function getCatalogStatus(db: PrismaClient): Promise<CatalogStatus> {
  const batches = await db.catalogImportBatch.findMany({
    where: { status: { in: ['committed', 'rolledBack'] } },
    orderBy: { id: 'desc' },
    take: 2
  })
  const active = batches.find((b) => b.isActive) ?? null
  const rollback = batches.find((b) => b.id !== active?.id) ?? null
  const staleThresholdDays = await getCatalogStaleThresholdDays(db)

  if (!active) {
    return {
      activeBatchId: null,
      filename: null,
      importedAt: null,
      ageDays: null,
      productCount: 0,
      dealCount: 0,
      rollbackBatchId: null,
      rollbackFilename: null,
      staleThresholdDays,
      isStale: false
    }
  }

  const [productCount, dealCount] = await Promise.all([
    db.catalogProduct.count({ where: { importBatchId: active.id } }),
    db.catalogDeal.count({ where: { catalogProduct: { importBatchId: active.id } } })
  ])

  const importedAt = active.completedAt ?? active.startedAt
  const ageDays = Math.floor((Date.now() - importedAt.getTime()) / 86_400_000)

  return {
    activeBatchId: active.id,
    filename: active.filename,
    importedAt: importedAt.toISOString(),
    ageDays,
    productCount,
    dealCount,
    rollbackBatchId: rollback?.id ?? null,
    rollbackFilename: rollback?.filename ?? null,
    staleThresholdDays,
    // Report the facts; never block or degrade on an invented cadence.
    isStale: ageDays > staleThresholdDays
  }
}

export interface CatalogSearchOptions {
  query: string
  /** null = include all provinces. */
  province?: string | null
  limit?: number
}

/**
 * FTS5 search over description + displayName + genericName + din + itemNumber.
 * Falls back to a LIKE scan only if the FTS query string is unusable.
 */
export async function searchCatalog(
  db: PrismaClient,
  options: CatalogSearchOptions
): Promise<CatalogSearchRow[]> {
  const activeBatchId = await getActiveBatchId(db)
  if (activeBatchId === null) return []

  const limit = options.limit ?? SEARCH_LIMIT
  const province = options.province === undefined ? await getCatalogProvince(db) : options.province
  const raw = options.query.trim()

  const where = {
    importBatchId: activeBatchId,
    ...(province ? { province } : {})
  }

  if (!raw) {
    const rows = await db.catalogProduct.findMany({
      where,
      select: CATALOG_SELECT,
      orderBy: { displayName: 'asc' },
      take: limit
    })
    return attachStockedProducts(db, rows)
  }

  // Build a prefix MATCH expression, quoting each token so punctuation in the
  // search box can't be read as FTS5 operator syntax.
  const tokens = raw
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => `"${t}"*`)

  if (tokens.length > 0) {
    try {
      await ensureSearchIndex(db)
      const hits = await db.$queryRawUnsafe<{ catalogProductId: number }[]>(
        `SELECT catalogProductId FROM catalog_fts WHERE catalog_fts MATCH ? LIMIT ?`,
        tokens.join(' '),
        limit
      )
      const ids = hits.map((h) => Number(h.catalogProductId))
      if (ids.length > 0) {
        const rows = await db.catalogProduct.findMany({
          where: { ...where, id: { in: ids } },
          select: CATALOG_SELECT,
          take: limit
        })
        return attachStockedProducts(db, rows)
      }
      return []
    } catch {
      // Fall through to LIKE — a search box must never hard-fail.
    }
  }

  const rows = await db.catalogProduct.findMany({
    where: {
      ...where,
      OR: [
        { description: { contains: raw } },
        { displayName: { contains: raw } },
        { genericName: { contains: raw } },
        { din: { contains: raw } },
        { itemNumber: { contains: raw } },
        { effectiveDate: { contains: raw } },
        { dosageForm: { contains: raw } },
        { strength: { contains: raw } },
        { vendorCode: { contains: raw } },
        { gtinPrimary: { contains: raw } }
        // Price/cost contains raw string is hard for Prisma `contains` on Int,
        // but fallback to LIKE scan is only for when FTS fails.
      ]
    },
    select: CATALOG_SELECT,
    take: limit
  })
  return attachStockedProducts(db, rows)
}

/** Find a catalogue item by scanned barcode, checking BOTH unit and case GTIN. */
export async function findCatalogByBarcode(
  db: PrismaClient,
  barcode: string
): Promise<CatalogSearchRow | null> {
  const activeBatchId = await getActiveBatchId(db)
  if (activeBatchId === null) return null

  // A scanner emits 12-13 digits; the file stores 14. Match on the normalized
  // zero-stripped form so both resolve to the same item.
  const norm = gtinNorm(barcode.trim())
  if (!norm) return null

  const row = await db.catalogProduct.findFirst({
    where: {
      importBatchId: activeBatchId,
      OR: [{ gtinPrimaryNorm: norm }, { gtinCaseNorm: norm }]
    },
    select: CATALOG_SELECT
  })
  if (!row) return null
  const [withStock] = await attachStockedProducts(db, [row])
  return withStock
}

/**
 * Scan lookup order (spec §5): Product -> CatalogProduct -> not found.
 * A catalogue-only hit is a distinct state, not an error.
 */
export async function scanLookup(db: PrismaClient, barcode: string): Promise<CatalogScanResult> {
  const trimmed = barcode.trim()
  if (!trimmed) return { kind: 'notFound' }

  const norm = gtinNorm(trimmed)
  const product = await db.product.findFirst({
    where: {
      OR: [
        { barcode: trimmed },
        { sku: trimmed },
        ...(norm && norm !== trimmed ? [{ barcode: norm }] : [])
      ]
    },
    select: { id: true }
  })
  if (product) return { kind: 'product', productId: product.id }

  const item = await findCatalogByBarcode(db, trimmed)
  if (item) return { kind: 'catalogOnly', item }

  return { kind: 'notFound' }
}

export async function getCatalogDeals(
  db: PrismaClient,
  catalogProductId: number
): Promise<CatalogDealRow[]> {
  return db.catalogDeal.findMany({
    where: { catalogProductId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      dealType: true,
      dealNumber: true,
      date1: true,
      date2: true,
      date3: true,
      date4: true,
      allowanceCents: true,
      dealPriceCents: true,
      tierFlag: true
    }
  })
}

export interface PromoteResult {
  productId: number
  created: boolean
  priceCents: number
  costCents: number
  /**
   * McKesson's list price — a reference figure, and also the retail fallback
   * when the cost is zero, when no markup tier matches the cost, or when the
   * pharmacist explicitly sets a retail price.
   */
  listPriceCents: number
  barcodeSkipped: boolean
  /** True when the retail price was pinned instead of tier-calculated (zero cost, no matching tier, or an explicit override). */
  pricePinnedForZeroCost: boolean
}

/**
 * "Start selling this item" — create (or price-edit) a `Product` from a
 * catalogue entry.
 *
 * Retail comes from the pharmacy's own tier engine, NOT McKesson's list price;
 * the list price is surfaced alongside as a reference figure, and used as the
 * fallback whenever the tier engine has nothing to compute from (see below).
 *
 * `priceCentsOverride`, when given, is the pharmacist manually setting the
 * retail price (from the Products screen) — it always wins and pins the
 * price, whether this call creates the product or edits an already-promoted
 * one, so a later tier-table save never silently overwrites it.
 */
export async function promoteCatalogProduct(
  db: PrismaClient,
  catalogProductId: number,
  priceCentsOverride?: number
): Promise<PromoteResult> {
  const item = await db.catalogProduct.findUniqueOrThrow({ where: { id: catalogProductId } })

  const existing = await db.product.findFirst({
    where: { sourceItemNumber: item.itemNumber, origin: 'CATALOG' }
  })
  if (existing) {
    if (priceCentsOverride === undefined) {
      return {
        productId: existing.id,
        created: false,
        priceCents: existing.priceCents,
        costCents: existing.costCents,
        listPriceCents: item.listPriceCents,
        barcodeSkipped: false,
        pricePinnedForZeroCost: existing.isPinned
      }
    }
    const updated = await db.product.update({
      where: { id: existing.id },
      data: { priceCents: priceCentsOverride, isPinned: true }
    })
    return {
      productId: updated.id,
      created: false,
      priceCents: updated.priceCents,
      costCents: updated.costCents,
      listPriceCents: item.listPriceCents,
      barcodeSkipped: false,
      pricePinnedForZeroCost: true
    }
  }

  const tiers = await getAllPricingTiers(db)
  const costCents = item.costPriceCents

  // A zero cost must never reach the tier engine — it yields a $0.00 shelf
  // price. Likewise, a cost that falls outside every configured tier has
  // nothing to compute a markup from. Both fall back to McKesson's own list
  // price and pin it, same as an explicit pharmacist override, so the price
  // is never silently a bare re-statement of the supplier cost.
  const noTierMatched = costCents > 0 && findPricingTier(costCents, tiers) === undefined
  const pricePinnedForZeroCost = priceCentsOverride !== undefined || costCents <= 0 || noTierMatched
  const priceCents =
    priceCentsOverride ??
    (costCents <= 0 || noTierMatched
      ? item.listPriceCents
      : calculateRetailPriceCents(costCents, tiers))

  // `barcode` is globally unique on Product; never fail a promote over a clash.
  let barcode: string | null = item.gtinPrimaryNorm
  let barcodeSkipped = false
  if (barcode) {
    const clash = await db.product.findFirst({ where: { barcode }, select: { id: true } })
    if (clash) {
      barcode = null
      barcodeSkipped = true
    }
  }

  let sku = `MCK-${item.itemNumber}`
  if (await db.product.findUnique({ where: { sku }, select: { id: true } })) {
    sku = `MCK-${item.itemNumber}-${Date.now().toString().slice(-5)}`
  }

  const created = await db.product.create({
    data: {
      sku,
      name: item.displayName || item.description,
      costCents,
      priceCents,
      barcode,
      isPinned: pricePinnedForZeroCost,
      origin: 'CATALOG',
      sourceItemNumber: item.itemNumber,
      lastSeenBatchId: item.importBatchId,
      lastCatalogSyncAt: new Date()
    }
  })

  return {
    productId: created.id,
    created: true,
    priceCents,
    costCents,
    listPriceCents: item.listPriceCents,
    barcodeSkipped,
    pricePinnedForZeroCost
  }
}

/**
 * Opt-in post-import cleanup: archive discontinued catalogue items that have no
 * stock left. Never automatic — a discontinued item stays sellable until the
 * owner says otherwise.
 */
export async function countDiscontinuedProducts(db: PrismaClient): Promise<number> {
  return db.product.count({ where: { origin: 'CATALOG', discontinued: true } })
}

/**
 * Promote EVERY unstocked catalogue item from the active batch into sellable
 * inventory in one pass. Items already linked to a Product are skipped.
 *
 * This is the bulk counterpart to promoteCatalogProduct — same pricing/barcode
 * rules, but tiers are loaded once and products are created in batches.
 */
export async function promoteAllCatalogProducts(db: PrismaClient): Promise<PromoteAllResult> {
  const activeBatchId = await getActiveBatchId(db)
  if (activeBatchId === null) {
    return { total: 0, created: 0, skipped: 0, errors: 0, barcodeSkipped: 0, zeroCostPinned: 0 }
  }

  const [catalogItems, existingProducts, tiers] = await Promise.all([
    db.catalogProduct.findMany({
      where: { importBatchId: activeBatchId },
      select: {
        id: true,
        itemNumber: true,
        description: true,
        displayName: true,
        costPriceCents: true,
        listPriceCents: true,
        gtinPrimaryNorm: true,
        importBatchId: true
      }
    }),
    db.product.findMany({
      where: { origin: 'CATALOG' },
      select: { id: true, sourceItemNumber: true, barcode: true, sku: true }
    }),
    getAllPricingTiers(db)
  ])

  const stockedByItemNumber = new Map(existingProducts.map((p) => [p.sourceItemNumber, p]))
  const existingBarcodes = new Set(
    existingProducts.map((p) => p.barcode).filter((b): b is string => b !== null)
  )
  const existingSkus = new Set(existingProducts.map((p) => p.sku))

  let created = 0
  let skipped = 0
  let errors = 0
  let barcodeSkipped = 0
  let zeroCostPinned = 0

  const CREATE_CHUNK = 500
  let buffer: Prisma.ProductCreateManyInput[] = []

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return
    // SKUs and barcodes are already deduped in-memory above, so a single bulk
    // insert covers the common case far more cheaply than a create-per-row loop.
    // (SQLite's Prisma client rejects `skipDuplicates`, so on the rare residual
    // unique-constraint clash we fall back to per-row inserts for this chunk.)
    const chunk = buffer
    buffer = []
    try {
      const result = await db.product.createMany({ data: chunk })
      created += result.count
    } catch {
      for (const item of chunk) {
        try {
          await db.product.create({ data: item })
          created++
        } catch {
          errors++
        }
      }
    }
  }

  for (const item of catalogItems) {
    if (stockedByItemNumber.has(item.itemNumber)) {
      skipped++
      continue
    }

    const costCents = item.costPriceCents
    const noTierMatched = costCents > 0 && findPricingTier(costCents, tiers) === undefined
    const pricePinnedForZeroCost = costCents <= 0 || noTierMatched
    if (pricePinnedForZeroCost) zeroCostPinned++
    const priceCents = pricePinnedForZeroCost
      ? item.listPriceCents
      : calculateRetailPriceCents(costCents, tiers)

    let barcode: string | null = item.gtinPrimaryNorm
    if (barcode) {
      if (existingBarcodes.has(barcode)) {
        barcode = null
        barcodeSkipped++
      } else {
        existingBarcodes.add(barcode)
      }
    }

    let sku = `MCK-${item.itemNumber}`
    if (existingSkus.has(sku)) {
      sku = `MCK-${item.itemNumber}-${Date.now().toString().slice(-5)}`
    }
    existingSkus.add(sku)

    buffer.push({
      sku,
      name: item.displayName || item.description,
      costCents,
      priceCents,
      barcode,
      isPinned: pricePinnedForZeroCost,
      origin: 'CATALOG',
      sourceItemNumber: item.itemNumber,
      lastSeenBatchId: item.importBatchId,
      lastCatalogSyncAt: new Date()
    })

    if (buffer.length >= CREATE_CHUNK) {
      await flush()
    }
  }

  await flush()

  return {
    total: catalogItems.length,
    created,
    skipped,
    errors,
    barcodeSkipped,
    zeroCostPinned
  }
}
