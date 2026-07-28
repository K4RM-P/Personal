import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Product, CartItem, TransactionWithItems } from '@shared/types'
import { formatCurrency } from '@shared/formatCurrency'

export function CheckoutScreen() {
  const [products, setProducts] = React.useState<Product[]>([])
  const [searchQuery, setSearchQuery] = React.useState('')
  const [cart, setCart] = React.useState<CartItem[]>([])
  const [taxRatePercent] = React.useState<number>(13) // Default 13% HST/tax
  const [tenderedDollars, setTenderedDollars] = React.useState<string>('')
  const [activeReceipt, setActiveReceipt] = React.useState<TransactionWithItems | null>(null)
  const [parkedCarts, setParkedCarts] = React.useState<{ id: string; name: string; items: CartItem[] }[]>([])
  const [managerOverride, setManagerOverride] = React.useState<boolean>(false)
  const [recentTransactions, setRecentTransactions] = React.useState<TransactionWithItems[]>([])

  const loadProducts = async () => {
    try {
      if (window.api && window.api.product) {
        const list = await window.api.product.getAll()
        setProducts(list)
      }
    } catch (err) {
      console.error('Failed to load products:', err)
    }
  }

  const loadTransactions = async () => {
    try {
      if (window.api && window.api.transaction) {
        const txs = await window.api.transaction.getAll()
        setRecentTransactions(txs)
      }
    } catch (err) {
      console.error('Failed to load transactions:', err)
    }
  }

  React.useEffect(() => {
    loadProducts()
    loadTransactions()
  }, [])

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery))
  )

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta
            return newQty > 0 ? { ...item, quantity: newQty } : null
          }
          return item
        })
        .filter(Boolean) as CartItem[]
    )
  }

  const removeLineItem = (productId: number) => {
    if (!managerOverride && cart.length > 0) {
      alert('Manager override required to void a line item. Toggle "Manager Mode" in top right.')
      return
    }
    setCart((prev) => prev.filter((item) => item.product.id !== productId))
  }

  const subtotalCents = cart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0)
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100)
  const totalCents = subtotalCents + taxCents

  const tenderedCents = Math.round((parseFloat(tenderedDollars) || 0) * 100)
  const changeCents = Math.max(0, tenderedCents - totalCents)

  const handleCheckout = async (tenderType: 'CASH' | 'CARD' = 'CASH') => {
    if (cart.length === 0) return
    if (tenderType === 'CASH' && tenderedCents < totalCents) {
      alert('Tendered amount is less than total amount due!')
      return
    }

    try {
      const payload = {
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          costCents: item.product.costCents,
          unitPriceCents: item.product.priceCents
        })),
        taxRatePercent,
        tenderType,
        tenderedCents: tenderType === 'CASH' ? tenderedCents : totalCents
      }

      if (window.api && window.api.transaction) {
        const tx = await window.api.transaction.create(payload)
        setActiveReceipt(tx)
        setCart([])
        setTenderedDollars('')
        loadTransactions()
      }
    } catch (err: any) {
      alert(`Checkout Error: ${err?.message || 'Transaction failed'}`)
    }
  }

  const handleParkSale = () => {
    if (cart.length === 0) return
    const parkId = `PARK-${Date.now()}`
    const name = `Parked Cart ${parkedCarts.length + 1} (${cart.length} items)`
    setParkedCarts((prev) => [...prev, { id: parkId, name, items: [...cart] }])
    setCart([])
  }

  const handleResumeParkedSale = (parkId: string) => {
    const parked = parkedCarts.find((p) => p.id === parkId)
    if (parked) {
      setCart(parked.items)
      setParkedCarts((prev) => prev.filter((p) => p.id !== parkId))
    }
  }

  const handleVoidSale = async (txId: string) => {
    if (!managerOverride) {
      alert('Manager override required to void a transaction!')
      return
    }
    const reason = prompt('Enter reason for voiding transaction:')
    if (!reason) return

    try {
      if (window.api && window.api.transaction) {
        await window.api.transaction.void(txId, reason)
        loadTransactions()
        if (activeReceipt?.id === txId) {
          setActiveReceipt(null)
        }
      }
    } catch (err: any) {
      alert(`Void Error: ${err?.message || 'Failed to void'}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Core Checkout Register</h1>
          <p className="text-[#94a3b8]">Select items, manage cart, calculate taxes, and tender cash/card sales.</p>
        </div>
        <div className="flex items-center space-x-3 bg-[#1e293b] p-2 rounded-lg border border-[#334155]">
          <span className="text-xs text-[#94a3b8]">Manager Mode:</span>
          <button
            onClick={() => setManagerOverride(!managerOverride)}
            className={`px-3 py-1 text-xs font-semibold rounded ${
              managerOverride ? 'bg-amber-500 text-black' : 'bg-[#334155] text-white'
            }`}
          >
            {managerOverride ? 'ENABLED' : 'DISABLED'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Item Selection Catalog (7 Cols) */}
        <div className="col-span-7 space-y-4">
          <Card>
            <div className="flex items-center space-x-3 mb-4">
              <input
                type="text"
                placeholder="Search products by SKU, Name, or Barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0f172a] border border-[#334155] rounded-lg px-4 py-2 text-white placeholder-[#64748b] focus:outline-none focus:border-[#0d9488]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="flex flex-col justify-between p-3 rounded-lg border border-[#334155] bg-[#0f172a] hover:border-[#0d9488] text-left transition-all group"
                >
                  <div>
                    <div className="font-semibold text-white group-hover:text-[#14b8a6]">
                      {product.name}
                    </div>
                    <div className="text-xs text-[#64748b]">SKU: {product.sku}</div>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-xs text-[#94a3b8]">Cost: {formatCurrency(product.costCents)}</span>
                    <span className="font-bold text-[#0d9488]">{formatCurrency(product.priceCents)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Parked Sales Section */}
          {parkedCarts.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-950/10">
              <h3 className="text-sm font-semibold text-amber-400 mb-2">Parked Sales ({parkedCarts.length})</h3>
              <div className="space-y-2">
                {parkedCarts.map((parked) => (
                  <div key={parked.id} className="flex justify-between items-center bg-[#0f172a] p-2 rounded text-xs">
                    <span className="text-white font-medium">{parked.name}</span>
                    <button
                      onClick={() => handleResumeParkedSale(parked.id)}
                      className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium"
                    >
                      Resume Sale
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Cart & Payment Tendering (5 Cols) */}
        <div className="col-span-5 space-y-4">
          <Card className="flex flex-col h-[520px] justify-between">
            <div>
              <div className="flex justify-between items-center pb-3 border-b border-[#334155]">
                <h3 className="font-semibold text-white">Current Order Cart</h3>
                <span className="text-xs text-[#94a3b8]">{cart.length} line items</span>
              </div>

              {/* Cart Items List */}
              <div className="space-y-2 mt-3 max-h-[220px] overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="text-center text-[#64748b] py-8 text-sm">Cart is empty. Click items to add.</div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="flex items-center justify-between bg-[#0f172a] p-2.5 rounded border border-[#334155] text-xs"
                    >
                      <div className="flex-1 pr-2">
                        <div className="font-medium text-white">{item.product.name}</div>
                        <div className="text-[#94a3b8]">
                          {formatCurrency(item.product.priceCents)} × {item.quantity}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center border border-[#334155] rounded">
                          <button
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="px-2 py-0.5 text-white hover:bg-[#334155]"
                          >
                            -
                          </button>
                          <span className="px-2 text-white">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="px-2 py-0.5 text-white hover:bg-[#334155]"
                          >
                            +
                          </button>
                        </div>
                        <span className="font-semibold text-white w-14 text-right">
                          {formatCurrency(item.product.priceCents * item.quantity)}
                        </span>
                        <button
                          onClick={() => removeLineItem(item.product.id)}
                          className="text-red-400 hover:text-red-300 font-bold px-1"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Totals & Tendering Form */}
            <div className="border-t border-[#334155] pt-3 space-y-2">
              <div className="flex justify-between text-xs text-[#94a3b8]">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-xs text-[#94a3b8] items-center">
                <span>Tax ({taxRatePercent}%)</span>
                <span>{formatCurrency(taxCents)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-white pt-1 border-t border-[#334155]">
                <span>Total Owed</span>
                <span className="text-[#0d9488]">{formatCurrency(totalCents)}</span>
              </div>

              {/* Tender Input */}
              <div className="pt-2">
                <label className="text-xs text-[#94a3b8] block mb-1">Cash Tendered ($):</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={tenderedDollars}
                  onChange={(e) => setTenderedDollars(e.target.value)}
                  className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-[#0d9488]"
                />
                {tenderedCents > 0 && (
                  <div className="flex justify-between text-xs mt-1 text-emerald-400 font-medium">
                    <span>Change Due:</span>
                    <span>{formatCurrency(changeCents)}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-3 gap-2 pt-2">
                <button
                  onClick={handleParkSale}
                  disabled={cart.length === 0}
                  className="px-3 py-2 bg-[#334155] hover:bg-[#475569] text-white rounded font-medium text-xs disabled:opacity-50"
                >
                  Park Sale
                </button>
                <button
                  onClick={() => handleCheckout('CARD')}
                  disabled={cart.length === 0}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium text-xs disabled:opacity-50"
                >
                  Pay Card
                </button>
                <button
                  onClick={() => handleCheckout('CASH')}
                  disabled={cart.length === 0}
                  className="px-3 py-2 bg-[#0d9488] hover:bg-[#0f766e] text-white rounded font-bold text-xs disabled:opacity-50"
                >
                  Pay Cash
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* On-Screen Receipt Modal */}
      {activeReceipt && (
        <Card className="border-[#0d9488] bg-[#0f172a] p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-[#334155] pb-3">
            <div>
              <h2 className="text-lg font-bold text-white">Receipt Summary</h2>
              <p className="text-xs text-[#94a3b8]">Transaction #{activeReceipt.receiptNumber}</p>
            </div>
            <button
              onClick={() => setActiveReceipt(null)}
              className="text-xs bg-[#334155] hover:bg-[#475569] px-3 py-1 text-white rounded"
            >
              Close Receipt
            </button>
          </div>

          <div className="space-y-2 text-xs">
            {activeReceipt.items.map((item) => (
              <div key={item.id} className="flex justify-between text-[#cbd5e1]">
                <span>
                  {item.product.name} (x{item.quantity})
                </span>
                <span>{formatCurrency(item.totalCents)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-[#334155] pt-3 text-xs space-y-1">
            <div className="flex justify-between text-[#94a3b8]">
              <span>Subtotal:</span>
              <span>{formatCurrency(activeReceipt.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-[#94a3b8]">
              <span>Tax:</span>
              <span>{formatCurrency(activeReceipt.taxCents)}</span>
            </div>
            <div className="flex justify-between font-bold text-white text-sm">
              <span>Total:</span>
              <span className="text-[#0d9488]">{formatCurrency(activeReceipt.totalCents)}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>Tendered ({activeReceipt.tenderType}):</span>
              <span>{formatCurrency(activeReceipt.tenderedCents)}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>Change Due:</span>
              <span>{formatCurrency(activeReceipt.changeCents)}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Recent Transactions Audit */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Completed Transactions</CardTitle>
          <CardDescription>Persisted sales records and voiding controls</CardDescription>
        </CardHeader>
        <div className="space-y-2 mt-2">
          {recentTransactions.map((tx) => (
            <div
              key={tx.id}
              className="flex justify-between items-center bg-[#0f172a] p-3 rounded border border-[#334155] text-xs"
            >
              <div>
                <div className="font-bold text-white">{tx.receiptNumber}</div>
                <div className="text-[#94a3b8]">
                  {new Date(tx.createdAt).toLocaleTimeString()} • {tx.items.length} items • Status:{' '}
                  <span className={tx.status === 'VOIDED' ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                    {tx.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="font-bold text-[#0d9488] text-sm">{formatCurrency(tx.totalCents)}</span>
                {tx.status !== 'VOIDED' && (
                  <button
                    onClick={() => handleVoidSale(tx.id)}
                    className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-500/50 text-red-300 rounded text-xs"
                  >
                    Void Sale
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
