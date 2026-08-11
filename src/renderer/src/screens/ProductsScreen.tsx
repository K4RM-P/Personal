import * as React from 'react'
import { PackageSearch } from 'lucide-react'
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

export function ProductsScreen(): React.JSX.Element {
  const [tiers, setTiers] = React.useState<PricingTier[]>([])
  const [catalogItems, setCatalogItems] = React.useState<CatalogRow[]>([])
  const [activeTab, setActiveTab] = React.useState<'catalog' | 'tiers' | 'import' | 'mckesson'>('catalog')
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
          <p className="text-[var(--muted-foreground)]">Product catalog CRUD, Tiered Markup Pricing Engine, and CSV import.</p>
        </div>
        <div className="flex space-x-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-1">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'catalog' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Product Catalog
          </button>
          <button
            onClick={() => setActiveTab('tiers')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'tiers' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Tiered Markup Engine
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'import' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Bulk Spreadsheet Import
          </button>
          <button
            onClick={() => setActiveTab('mckesson')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'mckesson' ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            McKesson Catalogue
          </button>
        </div>
      </div>

      {/* Tab 1: Product Catalog & Form */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-12 gap-6">
          {/* Add/Edit Product Form (4 Cols) */}
          <div className="col-span-4">
            <Card>
              <h3 className="mb-4 font-semibold text-[var(--foreground)]">
                {editingProductId ? 'Edit Product' : 'Add New Product'}
              </h3>
              {formMessage && <Alert variant={formMessage.type} className="mb-3">{formMessage.text}</Alert>}
              <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
                <div>
                  <label className="mb-1 block text-[var(--muted-foreground)]">SKU Code*</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    required
                    placeholder="e.g. OTC-100"
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[var(--foreground)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[var(--muted-foreground)]">Product Name*</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="e.g. Allergy Relief 24ct"
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[var(--foreground)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[var(--muted-foreground)]">Supplier Cost ($)*</label>
                  <input
                    type="number"
                    step="0.01"
                    value={costDollars}
                    onChange={(e) => setCostDollars(e.target.value)}
                    required
                    placeholder="0.00"
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[var(--foreground)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[var(--muted-foreground)]">Barcode / UPC</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Optional barcode digits"
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[var(--foreground)]"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="pinPrice"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                  />
                  <label htmlFor="pinPrice" className="text-[var(--foreground)]">
                    Pin Manual Override Price (Ignore Tier Rule)
                  </label>
                </div>

                {isPinned ? (
                  <div>
                    <label className="mb-1 block text-[var(--muted-foreground)]">Manual Retail Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={priceDollars}
                      onChange={(e) => setPriceDollars(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[var(--foreground)]"
                    />
                  </div>
                ) : (
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs text-[var(--success)]">
                    Auto-Calculated Tier Retail Price:{' '}
                    <span className="font-bold">{formatCurrency(calculatedPriceCents)}</span>
                  </div>
                )}

                <div className="flex space-x-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                  >
                    {editingProductId ? 'Update Product' : 'Create Product'}
                  </button>
                  {editingProductId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  )}
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
                    <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                      (filtered from full catalogue)
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {catalogSearch.trim().length > 0
                    ? 'Server-side FTS5 search across all fields. Results update automatically.'
                    : 'Full catalogue from latest McKesson WEBCAT import. Start typing to search.'}
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Search catalogue by any field: code, description, UPC, vendor, form, strength..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
                />
                <div className="max-h-[600px] overflow-y-auto pr-1">
                  {catalogLoading ? (
                    <div className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-sm text-[var(--muted-foreground)]">
                      <span className="icon-4 shrink-0 animate-spin rounded-full border-2 border-[var(--muted-foreground)] border-t-transparent" aria-hidden="true" />
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
                        <thead className="sticky top-0 bg-[var(--background)]">
                          <tr className="text-left text-[var(--muted-foreground)]">
                            <th className="pb-2 pr-2 font-medium">Product Code</th>
                            <th className="pb-2 pr-2 font-medium">Description</th>
                            <th className="pb-2 pr-2 font-medium">Effective Date</th>
                            <th className="pb-2 pr-2 font-medium">Pack Size</th>
                            <th className="pb-2 pr-2 font-medium">Form / Strength</th>
                            <th className="pb-2 pr-2 font-medium">Vendor / Brand</th>
                            <th className="pb-2 pr-2 text-right font-medium">Unit Cost ($)</th>
                            <th className="pb-2 pr-2 text-right font-medium">Retail Price ($)</th>
                            <th className="pb-2 text-right font-medium">UPC / Barcode</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayCatalog.map((item) => (
                            <tr key={item.id} className="border-t border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                              <td className="py-1.5 pr-2 text-[var(--foreground)] font-mono">{item.itemNumber}</td>
                              <td className="py-1.5 pr-2 text-[var(--foreground)]">{item.displayName || item.description}</td>
                              <td className="py-1.5 pr-2 text-[var(--muted-foreground)]">{item.effectiveDate || 'N/A'}</td>
                              <td className="py-1.5 pr-2 text-[var(--muted-foreground)]">{item.packSize || 'N/A'}</td>
                              <td className="py-1.5 pr-2 text-[var(--muted-foreground)]">
                                {[item.dosageForm, item.strength].filter(Boolean).join(' ') || 'N/A'}
                              </td>
                              <td className="py-1.5 pr-2 text-[var(--muted-foreground)]">{item.vendorCode || 'N/A'}</td>
                              <td className="py-1.5 pr-2 text-right text-[var(--foreground)]">{formatCurrency(item.costPriceCents)}</td>
                              <td className="py-1.5 pr-2 text-right text-[var(--primary)] font-semibold">{formatCurrency(item.listPriceCents)}</td>
                              <td className="py-1.5 text-right text-[var(--muted-foreground)] font-mono">{item.gtinPrimary || 'N/A'}</td>
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

            <div className="space-y-3 text-xs">
              {editableTiers.map((tier, idx) => (
                <div key={tier.id} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3">
                  <div>
                    <span className="font-bold text-[var(--foreground)]">Tier {idx + 1}: </span>
                    <span className="text-[var(--foreground)]">
                      Cost {formatCurrency(tier.minCostCents)}
                      {tier.maxCostCents !== null ? ` to ${formatCurrency(tier.maxCostCents)}` : '+'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="text-[var(--muted-foreground)]">Markup %:</label>
                    <input
                      type="number"
                      value={tier.markupPercent}
                      onChange={(e) => handleTierMarkupChange(idx, parseFloat(e.target.value) || 0)}
                      className="w-20 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-bold text-[var(--foreground)]"
                    />
                  </div>
                </div>
              ))}
              {tierMessage && <Alert variant={tierMessage.type}>{tierMessage.text}</Alert>}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleSaveTiers}
                  className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                >
                  Save Tier Table & Recalculate Catalog
                </button>
              </div>
            </div>
          </Card>

          {/* Tier Change Impact Preview */}
          {previewImpact.length > 0 && (
            <Card className="border-[var(--warning)]/30 bg-[var(--warning-bg)]">
              <CardHeader>
                <CardTitle className="text-[var(--warning)]">
                  Tier Change Impact Preview ({previewAffectedCount} products affected)
                </CardTitle>
                <CardDescription className="text-[var(--warning)]/80">
                  Preview showing which catalog items will change retail price before saving tier edits.
                  {previewAffectedCount > previewImpact.length &&
                    ` Showing the first ${previewImpact.length} of ${previewAffectedCount}.`}
                </CardDescription>
              </CardHeader>
              <div className="space-y-2 max-h-60 overflow-y-auto text-xs pr-1">
                {previewImpact.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2">
                    <div>
                      <span className="font-bold text-[var(--foreground)]">{item.name}</span>{' '}
                      <span className="text-[var(--muted-foreground)]">({item.sku})</span>
                    </div>
                    <div className="flex space-x-4">
                      <span className="text-[var(--muted-foreground)]">Current: {formatCurrency(item.currentPriceCents)}</span>
                      <span className="font-bold text-[var(--primary)]">New: {formatCurrency(item.newPriceCents)}</span>
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
              Paste CSV text formatted as <code>SKU,Name,CostInDollars,Barcode(optional)</code>.
              Retail prices will auto-calculate via the active Tiered Markup Engine.
            </CardDescription>
          </CardHeader>

          <div className="space-y-4">
            <textarea
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`OTC-101,Aspirin 81mg 100ct,2.50,012345678910\nOTC-102,Cough Syrup 120ml,4.00,012345678911\nOTC-103,First Aid Kit,12.00,012345678912`}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--foreground)] font-mono placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
            />

            {importPreview.length > 0 && (
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Import preview ({importPreview.length} rows)
                </div>
                <div className="space-y-2 text-xs">
                  {importPreview.slice(0, 6).map((row, index) => (
                    <div key={`${row.sku}-${index}`} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2">
                      <span className="font-medium text-[var(--foreground)]">{row.name}</span>
                      <span className="text-[var(--muted-foreground)]">{row.sku} • {formatCurrency(row.costCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importError && <Alert variant="error">{importError}</Alert>}
            {importCount !== null && <Alert variant="success">Successfully imported/upserted {importCount} products.</Alert>}

            <button
              onClick={handleBulkImport}
              className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
            >
              Preview and import CSV
            </button>
          </div>
        </Card>
      )}
      {/* Tab 4: McKesson Catalogue Import */}
      {activeTab === 'mckesson' && <McKessonCatalogTab />}
    </div>
  )
}