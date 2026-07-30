import { describe, it, expect } from 'vitest'
import {
  buildReconcilePlan,
  buildReferenceDiff,
  computeGuards,
  median,
  type CatalogEntry,
  type ProductEntry
} from '../main/catalog/reconcile'
import { DEFAULT_PRICING_TIERS } from '../shared/pricingEngine'

const TIERS = DEFAULT_PRICING_TIERS
const BATCH = 7
const NOW = new Date('2026-07-29T12:00:00Z')

function catalogEntry(overrides: Partial<CatalogEntry> & { itemNumber: string }): CatalogEntry {
  return {
    description: 'GENERIC ITEM',
    displayName: 'Generic Item',
    costPriceCents: 1000,
    province: 'ONT',
    din: null,
    gtinPrimaryNorm: null,
    ...overrides
  }
}

function product(overrides: Partial<ProductEntry> & { id: number }): ProductEntry {
  return {
    sku: `SKU-${overrides.id}`,
    name: 'Generic Item',
    costCents: 1000,
    priceCents: 1600, // $10.00 cost -> 60% tier -> $16.00
    barcode: null,
    isPinned: false,
    origin: 'CATALOG',
    sourceItemNumber: String(overrides.id).padStart(6, '0'),
    discontinued: false,
    nameOverridden: false,
    costOverridden: false,
    barcodeOverridden: false,
    ...overrides
  }
}

function catalog(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(entries.map((e) => [e.itemNumber, e]))
}

// ---------------------------------------------------------------------------
// The six scenarios the spec requires. This logic runs a few times a year, so
// bugs in it will not surface during normal use.
// ---------------------------------------------------------------------------

describe('1. re-importing the identical file is a no-op', () => {
  it('produces zero reprices, zero discontinued, and no field writes', () => {
    const products = [product({ id: 1 }), product({ id: 2 })]
    const next = catalog([
      catalogEntry({ itemNumber: '000001' }),
      catalogEntry({ itemNumber: '000002' })
    ])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)

    expect(plan.impact.repriced).toHaveLength(0)
    expect(plan.impact.discontinued).toHaveLength(0)
    expect(plan.impact.reappeared).toHaveLength(0)
    expect(plan.impact.barcodeChanged).toHaveLength(0)

    // Every update carries only the sync bookkeeping — no product data changes.
    for (const update of plan.updates) {
      expect(Object.keys(update.data).sort()).toEqual(['lastCatalogSyncAt', 'lastSeenBatchId'])
    }
  })

  it('reports an unchanged reference catalogue as all-zero diff', () => {
    const costs = new Map([
      ['000001', 1000],
      ['000002', 2000]
    ])
    const diff = buildReferenceDiff(costs, new Map(costs))
    expect(diff).toMatchObject({ added: 0, removed: 0, priceChanged: 0, delta: 0 })
  })
})

describe('2. an item removed from the file is discontinued, not deleted', () => {
  it('flags the product, keeps it sellable, and never emits a delete', () => {
    const products = [product({ id: 1 }), product({ id: 2 })]
    const next = catalog([catalogEntry({ itemNumber: '000001' })]) // 000002 is gone

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)

    expect(plan.impact.discontinued).toHaveLength(1)
    expect(plan.impact.discontinued[0].productId).toBe(2)

    const update = plan.updates.find((u) => u.productId === 2)
    expect(update?.data.discontinued).toBe(true)
    expect(update?.data.discontinuedAt).toEqual(NOW)

    // Crucially: nothing that would stop it being rung up, and no price reset.
    expect(update?.data.priceCents).toBeUndefined()
    expect(update?.data.costCents).toBeUndefined()
  })

  it('clears the flag when the item reappears in a later catalogue', () => {
    const products = [product({ id: 2, discontinued: true })]
    const next = catalog([catalogEntry({ itemNumber: '000002' })])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)

    expect(plan.impact.reappeared).toHaveLength(1)
    const update = plan.updates.find((u) => u.productId === 2)
    expect(update?.data.discontinued).toBe(false)
    expect(update?.data.discontinuedAt).toBeNull()
  })
})

describe('3. a cost change on a pinned item updates cost but NOT retail', () => {
  it('records the new cost, leaves the price alone, and reports it', () => {
    const products = [product({ id: 1, isPinned: true, priceCents: 1299 })]
    const next = catalog([catalogEntry({ itemNumber: '000001', costPriceCents: 2000 })])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)

    const update = plan.updates.find((u) => u.productId === 1)
    expect(update?.data.costCents).toBe(2000)
    expect(update?.data.priceCents).toBeUndefined() // the pin held

    expect(plan.impact.repriced).toHaveLength(0)
    expect(plan.impact.costChangedButPinned).toHaveLength(1)
    expect(plan.impact.costChangedButPinned[0]).toMatchObject({
      oldCostCents: 1000,
      newCostCents: 2000,
      priceCents: 1299
    })
  })

  it('DOES reprice the same change when the item is not pinned', () => {
    const products = [product({ id: 1, isPinned: false })]
    const next = catalog([catalogEntry({ itemNumber: '000001', costPriceCents: 2000 })])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)

    // $20.00 cost -> 60% tier -> $32.00
    expect(plan.impact.repriced).toHaveLength(1)
    expect(plan.impact.repriced[0]).toMatchObject({
      oldPriceCents: 1600,
      newPriceCents: 3200
    })
    expect(plan.updates.find((u) => u.productId === 1)?.data.priceCents).toBe(3200)
  })
})

describe('4. a manually-added product is completely untouched', () => {
  it('produces no update at all — not even a write', () => {
    const manual = product({
      id: 99,
      origin: 'MANUAL',
      sourceItemNumber: null,
      costCents: 500,
      priceCents: 999
    })
    const before = structuredClone(manual)

    // The new catalogue even contains an item whose barcode would match.
    const next = catalog([
      catalogEntry({ itemNumber: '000099', costPriceCents: 4242, gtinPrimaryNorm: '12345' })
    ])

    const plan = buildReconcilePlan([manual], next, TIERS, BATCH, NOW)

    expect(plan.updates).toHaveLength(0)
    expect(plan.impact.manualCount).toBe(1)
    expect(plan.impact.catalogSourcedCount).toBe(0)
    expect(plan.impact.repriced).toHaveLength(0)
    expect(plan.impact.discontinued).toHaveLength(0)

    // The input object itself was not mutated.
    expect(manual).toEqual(before)
  })

  it('skips a MANUAL product even when its sourceItemNumber matches the catalogue', () => {
    const manual = product({ id: 1, origin: 'MANUAL' }) // sourceItemNumber '000001'
    const next = catalog([catalogEntry({ itemNumber: '000001', costPriceCents: 9999 })])

    const plan = buildReconcilePlan([manual], next, TIERS, BATCH, NOW)
    expect(plan.updates).toHaveLength(0)
  })
})

describe('5. per-field overrides survive a refresh', () => {
  it('preserves an overridden name, cost and barcode', () => {
    const products = [
      product({
        id: 1,
        name: 'My Own Name',
        costCents: 111,
        barcode: 'MYBARCODE',
        nameOverridden: true,
        costOverridden: true,
        barcodeOverridden: true
      })
    ]
    const next = catalog([
      catalogEntry({
        itemNumber: '000001',
        displayName: 'Catalogue Name',
        costPriceCents: 5000,
        gtinPrimaryNorm: '9999999'
      })
    ])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)

    const update = plan.updates.find((u) => u.productId === 1)
    expect(update?.data.name).toBeUndefined()
    expect(update?.data.costCents).toBeUndefined()
    expect(update?.data.barcode).toBeUndefined()
    expect(plan.impact.manualOverridesPreserved).toHaveLength(1)
  })

  it('updates the fields nobody has overridden', () => {
    const products = [product({ id: 1, barcode: 'OLD' })]
    const next = catalog([
      catalogEntry({
        itemNumber: '000001',
        displayName: 'Catalogue Name',
        gtinPrimaryNorm: '9999999'
      })
    ])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)
    const update = plan.updates.find((u) => u.productId === 1)

    expect(update?.data.name).toBe('Catalogue Name')
    expect(update?.data.barcode).toBe('9999999')
    expect(plan.impact.barcodeChanged[0]).toMatchObject({
      oldBarcode: 'OLD',
      newBarcode: '9999999'
    })
  })

  it('never feeds a zero catalogue cost to the tier engine', () => {
    const products = [product({ id: 1, costCents: 1000, priceCents: 1600 })]
    const next = catalog([catalogEntry({ itemNumber: '000001', costPriceCents: 0 })])

    const plan = buildReconcilePlan(products, next, TIERS, BATCH, NOW)
    const update = plan.updates.find((u) => u.productId === 1)

    expect(update?.data.costCents).toBeUndefined()
    expect(update?.data.priceCents).toBeUndefined() // no $0.00 shelf price
    expect(plan.impact.zeroCostSkipped).toHaveLength(1)
  })
})

describe('6. bad-file guards', () => {
  const activeCosts = new Map(
    Array.from({ length: 1000 }, (_, i) => [String(i).padStart(6, '0'), 1000] as [string, number])
  )

  it('blocks a commit outright when the file has zero valid records', () => {
    const guards = computeGuards({
      activeCosts,
      nextCosts: new Map(),
      nextProvinceSplit: {},
      activeProvinceSplit: { ONT: 1000 },
      pharmacyProvince: 'ONT',
      validRecordCount: 0
    })
    expect(guards).toHaveLength(1)
    expect(guards[0]).toMatchObject({ code: 'zeroRecords', severity: 'block' })
  })

  it('requires typed confirmation when the new catalogue is >20% smaller', () => {
    const nextCosts = new Map([...activeCosts].slice(0, 700)) // 30% shrink
    const guards = computeGuards({
      activeCosts,
      nextCosts,
      nextProvinceSplit: { ONT: 700 },
      activeProvinceSplit: { ONT: 1000 },
      pharmacyProvince: 'ONT',
      validRecordCount: 700
    })
    const shrink = guards.find((g) => g.code === 'largeShrink')
    expect(shrink).toBeDefined()
    expect(shrink?.severity).toBe('confirm')
    expect(shrink?.confirmPhrase).toBeTruthy()
  })

  it('does NOT warn on a shrink within the 20% threshold', () => {
    const nextCosts = new Map([...activeCosts].slice(0, 850)) // 15% shrink
    const guards = computeGuards({
      activeCosts,
      nextCosts,
      nextProvinceSplit: { ONT: 850 },
      activeProvinceSplit: { ONT: 1000 },
      pharmacyProvince: 'ONT',
      validRecordCount: 850
    })
    expect(guards.find((g) => g.code === 'largeShrink')).toBeUndefined()
  })

  it('warns when the configured province is largely absent from the new file', () => {
    const guards = computeGuards({
      activeCosts,
      nextCosts: new Map(activeCosts),
      nextProvinceSplit: { QUE: 950, ONT: 50 },
      activeProvinceSplit: { ONT: 1000 },
      pharmacyProvince: 'ONT',
      validRecordCount: 1000
    })
    expect(guards.find((g) => g.code === 'provinceMismatch')?.severity).toBe('confirm')
  })

  it('warns when the median cost swing exceeds 25%', () => {
    const nextCosts = new Map([...activeCosts].map(([k]) => [k, 1400] as [string, number]))
    const guards = computeGuards({
      activeCosts,
      nextCosts,
      nextProvinceSplit: { ONT: 1000 },
      activeProvinceSplit: { ONT: 1000 },
      pharmacyProvince: 'ONT',
      validRecordCount: 1000
    })
    expect(guards.find((g) => g.code === 'costSwing')?.severity).toBe('warn')
  })

  it('stays silent on a normal, healthy refresh', () => {
    const nextCosts = new Map([...activeCosts].map(([k]) => [k, 1050] as [string, number]))
    const guards = computeGuards({
      activeCosts,
      nextCosts,
      nextProvinceSplit: { ONT: 990, QUE: 10 },
      activeProvinceSplit: { ONT: 1000 },
      pharmacyProvince: 'ONT',
      validRecordCount: 1000
    })
    expect(guards).toHaveLength(0)
  })
})

describe('reference diff', () => {
  it('counts added, removed and price-changed items', () => {
    const active = new Map([
      ['A', 100],
      ['B', 200],
      ['C', 300]
    ])
    const next = new Map([
      ['A', 100], // unchanged
      ['B', 250], // price changed
      ['D', 400] // added; C removed
    ])
    expect(buildReferenceDiff(active, next)).toEqual({
      currentCount: 3,
      newCount: 3,
      delta: 0,
      added: 1,
      removed: 1,
      priceChanged: 1
    })
  })
})

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})
