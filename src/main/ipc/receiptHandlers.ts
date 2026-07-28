import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { printReceipt, testNetworkPrinter } from '../receipt/receiptPrinter'
import { getPrinterConfig, getStoreInfo, savePrinterConfig, saveStoreInfo } from '../db/queries/settingsQueries'
import type { PrinterConfig, StoreInfo, TransactionWithItems } from '../../shared/types'

export function registerReceiptHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.RECEIPT_PRINT, async (_e, transaction: TransactionWithItems) => {
    const [printerConfig, storeInfo] = await Promise.all([getPrinterConfig(db), getStoreInfo(db)])
    return printReceipt({ transaction, printerConfig, storeInfo })
  })

  ipcMain.handle(IPC.RECEIPT_TEST_NETWORK, async (_e, { ipAddress, port }: { ipAddress: string; port?: number }) => {
    return testNetworkPrinter(ipAddress, port ?? 9100)
  })

  ipcMain.handle(IPC.SETTINGS_GET_PRINTER, () => getPrinterConfig(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_PRINTER, (_e, config: PrinterConfig) => savePrinterConfig(db, config))

  ipcMain.handle(IPC.SETTINGS_GET_STORE, () => getStoreInfo(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_STORE, (_e, info: StoreInfo) => saveStoreInfo(db, info))
}
