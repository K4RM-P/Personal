import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type { Product, Customer, TransactionWithItems, ChargeResult } from '@shared/types'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { Lock } from 'lucide-react'

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
  const [activeReceipt, setActiveReceipt] = React.useState<TransactionWithItems | null>(null)
  const [printStatus, setPrintStatus] = React.useState<string | null>(null)
  const [receiptPdfUrl, setReceiptPdfUrl] = React.useState<string | null>(null)
  const [parkedCarts, setParkedCarts] = React.useState<{ id: string; name: string; items: { product: Product; quantity: number; unitPriceCents: number }[] }[]>([])
  const [recentTransactions, setRecentTransactions] = React.useState<TransactionWithItems[]>([])
  const [paymentState, setPaymentState] = React.useState<'idle' | 'awaiting' | 'processing' | 'approved' | 'declined' | 'timeout'>('idle')
  const [paymentMessage, setPaymentMessage] = React.useState<string | null>(null)
  const [manualPrompt, setManualPrompt] = React.useState<{ amountCents: number; orderRef: string } | null>(null)
  const [manualRef, setManualRef] = React.useState('')

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
    const loadTransactions = async (): Promise<void> => {
      try {
        if (window.api?.transaction) {
          const txs = await window.api.transaction.getAll()
          setRecentTransactions(txs)
        }
      } catch (err) {
        console.error('Failed to load transactions:', err)
      }
    }
    void loadTransactions()
  }, [])

  // Product results come from the server, capped, and debounced. The register
  // must never pull the whole catalogue into memory (50k+ rows) just to filter
  // it in the browser — that was the source of the multi-second freeze.
  React.useEffect(() => {
    if (!window.api?.product) return
    const timer = setTimeout(() => {
      window.api.product
        .search(searchQuery, 50)
        .then(setProducts)
        .catch((err) => console.error('Product search failed:', err))
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

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
          return [...prev, { product, quantity: 1, unitPriceCents: product.priceCents }]
        })
        setScanFeedback({ type: 'success', message: `Added ${product.name}` })
      } catch (err) {
        setScanFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Scan failed' })
      }
    },
    []
  )

  useBarcodeScanner({ onScan: handleBarcode, pauseRefs: [searchRef, tenderRef] })

  const handleQuantityChange = (productId: number, delta: number): void => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta
            return newQty > 0 ? { ...item, quantity: newQty } : null
          }
          return item
        })
        .filter(Boolean) as typeof cart
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
      setActiveReceipt(transaction)
      setCart([])
      setTenderedDollars('')
      setAttachedCustomer(null)
      setScanFeedback({ type: 'success', message: `Sale complete — ${transaction.receiptNumber}` })

      if (window.api?.receipt) {
        const printResult = await window.api.receipt.print(transaction)
        setPrintStatus(printResult.message)
        setReceiptPdfUrl(printResult.pdfDataUrl ?? null)
      }
    } catch (err) {
      setScanFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Transaction failed' })
    } finally {
      setCardProcessing(false)
    }
  }

  const handleCashCheckout = (): void => {
    if (cart.length === 0) return
    if (tenderedCents < totalCents && !attachedCustomer) {
      setScanFeedback({ type: 'error', message: 'Not enough cash. Attach a customer to put the shortfall on their tab.' })
      return
    }
    if (tenderedCents + (attachedCustomer ? Math.max(0, attachedCustomer.ledgerEntries?.[0]?.balanceCents ?? 0) : 0) < totalCents) {
      setScanFeedback({ type: 'error', message: 'Tendered amount is less than the total due.' })
      return
    }
    if (tenderedCents >= totalCents) {
      void completeSale('CASH')
    } else if (attachedCustomer) {
      void completeSale('CASH', shortCents)
    }
  }

  const applyChargeResult = (result: ChargeResult): void => {
    if (result.status === 'approved') {
      setPaymentState('approved')
      setPaymentMessage(`Card approved${result.cardLast4 ? ` (card •••• ${result.cardLast4})` : ''}`)
      void completeSale('CARD')
    } else if (result.status === 'error') {
      setPaymentState('timeout')
      setPaymentMessage(result.message || 'Payment timed out.')
    } else {
      setPaymentState('declined')
      setPaymentMessage(result.message || 'Card was not approved')
    }
  }

  const startCardCheckout = async (): Promise<void> => {
    if (cart.length === 0 || cardProcessing) return
    setPaymentState('awaiting')
    setPaymentMessage('Waiting for terminal response…')
    const orderRef = `SALE-${Date.now()}`
    const cardAmount = totalCents

    if (!window.api?.payment) {
      alert('Payment service unavailable')
      return
    }

    setCardProcessing(true)
    try {
      const result = await window.api.payment.charge(cardAmount, orderRef)
      applyChargeResult(result)
    } catch (err) {
      setPaymentState('timeout')
      setPaymentMessage(err instanceof Error ? err.message : 'Payment timed out')
    } finally {
      setCardProcessing(false)
    }
  }

  const confirmManualPayment = async (outcome: 'approved' | 'declined'): Promise<void> => {
    if (!manualPrompt || !window.api?.payment) return
    const { amountCents, orderRef } = manualPrompt
    setPaymentState(outcome === 'approved' ? 'processing' : 'declined')
    setCardProcessing(true)
    try {
      const result = await window.api.payment.charge(amountCents, orderRef, {
        manualOutcome: outcome,
        manualReference: manualRef.trim() || undefined
      })
      setManualPrompt(null)
      applyChargeResult(result)
    } catch (err) {
      setPaymentState('timeout')
      setPaymentMessage(err instanceof Error ? err.message : 'Payment timed out')
    } finally {
      setCardProcessing(false)
    }
  }

  const handleParkSale = (): void => {
    if (cart.length === 0) return
    const parkId = `PARK-${Date.now()}`
    const name = `Parked Cart ${parkedCarts.length + 1} (${cart.length} items)`
    setParkedCarts((prev) => [...prev, { id: parkId, name, items: [...cart] }])
    setCart([])
  }

  const handleResumeParkedSale = (parkId: string): void => {
    const parked = parkedCarts.find((p) => p.id === parkId)
    if (parked) {
      setCart(parked.items)
      setParkedCarts((prev) => prev.filter((p) => p.id !== parkId))
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

  // Results are already searched + capped server-side; render them as-is.
  const filteredProducts = products

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
                <button onClick={() => { setAttachedCustomer(null); setTenderedDollars('') }} className="text-[var(--primary)]">
                  Remove
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={searchRef}
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCustomerSearch() }}
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
                {searchQuery ? `No results for "${searchQuery}". Try checking the spelling or scanning the barcode directly.` : 'Cart is empty. Search or scan to add items.'}
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

          {/* Parked Sales */}
          {parkedCarts.length > 0 && (
            <Card className="border-[var(--warning)]/30 bg-[var(--warning-bg)]">
              <h3 className="mb-2 text-sm font-semibold text-[var(--warning)]">Parked Sales ({parkedCarts.length})</h3>
              <div className="space-y-2">
                {parkedCarts.map((parked) => (
                  <div key={parked.id} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 text-xs">
                    <span className="font-medium text-[var(--foreground)]">{parked.name}</span>
                    <button
                      onClick={() => handleResumeParkedSale(parked.id)}
                      className="rounded-[var(--radius)] bg-[var(--warning)] px-2 py-1 font-medium text-[var(--primary-foreground)]"
                    >
                      Resume Sale
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recent Transactions */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Completed Transactions</CardTitle>
              <CardDescription>Persisted sales records</CardDescription>
            </CardHeader>
            <div className="space-y-2 mt-2">
              {recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-[var(--foreground)]">{tx.receiptNumber}</div>
                    <div className="text-[var(--muted-foreground)]">
                      {new Date(tx.createdAt).toLocaleTimeString()} • {tx.items.length} items • Status:{' '}
                      <span className={tx.status === 'VOIDED' ? 'font-bold text-[var(--error)]' : 'text-[var(--success)]'}>
                        {tx.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-[var(--primary)]">{formatCurrency(tx.totalCents)}</span>
                  </div>
                </div>
              ))}
            </div>
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
                        <button onClick={() => handleQuantityChange(item.product.id, -1)} className="px-2 py-1 text-[var(--foreground)]">−</button>
                        <span className="px-2 text-[var(--foreground)]">{item.quantity}</span>
                        <button onClick={() => handleQuantityChange(item.product.id, 1)} className="px-2 py-1 text-[var(--foreground)]">+</button>
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
                      onClick={handleCashCheckout}
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

              {/* Payment status message */}
              {paymentMessage && (
                <div
                  className={`rounded-[var(--radius)] border px-3 py-2 text-xs ${
                    paymentState === 'approved'
                      ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]'
                      : paymentState === 'declined'
                        ? 'border-[var(--error)]/30 bg-[var(--error-bg)] text-[var(--error)]'
                      : paymentState === 'timeout'
                        ? 'border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning)]'
                      : 'border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]'
                  }`}
                >
                  {paymentMessage}
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleParkSale}
                  disabled={cart.length === 0 || cardProcessing}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-3 text-xs font-medium text-[var(--foreground)] disabled:opacity-50"
                >
                  <span className="flex items-center justify-center gap-1"><Lock className="h-3.5 w-3.5" />Hold / Park</span>
                </button>
                <button
                  onClick={startCardCheckout}
                  disabled={cart.length === 0 || cardProcessing}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 py-3 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {cardProcessing ? 'Processing…' : 'Pay Card'}
                </button>
                <button
                  onClick={handleCashCheckout}
                  disabled={cart.length === 0 || cardProcessing || (tenderedCents < totalCents && !attachedCustomer)}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 py-3 text-xs font-semibold text-[var(--primary)] disabled:opacity-50"
                >
                  Pay Cash
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Manual / External Terminal confirmation */}
      {manualPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
            <div>
              <CardTitle className="text-[var(--foreground)]">External Terminal Payment</CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                Charge this amount on your standalone card terminal, then confirm the result below.
              </CardDescription>
            </div>
            <div className="text-center py-2">
              <div className="text-xs text-[var(--muted-foreground)]">Amount to charge</div>
              <div className="text-3xl font-bold text-[var(--primary)]">{formatCurrency(manualPrompt.amountCents)}</div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Terminal reference # (optional)</label>
              <input
                type="text"
                placeholder="e.g. receipt / approval number"
                value={manualRef}
                onChange={(e) => setManualRef(e.target.value)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => confirmManualPayment('declined')}
                disabled={cardProcessing}
                className="rounded-[var(--radius)] bg-[var(--error-bg)] px-3 py-2 text-sm font-medium text-[var(--error)] disabled:opacity-50"
              >
                Declined
              </button>
              <button
                onClick={() => confirmManualPayment('approved')}
                disabled={cardProcessing}
                className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                Approved
              </button>
            </div>
            <button
              onClick={() => setManualPrompt(null)}
              disabled={cardProcessing}
              className="w-full text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              Cancel
            </button>
          </Card>
        </div>
      )}

      {/* On-Screen Receipt Modal */}
      {activeReceipt && (
        <Card className="border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)]">Receipt Summary</h2>
              <p className="text-xs text-[var(--muted-foreground)]">Transaction #{activeReceipt.receiptNumber}</p>
              {printStatus && <p className="mt-1 text-xs text-[var(--success)]">{printStatus}</p>}
            </div>
            <div className="flex items-center gap-2">
              {receiptPdfUrl && (
                <a
                  href={receiptPdfUrl}
                  download={`receipt-${activeReceipt.receiptNumber}.pdf`}
                  className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-1 text-xs text-[var(--primary-foreground)]"
                >
                  Download PDF
                </a>
              )}
              <button
                onClick={() => { setActiveReceipt(null); setPrintStatus(null); setReceiptPdfUrl(null) }}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-1 text-xs text-[var(--foreground)]"
              >
                Close Receipt
              </button>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            {activeReceipt.items.map((item) => (
              <div key={item.id} className="flex justify-between text-[var(--foreground)]">
                <span>{item.product.name} (x{item.quantity})</span>
                <span>{formatCurrency(item.totalCents)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1 border-t border-[var(--border)] pt-3 text-xs">
            <div className="flex justify-between text-[var(--muted-foreground)]">
              <span>Subtotal:</span>
              <span>{formatCurrency(activeReceipt.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-[var(--muted-foreground)]">
              <span>Tax:</span>
              <span>{formatCurrency(activeReceipt.taxCents)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-[var(--foreground)]">
              <span>Total:</span>
              <span className="text-[var(--primary)]">{formatCurrency(activeReceipt.totalCents)}</span>
            </div>
            <div className="flex justify-between text-[var(--success)]">
              <span>Tendered ({activeReceipt.tenderType}):</span>
              <span>{formatCurrency(activeReceipt.tenderedCents)}</span>
            </div>
            <div className="flex justify-between text-[var(--success)]">
              <span>Change Due:</span>
              <span>{formatCurrency(activeReceipt.changeCents)}</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}