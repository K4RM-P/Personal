/** Shared types for the McKesson catalogue import (main <-> renderer). */

export type CatalogImportPhase =
  | 'idle'
  | 'reading'
  | 'writingProducts'
  | 'writingDeals'
  | 'analyzing'
  | 'ready'
  | 'committing'
  | 'done'
  | 'failed'

export interface CatalogImportProgress {
  batchId: number | null
  phase: CatalogImportPhase
  linesRead: number
  totalLines: number
  percent: number
  message?: string
}

/** Reference-catalogue diff: what changed in the McKesson data itself. */
export interface ReferenceDiff {
  currentCount: number
  newCount: number
  delta: number
  added: number
  removed: number
  priceChanged: number
}

export interface RepriceDetail {
  productId: number
  sku: string
  name: string
  itemNumber: string
  oldCostCents: number
  newCostCents: number
  oldPriceCents: number
  newPriceCents: number
}

export interface SimpleProductRef {
  productId: number
  sku: string
  name: string
  itemNumber: string
}

export interface BarcodeChangeDetail extends SimpleProductRef {
  oldBarcode: string | null
  newBarcode: string | null
}

export interface CostPinnedDetail extends SimpleProductRef {
  oldCostCents: number
  newCostCents: number
  priceCents: number
}

/** What committing will do to the pharmacy's own inventory. */
export interface InventoryImpact {
  catalogSourcedCount: number
  manualCount: number
  repriced: RepriceDetail[]
  costChangedButPinned: CostPinnedDetail[]
  manualOverridesPreserved: SimpleProductRef[]
  discontinued: SimpleProductRef[]
  reappeared: SimpleProductRef[]
  barcodeChanged: BarcodeChangeDetail[]
  zeroCostSkipped: SimpleProductRef[]
}

export type GuardSeverity = 'block' | 'confirm'

export interface ImportGuard {
  code: 'zeroRecords' | 'largeShrink' | 'provinceMismatch' | 'costSwing'
  severity: GuardSeverity
  title: string
  detail: string
  /** Text the owner must type verbatim to override a `confirm` guard. */
  confirmPhrase?: string
}

export interface CatalogPreview {
  batchId: number
  filename: string
  fileSizeBytes: number
  totalLines: number
  productsParsed: number
  dealsParsed: number
  linesRejected: number
  rejectSamples: { lineNumber: number; reason: string }[]
  anomalies: {
    zeroCost: number
    listBelowCost: number
    noPrimaryGtin: number
    orphanDeals: number
  }
  provinceSplit: Record<string, number>
  reference: ReferenceDiff
  inventory: InventoryImpact
  guards: ImportGuard[]
}

export interface CatalogCommitResult {
  batchId: number
  repricedCount: number
  discontinuedCount: number
  reappearedCount: number
  productsInCatalog: number
  purgedBatchIds: number[]
}

export interface CatalogSearchRow {
  id: number
  itemNumber: string
  description: string
  displayName: string
  din: string | null
  province: string
  strength: string | null
  dosageForm: string | null
  genericName: string | null
  packSize: number | null
  vendorCode: string | null
  categoryCode: string | null
  listPriceCents: number
  costPriceCents: number
  gtinPrimary: string | null
  gtinPrimaryNorm: string | null
  gtinCase: string | null
  gtinCaseNorm: string | null
  /** Set when this catalogue item is already stocked as a Product. */
  stockedProductId: number | null
}

export interface CatalogDealRow {
  id: number
  dealType: string
  dealNumber: string
  date1: string | null
  date2: string | null
  date3: string | null
  date4: string | null
  allowanceCents: number
  dealPriceCents: number
  tierFlag: string | null
}

/** Result of scanning a barcode against Product then CatalogProduct. */
export type CatalogScanResult =
  | { kind: 'product'; productId: number }
  | { kind: 'catalogOnly'; item: CatalogSearchRow }
  | { kind: 'notFound' }

export interface CatalogStatus {
  activeBatchId: number | null
  filename: string | null
  importedAt: string | null
  ageDays: number | null
  productCount: number
  dealCount: number
  /** Previous batch retained for rollback, if any. */
  rollbackBatchId: number | null
  rollbackFilename: string | null
  staleThresholdDays: number
  isStale: boolean
}

/** Result of promoting every unstocked catalogue item into sellable inventory. */
export interface PromoteAllResult {
  total: number
  created: number
  skipped: number
  errors: number
  barcodeSkipped: number
  zeroCostPinned: number
}

/** A single new product created from the catalogue during auto-upload. */
export interface AutoImportNewItem {
  productId: number
  sku: string
  name: string
  costCents: number
  priceCents: number
  barcode: string | null
  itemNumber: string
}

/** Result returned after a full auto-import flow (upload → commit → promote). */
export interface AutoImportResult {
  batchId: number
  filename: string
  catalogProductsTotal: number
  /** Products that are entirely new — didn't exist in the previous catalogue. */
  newItems: AutoImportNewItem[]
  repricedCount: number
  discontinuedCount: number
  errors: number
}