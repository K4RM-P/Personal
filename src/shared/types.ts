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
