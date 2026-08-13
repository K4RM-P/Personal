import type {
  FeatureFlag,
  Setting,
  Product,
  Customer,
  PricingTier as DBPricingTier,
  Transaction as DBTransaction,
  TransactionItem as DBTransactionItem,
  TransactionTender as DBTransactionTender,
  Refund as DBRefund,
  Discount as DBDiscount
} from '@prisma/client'
import type { PricingTier } from './pricingEngine'

export type {
  FeatureFlag,
  Setting,
  Product,
  Customer,
  DBPricingTier,
  DBTransaction,
  DBTransactionItem,
  DBTransactionTender,
  PricingTier,
  DBRefund,
  DBDiscount
}

export type RefundType = 'CASH' | 'CARD' | 'E_TRANSFER' | 'TAB_CREDIT'
export type RefundStatus = 'COMPLETED' | 'PENDING'
export type DiscountType = 'ITEM' | 'BILL'

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

export type TenderMethod = 'CASH' | 'CARD' | 'E_TRANSFER' | 'PHARMACY_CREDIT'
export type CardType = 'DEBIT' | 'CREDIT'
export type TenderLineStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'VOIDED'

/**
 * One tender line as built by the PAY popup. Every line sent to `transaction:create`
 * has already been "processed" client-side — cash counted, card charged through the
 * payment adapter, e-transfer confirmed, or a Pharmacy Credit amount validated against
 * the customer's outstanding breakdown — so every line here is implicitly COMPLETED;
 * PENDING/FAILED lines never leave the renderer (a failed card charge is simply never
 * added to the array the cashier is building). See TransactionTender in schema.prisma.
 */
export interface TenderLineInput {
  method: TenderMethod
  /** Amount this line applies toward the sale total. */
  amountCents: number

  // CASH-specific
  /** Physical cash handed over — may exceed amountCents (see changeCents/depositedToTabCents). */
  cashGivenCents?: number
  changeCents?: number
  /** cashGivenCents - amountCents, deposited to the linked customer's Pharmacy Credit instead of returned as change. */
  depositedToTabCents?: number

  // CARD-specific
  cardType?: CardType
  /** 2% surcharge cents, already included in amountCents, scoped to this line only. */
  surchargeCents?: number
  processorTransactionId?: string
  cardLastFour?: string

  // E_TRANSFER-specific
  eTransferEmail?: string
  eTransferConfirmed?: boolean
}

export interface CreateTransactionPayload {
  items: {
    productId: number
    quantity: number
    costCents: number
    unitPriceCents: number
    /** Per-item discount in cents, applied at checkout. Cannot exceed unitPriceCents * quantity. */
    discountCents?: number
    discountReason?: string
    /** Whether HST is charged on this line item. Defaults to true. */
    hstApplied?: boolean
  }[]
  taxRatePercent: number
  /**
   * Ordered list of tender lines covering the sale total. Replaces the old single
   * tenderType/tenderedCents/tabAmountCents/surchargeCents/cashOverageToCreditCents/
   * processorTransactionId/cardLast4 fields as the source of truth — server validates
   * that the sum of every line's amountCents exactly equals the computed total
   * (including surcharge and any debt settlement) before writing anything.
   */
  tenders: TenderLineInput[]
  status?: 'COMPLETED' | 'PARKED'
  customerId?: number
  /** Customer email for E-Transfer (optional, shown on receipt) — mirrors the first E_TRANSFER line's email. */
  email?: string
  /** Whole-bill discount in cents, applied to the pre-tax total after item discounts. */
  billDiscountCents?: number
  billDiscountReason?: string
  /**
   * `ledgerEntryId`s (see DebtBreakdownEntry) of specific outstanding debt items the
   * cashier chose to bring into and pay off with this sale — the cashier can select
   * one, several, or all of a customer's outstanding items, not just the full balance.
   * The dollar amount is always derived server-side from these entries' current
   * contribution (see getCustomerDebtBreakdown) — never trust a client-supplied cents
   * amount. Never taxed, never discounted, added to totalCents on top of the product
   * total. Requires `customerId`. Mutually exclusive with a PHARMACY_CREDIT tender line
   * — paying off tab debt by charging it back to the same tab is circular.
   */
  debtSettlementLedgerEntryIds?: number[]
}

// ------------------------------------------------- Pharmacy Credit debt settlement

export interface DebtBreakdownEntry {
  ledgerEntryId: number
  type: 'SALE_CHARGE' | 'MANUAL_ADJUSTMENT'
  /** Positive cents this entry still contributes to the customer's current outstanding balance. */
  amountCents: number
  createdAt: Date
  note: string | null
  // Populated only for type === 'SALE_CHARGE'.
  transactionId?: string
  receiptNumber?: string
  transactionDate?: Date
  transactionTotalCents?: number
  tabAmountCents?: number
  chargeKind?: 'FULL_CHARGE' | 'SHORT_PAY'
  items?: { productName: string; quantity: number }[]
}

export interface DebtBreakdown {
  customerId: number
  totalOutstandingCents: number
  entries: DebtBreakdownEntry[]
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
  /** `product` is null only for a DEBT_SETTLEMENT line (see DBTransactionItem.lineType). */
  items: (DBTransactionItem & { product: Product | null })[]
  tenders?: DBTransactionTender[]
  customer?: Customer | null
  user?: { id: number; fullName: string; role: string } | null
}

// ---------------------------------------------------------------- Refunds

/** A row in the "Refund Past Sales" / "Past Sales" search results list. */
export interface SaleSearchResult {
  id: string
  receiptNumber: string
  createdAt: string
  customerName: string | null
  cashierName: string | null
  itemCount: number
  totalCents: number
  tenderType: string
  status: string
  refundedCents: number
}

/** Optional inclusive date-range bound for sale search/history queries. */
export interface SaleDateRange {
  fromDate?: string
  toDate?: string
}

/** Full sale detail loaded when a manager drills into a specific sale to refund it. */
export type SaleRefundDetail = TransactionWithItems & {
  refunds: DBRefund[]
  refundedCents: number
  refundableCents: number
}

export interface ProcessRefundPayload {
  transactionId: string
  type: RefundType
  amountCents: number
  reason?: string
  /** Required for E_TRANSFER. */
  customerEmail?: string
  /** Required for TAB_CREDIT when the sale has no customer attached yet. */
  linkCustomerId?: number
  /** The manager who authenticated for this refund (see AUTH_VERIFY_MANAGER). */
  refundedByUserId: number
}

export type ProcessRefundResult =
  { refund: DBRefund; newTransactionStatus: string } | { error: string }

export type VerifyManagerResult = { user: AuthUser } | { error: string }

export interface StoreInfo {
  name: string
  address: string
  phone: string
  licenseNumber?: string
  email?: string
  /** Data URL (base64) of the manager-uploaded receipt logo. */
  logoDataUrl?: string
  /** When true, receipts render via `customReceiptTemplateHtml` instead of the built-in layout. */
  useCustomReceiptTemplate?: boolean
  /** Manager-uploaded HTML template with `{{token}}` placeholders (see receiptTemplate.ts). */
  customReceiptTemplateHtml?: string
}

export interface UploadLogoResult {
  logoDataUrl: string
}

export interface UploadReceiptTemplateResult {
  customReceiptTemplateHtml: string
  useCustomReceiptTemplate: boolean
}

export interface ExportReceiptResult {
  path: string
}

export type PrinterType = 'NETWORK' | 'SYSTEM' | 'PDF'

export interface PrinterConfig {
  type: PrinterType
  ipAddress?: string
  port?: number
  /** OS printer device name for SYSTEM type — printing targets this printer silently, no OS print dialog. */
  deviceName?: string
}

/** An installed OS printer, as reported by Electron's printer enumeration. */
export interface SystemPrinterInfo {
  name: string
  displayName: string
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

// ---------------------------------------------------------------------------
// Data Backup System — docs/data-backup-system-spec.md
// ---------------------------------------------------------------------------

export interface ExternalDrive {
  name: string
  path: string
  totalBytes: number
  freeBytes: number
}

export interface BackupRunResult {
  backupDir: string
  files: Array<{ name: string; sizeBytes: number }>
  createdAt: string
}

/** The manager-configured USB drive backups are written to automatically. */
export interface BackupDestination {
  drivePath: string
  driveName: string
}

export interface BackupLogSummary {
  id: number
  timestamp: string
  backupPath: string
  driveName: string
  drivePath: string
  backupSizeBytes: number
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL' | 'EXPIRED_AND_DELETED'
  errorMessage: string | null
}

/** A `PHARMACY_POS_BACKUP_*` folder found on a drive, valid enough to consider restoring. */
export interface RestorableBackup {
  backupDir: string
  timestamp: string
  posVersion: string
  dataSnapshot: Record<string, number>
}

export interface RestoreBackupResult {
  backupDir: string
  restoredAt: string
  /** True once the app must be restarted for the restored data to take effect. */
  restartRequired: boolean
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

export interface CompleteProductSaleRow {
  date: string // YYYY-MM-DD local — sale date, or debt payoff date if debt-attributed
  receiptNumber: string
  productName: string
  quantity: number
  supplierCostCents: number // per-unit
  retailCostCents: number // per-unit
  discountCents: number // line total
  hstCents: number // line total, apportioned
  totalPriceCents: number // line total, excludes tax
  profitCents: number
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

export interface CustomerActivityRow {
  customerId: number
  customerName: string
  transactionCount: number
  totalSpentCents: number
}

export interface CustomerDebtRow {
  customerId: number
  customerName: string
  balanceOwedCents: number // positive: amount owed
  oldestDebtDate: string // YYYY-MM-DD local date of the oldest still-unpaid debit
  daysOverdue: number
}

export interface CustomerDebtReport {
  thresholdDays: number
  byBalance: CustomerDebtRow[] // every debtor, sorted balance desc
  warnings: CustomerDebtRow[] // byBalance filtered to daysOverdue >= thresholdDays, oldest first
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
  'manual' | 'mock' | 'stripe' | 'square' | 'clover' | 'moneris' | 'globalpayments'

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

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  error?: string
}
