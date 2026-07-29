/**
 * McKesson WEBCAT streaming import (spec §3, §10).
 *
 * Main process only. The 26 MB / 65,402-record file is read line-by-line as
 * latin1 and written in ~1,000-row transactions — never `readFileSync`, never
 * row-at-a-time.
 *
 * Every import lands in a NEW batch with `isActive = false`. The live catalogue
 * is not touched until commit, which is a pointer flip. That is what makes a
 * failed or cancelled import a non-event: there is no half-replaced state to
 * recover from and no window where the POS sees an empty catalogue.
 */

import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, join } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import type {
  AutoImportResult,
  CatalogCommitResult,
  CatalogImportPhase,
  CatalogImportProgress,
  CatalogPreview
} from '../../shared/catalogTypes'
import { parseLine, type ParsedDeal, type ParsedProduct } from './webcatParser'
import { polishName, sanitizeDictionary, type AbbreviationDictionary } from './namePolish'
import {
  buildReconcilePlan,
  buildReferenceDiff,
  computeGuards,
  type CatalogEntry,
  type ProductEntry
} from './reconcile'
import { getAllPricingTiers } from '../db/queries/posQueries'
import { getCatalogProvince } from '../db/queries/settingsQueries'
import { promoteAllCatalogProducts } from './catalogQueries'

const WRITE_CHUNK = 1000
const PROGRESS_EVERY = 500
/** 396 chars + CRLF — used only to estimate total lines for the progress bar. */
const BYTES_PER_RECORD = 398
const MAX_REJECT_SAMPLES = 50
/** Retention: keep the active batch plus the previous one for rollback. */
const RETAINED_BATCHES = 2

export type ProgressCallback = (progress: CatalogImportProgress) => void

// ---------------------------------------------------------------- dictionary

let cachedDictionary: AbbreviationDictionary | null = null

/**
 * The abbreviation dictionary is a reviewable config file, not a hardcoded
 * table — the pharmacist can edit it and re-polish without a re-import.
 */
export function loadAbbreviationDictionary(): AbbreviationDictionary {
  if (cachedDictionary) return cachedDictionary

  // `process.resourcesPath` is set by Electron in a packaged app; in dev and in
  // unit tests the cwd/__dirname candidates resolve instead. Deliberately no
  // `electron` import here so the import pipeline stays testable in plain Node.
  const candidates = [
    ...(process.resourcesPath
      ? [join(process.resourcesPath, 'catalogAbbreviations.json')]
      : []),
    join(process.cwd(), 'resources', 'catalogAbbreviations.json'),
    join(__dirname, '../../resources/catalogAbbreviations.json')
  ]

  for (const path of candidates) {
    try {
      cachedDictionary = sanitizeDictionary(JSON.parse(readFileSync(path, 'utf8')))
      return cachedDictionary
    } catch {
      continue
    }
  }
  cachedDictionary = {}
  return cachedDictionary
}

// ---------------------------------------------------------------- parse + load

interface ParseAccumulator {
  totalLines: number
  productCount: number
  dealCount: number
  rejects: { lineNumber: number; reason: string }[]
  rejectCount: number
  provinceSplit: Record<string, number>
  zeroCost: number
  listBelowCost: number
  noPrimaryGtin: number
  orphanDeals: number
}

function toCatalogRow(
  p: ParsedProduct,
  batchId: number,
  dictionary: AbbreviationDictionary
): Prisma.CatalogProductCreateManyInput {
  return {
    itemNumber: p.itemNumber,
    description: p.description,
    displayName: polishName(p.description, { isDrug: p.din !== null, dictionary }),
    effectiveDate: p.effectiveDate,
    categoryCode: p.categoryCode,
    din: p.din,
    packSize: p.packSize,
    province: p.province,
    strength: p.strength,
    dosageForm: p.dosageForm,
    genericCode: p.genericCode,
    genericName: p.genericName,
    mfrPartNumber: p.mfrPartNumber,
    deptCode: p.deptCode,
    vendorCode: p.vendorCode,
    listPriceCents: p.listPriceCents,
    costPriceCents: p.costPriceCents,
    uomGroup: p.uomGroup,
    uomType: p.uomType,
    gtinPrimary: p.gtinPrimary,
    gtinPrimaryNorm: p.gtinPrimaryNorm,
    gtinCase: p.gtinCase,
    gtinCaseNorm: p.gtinCaseNorm,
    importBatchId: batchId
  }
}

/**
 * Stream the file into an inactive batch. Products first, then deals — `S`
 * records reference `P` records, so the itemNumber -> id map has to exist first.
 */
async function streamIntoBatch(
  db: PrismaClient,
  filePath: string,
  batchId: number,
  onProgress: ProgressCallback
): Promise<ParseAccumulator> {
  const dictionary = loadAbbreviationDictionary()
  const fileSize = statSync(filePath).size
  const estimatedLines = Math.max(1, Math.round(fileSize / BYTES_PER_RECORD))

  const acc: ParseAccumulator = {
    totalLines: 0,
    productCount: 0,
    dealCount: 0,
    rejects: [],
    rejectCount: 0,
    provinceSplit: {},
    zeroCost: 0,
    listBelowCost: 0,
    noPrimaryGtin: 0,
    orphanDeals: 0
  }

  const emit = (phase: CatalogImportPhase): void => {
    onProgress({
      batchId,
      phase,
      linesRead: acc.totalLines,
      totalLines: estimatedLines,
      percent: Math.min(99, Math.round((acc.totalLines / estimatedLines) * 100))
    })
  }

  // ---- Pass 1: products (deals are buffered, they need the product ids)
  let productBuffer: Prisma.CatalogProductCreateManyInput[] = []
  const dealBuffer: ParsedDeal[] = []
  const seenItemNumbers = new Set<string>()

  const flushProducts = async (): Promise<void> => {
    if (productBuffer.length === 0) return
    await db.catalogProduct.createMany({ data: productBuffer })
    productBuffer = []
  }

  // latin1, NOT utf8 — a strict utf8 decode aborts on a stray high byte.
  const stream = createReadStream(filePath, { encoding: 'latin1' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const raw of rl) {
      acc.totalLines++
      const line = raw.replace(/\r$/, '')

      // readline yields a trailing empty string for a file ending in CRLF.
      if (line.length === 0) {
        acc.totalLines--
        continue
      }

      const parsed = parseLine(line)
      if (parsed.kind === 'reject') {
        acc.rejectCount++
        if (acc.rejects.length < MAX_REJECT_SAMPLES) {
          acc.rejects.push({ lineNumber: acc.totalLines, reason: parsed.reason })
        }
      } else if (parsed.kind === 'product') {
        const p = parsed.product
        // itemNumber is unique within a batch; a duplicate would violate the
        // composite unique and abort the whole chunk, so drop it explicitly.
        if (seenItemNumbers.has(p.itemNumber)) {
          acc.rejectCount++
          if (acc.rejects.length < MAX_REJECT_SAMPLES) {
            acc.rejects.push({
              lineNumber: acc.totalLines,
              reason: `duplicate item number ${p.itemNumber}`
            })
          }
          continue
        }
        seenItemNumbers.add(p.itemNumber)

        acc.productCount++
        acc.provinceSplit[p.province] = (acc.provinceSplit[p.province] ?? 0) + 1
        if (p.costPriceCents === 0) acc.zeroCost++
        if (p.listPriceCents > 0 && p.listPriceCents < p.costPriceCents) acc.listBelowCost++
        if (!p.gtinPrimary) acc.noPrimaryGtin++

        productBuffer.push(toCatalogRow(p, batchId, dictionary))
        if (productBuffer.length >= WRITE_CHUNK) await flushProducts()
      } else {
        dealBuffer.push(parsed.deal)
      }

      if (acc.totalLines % PROGRESS_EVERY === 0) emit('writingProducts')
    }
    await flushProducts()
  } finally {
    rl.close()
    stream.destroy()
  }

  // ---- Pass 2: deals, resolved against the ids just written
  emit('writingDeals')
  const written = await db.catalogProduct.findMany({
    where: { importBatchId: batchId },
    select: { id: true, itemNumber: true }
  })
  const idByItemNumber = new Map(written.map((row) => [row.itemNumber, row.id]))

  let dealRows: Prisma.CatalogDealCreateManyInput[] = []
  const flushDeals = async (): Promise<void> => {
    if (dealRows.length === 0) return
    await db.catalogDeal.createMany({ data: dealRows })
    dealRows = []
  }

  for (const deal of dealBuffer) {
    const catalogProductId = idByItemNumber.get(deal.itemNumber)
    if (catalogProductId === undefined) {
      // Defensive: this file has no orphans, but a future one might.
      acc.orphanDeals++
      continue
    }
    acc.dealCount++
    dealRows.push({
      catalogProductId,
      dealType: deal.dealType,
      dealNumber: deal.dealNumber,
      date1: deal.date1,
      date2: deal.date2,
      date3: deal.date3,
      date4: deal.date4,
      allowanceCents: deal.allowanceCents,
      dealPriceCents: deal.dealPriceCents,
      tierFlag: deal.tierFlag
    })
    if (dealRows.length >= WRITE_CHUNK) await flushDeals()
  }
  await flushDeals()

  return acc
}

// ---------------------------------------------------------------- preview

async function loadCatalogEntries(
  db: PrismaClient,
  batchId: number
): Promise<Map<string, CatalogEntry>> {
  const rows = await db.catalogProduct.findMany({
    where: { importBatchId: batchId },
    select: {
      itemNumber: true,
      description: true,
      displayName: true,
      costPriceCents: true,
      province: true,
      din: true,
      gtinPrimaryNorm: true
    }
  })
  return new Map(rows.map((r) => [r.itemNumber, r]))
}

async function getActiveBatchId(db: PrismaClient): Promise<number | null> {
  const active = await db.catalogImportBatch.findFirst({
    where: { isActive: true },
    select: { id: true }
  })
  return active?.id ?? null
}

/**
 * Parse a file into a fresh inactive batch and return the full pre-commit
 * report. Nothing the pharmacist can see has changed when this returns.
 */
export async function startImport(
  db: PrismaClient,
  filePath: string,
  onProgress: ProgressCallback
): Promise<CatalogPreview> {
  const fileSizeBytes = statSync(filePath).size
  const batch = await db.catalogImportBatch.create({
    data: {
      filename: basename(filePath),
      fileSizeBytes,
      status: 'pending',
      isActive: false
    }
  })

  try {
    onProgress({
      batchId: batch.id,
      phase: 'reading',
      linesRead: 0,
      totalLines: 0,
      percent: 0
    })

    const acc = await streamIntoBatch(db, filePath, batch.id, onProgress)

    onProgress({
      batchId: batch.id,
      phase: 'analyzing',
      linesRead: acc.totalLines,
      totalLines: acc.totalLines,
      percent: 99
    })

    const preview = await buildPreview(db, batch.id, acc)

    await db.catalogImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'previewing',
        totalLines: acc.totalLines,
        linesRejected: acc.rejectCount,
        dealsImported: acc.dealCount,
        productsNew: preview.reference.added,
        productsUpdated: preview.reference.priceChanged,
        productsUnchanged:
          preview.reference.newCount - preview.reference.added - preview.reference.priceChanged,
        errorReport: acc.rejects.length > 0 ? JSON.stringify(acc.rejects) : null
      }
    })

    onProgress({
      batchId: batch.id,
      phase: 'ready',
      linesRead: acc.totalLines,
      totalLines: acc.totalLines,
      percent: 100
    })

    return preview
  } catch (error) {
    // The active catalogue was never touched. Discard the partial batch.
    await db.catalogImportBatch
      .update({ where: { id: batch.id }, data: { status: 'failed' } })
      .catch(() => undefined)
    await discardImport(db, batch.id).catch(() => undefined)
    onProgress({
      batchId: batch.id,
      phase: 'failed',
      linesRead: 0,
      totalLines: 0,
      percent: 0,
      message: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

async function buildPreview(
  db: PrismaClient,
  batchId: number,
  acc: ParseAccumulator
): Promise<CatalogPreview> {
  const batch = await db.catalogImportBatch.findUniqueOrThrow({ where: { id: batchId } })
  const activeBatchId = await getActiveBatchId(db)

  const nextEntries = await loadCatalogEntries(db, batchId)
  const nextCosts = new Map([...nextEntries].map(([k, v]) => [k, v.costPriceCents]))

  const activeCosts = new Map<string, number>()
  const activeProvinceSplit: Record<string, number> = {}
  if (activeBatchId !== null) {
    const rows = await db.catalogProduct.findMany({
      where: { importBatchId: activeBatchId },
      select: { itemNumber: true, costPriceCents: true, province: true }
    })
    for (const row of rows) {
      activeCosts.set(row.itemNumber, row.costPriceCents)
      activeProvinceSplit[row.province] = (activeProvinceSplit[row.province] ?? 0) + 1
    }
  }

  const [tiers, pharmacyProvince, products] = await Promise.all([
    getAllPricingTiers(db),
    getCatalogProvince(db),
    db.product.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        costCents: true,
        priceCents: true,
        barcode: true,
        isPinned: true,
        origin: true,
        sourceItemNumber: true,
        discontinued: true,
        nameOverridden: true,
        costOverridden: true,
        barcodeOverridden: true
      }
    })
  ])

  const plan = buildReconcilePlan(products as ProductEntry[], nextEntries, tiers, batchId)

  return {
    batchId,
    filename: batch.filename,
    fileSizeBytes: batch.fileSizeBytes,
    totalLines: acc.totalLines,
    productsParsed: acc.productCount,
    dealsParsed: acc.dealCount,
    linesRejected: acc.rejectCount,
    rejectSamples: acc.rejects,
    anomalies: {
      zeroCost: acc.zeroCost,
      listBelowCost: acc.listBelowCost,
      noPrimaryGtin: acc.noPrimaryGtin,
      orphanDeals: acc.orphanDeals
    },
    provinceSplit: acc.provinceSplit,
    reference: buildReferenceDiff(activeCosts, nextCosts),
    inventory: plan.impact,
    guards: computeGuards({
      activeCosts,
      nextCosts,
      nextProvinceSplit: acc.provinceSplit,
      activeProvinceSplit,
      pharmacyProvince,
      validRecordCount: acc.productCount
    })
  }
}

/** Re-derive the preview for an already-parsed batch (used to re-check guards at commit). */
export async function refreshPreview(db: PrismaClient, batchId: number): Promise<CatalogPreview> {
  const batch = await db.catalogImportBatch.findUniqueOrThrow({ where: { id: batchId } })
  const counts = await db.catalogProduct.groupBy({
    by: ['province'],
    where: { importBatchId: batchId },
    _count: { _all: true }
  })
  const provinceSplit: Record<string, number> = {}
  let productCount = 0
  for (const row of counts) {
    provinceSplit[row.province] = row._count._all
    productCount += row._count._all
  }
  const dealCount = await db.catalogDeal.count({
    where: { catalogProduct: { importBatchId: batchId } }
  })

  return buildPreview(db, batchId, {
    totalLines: batch.totalLines,
    productCount,
    dealCount,
    rejects: batch.errorReport ? JSON.parse(batch.errorReport) : [],
    rejectCount: batch.linesRejected,
    provinceSplit,
    zeroCost: 0,
    listBelowCost: 0,
    noPrimaryGtin: 0,
    orphanDeals: 0
  })
}

// ---------------------------------------------------------------- commit

export interface CommitOptions {
  /** Confirm phrases the owner typed, one per `confirm`-severity guard. */
  confirmations?: string[]
}

/**
 * Flip the active-batch pointer and reconcile promoted Products, in ONE
 * transaction (spec §10).
 *
 * The reconciliation plan is recomputed here and compared against nothing —
 * it is simply re-derived from the same pure function the preview used, over
 * the same immutable batch data, so what the owner approved is what is applied.
 */
export async function commitImport(
  db: PrismaClient,
  batchId: number,
  options: CommitOptions = {}
): Promise<CatalogCommitResult> {
  const preview = await refreshPreview(db, batchId)

  // --- Bad-file guards. `block` is absolute; `confirm` needs the typed phrase.
  const blocking = preview.guards.filter((g) => g.severity === 'block')
  if (blocking.length > 0) {
    throw new Error(`Commit refused: ${blocking.map((g) => g.title).join('; ')}`)
  }
  const typed = (options.confirmations ?? []).map((c) => c.trim().toUpperCase())
  for (const guard of preview.guards) {
    if (guard.severity !== 'confirm' || !guard.confirmPhrase) continue
    if (!typed.includes(guard.confirmPhrase.toUpperCase())) {
      throw new Error(
        `Commit blocked: "${guard.title}" requires typed confirmation ("${guard.confirmPhrase}").`
      )
    }
  }

  const now = new Date()
  const [tiers, products] = await Promise.all([
    getAllPricingTiers(db),
    db.product.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        costCents: true,
        priceCents: true,
        barcode: true,
        isPinned: true,
        origin: true,
        sourceItemNumber: true,
        discontinued: true,
        nameOverridden: true,
        costOverridden: true,
        barcodeOverridden: true
      }
    })
  ])
  const nextEntries = await loadCatalogEntries(db, batchId)
  const plan = buildReconcilePlan(products as ProductEntry[], nextEntries, tiers, batchId, now)

  const purgedBatchIds: number[] = []

  await db.$transaction(
    async (tx) => {
      // 1. Pointer flip — old batch out, new batch in.
      await tx.catalogImportBatch.updateMany({
        where: { isActive: true, id: { not: batchId } },
        data: { isActive: false, supersededAt: now }
      })
      await tx.catalogImportBatch.update({
        where: { id: batchId },
        data: {
          isActive: true,
          status: 'committed',
          completedAt: now,
          repricedCount: plan.impact.repriced.length,
          discontinuedCount: plan.impact.discontinued.length,
          reconcileReport: JSON.stringify(plan.impact)
        }
      })

      // 2. Reconcile promoted Products. origin = MANUAL rows produce no update
      //    and are never in this list.
      // Handle barcode conflicts gracefully — if two products would swap barcodes,
      // the second update would fail with a unique constraint violation. Skip
      // conflicting barcode updates rather than aborting the entire commit.
      const barcodeUpdates = plan.updates.filter((u) => u.data.barcode !== undefined)
      const nonBarcodeUpdates = plan.updates.filter((u) => u.data.barcode === undefined)

      for (const update of nonBarcodeUpdates) {
        await tx.product.update({ where: { id: update.productId }, data: update.data })
      }

      for (const update of barcodeUpdates) {
        try {
          await tx.product.update({ where: { id: update.productId }, data: update.data })
        } catch {
          // Barcode conflict — skip this update and clear the barcode to avoid
          // leaving the product in an inconsistent state
          await tx.product.update({
            where: { id: update.productId },
            data: { ...update.data, barcode: null }
          }).catch(() => {
            // If even clearing fails, just skip it
          })
        }
      }
    },
    { timeout: 120_000, maxWait: 30_000 }
  )

  // 3. Retention purge — keep the active batch plus one previous for rollback.
  //    Outside the transaction: a failed purge must not undo a good commit.
  const keep = await db.catalogImportBatch.findMany({
    where: { status: { in: ['committed', 'rolledBack'] } },
    orderBy: { id: 'desc' },
    select: { id: true },
    take: RETAINED_BATCHES
  })
  const keepIds = keep.map((b) => b.id)
  const stale = await db.catalogImportBatch.findMany({
    where: { id: { notIn: keepIds.length > 0 ? keepIds : [batchId] } },
    select: { id: true }
  })
  for (const batch of stale) {
    await db.catalogImportBatch.delete({ where: { id: batch.id } })
    purgedBatchIds.push(batch.id)
  }

  await rebuildSearchIndex(db)

  return {
    batchId,
    repricedCount: plan.impact.repriced.length,
    discontinuedCount: plan.impact.discontinued.length,
    reappearedCount: plan.impact.reappeared.length,
    productsInCatalog: nextEntries.size,
    purgedBatchIds
  }
}

/** Throw away an uncommitted batch. The active catalogue is untouched by design. */
export async function discardImport(db: PrismaClient, batchId: number): Promise<void> {
  const batch = await db.catalogImportBatch.findUnique({ where: { id: batchId } })
  if (!batch || batch.isActive) return
  await db.catalogImportBatch.delete({ where: { id: batchId } })
}

/**
 * Roll back to the previous catalogue by flipping the pointer and re-running
 * reconciliation against the restored batch. This cannot restore values a
 * pharmacist has edited since the commit — the UI must say so plainly.
 */
export async function rollbackImport(db: PrismaClient): Promise<CatalogCommitResult> {
  const batches = await db.catalogImportBatch.findMany({
    where: { status: { in: ['committed', 'rolledBack'] } },
    orderBy: { id: 'desc' },
    take: 2
  })
  if (batches.length < 2) {
    throw new Error('No previous catalogue to roll back to.')
  }
  const [current, previous] = batches

  const now = new Date()
  const [tiers, products] = await Promise.all([
    getAllPricingTiers(db),
    db.product.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        costCents: true,
        priceCents: true,
        barcode: true,
        isPinned: true,
        origin: true,
        sourceItemNumber: true,
        discontinued: true,
        nameOverridden: true,
        costOverridden: true,
        barcodeOverridden: true
      }
    })
  ])
  const restoredEntries = await loadCatalogEntries(db, previous.id)
  const plan = buildReconcilePlan(products as ProductEntry[], restoredEntries, tiers, previous.id, now)

  await db.$transaction(
    async (tx) => {
      await tx.catalogImportBatch.update({
        where: { id: current.id },
        data: { isActive: false, status: 'rolledBack', supersededAt: now }
      })
      await tx.catalogImportBatch.update({
        where: { id: previous.id },
        data: { isActive: true, status: 'committed', supersededAt: null }
      })
      for (const update of plan.updates) {
        await tx.product.update({ where: { id: update.productId }, data: update.data })
      }
    },
    { timeout: 120_000, maxWait: 30_000 }
  )

  await rebuildSearchIndex(db)

  return {
    batchId: previous.id,
    repricedCount: plan.impact.repriced.length,
    discontinuedCount: plan.impact.discontinued.length,
    reappearedCount: plan.impact.reappeared.length,
    productsInCatalog: restoredEntries.size,
    purgedBatchIds: []
  }
}

// ---------------------------------------------------------------- FTS5

/**
 * FTS5 lives outside Prisma's schema (it has no virtual-table support), so the
 * table is created idempotently and rebuilt from the active batch after every
 * pointer flip. A LIKE '%term%' scan over 52,741 rows feels sluggish and gets
 * worse with each import.
 */
export async function ensureSearchIndex(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    `CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
       catalogProductId UNINDEXED,
       description,
       displayName,
       genericName,
       din,
       itemNumber,
       effectiveDate,
       packSize,
       dosageForm,
       strength,
       vendorCode,
       gtinPrimary,
       costPrice,
       listPrice,
       tokenize = "unicode61"
    )`
  )
}

export async function rebuildSearchIndex(db: PrismaClient): Promise<void> {
  await ensureSearchIndex(db)
  await db.$executeRawUnsafe('DELETE FROM catalog_fts')
  await db.$executeRawUnsafe(
    `INSERT INTO catalog_fts (
       catalogProductId, description, displayName, genericName, din, itemNumber,
       effectiveDate, packSize, dosageForm, strength, vendorCode, gtinPrimary,
       costPrice, listPrice
     )
     SELECT cp.id,
            cp.description,
            cp.displayName,
            COALESCE(cp.genericName, ''),
            COALESCE(cp.din, ''),
            cp.itemNumber,
            COALESCE(cp.effectiveDate, ''),
            CAST(COALESCE(cp.packSize, 0) AS TEXT),
            COALESCE(cp.dosageForm, ''),
            COALESCE(cp.strength, ''),
            COALESCE(cp.vendorCode, ''),
            COALESCE(cp.gtinPrimary, ''),
            CAST(cp.costPriceCents / 100.0 AS TEXT),
            CAST(cp.listPriceCents / 100.0 AS TEXT)
       FROM CatalogProduct cp
       JOIN CatalogImportBatch b ON b.id = cp.importBatchId
      WHERE b.isActive = 1`
  )
}

// ---------------------------------------------------------------- auto import (one-shot)

/**
 * Full automated import pipeline: parse file → commit → promote all to inventory.
 *
 * This is the one-click "Upload catalogue" flow that the pharmacy uses on a
 * regular basis. It skips the multi-step preview/commit/approve workflow and
 * does everything in one shot.
 *
 * Returns a list of products that are *new* — items present in this catalogue
 * that were NOT in the previous active catalogue — plus summary counts.
 */
export async function autoImportCatalog(
  db: PrismaClient,
  filePath: string,
  onProgress: ProgressCallback
): Promise<AutoImportResult> {
  // 1. Parse the file into a new batch (same as startImport)
  const fileSizeBytes = statSync(filePath).size
  const batch = await db.catalogImportBatch.create({
    data: {
      filename: basename(filePath),
      fileSizeBytes,
      status: 'pending',
      isActive: false
    }
  })

  let acc: ParseAccumulator
  try {
    onProgress({ batchId: batch.id, phase: 'reading', linesRead: 0, totalLines: 0, percent: 0 })
    acc = await streamIntoBatch(db, filePath, batch.id, onProgress)
    onProgress({ batchId: batch.id, phase: 'analyzing', linesRead: acc.totalLines, totalLines: acc.totalLines, percent: 50 })
  } catch (error) {
    await db.catalogImportBatch.delete({ where: { id: batch.id } }).catch(() => undefined)
    onProgress({ batchId: batch.id, phase: 'failed', linesRead: 0, totalLines: 0, percent: 0, message: error instanceof Error ? error.message : String(error) })
    throw error
  }

  // 2. Determine which items are new (not in the previous active catalogue)
  const activeBatchId = await getActiveBatchId(db)
  const previousItemNumbers = new Set<string>()
  if (activeBatchId !== null) {
    const previous = await db.catalogProduct.findMany({
      where: { importBatchId: activeBatchId },
      select: { itemNumber: true }
    })
    for (const row of previous) {
      previousItemNumbers.add(row.itemNumber)
    }
  }

  // 3. Commit the batch (pointer flip + reconcile existing products)
  onProgress({ batchId: batch.id, phase: 'committing', linesRead: acc.totalLines, totalLines: acc.totalLines, percent: 75 })

  // Bypass guard checks for auto-import — the pharmacy trusts the file.
  const preview = await refreshPreview(db, batch.id)
  const confirmations = preview.guards
    .filter((g) => g.severity === 'confirm' && g.confirmPhrase)
    .map((g) => g.confirmPhrase!)

  await commitImport(db, batch.id, { confirmations })

  // 4. Promote all catalogue items to Products (auto-stock everything)
  onProgress({ batchId: batch.id, phase: 'writingProducts', linesRead: acc.totalLines, totalLines: acc.totalLines, percent: 90 })

  let errors = 0
  try {
    await promoteAllCatalogProducts(db)
  } catch {
    errors = 1
  }

  // 5. Query new items — Products created from items that weren't in the previous catalogue.
  // Use a smaller in-memory filter instead of `notIn` with 65k+ values to avoid SQLite parameter limits.
  const batchProducts = await db.product.findMany({
    where: {
      origin: 'CATALOG',
      lastSeenBatchId: batch.id
    },
    select: {
      id: true,
      sku: true,
      name: true,
      costCents: true,
      priceCents: true,
      barcode: true,
      sourceItemNumber: true
    },
    orderBy: { name: 'asc' }
  })
  const newProducts = batchProducts.filter((p) => p.sourceItemNumber != null && !previousItemNumbers.has(p.sourceItemNumber))

  onProgress({ batchId: batch.id, phase: 'done', linesRead: acc.totalLines, totalLines: acc.totalLines, percent: 100 })

  return {
    batchId: batch.id,
    filename: basename(filePath),
    catalogProductsTotal: acc.productCount,
    newItems: newProducts.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      costCents: p.costCents,
      priceCents: p.priceCents,
      barcode: p.barcode,
      itemNumber: p.sourceItemNumber ?? ''
    })),
    repricedCount: preview.reference.priceChanged,
    discontinuedCount: preview.reference.removed,
    errors
  }
}