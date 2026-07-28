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

export interface CreateTransactionPayload {
  items: {
    productId: number
    quantity: number
    costCents: number
    unitPriceCents: number
  }[]
  taxRatePercent: number
  tenderType: 'CASH' | 'CARD' | 'SPLIT'
  tenderedCents: number
  status?: 'COMPLETED' | 'PARKED'
  customerId?: number
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
