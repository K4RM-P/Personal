import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { EmptyState } from '../components/ui/EmptyState'
import { DiscountModal } from '../components/DiscountModal'
import { CustomProductModal } from '../components/CustomProductModal'
import { CustomerSearchPanel } from '../components/CustomerSearchPanel'
import { BringInBalanceModal } from '../components/BringInBalanceModal'
import { RefundsScreen } from './RefundsScreen'
import { formatCurrency } from '@shared/formatCurrency'
import type {
  Product,
  Customer,
  TransactionWithItems,
  ChargeResult,
  ChargeOptions,
  PaymentInteractionMode,
  DebtBreakdownEntry
} from '@shared/types'
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
  Check,
  User,
  AlertCircle,
  X
} from 'lucide-react'

type ScanFeedback = { type: 'success' | 'error'; message: string } | null
type PaymentMethod = 'CASH' | 'E_TRANSFER' | 'CARD' | 'PHARMACY_CREDIT' | null
type CardType = 'DEBIT' | 'CREDIT' | null

/**
 * One line of the tender ledger being built in the PAY popup. Every line here is
 * already fully processed (cash counted, card actually charged through the
 * terminal, e-transfer confirmed, or a Pharmacy Credit amount validated) — a card
 * charge that fails is never added here at all (see startCardLineCharge), so this
 * array only ever holds the equivalent of a COMPLETED TransactionTender row.
 */
type TenderLine = {
  id: string
  method: 'CASH' | 'CARD' | 'E_TRANSFER' | 'PHARMACY_CREDIT'
  amountCents: number
  cashGivenCents?: number
  changeCents?: number
  depositedToTabCents?: number
  cardType?: 'DEBIT' | 'CREDIT'
  surchargeCents?: number
  processorTransactionId?: string
  cardLastFour?: string
  eTransferEmail?: string
  eTransferConfirmed?: boolean
}
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
  const [savingPdf, setSavingPdf] = React.useState(false)
  const [parkedCarts, setParkedCarts] = React.useState<ParkedCart[]>([])
  const [showParkModal, setShowParkModal] = React.useState(false)
  const [parkCustomerQuery, setParkCustomerQuery] = React.useState('')
  const [parkCustomerResults, setParkCustomerResults] = React.useState<Customer[]>([])
  const [paymentState, setPaymentState] = React.useState<
    'idle' | 'awaiting' | 'processing' | 'approved' | 'declined' | 'timeout'
  >('idle')
  const [paymentMessage, setPaymentMessage] = React.useState<string | null>(null)
  // Whether the active processor drives itself (Stripe/Square/Moneris/etc. — await a
  // result) or is a standalone terminal the cashier operates by hand (Manual mode /
  // any semi-integrated terminal without a wired protocol yet, e.g. current Moneris
  // V400c). Fetched once — Settings is the only place this changes.
  const [paymentInteractionMode, setPaymentInteractionMode] =
    React.useState<PaymentInteractionMode>('automatic')
  // Manual-mode "type this into the terminal" popup — replaces the old dead-end where
  // tapping Charge in Manual mode just errored ("requires the cashier to confirm").
  const [manualCardPrompt, setManualCardPrompt] = React.useState<{
    amountCents: number
    orderRef: string
    lineSurchargeCents: number
    cardType: 'DEBIT' | 'CREDIT'
  } | null>(null)
  const [manualReference, setManualReference] = React.useState('')
  const [showRefunds, setShowRefunds] = React.useState(false)
  const [showPayModal, setShowPayModal] = React.useState(false)
  const [customProductMode, setCustomProductMode] = React.useState<'RX' | 'NONRX' | null>(null)
  const [customProductError, setCustomProductError] = React.useState<string | null>(null)

  // `paymentMethod` now doubles as "which tender line's amount-entry screen is
  // currently open" — null means the tender-building list (§2.1) is showing.
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>(null)
  const [cardType, setCardType] = React.useState<CardType>(null)
  const [applySurcharge, setApplySurcharge] = React.useState(false)
  const [eTransferEmail, setETransferEmail] = React.useState('')
  const [eTransferConfirmed, setETransferConfirmed] = React.useState(false)
  const [cashGivenDollars, setCashGivenDollars] = React.useState('')
  const [cashOverageChoice, setCashOverageChoice] = React.useState<'change' | 'deposit'>('change')
  const [tenderLines, setTenderLines] = React.useState<TenderLine[]>([])
  const [failedLineNotice, setFailedLineNotice] = React.useState<{
    method: string
    amountCents: number
    reason: string
  } | null>(null)
  const [showCancelWarning, setShowCancelWarning] = React.useState(false)
  const [reversingCancel, setReversingCancel] = React.useState(false)
  const [checkoutSettings, setCheckoutSettings] = React.useState({
    allowCreditCardSurcharge: false,
    cardSurchargePercent: 2,
    saveCustomItemsToCatalog: false
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

  // ---- Link Customer + Bring In Outstanding Balance --------------------------
  const [showLinkCustomerSearch, setShowLinkCustomerSearch] = React.useState(false)
  // Cash-overage "deposit to a tab" search — shown inline when the customer isn't
  // already attached to the sale, so the cashier doesn't have to back out of the
  // PAY popup, attach a customer from the top of the screen, and re-enter Cash.
  const [showOverageDepositSearch, setShowOverageDepositSearch] = React.useState(false)
  const [showCustomerOverflowMenu, setShowCustomerOverflowMenu] = React.useState(false)
  const [showBringInBalanceModal, setShowBringInBalanceModal] = React.useState(false)
  const [showDebtDetailsModal, setShowDebtDetailsModal] = React.useState(false)
  const [showCustomerProfileModal, setShowCustomerProfileModal] = React.useState(false)
  const [debtSettlement, setDebtSettlement] = React.useState<{
    amountCents: number
    ledgerEntryIds: number[]
    entries: DebtBreakdownEntry[]
  } | null>(null)

  const searchRef = React.useRef<HTMLInputElement>(null)
  const tenderRef = React.useRef<HTMLInputElement>(null)
  const productSearchRef = React.useRef<HTMLInputElement>(null)

  // Reused across every tender-line entry screen (§2.2) — the amount-to-apply for
  // whichever line is currently being built, not a whole-sale figure.
  const lineAmountCents = Math.round(parseFloat(tenderedDollars || '0') * 100)
  const cashGivenCents = cashGivenDollars.trim()
    ? Math.round(parseFloat(cashGivenDollars) * 100)
    : lineAmountCents
  const cashOverageCents = Math.max(0, cashGivenCents - lineAmountCents)

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
  // Surcharge is realized per completed CARD tender line (§3.2), not per sale —
  // this sums whatever's already been charged, so `effectiveTotal` grows live as
  // each surcharged card line is added, exactly like the customer sees before the
  // charge is sent to the terminal.
  const surchargeCents = tenderLines
    .filter((l) => l.method === 'CARD')
    .reduce((sum, l) => sum + (l.surchargeCents ?? 0), 0)
  // The surcharge a CARD line being built right now would add, if confirmed —
  // used to show the exact charge-inclusive amount before it's sent to the terminal.
  const pendingSurchargeCents =
    paymentMethod === 'CARD' && cardType === 'CREDIT' && applySurcharge
      ? Math.floor((lineAmountCents * checkoutSettings.cardSurchargePercent) / 100)
      : 0
  // Never taxed, never discounted — added on top of the product total. See
  // debtSettlement state: represents settling old Pharmacy Credit debt, not a sale of goods.
  const debtSettlementCents = debtSettlement?.amountCents ?? 0
  const effectiveTotal = preTaxCents + taxCents + surchargeCents + debtSettlementCents
  const appliedCents = tenderLines.reduce((sum, l) => sum + l.amountCents, 0)
  const remainingCents = Math.max(0, effectiveTotal - appliedCents)
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
    const loadPaymentMode = async (): Promise<void> => {
      try {
        if (window.api?.settings?.getPayment) {
          const cfg = await window.api.settings.getPayment()
          setPaymentInteractionMode(cfg.interactionMode)
        }
      } catch (err) {
        console.error('Failed to load payment interaction mode:', err)
      }
    }
    void loadPaymentMode()
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
      // Aggregate across every completed tender line so far, not a single cash field.
      tenderedCents: appliedCents,
      changeCents: tenderLines
        .filter((l) => l.method === 'CASH')
        .reduce((sum, l) => sum + (l.changeCents ?? 0), 0),
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
    appliedCents,
    cart,
    customerBalance,
    customerDisplayInfo,
    effectiveBillDiscountCents,
    effectiveTotal,
    paymentMethod,
    showPayModal,
    subtotalCents,
    taxCents,
    tenderLines
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

  // Keep the product search bar focused by default so a cashier can scan a
  // barcode immediately without clicking into it first.
  React.useEffect(() => {
    productSearchRef.current?.focus()
  }, [])

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
      else if (showAddCustomer) setShowAddCustomer(false)
      else if (showParkModal) setShowParkModal(false)
      else if (paymentMethod) backToTenderList()
      else if (showRefunds) setShowRefunds(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    customProductMode,
    discountItemTarget,
    showBillDiscountModal,
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

  /** Removes a per-item discount, returning the line to full price. */
  const handleClearItemDiscount = (productId: number): void => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, discountCents: undefined, discountReason: undefined }
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
        isPinned: true,
        excludeFromCatalog: !checkoutSettings.saveCustomItemsToCatalog
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

  // ---- Tender-line builder (general split tender, §1-§6) --------------------

  const resetTenderEntryFields = (): void => {
    setTenderedDollars('')
    setCashGivenDollars('')
    setCashOverageChoice('change')
    setCardType(null)
    setApplySurcharge(false)
    setETransferEmail(attachedCustomer?.email || '')
    setETransferConfirmed(false)
    setPaymentMessage(null)
    setPaymentState('idle')
  }

  /** Opens a method's amount-entry screen, prefilled to the exact current Remaining
   *  (still editable) — this is what backs both "+ Add [Method]" and "Pay Rest
   *  with [Method]", which are the same action, just surfaced twice per §2.1. */
  const openAddTender = (method: NonNullable<PaymentMethod>): void => {
    resetTenderEntryFields()
    const remainingDollars = remainingCents > 0 ? (remainingCents / 100).toFixed(2) : ''
    setTenderedDollars(remainingDollars)
    // Cash given defaults to exact change — the overwhelmingly common case — so the
    // cashier can tap "Add Cash Line" with zero typing; still fully editable for
    // when the customer hands over more than owed.
    if (method === 'CASH') setCashGivenDollars(remainingDollars)
    setPaymentMethod(method)
  }

  const backToTenderList = (): void => {
    setPaymentMethod(null)
    setPaymentMessage(null)
    setPaymentState('idle')
  }

  /** Enter submits the current tender-entry screen — keeps the cashier's hands on the
   *  keyboard instead of requiring a mouse click on "Add ... Line" every time. */
  const confirmOnEnter =
    (fn: () => void) =>
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') fn()
    }

  /** Focusing a prefilled amount selects it, so typing immediately replaces the
   *  default instead of requiring a manual clear/backspace first. */
  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>): void => e.target.select()

  const addLine = (line: TenderLine): void => {
    setTenderLines((prev) => [...prev, line])
    backToTenderList()
  }

  const confirmCashLine = (): void => {
    if (lineAmountCents <= 0 || lineAmountCents > remainingCents) return
    if (cashGivenCents < lineAmountCents) return
    const changeCents = cashOverageChoice === 'change' ? cashOverageCents : 0
    const depositedToTabCents = cashOverageChoice === 'deposit' ? cashOverageCents : 0
    addLine({
      id: crypto.randomUUID(),
      method: 'CASH',
      amountCents: lineAmountCents,
      cashGivenCents,
      changeCents,
      depositedToTabCents
    })
  }

  const confirmETransferLine = (): void => {
    if (lineAmountCents <= 0 || lineAmountCents > remainingCents || !eTransferConfirmed) return
    addLine({
      id: crypto.randomUUID(),
      method: 'E_TRANSFER',
      amountCents: lineAmountCents,
      eTransferEmail: eTransferEmail || undefined,
      eTransferConfirmed: true
    })
  }

  const confirmPharmacyCreditLine = (): void => {
    if (!attachedCustomer || lineAmountCents <= 0 || lineAmountCents > remainingCents) return
    addLine({
      id: crypto.randomUUID(),
      method: 'PHARMACY_CREDIT',
      amountCents: lineAmountCents
    })
  }

  /** Charges exactly this line's amount through the payment adapter the moment
   *  it's confirmed — never batched to sale completion (§3, non-negotiable #1).
   *  Two "+ Add Card" lines are two independent calls here, each its own real
   *  terminal authorization — this is how two physical cards get supported. */
  /** Shared by the automatic (processor drives itself) and manual (cashier reports the
   *  outcome) paths — both end up needing identical success/failure handling once the
   *  charge() call returns, so this is the one place that logic lives. */
  const performCardCharge = async (
    orderRef: string,
    chargeCents: number,
    lineSurchargeCents: number,
    cardTypeForLine: 'DEBIT' | 'CREDIT',
    options?: ChargeOptions
  ): Promise<void> => {
    setCardProcessing(true)
    try {
      const result: ChargeResult = await window.api.payment.charge(chargeCents, orderRef, options)
      if (result.status === 'approved') {
        cardOrderRefRef.current = null
        addLine({
          id: crypto.randomUUID(),
          method: 'CARD',
          amountCents: chargeCents,
          cardType: cardTypeForLine,
          surchargeCents: lineSurchargeCents,
          processorTransactionId: result.transactionId,
          cardLastFour: result.cardLast4
        })
      } else {
        // Partial-failure handling (§3.1, non-negotiable #2): this line simply
        // never gets added — every already-COMPLETED line above is untouched,
        // Remaining still reflects only what's genuinely uncovered, and the
        // cashier lands back on the tender list to retry or pick another method.
        cardOrderRefRef.current = null
        setFailedLineNotice({
          method: 'Card',
          amountCents: chargeCents,
          reason:
            result.message ||
            (result.status === 'error' ? 'Payment timed out' : 'Card was not approved')
        })
        backToTenderList()
      }
    } catch (err) {
      cardOrderRefRef.current = null
      setFailedLineNotice({
        method: 'Card',
        amountCents: chargeCents,
        reason: err instanceof Error ? err.message : 'Payment timed out'
      })
      backToTenderList()
    } finally {
      setCardProcessing(false)
    }
  }

  const startCardLineCharge = async (): Promise<void> => {
    if (!cardType || cardProcessing) return
    if (lineAmountCents <= 0 || lineAmountCents > remainingCents) return
    const lineSurchargeCents = pendingSurchargeCents
    const chargeCents = lineAmountCents + lineSurchargeCents
    if (!cardOrderRefRef.current) {
      cardOrderRefRef.current = `SALE-${Date.now()}-${tenderLines.length}`
    }
    const orderRef = cardOrderRefRef.current
    if (!window.api?.payment) {
      setPaymentState('timeout')
      setPaymentMessage('Payment service unavailable.')
      return
    }
    if (paymentInteractionMode === 'manual') {
      // Manual/External Terminal (and any semi-integrated terminal without a wired
      // protocol yet): there's no automatic result to await. Show exactly what to key
      // into the terminal, then record what it said — instead of the old dead end
      // where this just errored with "requires the cashier to confirm."
      setManualCardPrompt({ amountCents: chargeCents, orderRef, lineSurchargeCents, cardType })
      setManualReference('')
      return
    }
    setPaymentState('awaiting')
    setPaymentMessage('Waiting for terminal response…')
    await performCardCharge(orderRef, chargeCents, lineSurchargeCents, cardType)
  }

  const confirmManualCardOutcome = async (outcome: 'approved' | 'declined'): Promise<void> => {
    if (!manualCardPrompt) return
    const { amountCents, orderRef, lineSurchargeCents, cardType: promptCardType } = manualCardPrompt
    setManualCardPrompt(null)
    await performCardCharge(orderRef, amountCents, lineSurchargeCents, promptCardType, {
      manualOutcome: outcome,
      manualReference: manualReference.trim() || undefined
    })
  }

  /** Edit is only offered for CASH/PHARMACY_CREDIT lines — nothing external
   *  happened yet for those (no charge, no ledger write until sale completion),
   *  so it's safe to pull the line back out and reopen its entry screen. CARD
   *  and E_TRANSFER lines have no in-place edit — see removeLine for why. */
  const editLine = (line: TenderLine): void => {
    if (line.method === 'CARD' || line.method === 'E_TRANSFER') return
    setTenderLines((prev) => prev.filter((l) => l.id !== line.id))
    resetTenderEntryFields()
    setTenderedDollars((line.amountCents / 100).toFixed(2))
    if (line.method === 'CASH') {
      setCashGivenDollars(((line.cashGivenCents ?? line.amountCents) / 100).toFixed(2))
      setCashOverageChoice(line.depositedToTabCents ? 'deposit' : 'change')
    }
    setPaymentMethod(line.method)
  }

  /** Removing a CASH/PHARMACY_CREDIT line is free (nothing external happened).
   *  Removing a CARD/E_TRANSFER line means undoing a charge that already
   *  happened in the world — §7's reversal requirement applies per-line here
   *  too, not just on a full popup cancel. */
  const removeLine = async (line: TenderLine): Promise<void> => {
    if (line.method === 'CARD' || line.method === 'E_TRANSFER') {
      const kind = line.method === 'CARD' ? 'card charge' : 'e-transfer'
      if (
        !window.confirm(
          `This will reverse the ${formatCurrency(line.amountCents)} ${kind}. Continue?`
        )
      ) {
        return
      }
      if (line.method === 'CARD' && line.processorTransactionId && window.api?.payment?.refund) {
        try {
          await window.api.payment.refund(line.processorTransactionId, line.amountCents)
        } catch (err) {
          setScanFeedback({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to reverse card charge'
          })
          return
        }
      }
      // No processor-side reversal exists for E-Transfer — removing it here only
      // un-counts it toward Remaining; the cashier still owes the customer that
      // amount back by hand, which the confirm() copy above makes explicit.
    }
    setTenderLines((prev) => prev.filter((l) => l.id !== line.id))
  }

  const hasCompletedExternalLines = tenderLines.some(
    (l) => l.method === 'CARD' || l.method === 'E_TRANSFER'
  )
  const chargedExternalCents = tenderLines
    .filter((l) => l.method === 'CARD' || l.method === 'E_TRANSFER')
    .reduce((sum, l) => sum + l.amountCents, 0)

  const closePayModalReset = (): void => {
    setShowPayModal(false)
    setPaymentMethod(null)
    setTenderLines([])
    setShowCancelWarning(false)
    setFailedLineNotice(null)
    cardOrderRefRef.current = null
    resetTenderEntryFields()
  }

  /** §7: a silent cancel that leaves a charged-but-unrecorded card/e-transfer
   *  payment orphaned is exactly the failure mode this guards against. */
  const requestCancelPay = (): void => {
    if (hasCompletedExternalLines) {
      setShowCancelWarning(true)
    } else {
      closePayModalReset()
    }
  }

  const confirmCancelWithReversal = async (): Promise<void> => {
    setReversingCancel(true)
    try {
      for (const line of tenderLines) {
        if (line.method === 'CARD' && line.processorTransactionId && window.api?.payment?.refund) {
          await window.api.payment.refund(line.processorTransactionId, line.amountCents)
        }
      }
      closePayModalReset()
    } catch (err) {
      setScanFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to reverse a charge — resolve manually before leaving this sale.'
      })
    } finally {
      setReversingCancel(false)
    }
  }

  /** Finalizes the sale — gated client-side on Remaining === 0 (also re-validated
   *  server-side in createTransaction; see posQueries.ts, non-negotiable #3). */
  const completeSale = async (): Promise<void> => {
    // A genuine $0 sale (e.g. a fully-discounted or free RX item) needs no tender
    // line at all — only a nonzero total requires at least one to have been applied.
    if (remainingCents !== 0 || (tenderLines.length === 0 && effectiveTotal > 0) || cardProcessing)
      return
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
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents ?? 0,
          discountReason: item.discountReason,
          hstApplied: item.hstApplied !== false
        })),
        taxRatePercent,
        tenders: tenderLines.map((l) => ({
          method: l.method,
          amountCents: l.amountCents,
          cashGivenCents: l.cashGivenCents,
          changeCents: l.changeCents,
          depositedToTabCents: l.depositedToTabCents,
          cardType: l.cardType,
          surchargeCents: l.surchargeCents,
          processorTransactionId: l.processorTransactionId,
          cardLastFour: l.cardLastFour,
          eTransferEmail: l.eTransferEmail,
          eTransferConfirmed: l.eTransferConfirmed
        })),
        customerId: attachedCustomer?.id,
        email: tenderLines.find((l) => l.method === 'E_TRANSFER')?.eTransferEmail || undefined,
        billDiscountCents: effectiveBillDiscountCents,
        billDiscountReason,
        debtSettlementLedgerEntryIds: debtSettlement ? debtSettlement.ledgerEntryIds : undefined
      })
      cardOrderRefRef.current = null
      setActiveReceipt(transaction)
      setCart([])
      setAttachedCustomer(null)
      setDebtSettlement(null)
      setTenderLines([])
      setFailedLineNotice(null)
      setBillDiscountCents(0)
      setBillDiscountReason(undefined)
      setShowPayModal(false)
      resetTenderEntryFields()
      productSearchRef.current?.focus()
    } catch (err) {
      // Deliberately do NOT clear tenderLines here — any card/e-transfer charges
      // already happened in the world and must stay visible so the cashier can
      // retry completion or fall back to the cancel/reversal path, never silently
      // lose track of money that already moved (§8 non-negotiable).
      setScanFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Transaction failed'
      })
    } finally {
      setCardProcessing(false)
    }
  }

  // Auto-finish the sale the instant the last tender line brings Remaining to $0 — no
  // extra tap on "Complete Sale" needed. Only fires from the tender-list screen (not
  // mid-entry) and only once (completeSale's own guard + cardProcessing prevent a
  // second fire while the first is still in flight).
  React.useEffect(() => {
    if (
      showPayModal &&
      paymentMethod === null &&
      remainingCents === 0 &&
      (tenderLines.length > 0 || effectiveTotal === 0) &&
      !cardProcessing
    ) {
      void completeSale()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    remainingCents,
    tenderLines.length,
    effectiveTotal,
    showPayModal,
    paymentMethod,
    cardProcessing
  ])

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

  const handleSaveReceiptPdf = async (): Promise<void> => {
    if (!activeReceipt || !window.api?.receipt?.savePdf) return
    setSavingPdf(true)
    try {
      const result = await window.api.receipt.savePdf(activeReceipt)
      if (result) {
        setPrintStatus(`Saved to ${result.path} ✓`)
        setReceiptError(false)
      }
    } catch (err) {
      setPrintStatus(err instanceof Error ? err.message : 'Failed to save PDF')
      setReceiptError(true)
    } finally {
      setSavingPdf(false)
    }
  }

  const dismissReceipt = (): void => {
    setActiveReceipt(null)
    setPrintStatus(null)
    setReceiptPdfUrl(null)
    setReceiptError(false)
  }

  const filteredProducts = products

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Checkout</h1>
        <button
          type="button"
          onClick={() => setShowRefunds(true)}
          className="flex min-h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
        >
          <RotateCcw className="icon-4" /> Refunds
        </button>
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
                        className="min-h-8 flex-1 rounded-[var(--radius)] bg-[var(--warning)] px-2 py-1 font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
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
              <div className="relative min-w-0 flex-1">
                <input
                  ref={productSearchRef}
                  type="text"
                  placeholder="Search products by SKU, name, or barcode"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
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
              <button
                type="button"
                title="Add RX item"
                aria-label="Add RX item"
                onClick={() => setCustomProductMode('RX')}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-semibold text-[var(--warning)]"
              >
                <Pill className="icon-4" /> Add Rx
              </button>
              <button
                type="button"
                title="Add non-RX item"
                aria-label="Add non-RX item"
                onClick={() => setCustomProductMode('NONRX')}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-semibold text-[var(--foreground)]"
              >
                <PackagePlus className="icon-4" /> Add Non-Rx
              </button>

              {/* Link Customer — persistent, independent of the Pharmacy Credit tender's
                  own conditional search (see PHARMACY_CREDIT tender: if attachedCustomer is
                  already set here, that flow skips its own search step). */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (!attachedCustomer) setShowLinkCustomerSearch((v) => !v)
                  }}
                  className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-xs font-semibold text-[var(--foreground)]"
                >
                  <User className="icon-4" />
                  {attachedCustomer ? (
                    <span className="flex items-center gap-1">
                      {attachedCustomer.firstName} {attachedCustomer.lastName}
                      {customerBalance < 0 && (
                        <span
                          className="flex items-center gap-0.5 text-[var(--error)]"
                          title={`Owes ${formatCurrency(-customerBalance)}`}
                        >
                          <AlertCircle className="icon-3_5" /> {formatCurrency(-customerBalance)}
                        </span>
                      )}
                    </span>
                  ) : (
                    'Link Customer'
                  )}
                </button>

                {showLinkCustomerSearch && !attachedCustomer && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowLinkCustomerSearch(false)}
                    />
                    <div className="absolute right-0 z-20 mt-1 w-72 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 shadow-sm">
                      <CustomerSearchPanel
                        query={customerSearchQuery}
                        onQueryChange={setCustomerSearchQuery}
                        results={customerSearchResults}
                        onSelect={(customer) => {
                          void attachCustomer(customer)
                          setShowLinkCustomerSearch(false)
                        }}
                        onAddNew={() => {
                          setShowAddCustomer(true)
                          setShowLinkCustomerSearch(false)
                        }}
                        placeholder="Search name, phone, email, or address"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Overflow menu — visible even with no customer linked yet, so the
                  cashier knows the option exists once they link someone. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label="Customer actions"
                  aria-haspopup="true"
                  aria-expanded={showCustomerOverflowMenu}
                  onClick={() => setShowCustomerOverflowMenu((v) => !v)}
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]"
                >
                  <MoreVertical className="icon-4" />
                </button>
                {showCustomerOverflowMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowCustomerOverflowMenu(false)}
                    />
                    <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
                      <button
                        disabled={!attachedCustomer}
                        onClick={() => {
                          setShowCustomerProfileModal(true)
                          setShowCustomerOverflowMenu(false)
                        }}
                        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <User className="icon-4" /> View customer profile
                      </button>
                      <button
                        disabled={!attachedCustomer}
                        onClick={() => {
                          setAttachedCustomer(null)
                          setDebtSettlement(null)
                          setShowCustomerOverflowMenu(false)
                        }}
                        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="icon-4" /> Unlink customer
                      </button>
                      <button
                        disabled={!attachedCustomer || customerBalance >= 0}
                        title={
                          !attachedCustomer
                            ? 'No customer linked'
                            : customerBalance >= 0
                              ? 'This customer has no outstanding balance'
                              : undefined
                        }
                        onClick={() => {
                          setShowBringInBalanceModal(true)
                          setShowCustomerOverflowMenu(false)
                        }}
                        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <HeartHandshake className="icon-4" /> Bring in outstanding balance
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
              {cart.length === 0 && !debtSettlement ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="Cart is empty"
                  description="Search or scan to add items."
                  className="p-4"
                />
              ) : (
                <>
                  {cart.map((item) => {
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
                              <button
                                type="button"
                                onClick={() => handleClearItemDiscount(item.product.id)}
                                title="Cancel discount on this item"
                                className="ml-1 text-[10px] text-[var(--muted-foreground)] underline"
                              >
                                remove
                              </button>
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
                                className="icon-3_5 text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
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
                  })}
                  {debtSettlement && attachedCustomer && (
                    <div className="rounded-[var(--radius)] border border-[var(--warning)]/40 bg-[var(--warning-bg)] px-2 py-1.5 text-sm">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <div className="min-w-0 truncate font-medium text-[var(--foreground)]">
                          {attachedCustomer.firstName} {attachedCustomer.lastName} — brought in from
                          tab
                        </div>
                        <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1">
                          <button
                            onClick={() => setShowDebtDetailsModal(true)}
                            className="min-h-8 rounded-[var(--radius)] border border-[var(--border)] px-2 text-xs font-semibold text-[var(--muted-foreground)]"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => setDebtSettlement(null)}
                            className="min-h-8 rounded-[var(--radius)] border border-[var(--border)] px-2 text-xs font-semibold text-[var(--error)]"
                          >
                            Remove
                          </button>
                          <div className="w-16 text-right font-semibold text-[var(--foreground)]">
                            {formatCurrency(debtSettlement.amountCents)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {debtSettlement.entries.map((entry) => (
                          <div
                            key={entry.ledgerEntryId}
                            className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]"
                          >
                            <span className="min-w-0 truncate">
                              {new Date(
                                entry.type === 'SALE_CHARGE'
                                  ? (entry.transactionDate ?? entry.createdAt)
                                  : entry.createdAt
                              ).toLocaleDateString()}{' '}
                              —{' '}
                              {entry.type === 'SALE_CHARGE'
                                ? entry.items
                                    ?.map((i) => `${i.productName} (${i.quantity})`)
                                    .join(', ') || `Sale ${entry.receiptNumber ?? ''}`
                                : entry.note || 'Manual adjustment'}
                            </span>
                            <span className="shrink-0">{formatCurrency(entry.amountCents)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
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
              {debtSettlementCents > 0 && (
                <div className="flex items-center justify-between text-sm text-[var(--warning)]">
                  <span>Previous balance</span>
                  <span>{formatCurrency(debtSettlementCents)}</span>
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
                  onClick={handleParkSale}
                  disabled={cart.length === 0}
                  title="Hold / Park sale"
                  aria-label="Hold / Park sale"
                  className="flex h-14 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Lock className="icon-4" />
                </button>
                <button
                  onClick={() => {
                    cardOrderRefRef.current = null
                    setShowPayModal(true)
                  }}
                  disabled={cart.length === 0 && !debtSettlement}
                  className="h-14 flex-1 rounded-[var(--radius)] bg-[var(--primary)] text-lg font-bold tracking-wide text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  PAY
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* PAY popup — general split-tender builder (§1-§6): any combination of
          cash/card/e-transfer/pharmacy-credit lines, in any order/amounts, until
          Remaining hits zero. Card lines are charged immediately per-line (§3),
          never batched — see startCardLineCharge. */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[90vh] w-[520px] max-w-full overflow-y-auto bg-[var(--card)]">
            <CardHeader>
              <CardTitle>Pay — Total: {formatCurrency(effectiveTotal)}</CardTitle>
              <CardDescription>
                {paymentMethod === null
                  ? 'Add one or more tender lines to cover the total.'
                  : 'Choose the amount for this line to continue.'}
              </CardDescription>
            </CardHeader>

            {paymentMethod === null ? (
              <div
                className="mt-3 space-y-3 text-sm"
                onKeyDown={(e) => {
                  // Enter completes the sale the instant it's fully tendered — the fastest
                  // path once the last line is added, no mouse trip to the button required.
                  if (
                    e.key === 'Enter' &&
                    remainingCents === 0 &&
                    (tenderLines.length > 0 || effectiveTotal === 0) &&
                    !cardProcessing
                  ) {
                    void completeSale()
                  }
                }}
              >
                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-3 py-2">
                  <span className="font-semibold text-[var(--foreground)]">Remaining</span>
                  <span className="text-lg font-bold text-[var(--primary)]">
                    {formatCurrency(remainingCents)}
                  </span>
                </div>

                {failedLineNotice && (
                  <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--error)]/40 bg-[var(--error-bg)] px-2 py-1.5 text-xs text-[var(--error)]">
                    <span>
                      {failedLineNotice.method} attempt for{' '}
                      {formatCurrency(failedLineNotice.amountCents)} failed —{' '}
                      {failedLineNotice.reason}
                    </span>
                    <button onClick={() => setFailedLineNotice(null)} aria-label="Dismiss">
                      <X className="icon-3_5" />
                    </button>
                  </div>
                )}

                {tenderLines.length > 0 && (
                  <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--border)] p-2">
                    <div className="text-xs font-semibold text-[var(--muted-foreground)]">
                      Applied so far
                    </div>
                    {tenderLines.map((line, i) => (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-1.5 text-sm last:border-0"
                      >
                        <span className="min-w-0 truncate text-[var(--foreground)]">
                          {i + 1}.{' '}
                          {line.method === 'CASH'
                            ? 'Cash'
                            : line.method === 'CARD'
                              ? `Card${line.cardLastFour ? ` ····${line.cardLastFour}` : ''}`
                              : line.method === 'E_TRANSFER'
                                ? 'E-Transfer'
                                : 'Pharmacy Credit'}{' '}
                          — {formatCurrency(line.amountCents)}
                          {line.method === 'CASH' && (line.changeCents ?? 0) > 0
                            ? ` (change ${formatCurrency(line.changeCents ?? 0)})`
                            : ''}
                          {line.method === 'CASH' && (line.depositedToTabCents ?? 0) > 0
                            ? ` (${formatCurrency(line.depositedToTabCents ?? 0)} to tab)`
                            : ''}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          {line.method !== 'CARD' && line.method !== 'E_TRANSFER' && (
                            <button
                              onClick={() => editLine(line)}
                              className="text-xs font-semibold text-[var(--primary)] underline"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => void removeLine(line)}
                            className="text-xs font-semibold text-[var(--error)] underline"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {remainingCents > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => openAddTender('CASH')}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-2 text-xs font-semibold text-[var(--primary)]"
                    >
                      <Banknote className="icon-4 shrink-0" />
                      {tenderLines.length === 0 ? '+ Add Cash' : 'Pay Rest with Cash'}
                    </button>
                    <button
                      onClick={() => openAddTender('CARD')}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-2 text-xs font-semibold text-[var(--primary)]"
                    >
                      <CreditCard className="icon-4 shrink-0" />
                      {tenderLines.length === 0 ? '+ Add Card' : 'Pay Rest with Card'}
                    </button>
                    <button
                      onClick={() => openAddTender('E_TRANSFER')}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-2 text-xs font-semibold text-[var(--primary)]"
                    >
                      <Send className="icon-4 shrink-0" />
                      {tenderLines.length === 0 ? '+ Add E-Transfer' : 'Pay Rest with E-Transfer'}
                    </button>
                    <button
                      onClick={() => !(debtSettlementCents > 0) && openAddTender('PHARMACY_CREDIT')}
                      disabled={debtSettlementCents > 0}
                      title={
                        debtSettlementCents > 0
                          ? 'Cannot use Pharmacy Credit to pay off an outstanding balance — choose another method'
                          : undefined
                      }
                      className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--background)] px-2 text-xs font-semibold text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <HeartHandshake className="icon-4 shrink-0" />
                      {tenderLines.length === 0
                        ? '+ Add Pharmacy Credit'
                        : 'Pay Rest with Pharmacy Credit'}
                    </button>
                  </div>
                )}

                {scanFeedback?.type === 'error' && (
                  <Alert variant="error">{scanFeedback.message}</Alert>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={requestCancelPay}
                    className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void completeSale()}
                    disabled={remainingCents !== 0 || tenderLines.length === 0 || cardProcessing}
                    className="min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cardProcessing ? 'Completing…' : 'Complete Sale'}
                  </button>
                </div>
              </div>
            ) : (
              // Escape already backs out of this screen via the global handler above.
              <div className="mt-3 space-y-3 text-xs">
                <button
                  onClick={backToTenderList}
                  className="flex min-h-9 items-center gap-1 rounded-[var(--radius)] px-1 text-[var(--primary)] hover:bg-[var(--muted)]"
                >
                  <ChevronLeft className="icon-4" />
                  Back
                </button>

                {/* CASH */}
                {paymentMethod === 'CASH' && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block font-semibold text-[var(--foreground)]">
                        Amount to apply to this bill
                      </label>
                      <input
                        ref={tenderRef}
                        type="number"
                        step="0.01"
                        min="0"
                        autoFocus
                        onFocus={selectOnFocus}
                        value={tenderedDollars}
                        onChange={(e) => {
                          // Keep "cash given" tracking the amount as it's edited, as long as the
                          // cashier hasn't diverged it themselves (still exact-change by default).
                          if (cashGivenDollars === tenderedDollars)
                            setCashGivenDollars(e.target.value)
                          setTenderedDollars(e.target.value)
                        }}
                        onKeyDown={confirmOnEnter(confirmCashLine)}
                        placeholder="0.00"
                        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                      {lineAmountCents > remainingCents && (
                        <div className="mt-1 text-[var(--error)]">
                          Cannot exceed the remaining {formatCurrency(remainingCents)}.
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[var(--foreground)]">
                        Cash given by customer
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        onFocus={selectOnFocus}
                        value={cashGivenDollars}
                        onChange={(e) => setCashGivenDollars(e.target.value)}
                        onKeyDown={confirmOnEnter(confirmCashLine)}
                        placeholder={(lineAmountCents / 100).toFixed(2)}
                        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                    </div>
                    {cashOverageCents > 0 && (
                      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 space-y-1.5">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={cashOverageChoice === 'change'}
                            onChange={() => setCashOverageChoice('change')}
                          />
                          Change due: {formatCurrency(cashOverageCents)}
                        </label>
                        {attachedCustomer ? (
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              checked={cashOverageChoice === 'deposit'}
                              onChange={() => setCashOverageChoice('deposit')}
                            />
                            Deposit {formatCurrency(cashOverageCents)} to{' '}
                            {attachedCustomer.firstName}
                            &apos;s Pharmacy Credit
                          </label>
                        ) : (
                          <div>
                            <button
                              type="button"
                              onClick={() => setShowOverageDepositSearch((v) => !v)}
                              className="text-xs font-semibold text-[var(--primary)] underline"
                            >
                              Deposit to a tab instead
                            </button>
                            {showOverageDepositSearch && (
                              <div className="mt-2">
                                <CustomerSearchPanel
                                  query={customerSearchQuery}
                                  onQueryChange={setCustomerSearchQuery}
                                  results={customerSearchResults}
                                  onSelect={(customer) => {
                                    void attachCustomer(customer)
                                    setCashOverageChoice('deposit')
                                    setShowOverageDepositSearch(false)
                                  }}
                                  onAddNew={() => setShowAddCustomer(true)}
                                  placeholder="Search name or phone to deposit to their tab"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={confirmCashLine}
                      disabled={
                        lineAmountCents <= 0 ||
                        lineAmountCents > remainingCents ||
                        cashGivenCents < lineAmountCents
                      }
                      className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add Cash Line
                    </button>
                  </div>
                )}

                {/* E-TRANSFER */}
                {paymentMethod === 'E_TRANSFER' && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block font-semibold text-[var(--foreground)]">
                        Amount to apply to this bill
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        autoFocus
                        onFocus={selectOnFocus}
                        value={tenderedDollars}
                        onChange={(e) => setTenderedDollars(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                      {lineAmountCents > remainingCents && (
                        <div className="mt-1 text-[var(--error)]">
                          Cannot exceed the remaining {formatCurrency(remainingCents)}.
                        </div>
                      )}
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
                        onKeyDown={confirmOnEnter(confirmETransferLine)}
                      />
                      I have received the E-Transfer confirmation for this amount
                    </label>
                    <button
                      onClick={confirmETransferLine}
                      disabled={
                        lineAmountCents <= 0 ||
                        lineAmountCents > remainingCents ||
                        !eTransferConfirmed
                      }
                      className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add E-Transfer Line
                    </button>
                  </div>
                )}

                {/* CARD */}
                {paymentMethod === 'CARD' && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block font-semibold text-[var(--foreground)]">
                        Amount to apply to this bill
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        autoFocus
                        onFocus={selectOnFocus}
                        value={tenderedDollars}
                        onChange={(e) => setTenderedDollars(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void startCardLineCharge()
                        }}
                        placeholder="0.00"
                        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                      {lineAmountCents > remainingCents && (
                        <div className="mt-1 text-[var(--error)]">
                          Cannot exceed the remaining {formatCurrency(remainingCents)}.
                        </div>
                      )}
                    </div>
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
                            {formatCurrency(lineAmountCents)} +{' '}
                            {checkoutSettings.cardSurchargePercent}% fee{' '}
                            {formatCurrency(pendingSurchargeCents)} = charge{' '}
                            {formatCurrency(lineAmountCents + pendingSurchargeCents)}
                          </div>
                        )}
                      </div>
                    )}
                    {paymentMessage && (
                      <Alert
                        variant={
                          paymentState === 'declined' || paymentState === 'timeout'
                            ? 'error'
                            : 'pending'
                        }
                      >
                        {paymentMessage}
                      </Alert>
                    )}
                    <button
                      onClick={() => void startCardLineCharge()}
                      disabled={
                        !cardType ||
                        lineAmountCents <= 0 ||
                        lineAmountCents > remainingCents ||
                        cardProcessing
                      }
                      className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cardProcessing
                        ? 'Waiting for terminal response…'
                        : paymentInteractionMode === 'manual'
                          ? `Continue — ${formatCurrency(lineAmountCents + pendingSurchargeCents)}`
                          : `Charge ${formatCurrency(lineAmountCents + pendingSurchargeCents)}`}
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
                        <CustomerSearchPanel
                          inputRef={searchRef}
                          query={customerSearchQuery}
                          onQueryChange={setCustomerSearchQuery}
                          results={customerSearchResults}
                          onSelect={(customer) => void attachCustomer(customer)}
                          onAddNew={() => setShowAddCustomer(true)}
                          placeholder="Search name or phone"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-3 py-2 text-sm">
                          <span className="font-semibold">
                            {attachedCustomer.firstName} {attachedCustomer.lastName} ·{' '}
                            {attachedCustomer.phone}
                          </span>
                        </div>
                        <div
                          className={`flex items-center gap-1.5 font-semibold ${customerBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}
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
                        <div>
                          <label className="mb-1 block font-semibold text-[var(--foreground)]">
                            Amount to apply to this bill
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            autoFocus
                            onFocus={selectOnFocus}
                            value={tenderedDollars}
                            onChange={(e) => setTenderedDollars(e.target.value)}
                            onKeyDown={confirmOnEnter(confirmPharmacyCreditLine)}
                            placeholder="0.00"
                            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                          />
                          {lineAmountCents > remainingCents && (
                            <div className="mt-1 text-[var(--error)]">
                              Cannot exceed the remaining {formatCurrency(remainingCents)}.
                            </div>
                          )}
                        </div>
                        <button
                          onClick={confirmPharmacyCreditLine}
                          disabled={lineAmountCents <= 0 || lineAmountCents > remainingCents}
                          className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Add Pharmacy Credit Line
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Manual/External Terminal prompt — the cashier keys the amount into their own
          standalone terminal, then reports the outcome here. Sits above the PAY popup
          (z-[65] vs its z-50) since it's a step within the Card entry screen. */}
      {manualCardPrompt && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4">
          <Card className="w-[420px] max-w-full bg-[var(--card)] p-6 space-y-4">
            <div>
              <CardTitle className="text-[var(--foreground)]">Run this on the terminal</CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                Key this exact amount into your standalone card terminal, then tap what it says once
                the card is done.
              </CardDescription>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-4 py-3 text-center">
              <div className="text-xs font-semibold text-[var(--muted-foreground)]">
                Amount to key in
              </div>
              <div className="text-3xl font-bold text-[var(--primary)]">
                {formatCurrency(manualCardPrompt.amountCents)}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                Terminal receipt / reference number (optional)
              </label>
              <input
                autoFocus
                type="text"
                value={manualReference}
                onChange={(e) => setManualReference(e.target.value)}
                placeholder="e.g. last 4 digits or approval code"
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setManualCardPrompt(null)}
                className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmManualCardOutcome('declined')}
                className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--error)] px-3 text-sm font-semibold text-[var(--error)]"
              >
                Declined
              </button>
              <button
                onClick={() => void confirmManualCardOutcome('approved')}
                className="min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
              >
                Approved
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Cancel-with-completed-lines warning (§7) — a silent cancel that leaves a
          charged card/e-transfer orphaned is never allowed. */}
      {showCancelWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <Card className="w-[440px] max-w-full bg-[var(--card)] p-6 space-y-3">
            <div>
              <CardTitle className="text-[var(--foreground)]">Charges already made</CardTitle>
              <CardDescription className="text-[var(--muted-foreground)]">
                This sale has {formatCurrency(chargedExternalCents)} already charged/confirmed
                across card or e-transfer lines. Cancelling will require reversing those separately.
              </CardDescription>
            </div>
            <button
              onClick={() => void confirmCancelWithReversal()}
              disabled={reversingCancel}
              className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--error)] px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {reversingCancel ? 'Reversing…' : 'Reverse charges and cancel sale'}
            </button>
            <button
              onClick={() => setShowCancelWarning(false)}
              className="w-full min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)]"
            >
              Go back — keep this sale open
            </button>
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
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
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
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:opacity-50"
              >
                {creatingCustomer ? 'Saving…' : 'Create & attach'}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Manual / External Terminal confirmation */}
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
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => void handlePrintReceipt()}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
                >
                  Print Receipt
                </button>
                <button
                  onClick={() => void handleSaveReceiptPdf()}
                  disabled={savingPdf}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)] disabled:opacity-50"
                >
                  {savingPdf ? 'Saving…' : 'Save as PDF'}
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
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
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
              onRemove={() => {
                handleClearItemDiscount(discountItemTarget)
                setDiscountItemTarget(null)
              }}
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

      {showBringInBalanceModal && attachedCustomer && (
        <BringInBalanceModal
          customerId={attachedCustomer.id}
          customerName={`${attachedCustomer.firstName} ${attachedCustomer.lastName}`}
          readOnly={false}
          onAdd={(ledgerEntryIds, amountCents, entries) => {
            setDebtSettlement({ amountCents, ledgerEntryIds, entries })
            setShowBringInBalanceModal(false)
          }}
          onClose={() => setShowBringInBalanceModal(false)}
        />
      )}

      {showDebtDetailsModal && attachedCustomer && debtSettlement && (
        <BringInBalanceModal
          customerId={attachedCustomer.id}
          customerName={`${attachedCustomer.firstName} ${attachedCustomer.lastName}`}
          readOnly
          fixedLedgerEntryIds={debtSettlement.ledgerEntryIds}
          onClose={() => setShowDebtDetailsModal(false)}
        />
      )}

      {showCustomerProfileModal && attachedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[85vh] w-[420px] max-w-full overflow-y-auto bg-[var(--card)]">
            <CardHeader>
              <CardTitle>
                {attachedCustomer.firstName} {attachedCustomer.lastName}
              </CardTitle>
              <CardDescription>{attachedCustomer.phone}</CardDescription>
            </CardHeader>
            <div className="mt-3 space-y-2 text-sm">
              {attachedCustomer.email && (
                <div>
                  <span className="text-[var(--muted-foreground)]">Email: </span>
                  {attachedCustomer.email}
                </div>
              )}
              <div>
                <span className="text-[var(--muted-foreground)]">Address: </span>
                {attachedCustomer.address}
              </div>
              <div>
                <span className="text-[var(--muted-foreground)]">Pharmacy Credit balance: </span>
                <span className={customerBalance < 0 ? 'font-semibold text-[var(--error)]' : ''}>
                  {formatCurrency(customerBalance)}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowCustomerProfileModal(false)}
              className="mt-4 min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
            >
              Close
            </button>
          </Card>
        </div>
      )}
    </div>
  )
}
