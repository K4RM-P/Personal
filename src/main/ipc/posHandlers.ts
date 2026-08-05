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
  voidTransaction
} from '../db/queries/posQueries'
import { refundTabAmount } from '../db/queries/customerQueries'
import { log } from '../logging/logger'

export function registerPosHandlers(db: PrismaClient): void {
  // Products
  ipcMain.handle(IPC.PRODUCT_GET_ALL, () => getAllProducts(db))
  ipcMain.handle(IPC.PRODUCT_SEARCH, (_e, { query, limit }) => searchProducts(db, query, limit))
  ipcMain.handle(IPC.PRODUCT_CREATE, (_e, data) => createProduct(db, data))
  ipcMain.handle(IPC.PRODUCT_UPDATE, (_e, { id, data }) => updateProduct(db, id, data))
  ipcMain.handle(IPC.PRODUCT_DELETE, (_e, id: number) => deleteProduct(db, id))
  ipcMain.handle(IPC.PRODUCT_BULK_IMPORT, (_e, inputs) => bulkImportProducts(db, inputs))

  // Pricing Tiers
  ipcMain.handle(IPC.PRICING_TIER_GET_ALL, () => getAllPricingTiers(db))
  ipcMain.handle(IPC.PRICING_TIER_SAVE_ALL, (_e, tiers) => saveAllPricingTiers(db, tiers))
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
  ipcMain.handle(IPC.TRANSACTION_VOID, (_e, { id, reason }) => voidTransaction(db, id, reason))
  ipcMain.handle(IPC.TRANSACTION_REFUND_TAB, (_e, { id, amountCents }) =>
    refundTabAmount(db, id, amountCents)
  )
}
