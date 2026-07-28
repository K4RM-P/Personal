import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Product, PricingTier, BulkImportProductInput } from '@shared/types'
import { formatCurrency } from '@shared/formatCurrency'
import {
  calculateRetailPriceCents,
  previewTierChangeImpact,
  TierChangePreviewItem
} from '@shared/pricingEngine'

export function ProductsScreen() {
  const [products, setProducts] = React.useState<Product[]>([])
  const [tiers, setTiers] = React.useState<PricingTier[]>([])
  const [activeTab, setActiveTab] = React.useState<'catalog' | 'tiers' | 'import'>('catalog')

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
    const lines = csvText.trim().split('\n')
    const inputs: BulkImportProductInput[] = []

    for (const line of lines) {
      const parts = line.split(',').map((s) => s.trim())
      if (parts.length >= 3) {
        const [itemSku, itemName, itemCostStr, itemBarcode] = parts
        const itemCostCents = Math.round(parseFloat(itemCostStr) * 100)
        if (itemSku && itemName && !isNaN(itemCostCents)) {
          inputs.push({
            sku: itemSku,
            name: itemName,
            costCents: itemCostCents,
            barcode: itemBarcode || undefined
          })
        }
      }
    }

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
          <h1 className="text-2xl font-bold tracking-tight text-white">Products & Pricing Tiers</h1>
          <p className="text-[#94a3b8]">Product catalog CRUD, Tiered Markup Pricing Engine, and CSV import.</p>
        </div>
        <div className="flex space-x-2 bg-[#1e293b] p-1 rounded-lg border border-[#334155]">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'catalog' ? 'bg-[#0d9488] text-white' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Product Catalog
          </button>
          <button
            onClick={() => setActiveTab('tiers')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'tiers' ? 'bg-[#0d9488] text-white' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Tiered Markup Engine
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${
              activeTab === 'import' ? 'bg-[#0d9488] text-white' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Bulk Spreadsheet Import
          </button>
        </div>
      </div>

      {/* Tab 1: Product Catalog & Form */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-12 gap-6">
          {/* Add/Edit Product Form (4 Cols) */}
          <div className="col-span-4">
            <Card>
              <h3 className="font-semibold text-white mb-4">
                {editingProductId ? 'Edit Product' : 'Add New Product'}
              </h3>
              <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
                <div>
                  <label className="text-[#94a3b8] block mb-1">SKU Code*</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    required
                    placeholder="e.g. OTC-100"
                    className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="text-[#94a3b8] block mb-1">Product Name*</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="e.g. Allergy Relief 24ct"
                    className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="text-[#94a3b8] block mb-1">Supplier Cost ($)*</label>
                  <input
                    type="number"
                    step="0.01"
                    value={costDollars}
                    onChange={(e) => setCostDollars(e.target.value)}
                    required
                    placeholder="0.00"
                    className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-1.5 text-white"
                  />
                </div>
                <div>
                  <label className="text-[#94a3b8] block mb-1">Barcode / UPC</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Optional barcode digits"
                    className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-1.5 text-white"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="pinPrice"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                  />
                  <label htmlFor="pinPrice" className="text-[#cbd5e1]">
                    Pin Manual Override Price (Ignore Tier Rule)
                  </label>
                </div>

                {isPinned ? (
                  <div>
                    <label className="text-[#94a3b8] block mb-1">Manual Retail Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={priceDollars}
                      onChange={(e) => setPriceDollars(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-1.5 text-white"
                    />
                  </div>
                ) : (
                  <div className="bg-[#0f172a] p-2.5 rounded border border-[#334155] text-xs text-emerald-400">
                    Auto-Calculated Tier Retail Price:{' '}
                    <span className="font-bold">{formatCurrency(calculatedPriceCents)}</span>
                  </div>
                )}

                <div className="flex space-x-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-[#0d9488] hover:bg-[#0f766e] text-white font-semibold rounded text-xs"
                  >
                    {editingProductId ? 'Update Product' : 'Create Product'}
                  </button>
                  {editingProductId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-3 py-2 bg-[#334155] hover:bg-[#475569] text-white rounded text-xs"
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
                <CardDescription>Live pricing auto-recalculated on cost changes</CardDescription>
              </CardHeader>
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex justify-between items-center bg-[#0f172a] p-3 rounded border border-[#334155] text-xs"
                  >
                    <div>
                      <div className="font-bold text-white flex items-center space-x-2">
                        <span>{p.name}</span>
                        {p.isPinned && (
                          <span className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30">
                            Manual Pin
                          </span>
                        )}
                      </div>
                      <div className="text-[#94a3b8]">
                        SKU: {p.sku} • Barcode: {p.barcode || 'N/A'}
                      </div>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <div className="text-[#94a3b8]">Cost: {formatCurrency(p.costCents)}</div>
                        <div className="font-bold text-[#0d9488] text-sm">
                          Retail: {formatCurrency(p.priceCents)}
                        </div>
                      </div>
                      <div className="flex space-x-1">
                        <button
                          onClick={() => handleEditClick(p)}
                          className="px-2 py-1 bg-[#334155] hover:bg-[#475569] text-white rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p.id)}
                          className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-500/50 text-red-300 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
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
                <div key={tier.id} className="flex items-center justify-between bg-[#0f172a] p-3 rounded border border-[#334155]">
                  <div>
                    <span className="font-bold text-white">Tier {idx + 1}: </span>
                    <span className="text-[#cbd5e1]">
                      Cost {formatCurrency(tier.minCostCents)}
                      {tier.maxCostCents !== null ? ` to ${formatCurrency(tier.maxCostCents)}` : '+'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="text-[#94a3b8]">Markup %:</label>
                    <input
                      type="number"
                      value={tier.markupPercent}
                      onChange={(e) => handleTierMarkupChange(idx, parseFloat(e.target.value) || 0)}
                      className="w-20 bg-[#1e293b] border border-[#334155] rounded px-2 py-1 text-white font-bold"
                    />
                  </div>
                </div>
              ))}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleSaveTiers}
                  className="px-4 py-2 bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold rounded text-xs"
                >
                  Save Tier Table & Recalculate Catalog
                </button>
              </div>
            </div>
          </Card>

          {/* Tier Change Impact Preview */}
          {previewImpact.length > 0 && (
            <Card className="border-amber-500/50 bg-amber-950/20">
              <CardHeader>
                <CardTitle className="text-amber-400">
                  Tier Change Impact Preview ({previewImpact.length} products affected)
                </CardTitle>
                <CardDescription className="text-amber-200/70">
                  Preview showing which catalog items will change retail price before saving tier edits.
                </CardDescription>
              </CardHeader>
              <div className="space-y-2 max-h-60 overflow-y-auto text-xs pr-1">
                {previewImpact.map((item) => (
                  <div key={item.productId} className="flex justify-between items-center bg-[#0f172a] p-2 rounded border border-[#334155]">
                    <div>
                      <span className="font-bold text-white">{item.name}</span>{' '}
                      <span className="text-[#64748b]">({item.sku})</span>
                    </div>
                    <div className="flex space-x-4">
                      <span className="text-[#94a3b8]">Current: {formatCurrency(item.currentPriceCents)}</span>
                      <span className="font-bold text-[#14b8a6]">New: {formatCurrency(item.newPriceCents)}</span>
                      <span className={item.priceDiffCents > 0 ? 'text-emerald-400' : 'text-amber-400'}>
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
              className="w-full bg-[#0f172a] border border-[#334155] rounded p-3 text-xs text-white font-mono placeholder-[#64748b] focus:outline-none focus:border-[#0d9488]"
            />

            {importCount !== null && (
              <div className="p-3 bg-emerald-950/50 border border-emerald-500/50 text-emerald-200 rounded text-xs">
                Successfully imported/upserted {importCount} products into database!
              </div>
            )}

            <button
              onClick={handleBulkImport}
              className="px-4 py-2 bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold rounded text-xs"
            >
              Process Bulk CSV Import
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}
