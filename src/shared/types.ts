import type {
  FeatureFlag,
  Setting,
  Product,
  Customer,
  PricingTier as DBPricingTier,
  Transaction as DBTransaction,
  TransactionItem as DBTransactionItem
} from '@prisma/client'
import type { PricingTier } from './pricingEngine'

export type { FeatureFlag, Setting, Product, Customer, DBPricingTier, DBTransaction, DBTransactionItem, PricingTier }

export interface CartItem {
  product: Product
  quantity: number
}

// ---------------------------------------------------------------- Auth / users
export type UserRole = 'MANAGER' | 'CASHIER'

/** Safe user shape exposed to the renderer — never includes the password hash. */
export interface AuthUser {
  id: number
  fullName: string
  role: UserRole
  lastLogin: string | null
  createdAt: string
}

export type LoginResult = { user: AuthUser } | { error: string }

export interface CreateTransactionPayload {
  items: {
    productId: number
    quantity: number
    costCents: number
    unitPriceCents: number
  }[]
  taxRatePercent: number
  tenderType: 'CASH' | 'CARD' | 'E_TRANSFER' | 'PHARMACY_CREDIT' | 'SPLIT'
  tenderedCents: number
  status?: 'COMPLETED' | 'PARKED'
  customerId?: number
  /** Amount charged to the customer's Pharmacy Credit (for short-pay or tab). */
  tabAmountCents?: number
  /** Cash overpayment deposited to the attached customer's credit instead of returned as change. */
  cashOverageToCreditCents?: number
  /** Additional surcharge cents for credit card transactions. */
  surchargeCents?: number
  /** Customer email for E-Transfer (optional, shown on receipt). */
  email?: string
}

export interface BulkImportProductInput {
  sku: string
  name: string
  costCents: number
  priceCents?: number
  barcode?: string
  isPinned?: boolean
}

export type TransactionWithItems = DBTransaction & {
  items: (DBTransactionItem & { product: Product })[]
  customer?: Customer | null
  user?: { id: number; fullName: string; role: string } | null
}

export interface StoreInfo {
  name: string
  address: string
  phone: string
}

export type PrinterType = 'NETWORK' | 'SYSTEM' | 'PDF'

export interface PrinterConfig {
  type: PrinterType
  ipAddress?: string
  port?: number
}

export interface BarcodeScanResult {
  barcode: string
  product: Product | null
  found: boolean
}

export interface PrintReceiptOptions {
  transaction: TransactionWithItems
  storeInfo?: StoreInfo
  printerConfig?: PrinterConfig
  rxFooter?: string
}

export interface PrintReceiptResult {
  success: boolean
  message: string
  pdfDataUrl?: string
  pdfPath?: string
}

export interface PrescriptionRecord {
  id: string
  patientName: string
  rxNumber: string
  drugName: string
  pickupStatus: 'READY' | 'PENDING' | 'PICKED_UP'
  balanceCents: number
  ageDays: number
  notes?: string
  createdAt: string
}

export interface ComplianceAuditEntry {
  id: string
  kind: string
  summary: string
  details?: Record<string, unknown>
  userName?: string
  station?: string
  createdAt: string
}

export interface CustomerLedgerEntry {
  id: string
  customerId: number
  kind: 'SHORT_PAY' | 'FILL_TAB' | 'APPLY_TAB' | 'CHARGE' | 'PAYMENT'
  amountCents: number
  balanceCents: number
  reference: string
  userName?: string
  station?: string
  notes?: string
  createdAt: string
}

export interface DashboardSummary {
  totalSalesCents: number
  transactionCount: number
  topProducts: Array<{ name: string; quantity: number }>
  categorySales: Array<{ category: string; totalCents: number }>
  cashierSales: Array<{ name: string; totalCents: number }>
  lowStockCount: number
}

export interface BackupBundle {
  path: string
  createdAt: string
  sizeBytes: number
}

// ---------------------------------------------------------------------------
// Reports System — shared types across the IPC boundary
// ---------------------------------------------------------------------------

export interface DateRange {
  fromDate: string // ISO date string (inclusive)
  toDate: string // ISO date string (inclusive)
}

export interface SalesSummary {
  grossCents: number
  returnsCents: number
  netCents: number
  cogsCents: number
  marginCents: number
  marginPercent: number
  transactionCount: number
  avgTransactionCents: number
  newCustomers: number
  repeatCustomers: number
}

export interface TopItemRow {
  productId: number
  name: string
  sku: string
  category: string | null
  costCents: number
  retailCents: number
  quantity: number
  revenueCents: number
  cogsCents: number
  marginCents: number
  marginPercent: number
}

export interface SlowItemRow {
  productId: number
  name: string
  sku: string
  category: string | null
  currentOnHand: number
  quantitySold: number
  lastSoldAt: string | null
}

export interface DailySalesRow {
  date: string // YYYY-MM-DD in local timezone
  transactionCount: number
  grossCents: number
  returnsCents: number
  netCents: number
  cogsCents: number
  marginCents: number
  marginPercent: number
}

export interface TenderBreakdownRow {
  tender: string // CASH | CARD | PHARMACY_CREDIT | POINTS
  amountCents: number
  percent: number
}

export interface CashierTotalRow {
  userId: number | null
  cashierName: string
  transactionCount: number
  totalSalesCents: number
  avgTransactionCents: number
  discountsCents: number
  voidsCount: number
  voidsCents: number
}

export interface InventoryValuationRow {
  category: string
  itemCount: number
  costValueCents: number
  retailValueCents: number
  variancePercent: number
}

export interface InventoryValuation {
  rows: InventoryValuationRow[]
  totalItemCount: number
  totalCostValueCents: number
  totalRetailValueCents: number
  totalVariancePercent: number
}

export interface CheckoutSettings {
  allowCreditCardSurcharge: boolean
  cardSurchargePercent: number
  allowShortPayToTab: boolean
}

export interface CreditHealthSummary {
  enabled: boolean
  activeAccounts: number
  totalCustomers: number
  adoptionPercent: number
  totalOutstandingCents: number
  overdueAccounts: number
  overdueCents: number
}

export interface AlertsSummary {
  lowStockCount: number
  outOfStockCount: number
  overdueTabCount: number
}

export interface DashboardData {
  today: {
    sales: SalesSummary
    topItems: TopItemRow[]
    alerts: AlertsSummary
  }
  thisMonth: {
    sales: SalesSummary
    topItems: TopItemRow[]
    alerts: AlertsSummary
  }
  creditHealth: CreditHealthSummary | null
  alerts: AlertsSummary
}

export type ReportExportFormat = 'csv'

// ---------------------------------------------------------------------------
// Payment (Stage 5) — provider-agnostic types shared across the IPC boundary
// ---------------------------------------------------------------------------

/**
 * Registered payment processors, spanning every real-world terminal category:
 *  - `manual`  — standalone/"dumb" terminal with no POS connection (cashier confirms)
 *  - `mock`    — fully offline simulator for demos/tests
 *  - `stripe`  — Stripe Terminal (cloud-SDK reader)
 *  - `square`  — Square Terminal (cloud-SDK reader)
 *  - `moneris` — Moneris semi-integrated gateway
 *  - `globalpayments` — Global Payments (GP-API) semi-integrated gateway
 */
export type PaymentProviderName =
  | 'manual'
  | 'mock'
  | 'stripe'
  | 'square'
  | 'clover'
  | 'moneris'
  | 'globalpayments'

export type PaymentEnvironment = 'sandbox' | 'production'

/**
 * How checkout must drive the payment step for the active provider:
 *  - `automatic` — call `charge()` and await the processor's approved/declined result
 *  - `manual`    — cashier runs the card on an external terminal, then records the
 *                  outcome (Approved/Declined) which is passed into `charge()`
 */
export type PaymentInteractionMode = 'automatic' | 'manual'

/** Full config — the `apiKey` only ever exists inside the main process. */
export interface PaymentConfig {
  provider: PaymentProviderName
  environment: PaymentEnvironment
  /** Reader/terminal id (Stripe reader id, Moneris terminal id, etc.). */
  terminalId?: string
  /** Secret/API key. Never sent to the renderer; stored encrypted at rest. */
  apiKey?: string
}

/** Renderer-safe view of the payment config — never carries the secret key. */
export interface PaymentConfigView {
  provider: PaymentProviderName
  environment: PaymentEnvironment
  terminalId?: string
  /** True when an encrypted API key is on file, so the UI can show "•••• set". */
  hasApiKey: boolean
  /**
   * Drive-mode for the active provider, computed main-side from the provider —
   * checkout branches on this, never on the provider name, so any future
   * manual-style adapter works without touching checkout.
   */
  interactionMode: PaymentInteractionMode
}

/** Extra context for a charge. Automatic providers ignore the manual fields. */
export interface ChargeOptions {
  /** For manual/external terminals: the outcome the cashier observed. */
  manualOutcome?: 'approved' | 'declined'
  /** Optional receipt/reference number the cashier jots from the terminal. */
  manualReference?: string
}

/** What the renderer sends when saving. Omit/blank `apiKey` to keep the existing one. */
export interface SavePaymentConfigInput {
  provider: PaymentProviderName
  environment: PaymentEnvironment
  terminalId?: string
  apiKey?: string
}

export type PaymentStatus = 'approved' | 'declined' | 'error'

export interface ChargeResult {
  status: PaymentStatus
  /** Processor transaction id — used later for refund/void. */
  transactionId?: string
  cardLast4?: string
  authCode?: string
  amountCents: number
  message?: string
}

export interface RefundResult {
  status: PaymentStatus
  refundId?: string
  message?: string
}

export interface VoidResult {
  status: PaymentStatus
  message?: string
}

export interface ReaderStatus {
  connected: boolean
  batteryLevel?: number
  label?: string
  provider: PaymentProviderName
  message?: string
}
