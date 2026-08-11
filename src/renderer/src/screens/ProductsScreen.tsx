import * as React from 'react'
import { PackageSearch, Sparkles, Lock, Search, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { EmptyState } from '../components/ui/EmptyState'
import { PricingTier, BulkImportProductInput } from '@shared/types'
import { formatCurrency } from '@shared/formatCurrency'
import { calculateRetailPriceCents, TierChangePreviewItem } from '@shared/pricingEngine'
import { parseImportPreviewCsv } from '../lib/checkoutUi'
import { McKessonCatalogTab } from '../components/McKessonCatalogTab'

type CatalogRow = {
  id: number
  itemNumber: string
  description: string
  displayName: string
  effectiveDate: string | null
  packSize: string | null
  dosageForm: string | null
  strength: string | null
  vendorCode: string | null
  costPriceCents: number
  listPriceCents: number
  gtinPrimary: string | null
  province: string
  categoryCode: string | null
  din: string | null
  genericName: string | null
}

type ProductTab = 'catalog' | 'tiers' | 'import' | 'mckesson'

const TABS: { id: ProductTab; label: string }[] = [
  { id: 'catalog', label: 'Product Catalog' },
  { id: 'tiers', label: 'Tiered Markup Engine' },
  { id: 'import', label: 'Bulk Spreadsheet Import' },
  { id: 'mckesson', label: 'McKesson Catalogue' }
]

export function ProductsScreen(): React.JSX.Element {
  const [tiers, setTiers] = React.useState<PricingTier[]>([])
  const [catalogItems, setCatalogItems] = React.useState<CatalogRow[]>([])
  const [activeTab, setActiveTab] = React.useState<ProductTab>('catalog')
  const [catalogSearch, setCatalogSearch] = React.useState('')
  const [catalogLoading, setCatalogLoading] = React.useState(false)

  // New/Edit Product Form State
  const [sku, setSku] = React.useState('')
  const [name, setName] = React.useState('')
  const [costDollars, setCostDollars] = React.useState('')
  const [priceDollars, setPriceDollars] = React.useState('')
  const [barcode, setBarcode] = React.useState('')
  const [isPinned, setIsPinned] = React.useState(false)
  const [editingProductId, setEditingProductId] = React.useState<number | null>(null)
  const [formMessage, setFormMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Tier Edit & Preview State
  const [editableTiers, setEditableTiers] = React.useState<PricingTier[]>([])
  const [previewImpact, setPreviewImpact] = React.useState<TierChangePreviewItem[]>([])
  const [previewAffectedCount, setPreviewAffectedCount] = React.useState(0)
  const previewTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Bulk Import CSV State
  const [csvText, setCsvText] = React.useState('')
  const [importCount, setImportCount] = React.useState<number | null>(null)
  const [importError, setImportError] = React.useState<string | null>(null)
  const [tierMessage, setTierMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const importPreview = React.useMemo(() => parseImportPreviewCsv(csvText), [csvText])

  const loadData = async (): Promise<void> => {
    try {
      if (window.api?.pricingTier) {
        const tierList = await window.api.pricingTier.getAll()
        setTiers(tierList)
        setEditableTiers(tierList)
      }
      if (window.api?.catalog) {
        // First page only — never the whole catalogue. Typing narrows it server-side.
        const catalog = await window.api.catalog.search('', null, 100)
        setCatalogItems(catalog as CatalogRow[])
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    }
  }

  const loadCatalogSearch = async (query: string): Promise<void> => {
    if (!window.api?.catalog) return
    setCatalogLoading(true)
    try {
      const results = await window.api.catalog.search(query, null, 100)
      setCatalogItems(results as CatalogRow[])
    } catch (err) {
      console.error('Failed to search catalog:', err)
    } finally {
      setCatalogLoading(false)
    }
  }

  // Initial data load on mount
  React.useEffect(() => {
    let active = true
    loadData().then(() => {
      if (!active) return
      // loaded
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search using server-side FTS5
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (catalogSearch.trim().length > 0) {
        loadCatalogSearch(catalogSearch)
      } else if (catalogSearch.trim().length === 0) {
        loadData()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [catalogSearch])

  const costCents = Math.round((parseFloat(costDollars) || 0) * 100)
  const calculatedPriceCents = calculateRetailPriceCents(costCents, tiers)

  const handleSaveProduct = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFormMessage(null)
    if (!sku || !name || !costDollars) {
      setFormMessage({ type: 'error', text: 'Please provide SKU, Name, and Cost Price.' })
      return
    }

    const payload = {
      sku,
      name,
      costCents,
      priceCents: isPinned && priceDollars ? Math.round(parseFloat(priceDollars) * 100) : undefined,
      barcode: barcode || undefined,
      isPinned
    }

    try {
      if (window.api?.product) {
        if (editingProductId) {
          await window.api.product.update(editingProductId, payload)
        } else {
          await window.api.product.create(payload)
        }
        resetForm()
        loadData()
        setFormMessage({ type: 'success', text: 'Product saved.' })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save product'
      setFormMessage({ type: 'error', text: message })
    }
  }

  const resetForm = (): void => {
    setEditingProductId(null)
    setSku('')
    setName('')
    setCostDollars('')
    setPriceDollars('')
    setBarcode('')
    setIsPinned(false)
    setFormMessage(null)
  }

  // Tier Table Handlers
  const handleTierMarkupChange = (index: number, newMarkup: number): void => {
    const updated = editableTiers.map((t, idx) => (idx === index ? { ...t, markupPercent: newMarkup } : t))
    setEditableTiers(updated)
    // Impact is computed server-side against all 50k+ products; debounce so a
    // burst of keystrokes fires one query, and only a bounded sample crosses IPC.
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      if (!window.api?.pricingTier) return
      window.api.pricingTier
        .previewImpact(updated)
        .then((res) => {
          setPreviewImpact(res.sample)
          setPreviewAffectedCount(res.affectedCount)
        })
        .catch((err) => console.error('Tier preview failed:', err))
    }, 250)
  }

  const handleSaveTiers = async (): Promise<void> => {
    try {
      if (window.api?.pricingTier) {
        await window.api.pricingTier.saveAll(editableTiers)
        setTierMessage({ type: 'success', text: 'Pricing tiers saved — live retail prices updated across the catalog.' })
        loadData()
        setPreviewImpact([])
        setPreviewAffectedCount(0)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save tiers'
      setTierMessage({ type: 'error', text: message })
    }
  }

  // Bulk Import Handler
  const handleBulkImport = async (): Promise<void> => {
    if (!csvText.trim()) return
    setImportError(null)
    setImportCount(null)
    const inputs: BulkImportProductInput[] = importPreview.map((row) => ({
      sku: row.sku,
      name: row.name,
      costCents: row.costCents,
      barcode: row.barcode || undefined
    }))

    if (inputs.length === 0) {
      setImportError('Invalid CSV format. Expected: SKU,Name,CostInDollars,Barcode(optional)')
      return
    }

    try {
      if (window.api?.product) {
        const res = await window.api.product.bulkImport(inputs)
        setImportCount(res.count)
        setCsvText('')
        loadData()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Bulk import failed'
      setImportError(message)
    }
  }

  // Server-side search results are already filtered; no client-side filtering needed
  const displayCatalog = catalogItems

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">Products & Pricing Tiers</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Product catalog CRUD, Tiered Markup Pricing Engine, and CSV import.</p>
        </div>
        <div role="tablist" aria-label="Products sections" className="flex gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-9 rounded-[calc(var(--radius)-2px)] px-4 text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Product Catalog & Form */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-12 gap-6">
          {/* Add/Edit Product Form (4 Cols) */}
          <div className="col-span-4">
            <Card>
              <CardHeader>
                <CardTitle>{editingProductId ? 'Edit Product' : 'Add New Product'}</CardTitle>
              </CardHeader>
              {formMessage && (
                <Alert variant={formMessage.type} className="mb-3">
                  {formMessage.text}
                </Alert>
              )}
              <form onSubmit={handleSaveProduct} className="space-y-3">
                <div>
                  <label htmlFor="product-sku" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                    SKU Code*
                  </label>
                  <input
                    id="product-sku"
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    required
                    placeholder="e.g. OTC-100"
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="product-name" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                    Product Name*
                  </label>
                  <input
                    id="product-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="e.g. Allergy Relief 24ct"
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="product-cost" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                    Supplier Cost ($)*
                  </label>
                  <input
                    id="product-cost"
                    type="number"
                    step="0.01"
                    value={costDollars}
                    onChange={(e) => setCostDollars(e.target.value)}
                    required
                    placeholder="0.00"
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="product-barcode" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                    Barcode / UPC
                  </label>
                  <input
                    id="product-barcode"
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Optional barcode digits"
                    className="input"
                  />
                </div>

                <label
                  htmlFor="pinPrice"
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--radius)] px-1 text-xs text-[var(--foreground)]"
                >
                  <input
                    type="checkbox"
                    id="pinPrice"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="icon-4 shrink-0 accent-[var(--primary)]"
                  />
                  Pin manual override price (ignore tier rule)
                </label>

                {isPinned ? (
                  <div>
                    <label htmlFor="product-price" className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                      <Lock className="icon-3_5 shrink-0" aria-hidden="true" />
                      Manual Retail Price ($)
                    </label>
                    <input
                      id="product-price"
                      type="number"
                      step="0.01"
                      value={priceDollars}
                      onChange={(e) => setPriceDollars(e.target.value)}
                      placeholder="0.00"
                      className="input"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-2.5 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-[var(--muted-foreground)]">
                      <Sparkles className="icon-3_5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                      Auto-calculated (tier)
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--foreground)]">{formatCurrency(calculatedPriceCents)}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  {editingProductId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-4 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
                    >
                      Cancel
                    </button>
                  )}
                  <button type="submit" className="btn-primary flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]">
                    {editingProductId ? 'Update Product' : 'Create Product'}
                  </button>
                </div>
              </form>
            </Card>
          </div>

          {/* Catalogue Table (8 Cols) */}
          <div className="col-span-8">
            <Card>
              <CardHeader>
                <CardTitle>
                  McKesson Catalogue ({catalogItems.length.toLocaleString()} items)
                  {catalogSearch && !catalogLoading && (
                    <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">(filtered from full catalogue)</span>
                  )}
                </CardTitle>
                <CardDescription>
                  {catalogSearch.trim().length > 0
                    ? 'Server-side FTS5 search across all fields. Results update automatically.'
                    : 'Full catalogue from latest McKesson WEBCAT import. Start typing to search.'}
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="icon-4 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Search catalogue by any field: code, description, UPC, vendor, form, strength..."
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    className="input pl-9"
                  />
                </div>
                <div className="max-h-[600px] overflow-y-auto pr-1">
                  {catalogLoading ? (
                    <div className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-sm text-[var(--muted-foreground)]">
                      <Loader2 className="icon-4 shrink-0 animate-spin" aria-hidden="true" />
                      Searching catalogue…
                    </div>
                  ) : displayCatalog.length === 0 ? (
                    <EmptyState
                      icon={PackageSearch}
                      title={catalogSearch ? 'No catalogue items match your search' : 'No catalogue items yet'}
                      description={catalogSearch ? 'Try a different code, description, or UPC.' : 'Upload a McKesson WEBCAT file to populate the catalogue.'}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-[var(--card)]">
                          <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                            <th className="py-2 pr-2 font-medium">Product Code</th>
                            <th className="py-2 pr-2 font-medium">Description</th>
                            <th className="py-2 pr-2 font-medium">Effective Date</th>
                            <th className="py-2 pr-2 font-medium">Pack Size</th>
                            <th className="py-2 pr-2 font-medium">Form / Strength</th>
                            <th className="py-2 pr-2 font-medium">Vendor / Brand</th>
                            <th className="py-2 pr-2 text-right font-medium">Unit Cost</th>
                            <th className="py-2 pr-2 text-right font-medium">Retail Price</th>
                            <th className="py-2 text-right font-medium">UPC / Barcode</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayCatalog.map((item) => (
                            <tr key={item.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
                              <td className="py-2 pr-2 font-mono text-[var(--foreground)]">{item.itemNumber}</td>
                              <td className="py-2 pr-2 text-[var(--foreground)]">{item.displayName || item.description}</td>
                              <td className="py-2 pr-2 text-[var(--muted-foreground)]">{item.effectiveDate || '—'}</td>
                              <td className="py-2 pr-2 text-[var(--muted-foreground)]">{item.packSize || '—'}</td>
                              <td className="py-2 pr-2 text-[var(--muted-foreground)]">
                                {[item.dosageForm, item.strength].filter(Boolean).join(' ') || '—'}
                              </td>
                              <td className="py-2 pr-2 text-[var(--muted-foreground)]">{item.vendorCode || '—'}</td>
                              <td className="py-2 pr-2 text-right tabular-nums text-[var(--foreground)]">{formatCurrency(item.costPriceCents)}</td>
                              <td className="py-2 pr-2 text-right tabular-nums font-semibold text-[var(--primary)]">{formatCurrency(item.listPriceCents)}</td>
                              <td className="py-2 text-right font-mono text-[var(--muted-foreground)]">{item.gtinPrimary || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Tab 2: Tiered Markup Pricing Engine Settings & Live Preview */}
      {activeTab === 'tiers' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Owner Cost-Based Pricing Tiers Setup</CardTitle>
              <CardDescription>
                Formula: <code>retail = cost × (1 + markup%)</code> applied exactly with no rounding.
              </CardDescription>
            </CardHeader>

            <div className="space-y-3">
              {editableTiers.map((tier, idx) => (
                <div
                  key={tier.id}
                  className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs"
                >
                  <div>
                    <span className="font-semibold text-[var(--foreground)]">Tier {idx + 1}: </span>
                    <span className="tabular-nums text-[var(--foreground)]">
                      {formatCurrency(tier.minCostCents)}
                      {tier.maxCostCents !== null ? ` – ${formatCurrency(tier.maxCostCents)}` : '+'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor={`tier-markup-${tier.id}`} className="text-[var(--muted-foreground)]">
                      Markup %:
                    </label>
                    <input
                      id={`tier-markup-${tier.id}`}
                      type="number"
                      value={tier.markupPercent}
                      onChange={(e) => handleTierMarkupChange(idx, parseFloat(e.target.value) || 0)}
                      className="input min-h-9 w-24 text-right font-semibold tabular-nums"
                    />
                  </div>
                </div>
              ))}
              {tierMessage && <Alert variant={tierMessage.type}>{tierMessage.text}</Alert>}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveTiers}
                  className="btn-primary rounded-[var(--radius)] bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
                >
                  Save Tier Table & Recalculate Catalog
                </button>
              </div>
            </div>
          </Card>

          {/* Tier Change Impact Preview */}
          {previewImpact.length > 0 && (
            <Card className="border-[var(--warning)]/40">
              <CardHeader>
                <CardTitle className="text-[var(--warning)]">
                  Tier Change Impact Preview ({previewAffectedCount} products affected)
                </CardTitle>
                <CardDescription>
                  Preview showing which catalog items will change retail price before saving tier edits.
                  {previewAffectedCount > previewImpact.length && ` Showing the first ${previewImpact.length} of ${previewAffectedCount}.`}
                </CardDescription>
              </CardHeader>
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1 text-xs">
                {previewImpact.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2"
                  >
                    <div>
                      <span className="font-semibold text-[var(--foreground)]">{item.name}</span>{' '}
                      <span className="text-[var(--muted-foreground)]">({item.sku})</span>
                    </div>
                    <div className="flex items-center gap-4 tabular-nums">
                      <span className="text-[var(--muted-foreground)]">Current: {formatCurrency(item.currentPriceCents)}</span>
                      <span className="font-semibold text-[var(--primary)]">New: {formatCurrency(item.newPriceCents)}</span>
                      <span className={item.priceDiffCents > 0 ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                        ({item.priceDiffCents > 0 ? '+' : ''}
                        {formatCurrency(item.priceDiffCents)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab 3: Bulk Spreadsheet CSV Import */}
      {activeTab === 'import' && (
        <Card>
          <CardHeader>
            <CardTitle>Bulk Product Spreadsheet Import (CSV)</CardTitle>
            <CardDescription>
              Paste CSV text formatted as <code>SKU,Name,CostInDollars,Barcode(optional)</code>. Retail prices will
              auto-calculate via the active Tiered Markup Engine.
            </CardDescription>
          </CardHeader>

          <div className="space-y-4">
            <div>
              <label htmlFor="csv-import" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                CSV data
              </label>
              <textarea
                id="csv-import"
                rows={8}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`OTC-101,Aspirin 81mg 100ct,2.50,012345678910\nOTC-102,Cough Syrup 120ml,4.00,012345678911\nOTC-103,First Aid Kit,12.00,012345678912`}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/15"
              />
            </div>

            {importPreview.length > 0 && (
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Import preview ({importPreview.length} rows)
                </div>
                <div className="space-y-2 text-xs">
                  {importPreview.slice(0, 6).map((row, index) => (
                    <div
                      key={`${row.sku}-${index}`}
                      className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                    >
                      <span className="font-medium text-[var(--foreground)]">{row.name}</span>
                      <span className="tabular-nums text-[var(--muted-foreground)]">
                        {row.sku} • {formatCurrency(row.costCents)}
                      </span>
                    </div>
                  ))}
                  {importPreview.length > 6 && (
                    <p className="text-[var(--muted-foreground)]">…and {importPreview.length - 6} more rows.</p>
                  )}
                </div>
              </div>
            )}

            {importError && <Alert variant="error">{importError}</Alert>}
            {importCount !== null && <Alert variant="success">Successfully imported/upserted {importCount} products.</Alert>}

            <div className="flex justify-end">
              <button
                onClick={handleBulkImport}
                className="btn-primary rounded-[var(--radius)] bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
              >
                Preview and import CSV
              </button>
            </div>
          </div>
        </Card>
      )}
      {/* Tab 4: McKesson Catalogue Import */}
      {activeTab === 'mckesson' && <McKessonCatalogTab />}
    </div>
  )
}
