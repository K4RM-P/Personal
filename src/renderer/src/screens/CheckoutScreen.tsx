import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type { Product, Customer } from '@shared/types'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'

type ScanFeedback = { type: 'success' | 'error'; message: string } | null

export function CheckoutScreen(): React.JSX.Element {
  const [cart, setCart] = React.useState<
    { product: Product; quantity: number; unitPriceCents: number }[]
  >([])
  const [scanFeedback, setScanFeedback] = React.useState<ScanFeedback>(null)
  const [tenderedDollars, setTenderedDollars] = React.useState('')
  const [tabDollars, setTabDollars] = React.useState('')
  const [cardProcessing, setCardProcessing] = React.useState(false)
  const [attachedCustomer, setAttachedCustomer] = React.useState<
    (Customer & { ledgerEntries?: { balanceAfterCents: number }[] }) | null
  >(null)
  const [customerSearchQuery, setCustomerSearchQuery] = React.useState('')
  const [customerSearchResults, setCustomerSearchResults] = React.useState<Customer[]>([])
  const [customerSearching, setCustomerSearching] = React.useState(false)

  const tenderedCents = Math.round(parseFloat(tenderedDollars || '0') * 100)
  const tabAmountCents = Math.round(parseFloat(tabDollars || '0') * 100)

  const subtotalCents = cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const taxRatePercent = 13
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100)
  const totalCents = subtotalCents + taxCents
  const changeCents = Math.max(0, tenderedCents - totalCents)

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

  useBarcodeScanner(handleBarcode)

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

  const handlePriceOverride = (productId: number, newPriceCents: number): void => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, unitPriceCents: newPriceCents }
          : item
      )
    )
  }

  const completeSale = async (
    tenderType: string,
    _customerId?: number,
    depositCents?: number
  ): Promise<void> => {
    if (cart.length === 0) return
    setCardProcessing(true)
    try {
      if (!window.api?.transaction) {
        setScanFeedback({ type: 'error', message: 'API not available' })
        return
      }
      const effectiveTabAmountCents = depositCents ?? tabAmountCents
      const effectiveTenderedCents = depositCents ? totalCents : tenderedCents
      const transaction = await window.api.transaction.create({
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          costCents: item.product.costCents,
          unitPriceCents: item.unitPriceCents
        })),
        taxRatePercent,
        tenderedCents: effectiveTenderedCents,
        tenderType,
        customerId: attachedCustomer?.id,
        tabAmountCents: effectiveTabAmountCents
      })
      setCart([])
      setTenderedDollars('')
      setTabDollars('')
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
    setCustomerSearching(true)
    try {
      const results = await window.api.customer.search(customerSearchQuery)
      setCustomerSearchResults(results)
    } catch {
      setCustomerSearchResults([])
    } finally {
      setCustomerSearching(false)
    }
  }

  const attachCustomer = async (customer: Customer): Promise<void> => {
    if (!window.api?.customer) return
    try {
      const ledger = await window.api.customerLedger.get(customer.id)
      const balanceAfterCents = ledger.length > 0 ? ledger[ledger.length - 1].balanceAfterCents : 0
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceAfterCents }] })
      setCustomerSearchQuery('')
      setCustomerSearchResults([])
    } catch {
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceAfterCents: 0 }] })
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cart */}
        <Card>
          <CardHeader>
            <CardTitle>Cart ({cart.length} items)</CardTitle>
            <CardDescription>Scan barcode or search products to add items.</CardDescription>
          </CardHeader>
          <div className="space-y-2 text-xs">
            {cart.length === 0 && (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-4 text-center text-[var(--muted-foreground)]">
                Cart is empty. Scan a barcode to start.
              </div>
            )}
            {cart.map((item) => (
              <div
                key={item.product.id}
                className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3"
              >
                <div className="flex-1">
                  <div className="font-semibold text-[var(--foreground)]">{item.product.name}</div>
                  <div className="text-[var(--muted-foreground)]">SKU: {item.product.sku}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[var(--muted-foreground)]">Price</div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={(item.unitPriceCents / 100).toFixed(2)}
                      onChange={(e) =>
                        handlePriceOverride(
                          item.product.id,
                          Math.round(parseFloat(e.target.value || '0') * 100)
                        )
                      }
                      className="w-20 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right text-[var(--foreground)]"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleQuantityChange(item.product.id, -1)}
                      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-semibold text-[var(--foreground)]">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleQuantityChange(item.product.id, 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]"
                    >
                      +
                    </button>
                  </div>
                  <div className="w-20 text-right font-semibold text-[var(--foreground)]">
                    {formatCurrency(item.unitPriceCents * item.quantity)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Totals & Payment */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Subtotal</span>
                <span className="font-semibold text-[var(--foreground)]">{formatCurrency(subtotalCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Tax ({taxRatePercent}%)</span>
                <span className="font-semibold text-[var(--foreground)]">{formatCurrency(taxCents)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border)] pt-2">
                <span className="font-bold text-[var(--foreground)]">Total</span>
                <span className="font-bold text-[var(--foreground)]">{formatCurrency(totalCents)}</span>
              </div>
            </div>
          </Card>

          {/* Customer attachment */}
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
              <CardDescription>Attach a customer for credit / loyalty.</CardDescription>
            </CardHeader>
            <div className="space-y-2 text-xs">
              {attachedCustomer ? (
                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-2">
                  <div>
                    <div className="font-semibold text-[var(--foreground)]">{attachedCustomer.name}</div>
                    <div className="text-[var(--muted-foreground)]">{attachedCustomer.phone}</div>
                  </div>
                  <button
                    onClick={() => setAttachedCustomer(null)}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCustomerSearch()
                    }}
                    placeholder="Search by name or phone…"
                    className="flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]"
                  />
                  <button
                    onClick={handleCustomerSearch}
                    disabled={customerSearching}
                    className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                  >
                    {customerSearching ? '…' : 'Search'}
                  </button>
                </div>
              )}
              {customerSearchResults.length > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {customerSearchResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => void attachCustomer(c)}
                      className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-left text-[var(--foreground)]"
                    >
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-[var(--muted-foreground)]">{c.phone}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Tender */}
          <Card>
            <CardHeader>
              <CardTitle>Tender</CardTitle>
              <CardDescription>Enter cash amount or use card.</CardDescription>
            </CardHeader>
            <div className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-[var(--foreground)]">Cash tendered</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tenderedDollars}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !cardProcessing && cart.length > 0) {
                      event.preventDefault()
                      handleCashCheckout()
                    }
                  }}
                  onChange={(e) => setTenderedDollars(e.target.value)}
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                />
                {tenderedCents > 0 && (
                  <>
                    <div className="mt-2 flex justify-between text-xs font-medium text-[var(--success)]"><span>Change due</span><span>{formatCurrency(changeCents)}</span></div>
                    {tenderedCents > totalCents && <div className="mt-3 rounded-[var(--radius)] border border-[var(--primary)]/30 bg-[var(--muted)] p-3"><div className="mb-2 text-xs font-semibold text-[var(--foreground)]">You gave {formatCurrency(tenderedCents - totalCents)} extra</div><div className="grid grid-cols-2 gap-2"><button onClick={() => completeSale('CASH')} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 text-xs font-semibold">Give change</button>{attachedCustomer ? <button onClick={() => completeSale('CASH', undefined, tenderedCents - totalCents)} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-2 text-xs font-semibold text-[var(--primary-foreground)]">Deposit to pharmacy credit</button> : <button onClick={() => setScanFeedback({ type: 'error', message: 'Attach a customer before depositing the extra cash.' })} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-2 text-xs font-semibold">Deposit to credit</button>}</div></div>}
                  </>
                )}
              </div>

              {attachedCustomer && (
                <div className="rounded-[var(--radius)] border border-[var(--primary)]/30 bg-[var(--muted)] p-3">
                  <label className="mb-1 block text-xs font-semibold text-[var(--foreground)]">Pharmacy Credit tender</label>
                  <div className="text-xs text-[var(--muted-foreground)]">Current balance: {(attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0) >= 0 ? 'Credit available' : 'Customer owes'} {formatCurrency(Math.abs(attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0))}</div>
                  <input value={tabDollars} onChange={e => setTabDollars(e.target.value)} type="number" step="0.01" min="0" className="mt-2 min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 text-sm" placeholder="Amount to charge to tab"/>
                  {tabAmountCents > 0 && <div className="mt-1 text-xs text-[var(--muted-foreground)]">Remaining to collect: {formatCurrency(Math.max(0, totalCents - tabAmountCents))}</div>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void completeSale('CASH')}
                  disabled={cart.length === 0 || cardProcessing || tenderedCents < totalCents}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {cardProcessing ? 'Processing…' : 'Complete Cash Sale'}
                </button>
                <button
                  onClick={() => void completeSale('CARD')}
                  disabled={cart.length === 0 || cardProcessing}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-xs font-semibold text-[var(--foreground)] disabled:opacity-50"
                >
                  {cardProcessing ? 'Processing…' : 'Charge Card'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}