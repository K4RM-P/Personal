/**
 * Catalogue reconciliation — PURE logic (spec §10).
 *
 * This module computes *what a commit would do* without touching the database.
 * The same plan drives both the pre-commit preview and the commit itself, which
 * is what guarantees the spec's hard rule: every price change from a refresh
 * appears in the report before it is applied. There is no second code path that
 * could silently diverge from what the owner approved.
 *
 * Being pure also makes the one operation that can destroy real pharmacy data
 * fully testable without a database.
 */

import { calculateRetailPriceCents, PricingTier } from '../../shared/pricingEngine'
import type {
  BarcodeChangeDetail,
  CostPinnedDetail,
  ImportGuard,
  InventoryImpact,
  ReferenceDiff,
  RepriceDetail,
  SimpleProductRef
} from '../../shared/catalogTypes'

/** The subset of CatalogProduct reconciliation needs. */
export interface CatalogEntry {
  itemNumber: string
  description: string
  displayName: string
  costPriceCents: number
  province: string
  din: string | null
  gtinPrimaryNorm: string | null
}

/** The subset of Product reconciliation needs. */
export interface ProductEntry {
  id: number
  sku: string
  name: string
  costCents: number
  priceCents: number
  barcode: string | null
  isPinned: boolean
  origin: string
  sourceItemNumber: string | null
  discontinued: boolean
  nameOverridden: boolean
  costOverridden: boolean
  barcodeOverridden: boolean
}

/** The concrete field writes to apply to one Product. Empty object == no write. */
export interface ProductUpdate {
  productId: number
  data: {
    name?: string
    costCents?: number
    priceCents?: number
    barcode?: string | null
    discontinued?: boolean
    discontinuedAt?: Date | null
    lastSeenBatchId?: number
    lastCatalogSyncAt?: Date
  }
}

export interface ReconcilePlan {
  impact: InventoryImpact
  updates: ProductUpdate[]
}

// ---------------------------------------------------------------- reference diff

export function buildReferenceDiff(
  active: Map<string, number>, // itemNumber -> costPriceCents
  next: Map<string, number>
): ReferenceDiff {
  let added = 0
  let priceChanged = 0
  for (const [itemNumber, cost] of next) {
    const prev = active.get(itemNumber)
    if (prev === undefined) {
      added++
    } else if (prev !== cost) {
      priceChanged++
    }
  }
  let removed = 0
  for (const itemNumber of active.keys()) {
    if (!next.has(itemNumber)) removed++
  }
  return {
    currentCount: active.size,
    newCount: next.size,
    delta: next.size - active.size,
    added,
    removed,
    priceChanged
  }
}

// ---------------------------------------------------------------- inventory reconcile

/**
 * Compute the reconciliation plan for the pharmacy's own Products.
 *
 * Hard rules enforced here:
 *  - `origin = MANUAL` products are never read past the origin check and never
 *    produce an update. They must be byte-identical after an import.
 *  - A product absent from the new catalogue is marked discontinued and stays
 *    sellable. It is never deleted.
 *  - Per-field override flags and `isPinned` block the catalogue from
 *    overwriting anything the pharmacist edited by hand.
 *  - A zero catalogue cost never reaches the tier engine (it would produce a
 *    $0.00 retail price).
 */
export function buildReconcilePlan(
  products: ProductEntry[],
  nextCatalog: Map<string, CatalogEntry>,
  tiers: PricingTier[],
  batchId: number,
  now: Date = new Date()
): ReconcilePlan {
  const repriced: RepriceDetail[] = []
  const costChangedButPinned: CostPinnedDetail[] = []
  const manualOverridesPreserved: SimpleProductRef[] = []
  const discontinued: SimpleProductRef[] = []
  const reappeared: SimpleProductRef[] = []
  const barcodeChanged: BarcodeChangeDetail[] = []
  const zeroCostSkipped: SimpleProductRef[] = []
  const updates: ProductUpdate[] = []

  let catalogSourcedCount = 0
  let manualCount = 0

  for (const product of products) {
    // MANUAL products are skipped entirely — not read, not updated, not flagged.
    if (product.origin !== 'CATALOG') {
      manualCount++
      continue
    }
    catalogSourcedCount++

    const itemNumber = product.sourceItemNumber
    const entry = itemNumber ? nextCatalog.get(itemNumber) : undefined
    const ref: SimpleProductRef = {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      itemNumber: itemNumber ?? ''
    }

    // --- Absent from the new catalogue: flag, never delete, keep sellable.
    if (!entry) {
      if (!product.discontinued) {
        discontinued.push(ref)
        updates.push({
          productId: product.id,
          data: { discontinued: true, discontinuedAt: now }
        })
      }
      continue
    }

    // --- Still present: update in place, respecting ownership flags.
    const data: ProductUpdate['data'] = {
      lastSeenBatchId: batchId,
      lastCatalogSyncAt: now
    }
    const preserved: string[] = []

    if (product.discontinued) {
      // The item came back.
      data.discontinued = false
      data.discontinuedAt = null
      reappeared.push(ref)
    }

    // Name
    if (product.nameOverridden) {
      preserved.push('name')
    } else if (entry.displayName && entry.displayName !== product.name) {
      data.name = entry.displayName
    }

    // Cost + retail
    if (product.costOverridden) {
      preserved.push('cost')
    } else if (entry.costPriceCents !== product.costCents) {
      if (entry.costPriceCents <= 0) {
        // Never feed a zero cost to the tier engine, and don't wipe a real cost
        // with a placeholder zero from the file.
        zeroCostSkipped.push(ref)
      } else {
        data.costCents = entry.costPriceCents
        if (product.isPinned) {
          costChangedButPinned.push({
            ...ref,
            oldCostCents: product.costCents,
            newCostCents: entry.costPriceCents,
            priceCents: product.priceCents
          })
        } else {
          const newPriceCents = calculateRetailPriceCents(entry.costPriceCents, tiers)
          if (newPriceCents !== product.priceCents) {
            data.priceCents = newPriceCents
            repriced.push({
              ...ref,
              oldCostCents: product.costCents,
              newCostCents: entry.costPriceCents,
              oldPriceCents: product.priceCents,
              newPriceCents
            })
          }
        }
      }
    }
    if (product.isPinned) preserved.push('price')

    // Barcode
    if (product.barcodeOverridden) {
      preserved.push('barcode')
    } else if (entry.gtinPrimaryNorm && entry.gtinPrimaryNorm !== product.barcode) {
      data.barcode = entry.gtinPrimaryNorm
      barcodeChanged.push({
        ...ref,
        oldBarcode: product.barcode,
        newBarcode: entry.gtinPrimaryNorm
      })
    }

    if (preserved.length > 0) manualOverridesPreserved.push(ref)
    updates.push({ productId: product.id, data })
  }

  return {
    impact: {
      catalogSourcedCount,
      manualCount,
      repriced,
      costChangedButPinned,
      manualOverridesPreserved,
      discontinued,
      reappeared,
      barcodeChanged,
      zeroCostSkipped
    },
    updates
  }
}

// ---------------------------------------------------------------- bad-file guards

export interface GuardInput {
  activeCosts: Map<string, number>
  nextCosts: Map<string, number>
  nextProvinceSplit: Record<string, number>
  activeProvinceSplit: Record<string, number>
  pharmacyProvince: string | null
  validRecordCount: number
}

const SHRINK_THRESHOLD = 0.2
const COST_SWING_THRESHOLD = 0.25

/** Median of a numeric array. Returns 0 for an empty array. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function majority(split: Record<string, number>): string | null {
  let best: string | null = null
  let bestCount = 0
  let total = 0
  for (const [prov, count] of Object.entries(split)) {
    total += count
    if (count > bestCount) {
      bestCount = count
      best = prov
    }
  }
  return total > 0 ? best : null
}

/**
 * Bad-file guards (spec §10). A `block` guard disables commit outright; a
 * `confirm` guard requires the owner to type the phrase verbatim. Full
 * replacement makes a wrong file expensive, and these catch the three ways it
 * usually goes wrong: a truncated download, a single-province export, and a
 * price feed that moved implausibly.
 */
export function computeGuards(input: GuardInput): ImportGuard[] {
  const guards: ImportGuard[] = []

  if (input.validRecordCount === 0) {
    guards.push({
      code: 'zeroRecords',
      severity: 'block',
      title: 'No valid records found',
      detail:
        'This file contained zero parseable product records. It is not a McKesson WEBCAT file, or it is empty. Commit is refused.'
    })
    // Nothing else is meaningful to compare against an empty file.
    return guards
  }

  const activeCount = input.activeCosts.size
  const newCount = input.nextCosts.size

  if (activeCount > 0 && newCount < activeCount * (1 - SHRINK_THRESHOLD)) {
    const pct = Math.round((1 - newCount / activeCount) * 100)
    guards.push({
      code: 'largeShrink',
      severity: 'confirm',
      title: `New catalogue is ${pct}% smaller`,
      detail: `The active catalogue has ${activeCount.toLocaleString()} products; this file has only ${newCount.toLocaleString()}. This is almost always a truncated download, a single-province export, or the wrong file.`,
      confirmPhrase: 'REPLACE CATALOGUE'
    })
  }

  const activeMajority = majority(input.activeProvinceSplit)
  const newMajority = majority(input.nextProvinceSplit)
  const configured = input.pharmacyProvince
  const configuredCount = configured ? (input.nextProvinceSplit[configured] ?? 0) : 0
  const configuredShare = configured ? configuredCount / newCount : 1

  if (
    (activeMajority && newMajority && activeMajority !== newMajority) ||
    (configured && configuredShare < 0.5)
  ) {
    guards.push({
      code: 'provinceMismatch',
      severity: 'confirm',
      title: 'Province mismatch',
      detail: configured
        ? `Your pharmacy is configured as ${configured}, but only ${configuredCount.toLocaleString()} of ${newCount.toLocaleString()} products in this file are ${configured}. The active catalogue is majority ${activeMajority ?? 'unknown'}; this file is majority ${newMajority ?? 'unknown'}.`
        : `The active catalogue is majority ${activeMajority}; this file is majority ${newMajority}.`,
      confirmPhrase: 'WRONG PROVINCE OK'
    })
  }

  // Median cost movement across items present in both catalogues.
  const swings: number[] = []
  for (const [itemNumber, newCost] of input.nextCosts) {
    const oldCost = input.activeCosts.get(itemNumber)
    if (oldCost !== undefined && oldCost > 0 && newCost > 0) {
      swings.push(Math.abs(newCost - oldCost) / oldCost)
    }
  }
  const medianSwing = median(swings)
  if (swings.length > 0 && medianSwing > COST_SWING_THRESHOLD) {
    guards.push({
      code: 'costSwing',
      severity: 'confirm',
      title: `Median cost moved ${Math.round(medianSwing * 100)}%`,
      detail: `Across ${swings.length.toLocaleString()} items present in both catalogues, the median wholesale cost change is ${Math.round(medianSwing * 100)}%. This can be real, but it will propagate to shelf prices.`,
      confirmPhrase: 'PRICES ARE CORRECT'
    })
  }

  return guards
}
