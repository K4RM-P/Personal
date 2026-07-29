import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import {
  getAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
  getAllPricingTiers,
  saveAllPricingTiers,
  createTransaction,
  getAllTransactions,
  voidTransaction
} from '../db/queries/posQueries'
import { refundTabAmount } from '../db/queries/customerQueries'

export function registerPosHandlers(db: PrismaClient): void {
  // Products
  ipcMain.handle(IPC.PRODUCT_GET_ALL, () => getAllProducts(db))
  ipcMain.handle(IPC.PRODUCT_CREATE, (_e, data) => createProduct(db, data))
  ipcMain.handle(IPC.PRODUCT_UPDATE, (_e, { id, data }) => updateProduct(db, id, data))
  ipcMain.handle(IPC.PRODUCT_DELETE, (_e, id: number) => deleteProduct(db, id))
  ipcMain.handle(IPC.PRODUCT_BULK_IMPORT, (_e, inputs) => bulkImportProducts(db, inputs))

  // Pricing Tiers
  ipcMain.handle(IPC.PRICING_TIER_GET_ALL, () => getAllPricingTiers(db))
  ipcMain.handle(IPC.PRICING_TIER_SAVE_ALL, (_e, tiers) => saveAllPricingTiers(db, tiers))

  // Transactions
  ipcMain.handle(IPC.TRANSACTION_CREATE, (_e, payload) => createTransaction(db, payload))
  ipcMain.handle(IPC.TRANSACTION_GET_ALL, () => getAllTransactions(db))
  ipcMain.handle(IPC.TRANSACTION_VOID, (_e, { id, reason }) => voidTransaction(db, id, reason))
  ipcMain.handle(IPC.TRANSACTION_REFUND_TAB, (_e, { id, amountCents }) => refundTabAmount(db, id, amountCents))
}
