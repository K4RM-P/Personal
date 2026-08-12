import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import {
  getAllProducts,
  searchProducts,
  previewTierImpact,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
  getAllPricingTiers,
  saveAllPricingTiers,
  createTransaction,
  getTransactionDetail,
  voidTransaction
} from '../db/queries/posQueries'
import { refundTabAmount } from '../db/queries/customerQueries'
import { log } from '../logging/logger'
import { requireManager } from '../auth/session'

export function registerPosHandlers(db: PrismaClient): void {
  // Products
  ipcMain.handle(IPC.PRODUCT_GET_ALL, () => getAllProducts(db))
  ipcMain.handle(IPC.PRODUCT_SEARCH, (_e, { query, limit }) => searchProducts(db, query, limit))
  // Product create/update/delete/bulk-import are only surfaced on the Products screen,
  // which is manager-only nav (App.tsx MANAGER_ONLY) — enforce that at the IPC boundary too.
  ipcMain.handle(IPC.PRODUCT_CREATE, (_e, data) => {
    requireManager()
    return createProduct(db, data)
  })
  ipcMain.handle(IPC.PRODUCT_UPDATE, (_e, { id, data }) => {
    requireManager()
    return updateProduct(db, id, data)
  })
  ipcMain.handle(IPC.PRODUCT_DELETE, (_e, id: number) => {
    requireManager()
    return deleteProduct(db, id)
  })
  ipcMain.handle(IPC.PRODUCT_BULK_IMPORT, (_e, inputs) => {
    requireManager()
    return bulkImportProducts(db, inputs)
  })

  // Pricing Tiers — also manager-only nav (Products screen).
  ipcMain.handle(IPC.PRICING_TIER_GET_ALL, () => getAllPricingTiers(db))
  ipcMain.handle(IPC.PRICING_TIER_SAVE_ALL, (_e, tiers) => {
    requireManager()
    return saveAllPricingTiers(db, tiers)
  })
  ipcMain.handle(IPC.PRICING_TIER_PREVIEW_IMPACT, (_e, tiers) => previewTierImpact(db, tiers))

  // Transactions
  ipcMain.handle(IPC.TRANSACTION_CREATE, async (_e, payload) => {
    const result = await createTransaction(db, payload)
    log('SALE_COMPLETED', {
      transactionId: result.id,
      totalCents: result.totalCents,
      tenderType: result.tenderType
    })
    return result
  })
  // Void requires manager override per spec (pharmacy-pos-feature-spec.md "Void/void-line
  // with manager override") — the renderer only shows the void action to managers
  // (SalesHistoryScreen.tsx), but that alone doesn't stop a direct IPC call.
  ipcMain.handle(IPC.TRANSACTION_VOID, (_e, { id, reason }) => {
    requireManager()
    return voidTransaction(db, id, reason)
  })
  ipcMain.handle(IPC.TRANSACTION_REFUND_TAB, (_e, { id, amountCents }) =>
    refundTabAmount(db, id, amountCents)
  )
  ipcMain.handle(IPC.TRANSACTION_GET_DETAIL, (_e, id: string) => getTransactionDetail(db, id))
}
