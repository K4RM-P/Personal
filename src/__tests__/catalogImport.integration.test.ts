import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { commitImport, startImport } from '../main/catalog/importService'
import { promoteCatalogProduct, scanLookup, searchCatalog } from '../main/catalog/catalogQueries'
import { saveAllPricingTiers } from '../main/db/queries/posQueries'
import { RECORD_LEN } from '../main/catalog/webcatParser'
import { DEFAULT_PRICING_TIERS } from '../shared/pricingEngine'

/**
 * End-to-end cover for the streaming import, the batch-pointer flip and
 * reconciliation, against a real SQLite database.
 *
 * The refresh path is the one operation that can destroy real pharmacy data,
 * and it only runs a few times a year — so it gets exercised for real here
 * rather than only through the pure planner.
 */

let workDir: string
let db: PrismaClient

// --------------------------------------------------------------- fixtures

function buildRecord(fields: [number, string][]): string {
  const buf = new Array<string>(RECORD_LEN).fill(' ')
  for (const [pos1, value] of fields) {
    for (let i = 0; i < value.length; i++) buf[pos1 - 1 + i] = value[i]
  }
  return buf.join('')
}

interface ProductSpec {
  itemNumber: string
  description: string
  costCents: number
  listCents?: number
  province?: string
  din?: string
  gtin?: string
}

function productRecord(spec: ProductSpec): string {
  return buildRecord([
    [1, 'P'],
    [2, spec.itemNumber],
    [8, spec.description],
    [58, '20260715'],
    [90, '08640'],
    [127, spec.din ?? '00000000'],
    [144, '000001'],
    [150, spec.province ?? 'ONT'],
    [232, '320'],
    [235, 'PGA'],
    [332, String(spec.listCents ?? spec.costCents * 2).padStart(7, '0')],
    [339, String(spec.costCents).padStart(7, '0')],
    [346, '750000'],
    [352, 'AU'],
    [355, spec.gtin ?? '00000000000000'],
    [383, '00000000000000']
  ])
}

function dealRecord(itemNumber: string, dealPriceCents: number): string {
  return buildRecord([
    [1, 'S'],
    [2, itemNumber],
    [8, 'PCH'],
    [11, '00071'],
    [16, '20260701'],
    [24, '20260930'],
    [69, '0000500'],
    [76, String(dealPriceCents).padStart(7, '0')],
    [95, 'Y']
  ])
}

function writeCatalogFile(name: string, lines: string[]): string {
  const path = join(workDir, name)
  // CRLF line endings and latin1, exactly as McKesson ships it.
  writeFileSync(path, lines.map((l) => l + '\r\n').join(''), 'latin1')
  return path
}

// Valid check-digit GTINs.
const GTIN_A = '00035000764126'
const GTIN_B = '00062600000019'

const V1 = [
  productRecord({ itemNumber: '000001', description: 'ITEM ALPHA', costCents: 1000, gtin: GTIN_A }),
  productRecord({ itemNumber: '000002', description: 'ITEM BRAVO', costCents: 2000, gtin: GTIN_B }),
  productRecord({ itemNumber: '000003', description: 'ITEM CHARLIE 15ML', costCents: 500 }),
  dealRecord('000001', 899)
]

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'catalog-it-'))
  const dbPath = join(workDir, 'test.db')
  const url = `file:${dbPath}`

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe'
  })

  db = new PrismaClient({ datasources: { db: { url } } })

  // The tier engine is the source of truth for retail price, so the tiers have
  // to exist for promote/reprice to mean anything.
  await db.pricingTier.createMany({
    data: DEFAULT_PRICING_TIERS.map((t, i) => ({
      id: t.id,
      minCostCents: t.minCostCents,
      maxCostCents: t.maxCostCents,
      markupPercent: t.markupPercent,
      orderIndex: i
    }))
  })
}, 120_000)

afterAll(async () => {
  await db?.$disconnect()
  rmSync(workDir, { recursive: true, force: true })
})

const noop = (): void => undefined

/**
 * Type every `confirm` guard's phrase. These tiny fixtures trip the shrink and
 * cost-swing guards on purpose-built data that a 52,741-row file would not.
 */
function confirmAll(preview: { guards: { confirmPhrase?: string }[] }): string[] {
  return preview.guards.map((g) => g.confirmPhrase).filter((p): p is string => Boolean(p))
}

describe('streaming import + commit', () => {
  it('parses a CRLF latin1 file into an INACTIVE batch, leaving the live catalogue alone', async () => {
    const path = writeCatalogFile('v1.txt', V1)
    const preview = await startImport(db, path, noop)

    expect(preview.productsParsed).toBe(3)
    expect(preview.dealsParsed).toBe(1)
    expect(preview.linesRejected).toBe(0)
    expect(preview.reference).toMatchObject({ currentCount: 0, newCount: 3, added: 3 })

    // Nothing is live yet — the batch is inactive until commit.
    const batch = await db.catalogImportBatch.findUniqueOrThrow({ where: { id: preview.batchId } })
    expect(batch.isActive).toBe(false)
    expect(batch.status).toBe('previewing')
    expect(await db.catalogImportBatch.count({ where: { isActive: true } })).toBe(0)
  })

  it('commits with a pointer flip and makes the catalogue searchable', async () => {
    const active = await db.catalogImportBatch.findFirstOrThrow({ where: { status: 'previewing' } })
    const result = await commitImport(db, active.id)

    expect(result.productsInCatalog).toBe(3)
    expect(await db.catalogImportBatch.count({ where: { isActive: true } })).toBe(1)

    // Polished displayName is stored separately; raw description is untouched.
    const charlie = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000003' } })
    expect(charlie.description).toBe('ITEM CHARLIE 15ML')
    expect(charlie.displayName).toBe('Item Charlie 15 mL')

    // FTS5 search over the active batch.
    const hits = await searchCatalog(db, { query: 'charlie', province: null })
    expect(hits.map((h) => h.itemNumber)).toContain('000003')

    // Deals imported and linked by item number.
    const alpha = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000001' } })
    const deals = await db.catalogDeal.findMany({ where: { catalogProductId: alpha.id } })
    expect(deals).toHaveLength(1)
    expect(deals[0].dealPriceCents).toBe(899)
  })

  it('resolves a scan to a catalogue-only hit before anything is stocked', async () => {
    // Scanner emits 12-13 digits; the file stores 14.
    const result = await scanLookup(db, '035000764126')
    expect(result.kind).toBe('catalogOnly')
    expect(result.kind === 'catalogOnly' && result.item.itemNumber).toBe('000001')
  })
})

describe('promote to product', () => {
  it('prices from the tier engine, not from McKesson list price', async () => {
    const alpha = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000001' } })
    const promoted = await promoteCatalogProduct(db, alpha.id)

    expect(promoted.created).toBe(true)
    expect(promoted.costCents).toBe(1000)
    // $10.00 cost -> 100% tier -> $20.00 retail, computed by the tier engine.
    expect(promoted.priceCents).toBe(2000)
    expect(promoted.listPriceCents).toBe(2000)

    const product = await db.product.findUniqueOrThrow({ where: { id: promoted.productId } })
    expect(product.origin).toBe('CATALOG')
    expect(product.sourceItemNumber).toBe('000001')
    expect(product.barcode).toBe('35000764126') // normalized GTIN

    // Now the same scan resolves to the stocked product instead.
    const scan = await scanLookup(db, '035000764126')
    expect(scan.kind).toBe('product')
  })

  it('is idempotent — promoting twice returns the existing product', async () => {
    const alpha = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000001' } })
    const again = await promoteCatalogProduct(db, alpha.id)
    expect(again.created).toBe(false)
  })

  it('falls back to the McKesson list price, not the supplier cost, when no tier matches', async () => {
    // Charlie costs $5.00. Temporarily replace the tiers with a gap that
    // excludes it, so the tier engine has nothing to compute a markup from.
    const savedTiers = await db.pricingTier.findMany()
    await db.pricingTier.deleteMany()
    await db.pricingTier.createMany({
      data: [{ id: 'gap-tier', minCostCents: 600, maxCostCents: null, markupPercent: 50 }]
    })
    try {
      const charlie = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000003' } })
      const promoted = await promoteCatalogProduct(db, charlie.id)

      expect(promoted.created).toBe(true)
      expect(promoted.costCents).toBe(500)
      // Must be McKesson's list price ($10.00), never a bare re-statement of
      // the $5.00 supplier cost.
      expect(promoted.priceCents).toBe(promoted.listPriceCents)
      expect(promoted.priceCents).not.toBe(promoted.costCents)

      const product = await db.product.findUniqueOrThrow({ where: { id: promoted.productId } })
      expect(product.isPinned).toBe(true)
      expect(product.fallbackPinned).toBe(true)
    } finally {
      await db.pricingTier.deleteMany()
      await db.pricingTier.createMany({ data: savedTiers })
    }
  })

  it('re-enters the tier engine once a matching tier is later configured', async () => {
    // Charlie ($5.00 cost) was fallback-pinned to McKesson's list price by the
    // previous test. The default tiers were already restored in its `finally`
    // block, and tier-2 ($3.01-$10.00, 100%) covers Charlie's cost — so simply
    // re-saving the (unchanged) tier table should now un-pin it and reprice it
    // off supplier cost, not silently leave it stuck on the old list price.
    let product = await db.product.findFirstOrThrow({ where: { sourceItemNumber: '000003' } })
    expect(product.isPinned).toBe(true)
    expect(product.fallbackPinned).toBe(true)

    const currentTiers = await db.pricingTier.findMany({ orderBy: { orderIndex: 'asc' } })
    await saveAllPricingTiers(db, currentTiers)

    product = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(product.isPinned).toBe(false)
    expect(product.fallbackPinned).toBe(false)
    // $5.00 cost -> tier-2 (100% markup) -> $10.00 retail.
    expect(product.priceCents).toBe(1000)

    // Alpha (already tier-priced, never pinned) must be untouched by the resave.
    const alpha = await db.product.findFirstOrThrow({ where: { sourceItemNumber: '000001' } })
    expect(alpha.priceCents).toBe(2000)
  })

  it('an explicit price override pins the product at that price on create', async () => {
    const bravo = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000002' } })
    const promoted = await promoteCatalogProduct(db, bravo.id, 4999)

    expect(promoted.created).toBe(true)
    expect(promoted.priceCents).toBe(4999)

    const product = await db.product.findUniqueOrThrow({ where: { id: promoted.productId } })
    expect(product.isPinned).toBe(true)
    expect(product.priceCents).toBe(4999)
  })

  it('an explicit price override edits an already-promoted product in place', async () => {
    const bravo = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000002' } })
    const edited = await promoteCatalogProduct(db, bravo.id, 5999)

    expect(edited.created).toBe(false)
    expect(edited.priceCents).toBe(5999)

    const product = await db.product.findUniqueOrThrow({ where: { id: edited.productId } })
    expect(product.isPinned).toBe(true)
    expect(product.priceCents).toBe(5999)
    // Supplier cost is never touched by a retail-price override.
    expect(product.costCents).toBe(2000)
  })
})

describe('refresh + reconciliation', () => {
  let manualBefore: Record<string, unknown>

  beforeAll(async () => {
    // Promote Bravo too, so a removal has something to affect.
    const bravo = await db.catalogProduct.findFirstOrThrow({ where: { itemNumber: '000002' } })
    await promoteCatalogProduct(db, bravo.id)

    // A hand-entered product that must be byte-identical after any refresh.
    const manual = await db.product.create({
      data: { sku: 'HAND-001', name: 'Hand Entered', costCents: 777, priceCents: 1499 }
    })
    manualBefore = { ...manual }
  })

  it('re-importing the IDENTICAL file changes nothing', async () => {
    const path = writeCatalogFile('v1-again.txt', V1)
    const preview = await startImport(db, path, noop)

    expect(preview.reference).toMatchObject({ added: 0, removed: 0, priceChanged: 0 })
    expect(preview.inventory.repriced).toHaveLength(0)
    expect(preview.inventory.discontinued).toHaveLength(0)

    const before = await db.product.findMany({ orderBy: { id: 'asc' } })
    await commitImport(db, preview.batchId)
    const after = await db.product.findMany({ orderBy: { id: 'asc' } })

    // Only the catalogue-sync bookkeeping may differ.
    expect(after.map((p) => [p.costCents, p.priceCents, p.name, p.discontinued])).toEqual(
      before.map((p) => [p.costCents, p.priceCents, p.name, p.discontinued])
    )
  })

  it('shows the full impact in the preview WITHOUT touching the live catalogue', async () => {
    const v2 = [
      // Alpha's cost doubles -> must reprice.
      productRecord({
        itemNumber: '000001',
        description: 'ITEM ALPHA',
        costCents: 2000,
        gtin: GTIN_A
      }),
      // Bravo is GONE -> must be discontinued, never deleted.
      productRecord({ itemNumber: '000003', description: 'ITEM CHARLIE 15ML', costCents: 500 }),
      productRecord({ itemNumber: '000004', description: 'ITEM DELTA', costCents: 300 })
    ]
    const path = writeCatalogFile('v2.txt', v2)
    const preview = await startImport(db, path, noop)

    expect(preview.reference).toMatchObject({ added: 1, removed: 1, priceChanged: 1 })
    expect(preview.inventory.repriced).toHaveLength(1)
    expect(preview.inventory.repriced[0]).toMatchObject({
      itemNumber: '000001',
      oldPriceCents: 2000,
      newPriceCents: 3200 // $20.00 cost -> 60% tier
    })
    expect(preview.inventory.discontinued).toHaveLength(1)
    expect(preview.inventory.discontinued[0].itemNumber).toBe('000002')
    expect(preview.inventory.manualCount).toBe(1)

    // The live catalogue and the products are still exactly as they were.
    const bravoStillLive = await searchCatalog(db, { query: 'bravo', province: null })
    expect(bravoStillLive).toHaveLength(1)
    const alpha = await db.product.findFirstOrThrow({ where: { sourceItemNumber: '000001' } })
    expect(alpha.priceCents).toBe(2000)

    // ...and committing then applies exactly what was previewed.
    await commitImport(db, preview.batchId)

    const alphaAfter = await db.product.findFirstOrThrow({ where: { sourceItemNumber: '000001' } })
    expect(alphaAfter.costCents).toBe(2000)
    expect(alphaAfter.priceCents).toBe(3200)
  })

  it('marks a dropped product discontinued but keeps it sellable, never deleting it', async () => {
    const bravo = await db.product.findFirstOrThrow({ where: { sourceItemNumber: '000002' } })
    expect(bravo.discontinued).toBe(true)
    expect(bravo.discontinuedAt).not.toBeNull()

    // Still a real, ringable product: price and cost intact, row still present.
    expect(bravo.priceCents).toBeGreaterThan(0)
    expect(bravo.costCents).toBe(2000)
  })

  it('leaves a manually-added product byte-identical', async () => {
    const manualAfter = await db.product.findFirstOrThrow({ where: { sku: 'HAND-001' } })
    expect({ ...manualAfter }).toEqual(manualBefore)
    // Including updatedAt — proof the row was never written to at all.
    expect(manualAfter.updatedAt).toEqual(manualBefore.updatedAt)
    expect(manualAfter.origin).toBe('MANUAL')
  })

  it('clears discontinued when the item reappears in a later catalogue', async () => {
    const v3 = [
      productRecord({
        itemNumber: '000001',
        description: 'ITEM ALPHA',
        costCents: 2000,
        gtin: GTIN_A
      }),
      productRecord({
        itemNumber: '000002',
        description: 'ITEM BRAVO',
        costCents: 2000,
        gtin: GTIN_B
      }),
      productRecord({ itemNumber: '000003', description: 'ITEM CHARLIE 15ML', costCents: 500 }),
      productRecord({ itemNumber: '000004', description: 'ITEM DELTA', costCents: 300 })
    ]
    const preview = await startImport(db, writeCatalogFile('v3.txt', v3), noop)
    expect(preview.inventory.reappeared).toHaveLength(1)

    await commitImport(db, preview.batchId)

    const bravo = await db.product.findFirstOrThrow({ where: { sourceItemNumber: '000002' } })
    expect(bravo.discontinued).toBe(false)
    expect(bravo.discontinuedAt).toBeNull()
  })
})

describe('bad files', () => {
  it('blocks a >20% shrink until the phrase is typed, then allows it', async () => {
    // 4 products -> 1 product is a 75% shrink.
    const tiny = [
      productRecord({
        itemNumber: '000001',
        description: 'ITEM ALPHA',
        costCents: 2000,
        gtin: GTIN_A
      })
    ]
    const preview = await startImport(db, writeCatalogFile('tiny.txt', tiny), noop)

    const shrink = preview.guards.find((g) => g.code === 'largeShrink')
    expect(shrink?.severity).toBe('confirm')

    await expect(commitImport(db, preview.batchId)).rejects.toThrow(/typed confirmation/i)

    // The live catalogue survived the refused commit intact.
    expect(await db.catalogProduct.count({ where: { importBatch: { isActive: true } } })).toBe(4)

    // With the phrase typed, it goes through.
    const result = await commitImport(db, preview.batchId, {
      confirmations: [shrink!.confirmPhrase!]
    })
    expect(result.productsInCatalog).toBe(1)
  })

  it('refuses a file with zero valid records outright', async () => {
    const junk = ['this is not a webcat file', 'neither is this']
    const preview = await startImport(db, writeCatalogFile('junk.txt', junk), noop)

    expect(preview.productsParsed).toBe(0)
    expect(preview.linesRejected).toBe(2)
    expect(preview.guards[0]).toMatchObject({ code: 'zeroRecords', severity: 'block' })

    // Not even a typed confirmation can push this through.
    await expect(
      commitImport(db, preview.batchId, { confirmations: ['REPLACE CATALOGUE'] })
    ).rejects.toThrow(/refused/i)
  })

  it('leaves the active catalogue provably unchanged when a parse fails mid-flight', async () => {
    const activeBefore = await db.catalogImportBatch.findFirstOrThrow({ where: { isActive: true } })
    const countBefore = await db.catalogProduct.count({
      where: { importBatchId: activeBefore.id }
    })
    const batchesBefore = await db.catalogImportBatch.count()

    await expect(startImport(db, join(workDir, 'does-not-exist.txt'), noop)).rejects.toThrow()

    const activeAfter = await db.catalogImportBatch.findFirstOrThrow({ where: { isActive: true } })
    expect(activeAfter.id).toBe(activeBefore.id)
    expect(await db.catalogProduct.count({ where: { importBatchId: activeAfter.id } })).toBe(
      countBefore
    )
    // The partial batch was discarded, not left lying around.
    expect(await db.catalogImportBatch.count()).toBe(batchesBefore)
  })
})
