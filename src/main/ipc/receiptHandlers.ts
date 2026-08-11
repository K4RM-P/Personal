import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { printReceipt, testNetworkPrinter, listSystemPrinters } from '../receipt/receiptPrinter'
import {
  getPrinterConfig,
  getStoreInfo,
  savePrinterConfig,
  saveStoreInfo,
  getAllowCreditCardSurcharge,
  getCardSurchargePercent,
  getAllowShortPayToTab,
  saveAllowCreditCardSurcharge,
  saveCardSurchargePercent,
  saveAllowShortPayToTab,
  getIdleTimeoutMinutes,
  saveIdleTimeoutMinutes,
  getDisplayDensityLevel,
  saveDisplayDensityLevel
} from '../db/queries/settingsQueries'
import { requireManager } from '../auth/session'
import type {
  PrinterConfig,
  StoreInfo,
  TransactionWithItems,
  CheckoutSettings
} from '../../shared/types'

export function registerReceiptHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.RECEIPT_PRINT, async (_e, transaction: TransactionWithItems) => {
    const [printerConfig, storeInfo] = await Promise.all([getPrinterConfig(db), getStoreInfo(db)])
    return printReceipt({ transaction, printerConfig, storeInfo })
  })

  ipcMain.handle(
    IPC.RECEIPT_TEST_NETWORK,
    async (_e, { ipAddress, port }: { ipAddress: string; port?: number }) => {
      return testNetworkPrinter(ipAddress, port ?? 9100)
    }
  )

  ipcMain.handle(IPC.RECEIPT_LIST_PRINTERS, () => listSystemPrinters())

  ipcMain.handle(IPC.SETTINGS_GET_PRINTER, () => getPrinterConfig(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_PRINTER, (_e, config: PrinterConfig) =>
    savePrinterConfig(db, config)
  )

  ipcMain.handle(IPC.SETTINGS_GET_STORE, () => getStoreInfo(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_STORE, (_e, info: StoreInfo) => saveStoreInfo(db, info))

  ipcMain.handle(IPC.SETTINGS_GET_CHECKOUT, async (): Promise<CheckoutSettings> => {
    const [allowSurcharge, surchargePercent, allowShortPay] = await Promise.all([
      getAllowCreditCardSurcharge(db),
      getCardSurchargePercent(db),
      getAllowShortPayToTab(db)
    ])
    return {
      allowCreditCardSurcharge: allowSurcharge,
      cardSurchargePercent: surchargePercent,
      allowShortPayToTab: allowShortPay
    }
  })

  ipcMain.handle(IPC.SETTINGS_SAVE_CHECKOUT, async (_e, input: CheckoutSettings) => {
    await Promise.all([
      saveAllowCreditCardSurcharge(db, input.allowCreditCardSurcharge),
      saveCardSurchargePercent(db, input.cardSurchargePercent),
      saveAllowShortPayToTab(db, input.allowShortPayToTab)
    ])
    return input
  })

  ipcMain.handle(IPC.SETTINGS_GET_IDLE_TIMEOUT, () => getIdleTimeoutMinutes(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_IDLE_TIMEOUT, async (_e, minutes: number) => {
    requireManager()
    await saveIdleTimeoutMinutes(db, minutes)
    return minutes
  })

  // Display density — device-level, visible/settable by any role.
  ipcMain.handle(IPC.SETTINGS_GET_DISPLAY_DENSITY, () => getDisplayDensityLevel(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_DISPLAY_DENSITY, (_e, level: number) =>
    saveDisplayDensityLevel(db, level)
  )
}
