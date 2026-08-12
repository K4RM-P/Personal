import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { EmptyState } from '../components/ui/EmptyState'
import { DiscountModal } from '../components/DiscountModal'
import { CustomProductModal } from '../components/CustomProductModal'
import { RefundsScreen } from './RefundsScreen'
import { formatCurrency } from '@shared/formatCurrency'
import type { Product, Customer, TransactionWithItems, ChargeResult } from '@shared/types'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { buildCustomerDisplayState } from '../lib/customerDisplayState'
import {
  Lock,
  RotateCcw,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  Banknote,
  Send,
  CreditCard,
  HeartHandshake,
  ChevronLeft,
  Pill,
  PackagePlus,
  Trash2,
  MoreVertical,
  Plus,
  Check,
  User,
  AlertCircle,
  X
} from 'lucide-react'
import type { DebtBreakdown } from '@shared/types'

type ScanFeedback = { type: 'success' | 'error'; message: string } | null
type PaymentMethod = 'CASH' | 'E_TRANSFER' | 'CARD' | 'PHARMACY_CREDIT' | null
type CardType = 'DEBIT' | 'CREDIT' | null
type CartItem = {
  product: Product
  quantity: number
  unitPriceCents: number
  discountCents?: number
  discountReason?: string
  hstApplied?: boolean
  hstLocked?: boolean
}
type ParkedCart = {
  id: string
  name: string
  items: CartItem[]
  customer?: { id: number; firstName: string; lastName: string } | null
}

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
  // Stable across retries of the same in-flight card attempt so a timeout-retry reuses
  // the original orderRef instead of minting a new one (which would defeat processor-side
  // idempotency protection and risk a double charge). Cleared on success/cancel/reopen.
  const cardOrderRefRef = React.useRef<string | null>(null)
  const [attachedCustomer, setAttachedCustomer] = React.useState<
    (Customer & { ledgerEntries?: { balanceCents: number }[] }) | null
  >(null)
  const [customerSearchQuery, setCustomerSearchQuery] = React.useState('')
  const [customerSearchResults, setCustomerSearchResults] = React.useState<Customer[]>([])
  const [activeReceipt, setActiveReceipt] = React.useState<TransactionWithItems | null>(null)
  const [printStatus, setPrintStatus] = React.useState<string | null>(null)
  const [receiptPdfUrl, setReceiptPdfUrl] = React.useState<string | null>(null)
  const [receiptError, setReceiptError] = React.useState(false)
  const [parkedCarts, setParkedCarts] = React.useState<ParkedCart[]>([])
  const [showParkModal, setShowParkModal] = React.useState(false)
  const [parkCustomerQuery, setParkCustomerQuery] = React.useState('')
  const [parkCustomerResults, setParkCustomerResults] = React.useState<Customer[]>([])
  const [paymentState, setPaymentState] = React.useState<
    'idle' | 'awaiting' | 'processing' | 'approved' | 'declined' | 'timeout'
  >('idle')
  const [paymentMessage, setPaymentMessage] = React.useState<string | null>(null)
  const [manualPrompt, setManualPrompt] = React.useState<{
    amountCents: number
    orderRef: string
  } | null>(null)
  const [manualRef, setManualRef] = React.useState('')
  const [showRefunds, setShowRefunds] = React.useState(false)
  const [showPayModal, setShowPayModal] = React.useState(false)
  const [customProductMode, setCustomProductMode] = React.useState<'RX' | 'NONRX' | null>(null)
  const [showHeaderMenu, setShowHeaderMenu] = React.useState(false)
  const [showAddMenu, setShowAddMenu] = React.useState(false)
  const [customProductError, setCustomProductError] = React.useState<string | null>(null)

  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>(null)
  const [cardType, setCardType] = React.useState<CardType>(null)
  const [applySurcharge, setApplySurcharge] = React.useState(false)
  const [eTransferEmail, setETransferEmail] = React.useState('')
  const [eTransferConfirmed, setETransferConfirmed] = React.useState(false)
  const [checkoutSettings, setCheckoutSettings] = React.useState({
    allowCreditCardSurcharge: false,
    cardSurchargePercent: 2
  })

  const [showAddCustomer, setShowAddCustomer] = React.useState(false)
  const [newCustomer, setNewCustomer] = React.useState({
    firstName: '',
    lastName: '',
    phone: '',
    address: '',
    email: ''
  })
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
    subtotalCents > 0
      ? taxableSubtotalCents - (effectiveBillDiscountCents * taxableSubtotalCents) / subtotalCents
      : 0
  const taxCents = Math.round((taxableAfterBillDiscountCents * taxRatePercent) / 100)
  const surchargeCents =
    cardType === 'CREDIT' && applySurcharge
      ? Math.floor((preTaxCents * checkoutSettings.cardSurchargePercent) / 100)
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

  // ---- Customer-facing display (second screen) ----------------------------
  // Read-only mirror. Everything here is best-effort: a failure must never
  // affect the sale (spec §11), hence the try/catch and optional chaining.
  const [customerDisplayInfo, setCustomerDisplayInfo] = React.useState({
    pharmacyName: '',
    pharmacyEmail: ''
  })

  React.useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const s = await window.api?.customerDisplay?.getSettings()
        if (s)
          setCustomerDisplayInfo({ pharmacyName: s.pharmacyName, pharmacyEmail: s.eTransferEmail })
      } catch {
        // Second screen is an enhancement; ignore.
      }
    }
    void load()
  }, [])

  const lastPushedRef = React.useRef<string>('')
  React.useEffect(() => {
    const state = buildCustomerDisplayState({
      saleCompleted: activeReceipt !== null,
      pharmacyName: customerDisplayInfo.pharmacyName,
      pharmacyEmail: customerDisplayInfo.pharmacyEmail,
      paymentMethod,
      payModalOpen: showPayModal,
      lineItems: cart.map((item) => ({
        name: item.product.name,
        qty: item.quantity,
        lineTotalCents: item.unitPriceCents * item.quantity - (item.discountCents ?? 0),
        discountCents: item.discountCents ?? undefined
      })),
      subtotalCents,
      billDiscountCents: effectiveBillDiscountCents,
      taxCents,
      // effectiveTotal is surcharge-inclusive — the exact amount charged.
      totalCents: effectiveTotal,
      tenderedCents,
      changeCents,
      customerBalanceCents: customerBalance
    })
    const serialized = JSON.stringify(state)
    if (serialized === lastPushedRef.current) return
    lastPushedRef.current = serialized
    try {
      window.api?.customerDisplay?.push(state)
    } catch {
      // Never let the second screen break checkout.
    }
  }, [
    activeReceipt,
    cart,
    customerBalance,
    customerDisplayInfo,
    changeCents,
    effectiveBillDiscountCents,
    effectiveTotal,
    paymentMethod,
    showPayModal,
    subtotalCents,
    taxCents,
    tenderedCents
  ])

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

  const addProductToCart = (product: Product): void => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { product, quantity: 1, unitPriceCents: product.priceCents }]
    })
    setSearchQuery('')
    setProducts([])
  }

  // A search that resolves to exactly one product is treated the same as a
  // barcode scan — add it straight to the cart instead of making the cashier
  // tap it, so the results panel only ever appears when there's an actual
  // choice to make.
  React.useEffect(() => {
    if (products.length === 1) {
      addProductToCart(products[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])

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

  // Debounced customer search for the optional "attach customer" step when
  // parking a sale — kept separate from the Pharmacy Credit search state
  // above since the two flows can't run into each other but shouldn't share
  // state either.
  React.useEffect(() => {
    if (!window.api?.customer || !showParkModal) return
    const q = parkCustomerQuery.trim()
    if (!q) {
      setParkCustomerResults([])
      return
    }
    const timer = setTimeout(() => {
      window.api.customer
        .search(q)
        .then(setParkCustomerResults)
        .catch(() => setParkCustomerResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [parkCustomerQuery, showParkModal])

  const handleBarcode = React.useCallback(async (barcode: string): Promise<void> => {
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
            item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
          )
        }
        return [...prev, { product, quantity: 1, unitPriceCents: product.priceCents }]
      })
    } catch (err) {
      setScanFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Scan failed'
      })
    }
  }, [])

  useBarcodeScanner({ onScan: handleBarcode, pauseRefs: [searchRef, tenderRef] })

  // Escape closes whichever modal is currently open, topmost first. The PAY
  // popup itself is intentionally excluded before a method is chosen (it
  // requires an explicit Cancel tap per the guide's "no accidental dismiss
  // mid-sale" rule) but escapes out of an in-progress payment sub-flow.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (customProductMode) setCustomProductMode(null)
      else if (discountItemTarget !== null) setDiscountItemTarget(null)
      else if (showBillDiscountModal) setShowBillDiscountModal(false)
      else if (manualPrompt) setManualPrompt(null)
      else if (showAddCustomer) setShowAddCustomer(false)
      else if (showParkModal) setShowParkModal(false)
      else if (paymentMethod) resetPaymentMethod()
      else if (showRefunds) setShowRefunds(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    customProductMode,
    discountItemTarget,
    showBillDiscountModal,
    manualPrompt,
    showAddCustomer,
    showParkModal,
    paymentMethod,
    showRefunds
  ])

  const handleToggleItemHst = (productId: number): void => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId && !item.hstLocked
          ? { ...item, hstApplied: item.hstApplied === false }
          : item
      )
    )
  }

  const handleAddCustomProduct = async (
    mode: 'RX' | 'NONRX',
    data: { name: string; priceCents: number }
  ): Promise<void> => {
    setCustomProductError(null)
    try {
      if (!window.api?.product) {
        setCustomProductError('API not available')
        return
      }
      const sku = `${mode}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const product = await window.api.product.create({
        sku,
        name: data.name,
        costCents: data.priceCents,
        priceCents: data.priceCents,
        isPinned: true
      })
      setCart((prev) => [
        ...prev,
        {
          product,
          quantity: 1,
          unitPriceCents: data.priceCents,
          hstApplied: mode === 'RX' ? false : true,
          hstLocked: mode === 'RX'
        }
      ])
      setCustomProductMode(null)
    } catch (err) {
      setCustomProductError(err instanceof Error ? err.message : 'Failed to add item')
    }
  }

  const handleQuantityChange = (productId: number, delta: number): void => {
    setCart(
      (prev) =>
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
      cardOrderRefRef.current = null
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
      setShowPayModal(false)
    } catch (err) {
      setScanFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Transaction failed'
      })
    } finally {
      setCardProcessing(false)
    }
  }

  const handleCashCheckout = (): void => {
    if (cart.length === 0) return
    if (tenderedCents < effectiveTotal && !attachedCustomer) {
      setScanFeedback({
        type: 'error',
        message: 'Not enough cash. Attach a customer to put the shortfall on their tab.'
      })
      return
    }
    if (
      tenderedCents +
        (attachedCustomer
          ? Math.max(0, attachedCustomer.ledgerEntries?.[0]?.balanceCents ?? 0)
          : 0) <
      effectiveTotal
    ) {
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
      setPaymentMessage(
        `Card approved${result.cardLast4 ? ` (card •••• ${result.cardLast4})` : ''}`
      )
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
    if (!cardOrderRefRef.current) {
      cardOrderRefRef.current = `SALE-${Date.now()}`
    }
    const orderRef = cardOrderRefRef.current
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
    void completeSale('PHARMACY_CREDIT', effectiveTotal)
  }

  const handleParkSale = (): void => {
    if (cart.length === 0) return
    setParkCustomerQuery('')
    setParkCustomerResults([])
    setShowParkModal(true)
  }

  const confirmParkSale = (customer?: Customer): void => {
    const parkId = `PARK-${Date.now()}`
    const name = `Parked Cart ${parkedCarts.length + 1} (${cart.length} items)`
    setParkedCarts((prev) => [
      ...prev,
      {
        id: parkId,
        name,
        items: [...cart],
        customer: customer
          ? { id: customer.id, firstName: customer.firstName, lastName: customer.lastName }
          : null
      }
    ])
    setCart([])
    setShowParkModal(false)
    setParkCustomerQuery('')
    setParkCustomerResults([])
  }

  const handleResumeParkedSale = (parkId: string): void => {
    const parked = parkedCarts.find((p) => p.id === parkId)
    if (parked) {
      setCart(parked.items)
      setParkedCarts((prev) => prev.filter((p) => p.id !== parkId))
    }
  }

  const handleDeleteParkedSale = (parkId: string): void => {
    if (!window.confirm('Delete this parked sale? Its items will be lost.')) return
    setParkedCarts((prev) => prev.filter((p) => p.id !== parkId))
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
      const detail = (await window.api.customer.get(customer.id)) as Customer & {
        currentBalanceCents?: number
      }
      const balanceCents = detail.currentBalanceCents ?? 0
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceCents }] })
      setCustomerSearchQuery('')
      setCustomerSearchResults([])
    } catch {
      setAttachedCustomer({ ...customer, ledgerEntries: [{ balanceCents: 0 }] })
    }
  }

  const handleCreateCustomer = async (): Promise<void> => {
    if (
      !newCustomer.firstName.trim() ||
      !newCustomer.lastName.trim() ||
      !newCustomer.phone.trim() ||
      !newCustomer.address.trim()
    ) {
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
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowHeaderMenu((v) => !v)}
            aria-label="More actions"
            aria-haspopup="true"
            aria-expanded={showHeaderMenu}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--card)]"
          >
            <MoreVertical className="icon-4" />
          </button>
          {showHeaderMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowHeaderMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                <button
                  onClick={() => {
                    setShowRefunds(true)
                    setShowHeaderMenu(false)
                  }}
                  className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  <RotateCcw className="icon-4" /> Refunds
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Scan feedback — errors only; a successful add is already visible in the cart. */}
      {scanFeedback && <Alert variant={scanFeedback.type}>{scanFeedback.message}</Alert>}

      <div className="flex items-start gap-4">
        {/* Parked Sales — sits to the left of the main column instead of stacking
          above the cart, so it doesn't push checkout content down the page. */}
        {parkedCarts.length > 0 && (
          <div className="w-56 shrink-0 space-y-2">
            <Card className="border-[var(--warning)]/30 bg-[var(--warning-bg)]">
              <h3 className="mb-2 text-sm font-semibold text-[var(--warning)]">
                Parked ({parkedCarts.length})
              </h3>
              <div className="space-y-2">
                {parkedCarts.map((parked) => (
                  <div
                    key={parked.id}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[var(--foreground)]">
                        {parked.name}
                      </div>
                      {parked.customer && (
                        <div className="truncate text-[var(--muted-foreground)]">
                          {parked.customer.firstName} {parked.customer.lastName}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={() => handleResumeParkedSale(parked.id)}
                        className="min-h-8 flex-1 rounded-[var(--radius)] bg-[var(--warning)] px-2 py-1 font-medium text-[var(--primary-foreground)]"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => handleDeleteParkedSale(parked.id)}
                        aria-label="Delete parked sale"
                        className="flex min-h-8 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 font-medium text-[var(--error)] hover:bg-[var(--error-bg)]"
                      >
                        <Trash2 className="icon-3_5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          {/* Product search — compact single row. A single match auto-adds to the
          cart (same as a barcode scan); multiple matches drop into a small
          overlay dropdown that never pushes page content down or scrolls
          the page itself — only the dropdown's own list scrolls if it's
          taller than ~4 rows. */}
          <Card className="relative overflow-visible p-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search products by SKU, name, or barcode"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                />
                {searchQuery.trim() !== '' && filteredProducts.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-[190px] w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                    {filteredProducts.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => addProductToCart(product)}
                        className="flex min-h-9 w-full items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 text-left text-sm last:border-0 hover:bg-[var(--muted)]"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-[var(--foreground)]">
                            {product.name}
                          </span>
                          <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                            {product.sku}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold text-[var(--primary)]">
                          {formatCurrency(product.priceCents)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.trim() !== '' && filteredProducts.length === 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-center text-xs text-[var(--muted-foreground)] shadow-sm">
                    No results for &quot;{searchQuery}&quot;
                  </div>
                )}
              </div>
              {/* Single "+" menu replaces the separate RX / Non-RX buttons to save header width. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  title="Add custom item"
                  aria-label="Add custom item"
                  aria-haspopup="true"
                  aria-expanded={showAddMenu}
                  onClick={() => setShowAddMenu((v) => !v)}
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]"
                >
                  <Plus className="icon-5" />
                </button>
                {showAddMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                    <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                      <button
                        onClick={() => {
                          setCustomProductMode('RX')
                          setShowAddMenu(false)
                        }}
                        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--warning)] hover:bg-[var(--muted)]"
                      >
                        <Pill className="icon-4" /> Add RX Item
                      </button>
                      <button
                        onClick={() => {
                          setCustomProductMode('NONRX')
                          setShowAddMenu(false)
                        }}
                        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                      >
                        <PackagePlus className="icon-4" /> Add Non-RX Item
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* Cart — full width */}
          <Card className="p-2.5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-1">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Current Cart</h3>
              <span className="text-xs text-[var(--muted-foreground)]">
                {cart.length} line items
              </span>
            </div>

            <div className="mt-1.5 max-h-[360px] space-y-1 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="Cart is empty"
                  description="Search or scan to add items."
                  className="p-4"
                />
              ) : (
                cart.map((item) => {
                  const lineRawCents = item.unitPriceCents * item.quantity
                  const lineDiscountCents = item.discountCents ?? 0
                  const lineTotalCents = lineRawCents - lineDiscountCents
                  const itemHstOn = item.hstApplied !== false
                  return (
                    <div
                      key={item.product.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                    >
                      <div className="min-w-0 truncate font-medium text-[var(--foreground)]">
                        <span title={item.product.name}>{item.product.name}</span>
                        {lineDiscountCents > 0 && (
                          <span className="ml-1 text-xs font-normal text-[var(--success)]">
                            -{formatCurrency(lineDiscountCents)}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1">
                        <div className="flex min-h-8 items-center rounded-[var(--radius)] border border-[var(--border)]">
                          <button
                            onClick={() => handleQuantityChange(item.product.id, -1)}
                            className="min-w-7 px-1 py-1 text-[var(--foreground)]"
                          >
                            −
                          </button>
                          <span className="px-1 text-[var(--foreground)]">{item.quantity}</span>
                          <button
                            onClick={() => handleQuantityChange(item.product.id, 1)}
                            className="min-w-7 px-1 py-1 text-[var(--foreground)]"
                          >
                            +
                          </button>
                        </div>
                        <button
                          onClick={() => setDiscountItemTarget(item.product.id)}
                          className={`min-h-8 rounded-[var(--radius)] border px-2 text-xs font-semibold ${lineDiscountCents > 0 ? 'border-[var(--success)] text-[var(--success)]' : 'border-[var(--border)] text-[var(--muted-foreground)]'}`}
                        >
                          {lineDiscountCents > 0 ? 'Edit' : 'Disc.'}
                        </button>
                        <button
                          type="button"
                          onClick={() => !item.hstLocked && handleToggleItemHst(item.product.id)}
                          disabled={item.hstLocked}
                          aria-pressed={itemHstOn}
                          className={`flex min-h-8 items-center gap-0.5 rounded-[var(--radius)] border px-2 text-xs font-semibold ${itemHstOn ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--warning)] text-[var(--warning)]'} ${item.hstLocked ? 'opacity-60' : ''}`}
                          title={
                            item.hstLocked
                              ? 'RX items cannot be charged HST'
                              : 'Charge HST on this item'
                          }
                        >
                          {itemHstOn && (
                            <Check
                              className="icon-3_5 text-[var(--primary-foreground)]"
                              aria-hidden="true"
                            />
                          )}
                          HST
                        </button>
                        <div className="w-16 text-right font-semibold text-[var(--foreground)]">
                          {formatCurrency(lineTotalCents)}
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
                      onClick={() => {
                        setBillDiscountCents(0)
                        setBillDiscountReason(undefined)
                      }}
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
              <div className="flex items-stretch gap-2">
                <button
                  onClick={() => setShowBillDiscountModal(true)}
                  disabled={cart.length === 0}
                  title={
                    effectiveBillDiscountCents > 0
                      ? 'Edit whole-bill discount'
                      : 'Whole Bill Discount'
                  }
                  aria-label={
                    effectiveBillDiscountCents > 0
                      ? 'Edit whole-bill discount'
                      : 'Whole Bill Discount'
                  }
                  className={`flex h-14 flex-1 items-center justify-center rounded-[var(--radius)] border text-xs font-semibold disabled:opacity-50 ${effectiveBillDiscountCents > 0 ? 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]' : 'border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]'}`}
                >
                  Disc.
                </button>
                <button
                  onClick={() => {
                    cardOrderRefRef.current = null
                    setShowPayModal(true)
                  }}
                  disabled={cart.length === 0}
                  className="h-14 flex-1 rounded-[var(--radius)] bg-[var(--primary)] text-lg font-bold tracking-wide text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  PAY
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* PAY popup — not dismissable by outside click; explicit Cancel only before a method is picked */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[90vh] w-[480px] max-w-full overflow-y-auto bg-[var(--card)]">
            <CardHeader>
              <CardTitle>How will they pay?</CardTitle>
              <CardDescription>Choose a payment method to continue.</CardDescription>
            </CardHeader>

            {paymentMethod === null ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod('CASH')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Banknote className="icon-5 shrink-0" />
                  CASH
                </button>
                <button
                  onClick={() => setPaymentMethod('E_TRANSFER')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="icon-5 shrink-0" />
                  E-TRANSFER
                </button>
                <button
                  onClick={() => setPaymentMethod('CARD')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CreditCard className="icon-5 shrink-0" />
                  CARD (Debit/Credit)
                </button>
                <button
                  onClick={() => setPaymentMethod('PHARMACY_CREDIT')}
                  disabled={cart.length === 0}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HeartHandshake className="icon-5 shrink-0" />
                  PHARMACY CREDIT
                </button>
                <button
                  onClick={handleParkSale}
                  disabled={cart.length === 0}
                  className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Lock className="icon-3_5" />
                  Hold / Park sale
                </button>
                <button
                  onClick={() => setShowPayModal(false)}
                  className="col-span-2 min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3 text-xs">
                <button
                  onClick={resetPaymentMethod}
                  className="flex min-h-9 items-center gap-1 rounded-[var(--radius)] px-1 text-[var(--primary)] hover:bg-[var(--muted)]"
                >
                  <ChevronLeft className="icon-4" />
                  Back to payment methods
                </button>

                {/* CASH */}
                {paymentMethod === 'CASH' && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block font-semibold text-[var(--foreground)]">
                        Cash received
                      </label>
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
                        Deposit {formatCurrency(tenderedCents - effectiveTotal)} overpayment to
                        credit
                      </button>
                    )}

                    {tenderedCents > 0 && tenderedCents < effectiveTotal && !attachedCustomer && (
                      <div>
                        <label className="mb-1 block font-semibold text-[var(--foreground)]">
                          Attach a customer to put {formatCurrency(shortCents)} on their tab
                        </label>
                        <div className="relative">
                          <input
                            ref={searchRef}
                            value={customerSearchQuery}
                            onChange={(e) => setCustomerSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleCustomerSearch()
                            }}
                            placeholder="Search name or phone, then Enter"
                            className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"
                          />
                          {customerSearchResults.length > 0 && (
                            <div className="relative z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                              {customerSearchResults.map((customer) => (
                                <button
                                  key={customer.id}
                                  onClick={() => void attachCustomer(customer)}
                                  className="block min-h-11 w-full border-b border-[var(--border)] px-3 text-left text-sm last:border-0"
                                >
                                  <b>
                                    {customer.firstName} {customer.lastName}
                                  </b>{' '}
                                  · {customer.phone}
                                </button>
                              ))}
                            </div>
                          )}
                          {/* No results → offer to add a new customer */}
                          {customerSearchQuery.trim() !== '' &&
                            customerSearchResults.length === 0 && (
                              <div className="relative z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-center text-sm shadow-sm">
                                <div className="mb-2 text-[var(--muted-foreground)]">
                                  Customer not found
                                </div>
                                <button
                                  onClick={() => {
                                    setShowAddCustomer(true)
                                  }}
                                  className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
                                >
                                  + Add new customer
                                </button>
                              </div>
                            )}
                        </div>
                      </div>
                    )}

                    {tenderedCents > 0 && tenderedCents < effectiveTotal && attachedCustomer && (
                      <button
                        onClick={() => void completeSale('CASH', shortCents)}
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
                      <div className="text-xs text-[var(--muted-foreground)]">
                        Amount due via E-Transfer
                      </div>
                      <div className="text-3xl font-bold text-[var(--primary)]">
                        {formatCurrency(effectiveTotal)}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[var(--muted-foreground)]">
                        Customer email for E-Transfer (optional)
                      </label>
                      <input
                        type="email"
                        value={eTransferEmail}
                        onChange={(e) => setETransferEmail(e.target.value)}
                        placeholder={attachedCustomer?.email || 'name@example.com'}
                        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                      <input
                        type="checkbox"
                        checked={eTransferConfirmed}
                        onChange={(e) => setETransferConfirmed(e.target.checked)}
                      />
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
                            Original: {formatCurrency(subtotalCents + taxCents)} +{' '}
                            {checkoutSettings.cardSurchargePercent}% credit fee:{' '}
                            {formatCurrency(surchargeCents)} = Total:{' '}
                            {formatCurrency(effectiveTotal)}
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
                      <div>
                        <label className="mb-1 block font-semibold text-[var(--foreground)]">
                          Attach a customer for Pharmacy Credit
                        </label>
                        <div className="relative">
                          <input
                            ref={searchRef}
                            value={customerSearchQuery}
                            onChange={(e) => setCustomerSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleCustomerSearch()
                            }}
                            placeholder="Search name or phone, then Enter"
                            className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"
                          />
                          {customerSearchResults.length > 0 && (
                            <div className="relative z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                              {customerSearchResults.map((customer) => (
                                <button
                                  key={customer.id}
                                  onClick={() => void attachCustomer(customer)}
                                  className="block min-h-11 w-full border-b border-[var(--border)] px-3 text-left text-sm last:border-0"
                                >
                                  <b>
                                    {customer.firstName} {customer.lastName}
                                  </b>{' '}
                                  · {customer.phone}
                                </button>
                              ))}
                            </div>
                          )}
                          {/* No results → offer to add a new customer */}
                          {customerSearchQuery.trim() !== '' &&
                            customerSearchResults.length === 0 && (
                              <div className="relative z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-center text-sm shadow-sm">
                                <div className="mb-2 text-[var(--muted-foreground)]">
                                  Customer not found
                                </div>
                                <button
                                  onClick={() => {
                                    setShowAddCustomer(true)
                                  }}
                                  className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
                                >
                                  + Add new customer
                                </button>
                              </div>
                            )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-3 py-2 text-sm">
                          <span className="font-semibold">
                            {attachedCustomer.firstName} {attachedCustomer.lastName} ·{' '}
                            {attachedCustomer.phone}
                          </span>
                          <button
                            onClick={() => {
                              setAttachedCustomer(null)
                              setTenderedDollars('')
                            }}
                            className="text-[var(--primary)]"
                          >
                            Remove
                          </button>
                        </div>
                        <div
                          className={`flex items-center gap-1.5 text-xs font-semibold ${customerBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}
                        >
                          {customerBalance >= 0 ? (
                            <ArrowUpRight className="icon-4" />
                          ) : (
                            <ArrowDownRight className="icon-4" />
                          )}
                          <span>
                            {customerBalance >= 0 ? 'Credit available' : 'Customer owes'}:{' '}
                            {formatCurrency(Math.abs(customerBalance))}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
                          Available: {formatCurrency(customerBalance)} | Applying:{' '}
                          {formatCurrency(effectiveTotal)}
                        </div>
                        {customerBalance < effectiveTotal && (
                          <Alert variant="warning">
                            {`Balance is short by ${formatCurrency(effectiveTotal - customerBalance)}; this will push the tab negative.`}
                          </Alert>
                        )}
                        <button
                          onClick={handlePharmacyCreditCheckout}
                          disabled={cardProcessing}
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
      )}

      {/* Park-sale modal — optional customer attach before parking */}
      {showParkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-[420px] max-w-full bg-[var(--card)] p-6 space-y-3">
            <div>
              <CardTitle className="text-[var(--foreground)]">
                Attach a customer? (optional)
              </CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                Search to link this parked sale to a customer, or skip.
              </CardDescription>
            </div>
            <div className="relative">
              <input
                value={parkCustomerQuery}
                onChange={(e) => setParkCustomerQuery(e.target.value)}
                placeholder="Search name or phone"
                autoFocus
                className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"
              />
              {parkCustomerResults.length > 0 && (
                <div className="mt-1 max-h-[180px] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                  {parkCustomerResults.map((customer) => (
                    <button
                      key={customer.id}
                      onClick={() => confirmParkSale(customer)}
                      className="block min-h-11 w-full border-b border-[var(--border)] px-3 text-left text-sm last:border-0 hover:bg-[var(--muted)]"
                    >
                      <b>
                        {customer.firstName} {customer.lastName}
                      </b>{' '}
                      · {customer.phone}
                    </button>
                  ))}
                </div>
              )}
              {parkCustomerQuery.trim() !== '' && parkCustomerResults.length === 0 && (
                <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                  No matching customers.
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  setShowParkModal(false)
                  setParkCustomerQuery('')
                  setParkCustomerResults([])
                }}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmParkSale()}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
              >
                Skip &amp; Park
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Add-customer modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-3">
            <CardTitle className="text-[var(--foreground)]">Add new customer</CardTitle>
            {customerCreationError && <Alert variant="error">{customerCreationError}</Alert>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                  First name
                </label>
                <input
                  autoFocus
                  value={newCustomer.firstName}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, firstName: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                  Last name
                </label>
                <input
                  value={newCustomer.lastName}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, lastName: e.target.value }))}
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Phone (required)
              </label>
              <input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Address
              </label>
              <input
                value={newCustomer.address}
                onChange={(e) => setNewCustomer((p) => ({ ...p, address: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Email (optional)
              </label>
              <input
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer((p) => ({ ...p, email: e.target.value }))}
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  setShowAddCustomer(false)
                  setCustomerCreationError(null)
                }}
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
              <div className="text-3xl font-bold text-[var(--primary)]">
                {formatCurrency(manualPrompt.amountCents)}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                Terminal reference # (optional)
              </label>
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

      {/* Receipt printing popup — not dismissable by outside click, forces an explicit choice */}
      {activeReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
            <div>
              <CardTitle className="text-[var(--foreground)]">
                Sale complete — {activeReceipt.receiptNumber}
              </CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                Total {formatCurrency(activeReceipt.totalCents)} · Paid via{' '}
                {activeReceipt.tenderType.replace('_', '-')}
              </CardDescription>
            </div>

            {printStatus && (
              <Alert variant={receiptError ? 'error' : 'success'}>{printStatus}</Alert>
            )}

            {!receiptError ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void handlePrintReceipt()}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
                >
                  Print Receipt
                </button>
                <button
                  onClick={dismissReceipt}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
                >
                  Skip
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => void handlePrintReceipt()}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
                >
                  Retry
                </button>
                {receiptPdfUrl ? (
                  <a
                    href={receiptPdfUrl}
                    download={`receipt-${activeReceipt.receiptNumber}.pdf`}
                    className="min-h-11 flex items-center justify-center rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)]"
                  >
                    PDF
                  </a>
                ) : (
                  <button
                    disabled
                    className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--muted-foreground)] opacity-50"
                  >
                    PDF
                  </button>
                )}
                <button
                  onClick={dismissReceipt}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
                >
                  Skip
                </button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Per-item discount */}
      {discountItemTarget !== null &&
        (() => {
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
                  prev.map((i) =>
                    i.product.id === discountItemTarget
                      ? { ...i, discountCents, discountReason: reason }
                      : i
                  )
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

      {customProductMode && (
        <CustomProductModal
          mode={customProductMode}
          onApply={(data) => void handleAddCustomProduct(customProductMode, data)}
          onCancel={() => {
            setCustomProductMode(null)
            setCustomProductError(null)
          }}
        />
      )}
      {customProductError && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center">
          <Alert variant="error">{customProductError}</Alert>
        </div>
      )}
    </div>
  )
}
