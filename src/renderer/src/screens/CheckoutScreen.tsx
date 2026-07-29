import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import {
  Product,
  CartItem,
  TransactionWithItems,
  ChargeResult,
  PaymentInteractionMode
} from '@shared/types'
import { formatCurrency } from '@shared/formatCurrency'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { Lock, ShieldAlert, WifiOff, Printer, CircleAlert, CheckCircle2, AlertTriangle } from 'lucide-react'

export function CheckoutScreen() {
  const [products, setProducts] = React.useState<Product[]>([])
  const [searchQuery, setSearchQuery] = React.useState('')
  const [cart, setCart] = React.useState<CartItem[]>([])
  const [taxRatePercent] = React.useState<number>(13)
  const [tenderedDollars, setTenderedDollars] = React.useState<string>('')
  const [activeReceipt, setActiveReceipt] = React.useState<TransactionWithItems | null>(null)
  const [printStatus, setPrintStatus] = React.useState<string | null>(null)
  const [receiptPdfUrl, setReceiptPdfUrl] = React.useState<string | null>(null)
  const [scanFeedback, setScanFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [parkedCarts, setParkedCarts] = React.useState<{ id: string; name: string; items: CartItem[] }[]>([])
  const [managerOverride, setManagerOverride] = React.useState<boolean>(false)
  const [recentTransactions, setRecentTransactions] = React.useState<TransactionWithItems[]>([])
  const [scannerConnected, setScannerConnected] = React.useState(true)
  const [printerOnline, setPrinterOnline] = React.useState(true)
  const [dbIssue, setDbIssue] = React.useState<string | null>(null)
  const [paymentState, setPaymentState] = React.useState<'idle' | 'awaiting' | 'processing' | 'approved' | 'declined' | 'timeout'>('idle')

  // Payment (Stage 5). `paymentMode` drives checkout without knowing the processor.
  const [paymentMode, setPaymentMode] = React.useState<PaymentInteractionMode>('automatic')
  const [cardProcessing, setCardProcessing] = React.useState<boolean>(false)
  const [, setCardStatus] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [manualPrompt, setManualPrompt] = React.useState<{ amountCents: number; orderRef: string } | null>(null)
  const [manualRef, setManualRef] = React.useState<string>('')
  const [paymentMessage, setPaymentMessage] = React.useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [customerMatches, setCustomerMatches] = React.useState<any[]>([])
  const [attachedCustomer, setAttachedCustomer] = React.useState<any>(null)
  const [tabDollars, setTabDollars] = React.useState('')
  const [creditSettings, setCreditSettings] = React.useState<{ allowShortPayToTab: boolean }>({ allowShortPayToTab: false })
  const [quickAdd, setQuickAdd] = React.useState(false)
  const [quickCustomer, setQuickCustomer] = React.useState({ firstName: '', lastName: '', phone: '', address: '', email: '' })

  const searchRef = React.useRef<HTMLInputElement>(null)
  const tenderRef = React.useRef<HTMLInputElement>(null)

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

  const loadPaymentMode = async () => {
    try {
      if (window.api?.settings?.getPayment) {
        const cfg = await window.api.settings.getPayment()
        setPaymentMode(cfg.interactionMode)
      }
    } catch (err) {
      console.error('Failed to load payment mode:', err)
    }
  }

  React.useEffect(() => {
    loadProducts()
    loadTransactions()
    loadPaymentMode()
    window.api.customer.getCreditSettings().then(setCreditSettings).catch(console.error)
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (customerSearch.trim()) window.api.customer.search(customerSearch).then(setCustomerMatches).catch(console.error)
      else setCustomerMatches([])
    }, 200)
    return () => window.clearTimeout(timer)
  }, [customerSearch])

  React.useEffect(() => {
    const currentTotal = cart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0) * (1 + taxRatePercent / 100)
    if (!attachedCustomer || currentTotal <= 0) return
    const balance = attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0
    setTabDollars((Math.min(Math.max(balance, 0), Math.round(currentTotal)) / 100).toFixed(2))
  }, [attachedCustomer?.id, cart, taxRatePercent])

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery))
  )

  const addToCart = React.useCallback((product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }, [])

  const handleBarcodeScan = React.useCallback(async (barcode: string) => {
    setScannerConnected(true)
    try {
      if (window.api?.barcode) {
        const result = await window.api.barcode.scan(barcode)
        if (result.product) {
          addToCart(result.product)
          setScanFeedback({ type: 'success', message: `Scanned: ${result.product.name}` })
        } else {
          setScanFeedback({ type: 'error', message: `No product found for barcode ${barcode}` })
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scan failed'
      setScannerConnected(false)
      setScanFeedback({ type: 'error', message: msg })
    }
    window.setTimeout(() => setScanFeedback(null), 3000)
  }, [addToCart])

  const { scanInputProps } = useBarcodeScanner({
    onScan: handleBarcodeScan,
    pauseRefs: [searchRef, tenderRef]
  })

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
      setScanFeedback({ type: 'error', message: 'Manager override required to void a line item.' })
      return
    }
    setCart((prev) => prev.filter((item) => item.product.id !== productId))
  }

  const subtotalCents = cart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0)
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100)
  const totalCents = subtotalCents + taxCents

  const tenderedCents = Math.round((parseFloat(tenderedDollars) || 0) * 100)
  const tabAmountCents = Math.max(0, Math.round((parseFloat(tabDollars) || 0) * 100))
  const changeCents = Math.max(0, tenderedCents - totalCents)

  // Records the finished sale + prints the receipt. Card sales only reach here
  // after the PaymentProvider returned "approved".
  const completeSale = async (tenderType: 'CASH' | 'CARD' | 'SPLIT' | 'TAB', cardAmountCents?: number): Promise<void> => {
    if (dbIssue) {
      setScanFeedback({ type: 'error', message: dbIssue })
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
        tenderedCents: tenderType === 'CASH' || tenderType === 'SPLIT' ? tenderedCents : (cardAmountCents ?? totalCents),
        customerId: attachedCustomer?.id,
        tabAmountCents
      }

      if (window.api && window.api.transaction) {
        const tx = await window.api.transaction.create(payload)
        setActiveReceipt(tx)
        setCart([])
        setTenderedDollars('')
        setTabDollars('')
        setAttachedCustomer(null)
        loadTransactions()

        if (window.api.receipt) {
          const printResult = await window.api.receipt.print(tx)
          if (printResult?.message?.toLowerCase().includes('error') || printResult?.message?.toLowerCase().includes('offline')) {
            setPrinterOnline(false)
          }
          setPrintStatus(printResult.message)
          setReceiptPdfUrl(printResult.pdfDataUrl ?? null)
        }
      }
    } catch (err: any) {
      setDbIssue(err?.message || 'Database connection issue. Sale cannot safely continue.')
      setScanFeedback({ type: 'error', message: err?.message || 'Database connection issue.' })
    }
  }

  const handleCashCheckout = () => {
    if (cart.length === 0) return
    const availableCredit = Math.max(0, attachedCustomer?.ledgerEntries?.[0]?.balanceAfterCents ?? 0)
    if (tabAmountCents > availableCredit && !creditSettings.allowShortPayToTab) {
      setScanFeedback({ type: 'error', message: 'Pharmacy Credit only has enough available credit for the displayed balance. Use another tender for the remainder.' })
      return
    }
    if (tenderedCents + tabAmountCents < totalCents) {
      setScanFeedback({ type: 'error', message: 'Tendered amount is less than the total due.' })
      return
    }
    completeSale(tabAmountCents ? 'SPLIT' : 'CASH')
  }

  // Applies a card charge result: approved → record the sale; otherwise abort
  // and surface the reason. Provider-agnostic — same for Stripe, Moneris, manual…
  const applyChargeResult = (result: ChargeResult): void => {
    if (result.status === 'approved') {
      const detail = [result.cardLast4 && `card •••• ${result.cardLast4}`, result.authCode && `auth ${result.authCode}`]
        .filter(Boolean)
        .join(' · ')
      setPaymentState('approved')
      setPaymentMessage(`Card approved${detail ? ` (${detail})` : ''}`)
      setCardStatus({ ok: true, message: `Card approved${detail ? ` (${detail})` : ''}` })
      completeSale(tabAmountCents ? 'SPLIT' : 'CARD', totalCents - tabAmountCents)
    } else if (result.status === 'error') {
      setPaymentState('timeout')
      setPaymentMessage(result.message || 'Payment timed out. Verify the terminal status before retrying.')
      setCardStatus({ ok: false, message: result.message || 'Payment timed out' })
    } else {
      setPaymentState('declined')
      setPaymentMessage(result.message || 'Card was not approved')
      setCardStatus({ ok: false, message: result.message || 'Card was not approved' })
    }
  }

  // "Pay Card" entry point. Automatic providers charge inline; manual/external
  // terminals open a confirmation prompt so the cashier can record the outcome.
  const startCardCheckout = async () => {
    if (cart.length === 0 || cardProcessing) return
    const availableCredit = Math.max(0, attachedCustomer?.ledgerEntries?.[0]?.balanceAfterCents ?? 0)
    if (tabAmountCents > availableCredit && !creditSettings.allowShortPayToTab) {
      setScanFeedback({ type: 'error', message: 'Pharmacy Credit only has enough available credit for the displayed balance. Use another tender for the remainder.' })
      return
    }
    setCardStatus(null)
    setPaymentState('awaiting')
    setPaymentMessage('Waiting for terminal response…')
    const orderRef = `SALE-${Date.now()}`
    const cardAmount = totalCents - tabAmountCents
    if (cardAmount <= 0) { completeSale('TAB'); return }

    if (!window.api?.payment) {
      alert('Payment service unavailable')
      return
    }

    if (paymentMode === 'manual') {
      setManualRef('')
      setManualPrompt({ amountCents: cardAmount, orderRef })
      return
    }

    setCardProcessing(true)
    try {
      const result = await window.api.payment.charge(cardAmount, orderRef)
      applyChargeResult(result)
    } catch (err: any) {
      setPaymentState('timeout')
      setPaymentMessage(err?.message || 'Payment timed out')
      setCardStatus({ ok: false, message: err?.message || 'Payment failed' })
    } finally {
      setCardProcessing(false)
    }
  }

  const confirmManualPayment = async (outcome: 'approved' | 'declined') => {
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
    } catch (err: any) {
      setPaymentState('timeout')
      setPaymentMessage(err?.message || 'Payment timed out')
      setCardStatus({ ok: false, message: err?.message || 'Payment failed' })
    } finally {
      setCardProcessing(false)
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

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setManualPrompt(null)
        setDbIssue(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="space-y-6">
      {/* Hidden keyboard-wedge barcode scanner input — always refocused unless search/tender active */}
      <input
        {...scanInputProps}
        className="sr-only"
        tabIndex={-1}
      />

      {scanFeedback && (
        <div
          className={`rounded-[var(--radius)] border p-3 text-sm ${
            scanFeedback.type === 'success'
              ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]'
              : 'border-[var(--error)]/30 bg-[var(--error-bg)] text-[var(--error)]'
          }`}
        >
          {scanFeedback.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">Checkout Register</h1>
          <p className="text-[var(--muted-foreground)]">Fast, touch-first checkout with visible totals and clear state handling.</p>
        </div>
        <div className="flex items-center space-x-3 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2">
          <span className="text-xs text-[var(--muted-foreground)]">Manager Mode</span>
          <button
            onClick={() => setManagerOverride(!managerOverride)}
            className={`rounded-[var(--radius)] px-3 py-1.5 text-xs font-semibold ${
              managerOverride ? 'bg-[var(--warning-bg)] text-[var(--warning)]' : 'bg-[var(--muted)] text-[var(--foreground)]'
            }`}
          >
            {managerOverride ? 'ENABLED' : 'DISABLED'}
          </button>
        </div>
      </div>

      <Card className="border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Customer (optional)</label>
            {attachedCustomer ? <div className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-3 text-sm"><span className="font-semibold">{attachedCustomer.firstName} {attachedCustomer.lastName} · {attachedCustomer.phone}</span><button onClick={() => { setAttachedCustomer(null); setTabDollars('') }} className="text-[var(--primary)]">Remove</button></div> : <div className="relative"><input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Attach customer — search name or phone" className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"/>{customerMatches.length > 0 && <div className="absolute z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">{customerMatches.map(customer => <button key={customer.id} onClick={() => { setAttachedCustomer(customer); setCustomerSearch(''); setCustomerMatches([]) }} className="block min-h-11 w-full border-b border-[var(--border)] px-3 text-left text-sm last:border-0"><b>{customer.firstName} {customer.lastName}</b> · {customer.phone}</button>)}</div>}<button onClick={() => setQuickAdd(!quickAdd)} className="mt-2 text-xs font-semibold text-[var(--primary)]">Customer not found? Quick add</button>{quickAdd && <div className="mt-2 grid grid-cols-2 gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2"><input value={quickCustomer.firstName} onChange={e => setQuickCustomer(s => ({ ...s, firstName: e.target.value }))} placeholder="First name" className="input"/><input value={quickCustomer.lastName} onChange={e => setQuickCustomer(s => ({ ...s, lastName: e.target.value }))} placeholder="Last name" className="input"/><input value={quickCustomer.phone} onChange={e => setQuickCustomer(s => ({ ...s, phone: e.target.value }))} placeholder="Phone" className="input"/><input value={quickCustomer.address} onChange={e => setQuickCustomer(s => ({ ...s, address: e.target.value }))} placeholder="Address" className="input"/><button onClick={() => void window.api.customer.create(quickCustomer).then(created => { setAttachedCustomer(created); setQuickAdd(false); setQuickCustomer({ firstName: '', lastName: '', phone: '', address: '', email: '' }) }).catch(error => setScanFeedback({ type: 'error', message: error.message }))} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)]">Add & attach</button></div>}</div>}</div>
          {attachedCustomer && <div className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"><div className="text-xs text-[var(--muted-foreground)]">Pharmacy Credit balance</div><div className="font-semibold">{(attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0) >= 0 ? 'Credit available' : 'Customer owes'}: {formatCurrency(Math.abs(attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0))}</div></div>}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-7 space-y-4">
          <Card>
            <div className="mb-4 flex items-center space-x-3">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search products by SKU, name, or barcode"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            {!scannerConnected && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--warning)]/25 bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
                <WifiOff className="h-4 w-4" />
                Scanner offline. Manual search and entry still work.
              </div>
            )}

            {!printerOnline && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--warning)]/25 bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
                <Printer className="h-4 w-4" />
                Receipt printer is offline. Sale can still complete and a PDF receipt is available.
              </div>
            )}

            {filteredProducts.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                No results for “{searchQuery}”. Try checking the spelling or scanning the barcode directly.
              </div>
            ) : (
              <div className="grid max-h-[500px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
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

          {/* Parked Sales Section */}
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
        </div>

        {/* Right Column: Cart & Payment Tendering (5 Cols) */}
        <div className="col-span-5 space-y-4">
          <Card className="flex h-[560px] flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <h3 className="font-semibold text-[var(--foreground)]">Current Cart</h3>
                <span className="text-xs text-[var(--muted-foreground)]">{cart.length} line items</span>
              </div>

              <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center text-sm text-[var(--muted-foreground)]">Cart is empty. Search or scan to add the first item.</div>
                ) : (
                  cart.map((item) => (
                    <div key={item.product.id} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs">
                      <div className="flex-1 pr-2">
                        <div className="font-medium text-[var(--foreground)]">{item.product.name}</div>
                        <div className="text-[var(--muted-foreground)]">{formatCurrency(item.product.priceCents)} × {item.quantity}</div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center rounded-[var(--radius)] border border-[var(--border)]">
                          <button onClick={() => updateQuantity(item.product.id, -1)} className="px-2 py-1 text-[var(--foreground)]">
                            −
                          </button>
                          <span className="px-2 text-[var(--foreground)]">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.product.id, 1)} className="px-2 py-1 text-[var(--foreground)]">
                            +
                          </button>
                        </div>
                        <span className="w-14 text-right font-semibold text-[var(--foreground)]">{formatCurrency(item.product.priceCents * item.quantity)}</span>
                        <button onClick={() => removeLineItem(item.product.id)} className="px-1 font-bold text-[var(--error)]">
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3 border-t border-[var(--border)] pt-3">
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

              <div className="pt-2">
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Cash tendered</label>
                <input
                  ref={tenderRef}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
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
                  <div className="mt-2 flex justify-between text-xs font-medium text-[var(--success)]">
                    <span>Change due</span>
                    <span>{formatCurrency(changeCents)}</span>
                  </div>
                )}
              </div>

              {attachedCustomer && (
                <div className="rounded-[var(--radius)] border border-[var(--primary)]/30 bg-[var(--muted)] p-3">
                  <label className="mb-1 block text-xs font-semibold text-[var(--foreground)]">Pharmacy Credit tender</label>
                  <div className="text-xs text-[var(--muted-foreground)]">Current balance: {(attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0) >= 0 ? 'Credit available' : 'Customer owes'} {formatCurrency(Math.abs(attachedCustomer.ledgerEntries?.[0]?.balanceAfterCents ?? 0))}</div>
                  <input value={tabDollars} onChange={e => setTabDollars(e.target.value)} type="number" step="0.01" min="0" className="mt-2 min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 text-sm" placeholder="Amount to charge to tab"/>
                  {tabAmountCents > 0 && <div className="mt-1 text-xs text-[var(--muted-foreground)]">Remaining after tab: {formatCurrency(Math.max(0, totalCents - tabAmountCents))}{creditSettings.allowShortPayToTab ? ' · Short-pay to tab is enabled' : ''}</div>}
                </div>
              )}

              {paymentMessage && (
                <div className={`rounded-[var(--radius)] border px-3 py-2 text-xs ${
                  paymentState === 'approved'
                    ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]'
                    : paymentState === 'declined'
                      ? 'border-[var(--error)]/30 bg-[var(--error-bg)] text-[var(--error)]'
                      : paymentState === 'timeout'
                        ? 'border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning)]'
                        : 'border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]'
                }`}>
                  {paymentState === 'approved' && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                  {paymentState === 'declined' && <CircleAlert className="mr-2 inline h-4 w-4" />}
                  {paymentState === 'timeout' && <AlertTriangle className="mr-2 inline h-4 w-4" />}
                  {paymentState === 'awaiting' && <ShieldAlert className="mr-2 inline h-4 w-4" />}
                  {paymentMessage}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2">
                <button onClick={handleParkSale} disabled={cart.length === 0 || cardProcessing} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-3 text-xs font-medium text-[var(--foreground)] disabled:opacity-50">
                  <span className="flex items-center justify-center gap-1"><Lock className="h-3.5 w-3.5" />Hold / Park</span>
                </button>
                <button onClick={startCardCheckout} disabled={cart.length === 0 || cardProcessing} className="btn-primary rounded-[var(--radius)] bg-[var(--primary)] px-3 py-3 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50" title={paymentMode === 'manual' ? 'Run card on external terminal, then confirm' : undefined}>
                  {cardProcessing ? 'Processing…' : paymentMode === 'manual' ? 'Pay Card' : 'Pay Card'}
                </button>
                <button onClick={handleCashCheckout} disabled={cart.length === 0 || cardProcessing} className="rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 py-3 text-xs font-semibold text-[var(--primary)] disabled:opacity-50">
                  Complete Sale
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Manual / External Terminal confirmation — a first-class flow, not an error state */}
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

      {dbIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-[420px] border-[var(--error)] bg-[var(--card)] p-6 space-y-4">
            <div className="flex items-center gap-2 text-[var(--error)]">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle>Database connection issue</CardTitle>
            </div>
            <CardDescription>{dbIssue}</CardDescription>
            <button onClick={() => setDbIssue(null)} className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]">
              Acknowledge and retry later
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
              {printStatus && (
                <p className="mt-1 text-xs text-[var(--success)]">{printStatus}</p>
              )}
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
                onClick={() => {
                  setActiveReceipt(null)
                  setPrintStatus(null)
                  setReceiptPdfUrl(null)
                }}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-1 text-xs text-[var(--foreground)]"
              >
                Close Receipt
              </button>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            {activeReceipt.items.map((item) => (
              <div key={item.id} className="flex justify-between text-[var(--foreground)]">
                <span>
                  {item.product.name} (x{item.quantity})
                </span>
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
              <div className="flex items-center space-x-3">
                <span className="text-sm font-bold text-[var(--primary)]">{formatCurrency(tx.totalCents)}</span>
                {tx.status !== 'VOIDED' && (
                  <button
                    onClick={() => handleVoidSale(tx.id)}
                    className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-2 py-1 text-xs text-[var(--error)]"
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
