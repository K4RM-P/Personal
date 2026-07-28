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
