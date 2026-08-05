import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { EmptyState } from '../components/ui/EmptyState'
import { DiscountModal } from '../components/DiscountModal'
import { RefundsScreen } from './RefundsScreen'
import { formatCurrency } from '@shared/formatCurrency'
import type { Product, Customer, TransactionWithItems, ChargeResult } from '@shared/types'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { Lock, RotateCcw, ShoppingCart, SearchX, ScanLine, ArrowUpRight, ArrowDownRight, Banknote, Send, CreditCard, HeartHandshake, ChevronLeft } from 'lucide-react'

type ScanFeedback = { type: 'success' | 'error'; message: string } | null
type PaymentMethod = 'CASH' | 'E_TRANSFER' | 'CARD' | 'PHARMACY_CREDIT' | null
type CardType = 'DEBIT' | 'CREDIT' | null
type CartItem = { product: Product; quantity: number; unitPriceCents: number; discountCents?: number; discountReason?: string; hstApplied?: boolean }

export function CheckoutScreen(): React.JSX.Element {
  const [products, setProducts] = React.useState<Product[]>([])
  const [searchQuery, setSearchQuery] = React.useState('')
  const [cart, setCart] = React.useState<CartItem[]>([])
  const [discountItemTarget, setDiscountItemTarget] = React.useState<number | null>(null)
  const [showBillDiscountModal, setShowBillDiscountModal] = React.useState(false)
  const [billDiscountCents, setBillDiscountCents] = React.useState(0)
  const [billDiscountReason, setBillDiscountReason] = React.useState<string | undefined>(undefined)
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
  const [receiptError, setReceiptError] = React.useState(false)
  const [parkedCarts, setParkedCarts] = React.useState<{ id: string; name: string; items: CartItem[] }[]>([])
  const [paymentState, setPaymentState] = React.useState<'idle' | 'awaiting' | 'processing' | 'approved' | 'declined' | 'timeout'>('idle')
  const [paymentMessage, setPaymentMessage] = React.useState<string | null>(null)
  const [manualPrompt, setManualPrompt] = React.useState<{ amountCents: number; orderRef: string } | null>(null)
  const [manualRef, setManualRef] = React.useState('')
  const [showRefunds, setShowRefunds] = React.useState(false)

  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>(null)
  const [cardType, setCardType] = React.useState<CardType>(null)
  const [applySurcharge, setApplySurcharge] = React.useState(false)
  const [eTransferEmail, setETransferEmail] = React.useState('')
  const [eTransferConfirmed, setETransferConfirmed] = React.useState(false)
  const [checkoutSettings, setCheckoutSettings] = React.useState({
    allowCreditCardSurcharge: false,
    cardSurchargePercent: 2,
    allowShortPayToTab: false
  })

  const [showAddCustomer, setShowAddCustomer] = React.useState(false)
  const [newCustomer, setNewCustomer] = React.useState({ firstName: '', lastName: '', phone: '', address: '', email: '' })
  const [customerCreationError, setCustomerCreationError] = React.useState<string | null>(null)
  const [creatingCustomer, setCreatingCustomer] = React.useState(false)

  const searchRef = React.useRef<HTMLInputElement>(null)
  const tenderRef = React.useRef<HTMLInputElement>(null)

  const tenderedCents = Math.round(parseFloat(tenderedDollars || '0') * 100)

  const rawSubtotalCents = cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const itemDiscountTotalCents = cart.reduce((sum, item) => sum + (item.discountCents ?? 0), 0)
  // Reflects item discounts already, matching the receipt's SUBTOTAL line.
  const subtotalCents = rawSubtotalCents - itemDiscountTotalCents
  const effectiveBillDiscountCents = Math.min(billDiscountCents, subtotalCents)
  // Bill discount reduces the pre-tax total further; tax is never charged on
  // an amount that was discounted away.
  const preTaxCents = subtotalCents - effectiveBillDiscountCents
  const taxRatePercent = 13
  // Only items with HST applied contribute to the taxable amount; the whole-bill
  // discount is spread proportionally across taxable vs. non-taxable lines.
  const taxableSubtotalCents = cart.reduce((sum, item) => {
    if (item.hstApplied === false) return sum
    const lineRawCents = item.unitPriceCents * item.quantity
    const lineDiscountCents = item.discountCents ?? 0
    return sum + (lineRawCents - lineDiscountCents)
  }, 0)
  const taxableAfterBillDiscountCents =
    subtotalCents > 0 ? taxableSubtotalCents - (effectiveBillDiscountCents * taxableSubtotalCents) / subtotalCents : 0
  const taxCents = Math.round((taxableAfterBillDiscountCents * taxRatePercent) / 100)
  const allHstOn = cart.length > 0 && cart.every((item) => item.hstApplied !== false)
  const surchargeCents = cardType === 'CREDIT' && applySurcharge
    ? Math.floor(preTaxCents * checkoutSettings.cardSurchargePercent / 100)
    : 0
  const effectiveTotal = preTaxCents + taxCents + surchargeCents
  const changeCents = Math.max(0, tenderedCents - effectiveTotal)
  const shortCents = Math.max(0, effectiveTotal - tenderedCents)
  const customerBalance = attachedCustomer?.ledgerEntries?.[0]?.balanceCents ?? 0

  React.useEffect(() => {
    const loadSettings = async (): Promise<void> => {
      try {
        if (window.api?.settings?.getCheckout) {
          const settings = await window.api.settings.getCheckout()
          setCheckoutSettings(settings)
        }
      } catch (err) {
        console.error('Failed to load checkout settings:', err)
      }
    }
    void loadSettings()
  }, [])

  React.useEffect(() => {
    if (!window.api?.product) return
    const q = searchQuery.trim()
    if (!q) {
      setProducts([])
      return
    }
    const timer = setTimeout(() => {
      window.api.product
        .search(q, 50)
        .then(setProducts)
        .catch((err) => console.error('Product search failed:', err))
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Live, debounced customer search — fires as the cashier types (no Enter required)
  React.useEffect(() => {
    if (!window.api?.customer || attachedCustomer) return
    const q = customerSearchQuery.trim()
    if (!q) {
      setCustomerSearchResults([])
      return
    }
    const timer = setTimeout(() => {
      window.api.customer
        .search(q)
        .then(setCustomerSearchResults)
        .catch(() => setCustomerSearchResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [customerSearchQuery, attachedCustomer])

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

  const handleToggleItemHst = (productId: number): void => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, hstApplied: item.hstApplied === false } : item
      )
    )
  }

  const handleToggleWholeCartHst = (): void => {
    setCart((prev) => {
      const nextValue = !allHstOn
      return prev.map((item) => ({ ...item, hstApplied: nextValue }))
    })
  }

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
    tenderType: 'CASH' | 'CARD' | 'E_TRANSFER' | 'PHARMACY_CREDIT' | 'SPLIT',
    tabAmountCents?: number,
    cashOverageToCreditCents?: number,
    surchargeCentsArg?: number,
    email?: string,
    cardMeta?: { processorTransactionId?: string; cardLast4?: string }
  ): Promise<void> => {
    if (cart.length === 0) return
    setCardProcessing(true)
    try {
      if (!window.api?.transaction) {
        setScanFeedback({ type: 'error', message: 'API not available' })
        return
      }
      const finalTendered = tenderType === 'E_TRANSFER' ? effectiveTotal : tenderedCents
      const transaction = await window.api.transaction.create({
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          costCents: item.product.costCents,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents ?? 0,
          discountReason: item.discountReason,
          hstApplied: item.hstApplied !== false
        })),
        taxRatePercent,
        tenderedCents: finalTendered,
        tenderType,
        customerId: attachedCustomer?.id,
        tabAmountCents: tabAmountCents ?? 0,
        cashOverageToCreditCents: cashOverageToCreditCents ?? 0,
        surchargeCents: surchargeCentsArg ?? 0,
        email: email || undefined,
        billDiscountCents: effectiveBillDiscountCents,
        billDiscountReason,
        processorTransactionId: cardMeta?.processorTransactionId,
        cardLast4: cardMeta?.cardLast4
      })
      setActiveReceipt(transaction)
      setCart([])
      setTenderedDollars('')
      setAttachedCustomer(null)
      setPaymentMethod(null)
      setCardType(null)
      setApplySurcharge(false)
      setETransferEmail('')
      setETransferConfirmed(false)
      setBillDiscountCents(0)
      setBillDiscountReason(undefined)
      setScanFeedback({ type: 'success', message: `Sale complete — ${transaction.receiptNumber}` })
    } catch (err) {
      setScanFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Transaction failed' })
    } finally {
      setCardProcessing(false)
    }
  }

  const handleCashCheckout = (): void => {
    if (cart.length === 0) return
    if (tenderedCents < effectiveTotal && !attachedCustomer) {
      setScanFeedback({ type: 'error', message: 'Not enough cash. Attach a customer to put the shortfall on their tab.' })
      return
    }
    if (tenderedCents + (attachedCustomer ? Math.max(0, attachedCustomer.ledgerEntries?.[0]?.balanceCents ?? 0) : 0) < effectiveTotal) {
      setScanFeedback({ type: 'error', message: 'Tendered amount is less than the total due.' })
      return
    }
    if (tenderedCents >= effectiveTotal) {
      void completeSale('CASH')
    } else if (attachedCustomer) {
      void completeSale('CASH', shortCents)
    }
  }

  const applyChargeResult = (result: ChargeResult): void => {
    if (result.status === 'approved') {
      setPaymentState('approved')
      setPaymentMessage(`Card approved${result.cardLast4 ? ` (card •••• ${result.cardLast4})` : ''}`)
      void completeSale('CARD', undefined, undefined, surchargeCents, undefined, {
        processorTransactionId: result.transactionId,
        cardLast4: result.cardLast4
      })
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
    const cardAmount = effectiveTotal

    if (!window.api?.payment) {
      setPaymentState('timeout')
      setPaymentMessage('Payment service unavailable.')
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

  const handleETransferComplete = (): void => {
    if (cart.length === 0 || !eTransferConfirmed) return
    void completeSale('E_TRANSFER', undefined, undefined, 0, eTransferEmail || undefined)
  }

  const handlePharmacyCreditCheckout = (): void => {
    if (cart.length === 0) return
    if (!attachedCustomer) {
      setScanFeedback({ type: 'error', message: 'Attach a customer before using Pharmacy Credit.' })
      return
    }
    if (customerBalance < effectiveTotal && !checkoutSettings.allowShortPayToTab) {
      setScanFeedback({ type: 'error', message: 'Balance insufficient for full Pharmacy Credit payment. Add another tender.' })
      return
    }
    void completeSale('PHARMACY_CREDIT', effectiveTotal)
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
      // Read the authoritative balance from the Prisma credit ledger (same store
      // that sales charge and the backend Pharmacy Credit guard read), not the
      // Setting-table ledger — those two stores can diverge.
      const detail = (await window.api.customer.get(customer.id)) as Customer & { currentBalanceCents?: number }
      const balanceCents = detail.currentBalanceCents ?? 0
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceCents }] })
      setCustomerSearchQuery('')
      setCustomerSearchResults([])
    } catch {
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceCents: 0 }] })
    }
  }

  const handleCreateCustomer = async (): Promise<void> => {
    if (!newCustomer.firstName.trim() || !newCustomer.lastName.trim() || !newCustomer.phone.trim() || !newCustomer.address.trim()) {
      setCustomerCreationError('First name, last name, phone, and address are required.')
      return
    }
    if (window.api?.customer?.findDuplicatePhone) {
      const dup = await window.api.customer.findDuplicatePhone(newCustomer.phone)
      if (dup) {
        setCustomerCreationError(`A customer with phone ${newCustomer.phone} already exists.`)
        return
      }
    }
    try {
      setCreatingCustomer(true)
      const created = await window.api.customer.create({
        firstName: newCustomer.firstName.trim(),
        lastName: newCustomer.lastName.trim(),
        phone: newCustomer.phone.trim(),
        address: newCustomer.address.trim(),
        email: newCustomer.email.trim() || undefined
      })
      await attachCustomer(created)
      setShowAddCustomer(false)
      setNewCustomer({ firstName: '', lastName: '', phone: '', address: '', email: '' })
      setCustomerCreationError(null)
    } catch (err) {
      setCustomerCreationError(err instanceof Error ? err.message : 'Failed to create customer')
    } finally {
      setCreatingCustomer(false)
    }
  }

  const handlePrintReceipt = async (): Promise<void> => {
    if (!activeReceipt || !window.api?.receipt) return
    setPrintStatus('Printing…')
    setReceiptError(false)
    try {
      const result = await window.api.receipt.print(activeReceipt)
      if (result.success) {
        setPrintStatus('Receipt printed successfully ✓ — closing…')
        setReceiptPdfUrl(result.pdfDataUrl ?? null)
        // Give the cashier ~2s to see the confirmation, then close and reset checkout.
        setTimeout(() => dismissReceipt(), 2000)
      } else {
        setPrintStatus(result.message || 'Printer unavailable')
        setReceiptPdfUrl(result.pdfDataUrl ?? null)
        setReceiptError(true)
      }
    } catch (err) {
      setPrintStatus(err instanceof Error ? err.message : 'Printer unavailable')
      setReceiptError(true)
    }
  }

  const dismissReceipt = (): void => {
    setActiveReceipt(null)
    setPrintStatus(null)
    setReceiptPdfUrl(null)
    setReceiptError(false)
  }

  const resetPaymentMethod = (): void => {
    setPaymentMethod(null)
    setCardType(null)
    setApplySurcharge(false)
    setETransferEmail('')
    setETransferConfirmed(false)
    setPaymentMessage(null)
    setPaymentState('idle')
  }

  const filteredProducts = products

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Checkout</h1>
        <button
          onClick={() => setShowRefunds(true)}
          className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
        >
          <RotateCcw className="h-4 w-4" /> Refunds
        </button>
      </div>

      {/* Scan feedback */}
      {scanFeedback && <Alert variant={scanFeedback.type}>{scanFeedback.message}</Alert>}

      <div className="grid grid-cols-12 gap-4">
        {/* Left: Customer attachment + Product search + selectable items */}
        <div className="col-span-7 space-y-4">
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
                      placeholder="Attach customer — search name or phone, then Enter"
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
                    {/* No results → offer to add a new customer */}
                    {customerSearchQuery.trim() !== '' && customerSearchResults.length === 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-center text-sm shadow-sm">
                        <div className="mb-2 text-[var(--muted-foreground)]">Customer not found</div>
                        <button
                          onClick={() => {
                            setNewCustomer((prev) => ({ ...prev, lastName: customerSearchQuery.trim() }))
                            setShowAddCustomer(true)
                          }}
                          className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
                        >
                          + Add new customer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {attachedCustomer && (
                <div className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm">
                  <div className="text-xs text-[var(--muted-foreground)]">Pharmacy Credit balance</div>
                  <div className={`flex items-center gap-1.5 font-semibold ${customerBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}>
                    {customerBalance >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    <span>{customerBalance >= 0 ? 'Credit available' : 'Customer owes'}: {formatCurrency(Math.abs(customerBalance))}</span>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="mb-3">
              <input
                type="text"
                placeholder="Search products by SKU, name, or barcode"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            {filteredProducts.length === 0 ? (
              <EmptyState
                icon={searchQuery.trim() ? SearchX : ScanLine}
                title={searchQuery.trim() ? `No results for "${searchQuery}"` : 'Search to load items'}
                description={
                  searchQuery.trim()
                    ? 'Try checking the spelling, or scan the barcode directly.'
                    : 'Type a name, SKU, or barcode, or scan an item.'
                }
              />
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
                <EmptyState icon={ShoppingCart} title="Cart is empty" description="Search or scan to add items." className="p-4" />
              ) : (
                cart.map((item) => {
                  const lineRawCents = item.unitPriceCents * item.quantity
                  const lineDiscountCents = item.discountCents ?? 0
                  const lineTotalCents = lineRawCents - lineDiscountCents
                  const itemHstOn = item.hstApplied !== false
                  return (
                    <div key={item.product.id} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs">
                      <div className="flex-1 pr-2">
                        <div className="font-medium text-[var(--foreground)]">{item.product.name}</div>
                        <div className="text-[var(--muted-foreground)]">
                          {formatCurrency(item.unitPriceCents)} × {item.quantity}
                          {lineDiscountCents > 0 && <span className="text-[var(--success)]"> · discount {formatCurrency(lineDiscountCents)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-[var(--radius)] border border-[var(--border)]">
                          <button onClick={() => handleQuantityChange(item.product.id, -1)} className="px-2 py-1 text-[var(--foreground)]">−</button>
                          <span className="px-2 text-[var(--foreground)]">{item.quantity}</span>
                          <button onClick={() => handleQuantityChange(item.product.id, 1)} className="px-2 py-1 text-[var(--foreground)]">+</button>
                        </div>
                        <button
                          onClick={() => setDiscountItemTarget(item.product.id)}
                          className={`min-h-7 rounded-[var(--radius)] border px-1.5 text-[10px] font-semibold ${lineDiscountCents > 0 ? 'border-[var(--success)] text-[var(--success)]' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}
                        >
                          {lineDiscountCents > 0 ? 'Edit' : 'Discount'}
                        </button>
                        <label
                          className={`flex min-h-7 items-center gap-1 rounded-[var(--radius)] border px-1.5 text-[10px] font-semibold ${itemHstOn ? 'border-[var(--border)] text-[var(--foreground)]' : 'border-[var(--warning)] text-[var(--warning)]'}`}
                          title="Charge HST on this item"
                        >
                          <input
                            type="checkbox"
                            checked={itemHstOn}
                            onChange={() => handleToggleItemHst(item.product.id)}
                            className="h-3 w-3"
                          />
                          HST
                        </label>
                        <div className="w-14 text-right">
                          {lineDiscountCents > 0 && (
                            <div className="text-[10px] text-[var(--muted-foreground)] line-through">{formatCurrency(lineRawCents)}</div>
                          )}
                          <span className="font-semibold text-[var(--foreground)]">{formatCurrency(lineTotalCents)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              <div className="flex justify-between text-sm text-[var(--muted-foreground)]">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotalCents)}</span>
              </div>
              {itemDiscountTotalCents > 0 && (
                <div className="flex justify-between text-sm text-[var(--success)]">
                  <span>Item discounts</span>
                  <span>-{formatCurrency(itemDiscountTotalCents)}</span>
                </div>
              )}
              {effectiveBillDiscountCents > 0 && (
                <div className="flex items-center justify-between text-sm text-[var(--success)]">
                  <span>Bill discount</span>
                  <span className="flex items-center gap-2">
                    -{formatCurrency(effectiveBillDiscountCents)}
                    <button
                      onClick={() => { setBillDiscountCents(0); setBillDiscountReason(undefined) }}
                      className="text-[10px] text-[var(--muted-foreground)] underline"
                    >
                      remove
                    </button>
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
                <span>HST ({taxRatePercent}%)</span>
                <span>{formatCurrency(taxCents)}</span>
              </div>
              {surchargeCents > 0 && (
                <div className="flex items-center justify-between text-sm text-[var(--warning)]">
                  <span>Credit card fee ({checkoutSettings.cardSurchargePercent}%)</span>
                  <span>{formatCurrency(surchargeCents)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base font-semibold text-[var(--foreground)]">
                <span>Total due</span>
                <span className="text-[var(--primary)]">{formatCurrency(effectiveTotal)}</span>
              </div>
              <button
                onClick={() => setShowBillDiscountModal(true)}
                disabled={cart.length === 0}
                className="w-full min-h-9 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-medium text-[var(--foreground)] disabled:opacity-50"
              >
                {effectiveBillDiscountCents > 0 ? 'Edit whole-bill discount' : 'Whole Bill Discount'}
              </button>
              <button
                onClick={handleToggleWholeCartHst}
                disabled={cart.length === 0}
                className={`w-full min-h-9 rounded-[var(--radius)] border px-3 text-xs font-medium disabled:opacity-50 ${allHstOn ? 'border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]' : 'border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]'}`}
              >
                {allHstOn ? 'Remove HST from Whole Cart' : 'Charge HST on Whole Cart'}
              </button>
            </div>
          </Card>

          {/* Payment method selection */}
          <Card>
            <CardHeader>
              <CardTitle>How will they pay?</CardTitle>
              <CardDescription>Choose a payment method to continue.</CardDescription>
            </CardHeader>

            {paymentMethod === null ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod('CASH')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Banknote className="h-5 w-5 shrink-0" />
                  CASH
                </button>
                <button
                  onClick={() => setPaymentMethod('E_TRANSFER')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-5 w-5 shrink-0" />
                  E-TRANSFER
                </button>
                <button
                  onClick={() => setPaymentMethod('CARD')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CreditCard className="h-5 w-5 shrink-0" />
                  CARD (Debit/Credit)
                </button>
                <button
                  onClick={() => setPaymentMethod('PHARMACY_CREDIT')}
                  disabled={cart.length === 0 || !attachedCustomer}
                  title={!attachedCustomer ? 'Attach a customer to use Pharmacy Credit' : undefined}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HeartHandshake className="h-5 w-5 shrink-0" />
                  PHARMACY CREDIT
                </button>
                <button
                  onClick={handleParkSale}
                  disabled={cart.length === 0}
                  className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Hold / Park sale
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3 text-xs">
                <button onClick={resetPaymentMethod} className="flex min-h-9 items-center gap-1 rounded-[var(--radius)] px-1 text-[var(--primary)] hover:bg-[var(--muted)]">
                  <ChevronLeft className="h-4 w-4" />
                  Back to payment methods
                </button>

                {/* CASH */}
                {paymentMethod === 'CASH' && (
                  <div className="space-y-3">
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
                    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
                      Paid: {formatCurrency(tenderedCents)} | Change: {formatCurrency(changeCents)}
                    </div>

                    {tenderedCents > effectiveTotal && attachedCustomer && (
                      <button
                        onClick={() => void completeSale('CASH', 0, tenderedCents - effectiveTotal)}
                        className="w-full min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--foreground)]"
                      >
                        Deposit {formatCurrency(tenderedCents - effectiveTotal)} overpayment to credit
                      </button>
                    )}

                    {tenderedCents > 0 && tenderedCents < effectiveTotal && attachedCustomer && (
                      <button
                        onClick={() => void completeSale('CASH', shortCents)}
                        disabled={customerBalance < shortCents && !checkoutSettings.allowShortPayToTab}
                        className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                      >
                        Put {formatCurrency(shortCents)} on {attachedCustomer.firstName}&apos;s tab
                      </button>
                    )}

                    <button
                      onClick={handleCashCheckout}
                      disabled={cardProcessing || tenderedCents < effectiveTotal}
                      className="w-full min-h-11 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] disabled:opacity-50"
                    >
                      Complete Cash Sale
                    </button>
                  </div>
                )}

                {/* E-TRANSFER */}
                {paymentMethod === 'E_TRANSFER' && (
                  <div className="space-y-3">
                    <div className="text-center">
                      <div className="text-xs text-[var(--muted-foreground)]">Amount due via E-Transfer</div>
                      <div className="text-3xl font-bold text-[var(--primary)]">{formatCurrency(effectiveTotal)}</div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[var(--muted-foreground)]">Customer email for E-Transfer (optional)</label>
                      <input
                        type="email"
                        value={eTransferEmail}
                        onChange={(e) => setETransferEmail(e.target.value)}
                        placeholder={attachedCustomer?.email || 'name@example.com'}
                        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                      <input type="checkbox" checked={eTransferConfirmed} onChange={(e) => setETransferConfirmed(e.target.checked)} />
                      I have received the E-Transfer confirmation
                    </label>
                    <button
                      onClick={handleETransferComplete}
                      disabled={!eTransferConfirmed || cardProcessing}
                      className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                    >
                      Complete Sale
                    </button>
                  </div>
                )}

                {/* CARD */}
                {paymentMethod === 'CARD' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCardType('DEBIT')}
                        className={`flex-1 min-h-11 rounded-[var(--radius)] border px-3 text-sm font-semibold ${cardType === 'DEBIT' ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)] text-[var(--foreground)]'}`}
                      >
                        Debit
                      </button>
                      <button
                        onClick={() => setCardType('CREDIT')}
                        className={`flex-1 min-h-11 rounded-[var(--radius)] border px-3 text-sm font-semibold ${cardType === 'CREDIT' ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)] text-[var(--foreground)]'}`}
                      >
                        Credit
                      </button>
                    </div>

                    {cardType === 'CREDIT' && (
                      <div className="rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-xs text-[var(--foreground)]">
                        <label className="flex items-center gap-2 font-semibold">
                          <input
                            type="checkbox"
                            checked={applySurcharge}
                            onChange={() => setApplySurcharge((v) => !v)}
                          />
                          Apply {checkoutSettings.cardSurchargePercent}% credit card surcharge
                        </label>
                        {applySurcharge && (
                          <div className="mt-2">
                            Original: {formatCurrency(subtotalCents + taxCents)} + {checkoutSettings.cardSurchargePercent}% credit fee: {formatCurrency(surchargeCents)} = Total: {formatCurrency(effectiveTotal)}
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={startCardCheckout}
                      disabled={!cardType || cardProcessing}
                      className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                    >
                      {cardProcessing ? 'Processing…' : `Charge ${formatCurrency(effectiveTotal)}`}
                    </button>
                  </div>
                )}

                {/* PHARMACY CREDIT */}
                {paymentMethod === 'PHARMACY_CREDIT' && (
                  <div className="space-y-3">
                    {!attachedCustomer ? (
                      <div className="rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-xs text-[var(--foreground)]">
                        Attach a customer to pay with Pharmacy Credit.
                      </div>
                    ) : (
                      <>
                        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
                          Available: {formatCurrency(customerBalance)} | Applying: {formatCurrency(effectiveTotal)}
                        </div>
                        {customerBalance < effectiveTotal && (
                          <Alert variant={checkoutSettings.allowShortPayToTab ? 'warning' : 'error'}>
                            {checkoutSettings.allowShortPayToTab
                              ? `Balance is short by ${formatCurrency(effectiveTotal - customerBalance)}; this will push the tab negative.`
                              : 'Balance insufficient; short-pay to tab is disabled. Add another tender.'}
                          </Alert>
                        )}
                        <button
                          onClick={handlePharmacyCreditCheckout}
                          disabled={cardProcessing || (customerBalance < effectiveTotal && !checkoutSettings.allowShortPayToTab)}
                          className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                        >
                          Pay with Pharmacy Credit
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Payment status message — approved/declined/timeout are visually
                    distinct per the design guide (a decline ≠ a timeout: retrying a
                    genuinely-declined card wastes time, but retrying a timeout risks
                    a double-charge). */}
                {paymentMessage && (
                  <Alert
                    variant={
                      paymentState === 'approved'
                        ? 'success'
                        : paymentState === 'declined'
                          ? 'error'
                          : paymentState === 'timeout'
                            ? 'warning'
                            : 'pending'
                    }
                  >
                    {paymentMessage}
                  </Alert>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Add-customer modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-3">
            <CardTitle className="text-[var(--foreground)]">Add new customer</CardTitle>
            {customerCreationError && <Alert variant="error">{customerCreationError}</Alert>}
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="First name" value={newCustomer.firstName} onChange={(e) => setNewCustomer((p) => ({ ...p, firstName: e.target.value }))} className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
              <input placeholder="Last name" value={newCustomer.lastName} onChange={(e) => setNewCustomer((p) => ({ ...p, lastName: e.target.value }))} className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            </div>
            <input placeholder="Phone (required)" value={newCustomer.phone} onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            <input placeholder="Address" value={newCustomer.address} onChange={(e) => setNewCustomer((p) => ({ ...p, address: e.target.value }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            <input placeholder="Email (optional)" value={newCustomer.email} onChange={(e) => setNewCustomer((p) => ({ ...p, email: e.target.value }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => { setShowAddCustomer(false); setCustomerCreationError(null) }}
                disabled={creatingCustomer}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateCustomer()}
                disabled={creatingCustomer}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {creatingCustomer ? 'Saving…' : 'Create & attach'}
              </button>
            </div>
          </Card>
        </div>
      )}

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
              <button onClick={() => confirmManualPayment('declined')} disabled={cardProcessing} className="rounded-[var(--radius)] bg-[var(--error-bg)] px-3 py-2 text-sm font-medium text-[var(--error)] disabled:opacity-50">Declined</button>
              <button onClick={() => confirmManualPayment('approved')} disabled={cardProcessing} className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">Approved</button>
            </div>
            <button onClick={() => setManualPrompt(null)} disabled={cardProcessing} className="w-full text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50">Cancel</button>
          </Card>
        </div>
      )}

      {/* Receipt printing popup — not dismissable by outside click, forces an explicit choice */}
      {activeReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
            <div>
              <CardTitle className="text-[var(--foreground)]">Sale complete — {activeReceipt.receiptNumber}</CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                Total {formatCurrency(activeReceipt.totalCents)} · Paid via {activeReceipt.tenderType.replace('_', '-')}
              </CardDescription>
            </div>

            {printStatus && <Alert variant={receiptError ? 'error' : 'success'}>{printStatus}</Alert>}

            {!receiptError ? (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void handlePrintReceipt()} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]">
                  Print Receipt
                </button>
                <button onClick={dismissReceipt} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]">
                  Skip
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => void handlePrintReceipt()} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]">
                  Retry
                </button>
                {receiptPdfUrl ? (
                  <a href={receiptPdfUrl} download={`receipt-${activeReceipt.receiptNumber}.pdf`} className="min-h-11 flex items-center justify-center rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)]">
                    PDF
                  </a>
                ) : (
                  <button disabled className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--muted-foreground)] opacity-50">PDF</button>
                )}
                <button onClick={dismissReceipt} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]">
                  Skip
                </button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Per-item discount */}
      {discountItemTarget !== null && (() => {
        const item = cart.find((i) => i.product.id === discountItemTarget)
        if (!item) return null
        const lineTotalCents = item.unitPriceCents * item.quantity
        return (
          <DiscountModal
            title={`Discount: ${item.product.name} (qty ${item.quantity})`}
            baseLabel={`Line total: ${formatCurrency(lineTotalCents)}`}
            baseCents={lineTotalCents}
            initialDiscountCents={item.discountCents ?? 0}
            initialReason={item.discountReason}
            onApply={(discountCents, reason) => {
              setCart((prev) =>
                prev.map((i) => (i.product.id === discountItemTarget ? { ...i, discountCents, discountReason: reason } : i))
              )
              setDiscountItemTarget(null)
            }}
            onCancel={() => setDiscountItemTarget(null)}
          />
        )
      })()}

      {/* Whole-bill discount */}
      {showBillDiscountModal && (
        <DiscountModal
          title="Whole Bill Discount"
          baseLabel={`Current subtotal (pre-tax): ${formatCurrency(subtotalCents)}`}
          baseCents={subtotalCents}
          initialDiscountCents={billDiscountCents}
          initialReason={billDiscountReason}
          onApply={(discountCents, reason) => {
            setBillDiscountCents(discountCents)
            setBillDiscountReason(reason)
            setShowBillDiscountModal(false)
          }}
          onCancel={() => setShowBillDiscountModal(false)}
        />
      )}

      {showRefunds && <RefundsScreen onClose={() => setShowRefunds(false)} />}

    </div>
  )
}
