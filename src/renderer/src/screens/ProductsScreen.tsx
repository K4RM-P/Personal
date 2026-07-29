import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Product, PricingTier, BulkImportProductInput } from '@shared/types'
import { formatCurrency } from '@shared/formatCurrency'
import {
  calculateRetailPriceCents,
  previewTierChangeImpact,
  TierChangePreviewItem
} from '@shared/pricingEngine'
import { parseImportPreviewCsv } from '../lib/checkoutUi'
import { McKessonCatalogTab } from '../components/McKessonCatalogTab'

export function ProductsScreen() {
  const [products, setProducts] = React.useState<Product[]>([])
  const [tiers, setTiers] = React.useState<PricingTier[]>([])
  const [activeTab, setActiveTab] = React.useState<'catalog' | 'tiers' | 'import' | 'mckesson'>('catalog')

  // New/Edit Product Form State
  const [sku, setSku] = React.useState('')
  const [name, setName] = React.useState('')
  const [costDollars, setCostDollars] = React.useState('')
  const [priceDollars, setPriceDollars] = React.useState('')
  const [barcode, setBarcode] = React.useState('')
  const [isPinned, setIsPinned] = React.useState(false)
  const [editingProductId, setEditingProductId] = React.useState<number | null>(null)

  // Tier Edit & Preview State
  const [editableTiers, setEditableTiers] = React.useState<PricingTier[]>([])
  const [previewImpact, setPreviewImpact] = React.useState<TierChangePreviewItem[]>([])

  // Bulk Import CSV State
  const [csvText, setCsvText] = React.useState('')
  const [importCount, setImportCount] = React.useState<number | null>(null)
  const importPreview = React.useMemo(() => parseImportPreviewCsv(csvText), [csvText])

  const loadData = async () => {
    try {
      if (window.api && window.api.product && window.api.pricingTier) {
        const prodList = await window.api.product.getAll()
        const tierList = await window.api.pricingTier.getAll()
        setProducts(prodList)
        setTiers(tierList)
        setEditableTiers(tierList)
      }
    } catch (err) {
      console.error('Failed to load products/tiers:', err)
    }
  }

  React.useEffect(() => {
    loadData()
  }, [])

  const costCents = Math.round((parseFloat(costDollars) || 0) * 100)
  const calculatedPriceCents = calculateRetailPriceCents(costCents, tiers)

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sku || !name || !costDollars) {
      alert('Please provide SKU, Name, and Cost Price')
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
      if (window.api && window.api.product) {
        if (editingProductId) {
          await window.api.product.update(editingProductId, payload)
        } else {
          await window.api.product.create(payload)
        }
        resetForm()
        loadData()
      }
    } catch (err: any) {
      alert(`Failed to save product: ${err?.message || 'Error occurred'}`)
    }
  }

  const handleEditClick = (p: Product) => {
    setEditingProductId(p.id)
    setSku(p.sku)
    setName(p.name)
    setCostDollars((p.costCents / 100).toString())
    setPriceDollars((p.priceCents / 100).toString())
    setBarcode(p.barcode || '')
    setIsPinned(p.isPinned)
  }

  const handleDeleteProduct = async (id: number) => {
    if (!confirm('Are you sure you want to delete this product?')) return
    try {
      if (window.api && window.api.product) {
        await window.api.product.delete(id)
        loadData()
      }
    } catch (err: any) {
      alert(`Delete failed: ${err?.message}`)
    }
  }

  const resetForm = () => {
    setEditingProductId(null)
    setSku('')
    setName('')
    setCostDollars('')
    setPriceDollars('')
    setBarcode('')
    setIsPinned(false)
  }

  // Tier Table Handlers
  const handleTierMarkupChange = (index: number, newMarkup: number) => {
    const updated = editableTiers.map((t, idx) => (idx === index ? { ...t, markupPercent: newMarkup } : t))
    setEditableTiers(updated)
    const impact = previewTierChangeImpact(products, updated)
    setPreviewImpact(impact)
  }

  const handleSaveTiers = async () => {
    try {
      if (window.api && window.api.pricingTier) {
        await window.api.pricingTier.saveAll(editableTiers)
        alert('Pricing Tiers saved successfully! Live retail prices updated across catalog.')
        loadData()
        setPreviewImpact([])
      }
    } catch (err: any) {
      alert(`Failed to save tiers: ${err?.message}`)
    }
  }

  // Bulk Import Handler
  const handleBulkImport = async () => {
    if (!csvText.trim()) return
    const inputs: BulkImportProductInput[] = importPreview.map((row) => ({
      sku: row.sku,
      name: row.name,
      costCents: row.costCents,
      barcode: row.barcode || undefined
    }))

    if (inputs.length === 0) {
      alert('Invalid CSV format. Format: SKU,Name,CostInDollars,Barcode(optional)')
      return
    }

    try {
      if (window.api && window.api.product) {
        const res = await window.api.product.bulkImport(inputs)
        setImportCount(res.count)
        setCsvText('')
        loadData()
      }
    } catch (err: any) {
      alert(`Bulk Import Failed: ${err?.message}`)
    }
  }

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

          {/* Product Catalog List (8 Cols) */}
          <div className="col-span-8">
            <Card>
              <CardHeader>
                <CardTitle>Master Product Catalog ({products.length})</CardTitle>
                <CardDescription>Dense, scannable pricing view with auto vs. pinned retail states.</CardDescription>
              </CardHeader>
              <div className="max-h-[480px] overflow-y-auto pr-1">
                {products.length === 0 ? (
                  <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                    No products yet. Add the first item to start building the catalog.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {products.map((p) => (
                      <div key={p.id} className="grid grid-cols-[1.6fr_0.8fr_0.7fr_0.7fr] items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs">
                        <div>
                          <div className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
                            <span>{p.name}</span>
                            {p.isPinned ? (
                              <span className="rounded-full border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
                                Pinned
                              </span>
                            ) : (
                              <span className="rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                                Auto
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-[var(--muted-foreground)]">SKU {p.sku} • {p.barcode || 'No barcode'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[var(--muted-foreground)]">Cost</div>
                          <div className="font-semibold text-[var(--foreground)]">{formatCurrency(p.costCents)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[var(--muted-foreground)]">Retail</div>
                          <div className="font-semibold text-[var(--primary)]">{formatCurrency(p.priceCents)}</div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => handleEditClick(p)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-[var(--foreground)]">
                            Edit
                          </button>
                          <button onClick={() => handleDeleteProduct(p.id)} className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-2 py-1 text-[var(--error)]">
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                  Tier Change Impact Preview ({previewImpact.length} products affected)
                </CardTitle>
                <CardDescription className="text-[var(--warning)]/80">
                  Preview showing which catalog items will change retail price before saving tier edits.
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

            {importCount !== null && (
              <div className="rounded-[var(--radius)] border border-[var(--success)]/30 bg-[var(--success-bg)] p-3 text-xs text-[var(--success)]">
                Successfully imported/upserted {importCount} products into database.
              </div>
            )}

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
