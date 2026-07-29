import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type { Product, Customer } from '@shared/types'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'

type ScanFeedback = { type: 'success' | 'error'; message: string } | null

export function CheckoutScreen(): React.JSX.Element {
  const [products, setProducts] = React.useState<Product[]>([])
  const [searchQuery, setSearchQuery] = React.useState('')
  const [cart, setCart] = React.useState<
    { product: Product; quantity: number; unitPriceCents: number }[]
  >([])
  const [scanFeedback, setScanFeedback] = React.useState<ScanFeedback>(null)
  const [tenderedDollars, setTenderedDollars] = React.useState('')
  const [cardProcessing, setCardProcessing] = React.useState(false)
  const [attachedCustomer, setAttachedCustomer] = React.useState<
    (Customer & { ledgerEntries?: { balanceCents: number }[] }) | null
  >(null)
  const [customerSearchQuery, setCustomerSearchQuery] = React.useState('')
  const [customerSearchResults, setCustomerSearchResults] = React.useState<Customer[]>([])
  const searchRef = React.useRef<HTMLInputElement>(null)
  const tenderRef = React.useRef<HTMLInputElement>(null)

  const tenderedCents = Math.round(parseFloat(tenderedDollars || '0') * 100)

  const subtotalCents = cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const taxRatePercent = 13
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100)
  const totalCents = subtotalCents + taxCents
  const changeCents = Math.max(0, tenderedCents - totalCents)
  const shortCents = Math.max(0, totalCents - tenderedCents)

  React.useEffect(() => {
    const loadProducts = async (): Promise<void> => {
      try {
        if (window.api?.product) {
          const list = await window.api.product.getAll()
          setProducts(list)
        }
      } catch (err) {
        console.error('Failed to load products:', err)
      }
    }
    void loadProducts()
  }, [])

  const handleBarcode = React.useCallback(
    async (barcode: string): Promise<void> => {
      setScanFeedback(null)
      try {
        if (!window.api?.product) {
          setScanFeedback({ type: 'error', message: 'API not available' })
          return
        }
        const product = await window.api.product.getByBarcode(barcode)
        if (!product) {
          setScanFeedback({ type: 'error', message: `No product found for barcode ${barcode}` })
          return
        }
        setCart((prev) => {
          const existing = prev.find((item) => item.product.id === product.id)
          if (existing) {
            return prev.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: item.quantity + 1 }
                : item
            )
          }
          return [
            ...prev,
            { product, quantity: 1, unitPriceCents: product.priceCents }
          ]
        })
        setScanFeedback({ type: 'success', message: `Added ${product.name}` })
      } catch (err) {
        setScanFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Scan failed'
        })
      }
    },
    []
  )

  useBarcodeScanner({ onScan: handleBarcode, pauseRefs: [searchRef, tenderRef] })

  const handleQuantityChange = (
    productId: number,
    delta: number
  ): void => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  const completeSale = async (
    tenderType: 'CASH' | 'CARD' | 'SPLIT',
    tabAmountCents?: number,
    cashOverageToCreditCents?: number
  ): Promise<void> => {
    if (cart.length === 0) return
    setCardProcessing(true)
    try {
      if (!window.api?.transaction) {
        setScanFeedback({ type: 'error', message: 'API not available' })
        return
      }
      const transaction = await window.api.transaction.create({
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          costCents: item.product.costCents,
          unitPriceCents: item.unitPriceCents
        })),
        taxRatePercent,
        tenderedCents,
        tenderType,
        customerId: attachedCustomer?.id,
        tabAmountCents: tabAmountCents ?? 0,
        cashOverageToCreditCents: cashOverageToCreditCents ?? 0
      })
      setCart([])
      setTenderedDollars('')
      setAttachedCustomer(null)
      setScanFeedback({ type: 'success', message: `Sale complete — ${transaction.receiptNumber}` })
    } catch (err) {
      setScanFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Transaction failed'
      })
    } finally {
      setCardProcessing(false)
    }
  }

  const handleCustomerSearch = async (): Promise<void> => {
    if (!window.api?.customer) return
    try {
      const results = await window.api.customer.search(customerSearchQuery)
      setCustomerSearchResults(results)
    } catch {
      setCustomerSearchResults([])
    }
  }

  const attachCustomer = async (customer: Customer): Promise<void> => {
    if (!window.api?.customer) return
    try {
      const ledger = await window.api.customerLedger.get(customer.id)
      const balanceCents = ledger.length > 0 ? ledger[ledger.length - 1].balanceCents : 0
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceCents }] })
      setCustomerSearchQuery('')
      setCustomerSearchResults([])
    } catch {
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceCents: 0 }] })
    }
  }

  const customerBalance = attachedCustomer?.ledgerEntries?.[0]?.balanceCents ?? 0

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery))
  )

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <h1 className="text-2xl font-bold text-[var(--foreground)]">Checkout</h1>

      {/* Scan feedback */}
      {scanFeedback && (
        <div
          className={`rounded-[var(--radius)] border p-3 text-xs ${
            scanFeedback.type === 'success'
              ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]'
              : 'border-[var(--error)]/30 bg-[var(--error-bg)] text-[var(--error)]'
          }`}
        >
          {scanFeedback.message}
        </div>
      )}

      {/* Customer attachment bar */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Customer (optional)</label>
            {attachedCustomer ? (
              <div className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-3 text-sm">
                <span className="font-semibold">
                  {attachedCustomer.firstName} {attachedCustomer.lastName} · {attachedCustomer.phone}
                </span>
                <button
                  onClick={() => { setAttachedCustomer(null); setTenderedDollars('') }}
                  className="text-[var(--primary)]"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={searchRef}
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCustomerSearch()
                  }}
                  placeholder="Attach customer — search name or phone"
                  className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"
                />
                {customerSearchResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                    {customerSearchResults.map((customer) => (
                      <button
                        key={customer.id}
                        onClick={() => void attachCustomer(customer)}
                        className="block min-h-11 w-full border-b border-[var(--border)] px-3 text-left text-sm last:border-0"
                      >
                        <b>{customer.firstName} {customer.lastName}</b> · {customer.phone}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {attachedCustomer && (
            <div className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm">
              <div className="text-xs text-[var(--muted-foreground)]">Pharmacy Credit balance</div>
              <div className={`font-semibold ${customerBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}>
                {customerBalance >= 0 ? 'Credit available' : 'Customer owes'}: {formatCurrency(Math.abs(customerBalance))}
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: Product search + selectable items */}
        <div className="col-span-7 space-y-4">
          <Card>
            <div className="mb-3">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search products by SKU, name, or barcode"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            {filteredProducts.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                {searchQuery ? `No results for "${searchQuery}". Try checking the spelling or scanning the barcode directly.` : 'Cart is empty. Scan a barcode to start.'}
              </div>
            ) : (
              <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => {
                      setCart((prev) => {
                        const existing = prev.find((item) => item.product.id === product.id)
                        if (existing) {
                          return prev.map((item) =>
                            item.product.id === product.id
                              ? { ...item, quantity: item.quantity + 1 }
                              : item
                          )
                        }
                        return [...prev, { product, quantity: 1, unitPriceCents: product.priceCents }]
                      })
                      setScanFeedback({ type: 'success', message: `Added ${product.name}` })
                    }}
                    className="flex flex-col justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-left"
                  >
                    <div>
                      <div className="font-semibold text-[var(--foreground)]">{product.name}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">SKU: {product.sku}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-[var(--muted-foreground)]">Cost: {formatCurrency(product.costCents)}</span>
                      <span className="font-semibold text-[var(--primary)]">{formatCurrency(product.priceCents)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right: Cart + Payment */}
        <div className="col-span-5 space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
              <h3 className="font-semibold text-[var(--foreground)]">Current Cart</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{cart.length} line items</span>
            </div>

            <div className="mt-3 max-h-[180px] space-y-2 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-4 text-center text-sm text-[var(--muted-foreground)]">
                  Cart is empty. Search or scan to add items.
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.product.id} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs">
                    <div className="flex-1 pr-2">
                      <div className="font-medium text-[var(--foreground)]">{item.product.name}</div>
                      <div className="text-[var(--muted-foreground)]">{formatCurrency(item.unitPriceCents)} × {item.quantity}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-[var(--radius)] border border-[var(--border)]">
                        <button onClick={() => handleQuantityChange(item.product.id, -1)} className="px-2 py-1 text-[var(--foreground)]">
                          −
                        </button>
                        <span className="px-2 text-[var(--foreground)]">{item.quantity}</span>
                        <button onClick={() => handleQuantityChange(item.product.id, 1)} className="px-2 py-1 text-[var(--foreground)]">
                          +
                        </button>
                      </div>
                      <span className="w-14 text-right font-semibold text-[var(--foreground)]">
                        {formatCurrency(item.unitPriceCents * item.quantity)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              <div className="flex justify-between text-sm text-[var(--muted-foreground)]">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
                <span>Tax ({taxRatePercent}%)</span>
                <span>{formatCurrency(taxCents)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base font-semibold text-[var(--foreground)]">
                <span>Total due</span>
                <span className="text-[var(--primary)]">{formatCurrency(totalCents)}</span>
              </div>
            </div>
          </Card>

          {/* Payment */}
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
              <CardDescription>Enter cash amount or charge card.</CardDescription>
            </CardHeader>
            <div className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-[var(--foreground)]">Cash received</label>
                <input
                  ref={tenderRef}
                  type="number"
                  step="0.01"
                  min="0"
                  value={tenderedDollars}
                  onChange={(e) => setTenderedDollars(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                />
              </div>

              {/* Overpaid — give change or deposit to credit */}
              {tenderedCents > totalCents && (
                <div className="rounded-[var(--radius)] border border-[var(--success)]/30 bg-[var(--muted)] p-3">
                  <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">
                    Overpaid by {formatCurrency(tenderedCents - totalCents)}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => void completeSale('CASH')}
                      className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--foreground)]"
                    >
                      Give change ({formatCurrency(changeCents)})
                    </button>
                    {attachedCustomer ? (
                      <button
                        onClick={() => void completeSale('CASH', 0, tenderedCents - totalCents)}
                        className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-2 text-xs font-semibold text-[var(--primary-foreground)]"
                      >
                        Deposit {formatCurrency(tenderedCents - totalCents)} to credit
                      </button>
                    ) : (
                      <button
                        onClick={() => setScanFeedback({ type: 'error', message: 'Attach a customer to deposit overpayment to their credit.' })}
                        className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--muted-foreground)]"
                      >
                        Deposit to credit
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Underpaid — put the rest on customer's tab */}
              {tenderedCents > 0 && tenderedCents < totalCents && attachedCustomer && (
                <div className="rounded-[var(--radius)] border border-[var(--primary)]/30 bg-[var(--muted)] p-3">
                  <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">
                    Short by {formatCurrency(shortCents)}
                  </div>
                  <button
                    onClick={() => void completeSale('CASH', shortCents)}
                    className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-2 text-xs font-semibold text-[var(--primary-foreground)]"
                  >
                    Put {formatCurrency(shortCents)} on {attachedCustomer.firstName}'s tab
                  </button>
                </div>
              )}

              {/* Underpaid but no customer attached */}
              {tenderedCents > 0 && tenderedCents < totalCents && !attachedCustomer && (
                <div className="rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-xs text-[var(--foreground)]">
                  Not enough cash. Attach a customer to put the remaining {formatCurrency(shortCents)} on their tab.
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void completeSale('CASH')}
                  disabled={cart.length === 0 || cardProcessing || tenderedCents < totalCents}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {cardProcessing ? 'Processing…' : 'Pay Cash'}
                </button>
                <button
                  onClick={() => void completeSale('CARD')}
                  disabled={cart.length === 0 || cardProcessing}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-xs font-semibold text-[var(--foreground)] disabled:opacity-50"
                >
                  {cardProcessing ? 'Processing…' : 'Pay Card'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}