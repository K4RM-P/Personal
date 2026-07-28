import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  FeatureFlag,
  Product,
  PricingTier,
  CreateTransactionPayload,
  BulkImportProductInput,
  TransactionWithItems
} from '../shared/types'

const api = {
  featureFlag: {
    getAll: (): Promise<FeatureFlag[]> => ipcRenderer.invoke(IPC.FEATURE_FLAG_GET_ALL),
    upsert: (key: string, enabled: boolean): Promise<FeatureFlag> =>
      ipcRenderer.invoke(IPC.FEATURE_FLAG_UPSERT, { key, enabled })
  },
  product: {
    getAll: (): Promise<Product[]> => ipcRenderer.invoke(IPC.PRODUCT_GET_ALL),
    create: (data: { sku: string; name: string; costCents: number; priceCents?: number; barcode?: string; isPinned?: boolean }): Promise<Product> =>
      ipcRenderer.invoke(IPC.PRODUCT_CREATE, data),
    update: (id: number, data: { sku?: string; name?: string; costCents?: number; priceCents?: number; barcode?: string; isPinned?: boolean }): Promise<Product> =>
      ipcRenderer.invoke(IPC.PRODUCT_UPDATE, { id, data }),
    delete: (id: number): Promise<Product> => ipcRenderer.invoke(IPC.PRODUCT_DELETE, id),
    bulkImport: (inputs: BulkImportProductInput[]): Promise<{ count: number }> =>
      ipcRenderer.invoke(IPC.PRODUCT_BULK_IMPORT, inputs)
  },
  pricingTier: {
    getAll: (): Promise<PricingTier[]> => ipcRenderer.invoke(IPC.PRICING_TIER_GET_ALL),
    saveAll: (tiers: PricingTier[]): Promise<PricingTier[]> =>
      ipcRenderer.invoke(IPC.PRICING_TIER_SAVE_ALL, tiers)
  },
  transaction: {
    create: (payload: CreateTransactionPayload): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_CREATE, payload),
    getAll: (): Promise<TransactionWithItems[]> => ipcRenderer.invoke(IPC.TRANSACTION_GET_ALL),
    void: (id: string, reason: string): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_VOID, { id, reason })
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (see index.d.ts)
  window.api = api
}

export type PosApi = typeof api
