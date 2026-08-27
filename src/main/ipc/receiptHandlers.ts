import { dialog, ipcMain, BrowserWindow } from 'electron'
import { PrismaClient } from '@prisma/client'
import { readFile, writeFile } from 'fs/promises'
import { extname } from 'path'
import { IPC } from '../../shared/channels'
import {
  printReceipt,
  testNetworkPrinter,
  listSystemPrinters,
  printToPdf
} from '../receipt/receiptPrinter'
import { buildReceiptHtml } from '../receipt/receiptTemplate'
import {
  getPrinterConfig,
  getStoreInfo,
  savePrinterConfig,
  saveStoreInfo,
  saveStoreLogo,
  clearStoreLogo,
  saveCustomReceiptTemplate,
  clearCustomReceiptTemplate,
  setUseCustomReceiptTemplate,
  getAllowCreditCardSurcharge,
  getCardSurchargePercent,
  saveAllowCreditCardSurcharge,
  saveCardSurchargePercent,
  getSaveCustomItemsToCatalog,
  saveSaveCustomItemsToCatalog,
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

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const MAX_TEMPLATE_CHARS = 200_000
const LOGO_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

/** Wraps a handler so a thrown error surfaces as a clean message, not an unhandled rejection. */
function guard<A extends unknown[], R>(
  label: string,
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${label}: ${message}`)
    }
  }
}

function buildSampleProduct(
  overrides: {
    id: number
    sku: string
    name: string
    costCents: number
    priceCents: number
    barcode: string
  },
  now: Date
): TransactionWithItems['items'][number]['product'] {
  return {
    ...overrides,
    isPinned: false,
    fallbackPinned: false,
    createdAt: now,
    updatedAt: now,
    currentOnHand: 0,
    reorderPoint: 0,
    categoryCode: null,
    origin: 'MANUAL',
    sourceItemNumber: null,
    lastCatalogSyncAt: null,
    lastSeenBatchId: null,
    discontinued: false,
    discontinuedAt: null,
    nameOverridden: false,
    costOverridden: false,
    barcodeOverridden: false,
    excludeFromCatalog: false
  }
}

/** Sample transaction used to preview/export receipt layout & branding without a real sale. */
function buildSampleTransaction(): TransactionWithItems {
  const now = new Date()
  return {
    id: 'preview',
    receiptNumber: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}00001`,
    status: 'COMPLETED',
    subtotalCents: 2497,
    taxCents: 325,
    totalCents: 2822,
    tenderType: 'CASH',
    tenderedCents: 3000,
    changeCents: 178,
    billDiscountCents: 0,
    voidReason: null,
    customerId: null,
    tabAmountCents: 0,
    surchargeCents: 0,
    email: null,
    userId: null,
    cashierId: null,
    voidedByUserId: null,
    discountIssuedByUserId: null,
    processorTransactionId: null,
    cardLast4: null,
    category: null,
    saleType: 'NORMAL',
    discountApplied: 0,
    createdAt: now,
    updatedAt: now,
    customer: null,
    items: [
      {
        id: 'preview-item-1',
        transactionId: 'preview',
        productId: 1,
        quantity: 2,
        costCents: 450,
        unitPriceCents: 899,
        totalCents: 1798,
        discountCents: 0,
        isVoided: false,
        hstApplied: true,
        lineType: 'PRODUCT',
        product: buildSampleProduct(
          {
            id: 1,
            sku: 'OTC-001',
            name: 'Ibuprofen 200mg 50ct',
            costCents: 450,
            priceCents: 899,
            barcode: '012345678901'
          },
          now
        )
      },
      {
        id: 'preview-item-2',
        transactionId: 'preview',
        productId: 2,
        quantity: 1,
        costCents: 350,
        unitPriceCents: 699,
        totalCents: 699,
        discountCents: 0,
        isVoided: false,
        hstApplied: false,
        lineType: 'PRODUCT',
        product: buildSampleProduct(
          {
            id: 2,
            sku: 'RX-002',
            name: 'Amoxicillin 500mg 21ct',
            costCents: 350,
            priceCents: 699,
            barcode: '012345678902'
          },
          now
        )
      }
    ]
  }
}

export function registerReceiptHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.RECEIPT_PRINT, async (_e, transaction: TransactionWithItems) => {
    const [printerConfig, storeInfo] = await Promise.all([getPrinterConfig(db), getStoreInfo(db)])
    return printReceipt({ transaction, printerConfig, storeInfo })
  })

  ipcMain.handle(
    IPC.RECEIPT_SAVE_PDF,
    guard('Save receipt as PDF', async (_e, transaction: TransactionWithItems) => {
      const storeInfo = await getStoreInfo(db)
      const html = buildReceiptHtml({ transaction, storeInfo })
      const saveResult = await dialog.showSaveDialog({
        title: 'Save receipt as PDF',
        defaultPath: `receipt-${transaction.receiptNumber}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) return null
      const { pdfDataUrl } = await printToPdf(html, transaction.receiptNumber)
      const base64 = pdfDataUrl.split(',')[1]
      await writeFile(saveResult.filePath, Buffer.from(base64, 'base64'))
      return { path: saveResult.filePath }
    })
  )

  ipcMain.handle(
    IPC.RECEIPT_TEST_NETWORK,
    async (
      _e,
      {
        ipAddress,
        port,
        language,
        labelWidthMm,
        labelHeightMm,
        topMarginMm
      }: Pick<PrinterConfig, 'ipAddress' | 'port' | 'language' | 'labelWidthMm' | 'labelHeightMm' | 'topMarginMm'>
    ) => {
      if (!ipAddress) throw new Error('ipAddress is required')
      return testNetworkPrinter(ipAddress, port ?? 9100, { language, labelWidthMm, labelHeightMm, topMarginMm })
    }
  )

  ipcMain.handle(IPC.RECEIPT_LIST_PRINTERS, () => listSystemPrinters())

  ipcMain.handle(IPC.SETTINGS_GET_PRINTER, () => getPrinterConfig(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_PRINTER, (_e, config: PrinterConfig) =>
    savePrinterConfig(db, config)
  )

  ipcMain.handle(IPC.SETTINGS_GET_STORE, () => getStoreInfo(db))
  ipcMain.handle(IPC.SETTINGS_SAVE_STORE, (_e, info: StoreInfo) => {
    requireManager()
    return saveStoreInfo(db, info)
  })

  ipcMain.handle(
    IPC.SETTINGS_UPLOAD_LOGO,
    guard('Upload logo', async () => {
      requireManager()
      const result = await dialog.showOpenDialog({
        title: 'Select pharmacy logo',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const filePath = result.filePaths[0]
      const ext = extname(filePath).slice(1).toLowerCase()
      const mime = LOGO_MIME_BY_EXT[ext]
      if (!mime) throw new Error('Unsupported image format. Use PNG, JPG, GIF, or WebP.')

      const buffer = await readFile(filePath)
      if (buffer.length > MAX_LOGO_BYTES) throw new Error('Logo image must be smaller than 2MB.')

      const logoDataUrl = `data:${mime};base64,${buffer.toString('base64')}`
      await saveStoreLogo(db, logoDataUrl)
      return { logoDataUrl }
    })
  )

  ipcMain.handle(
    IPC.SETTINGS_REMOVE_LOGO,
    guard('Remove logo', async () => {
      requireManager()
      await clearStoreLogo(db)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC.SETTINGS_UPLOAD_RECEIPT_TEMPLATE,
    guard('Upload receipt template', async () => {
      requireManager()
      const result = await dialog.showOpenDialog({
        title: 'Select custom receipt template (HTML)',
        properties: ['openFile'],
        filters: [{ name: 'HTML template', extensions: ['html', 'htm'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const filePath = result.filePaths[0]
      const html = await readFile(filePath, 'utf-8')
      if (html.length > MAX_TEMPLATE_CHARS) throw new Error('Receipt template file is too large.')
      if (!html.trim()) throw new Error('Receipt template file is empty.')

      await saveCustomReceiptTemplate(db, html)
      return { customReceiptTemplateHtml: html, useCustomReceiptTemplate: true }
    })
  )

  ipcMain.handle(
    IPC.SETTINGS_CLEAR_RECEIPT_TEMPLATE,
    guard('Clear receipt template', async () => {
      requireManager()
      await clearCustomReceiptTemplate(db)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC.SETTINGS_SET_USE_CUSTOM_RECEIPT_TEMPLATE,
    guard('Toggle custom receipt template', async (_e, enabled: boolean) => {
      requireManager()
      await setUseCustomReceiptTemplate(db, enabled)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC.RECEIPT_PREVIEW,
    guard('Preview receipt', async () => {
      const storeInfo = await getStoreInfo(db)
      const html = buildReceiptHtml({ transaction: buildSampleTransaction(), storeInfo })
      const win = new BrowserWindow({
        width: 420,
        height: 760,
        title: 'Receipt Preview',
        autoHideMenuBar: true
      })
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC.RECEIPT_EXPORT,
    guard('Export receipt', async () => {
      const storeInfo = await getStoreInfo(db)
      const html = buildReceiptHtml({ transaction: buildSampleTransaction(), storeInfo })

      const saveResult = await dialog.showSaveDialog({
        title: 'Export current receipt',
        defaultPath: 'receipt-preview.pdf',
        filters: [
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'HTML', extensions: ['html'] }
        ]
      })
      if (saveResult.canceled || !saveResult.filePath) return null

      if (saveResult.filePath.toLowerCase().endsWith('.html')) {
        await writeFile(saveResult.filePath, html, 'utf-8')
      } else {
        const { pdfDataUrl } = await printToPdf(html, 'preview')
        const base64 = pdfDataUrl.split(',')[1]
        await writeFile(saveResult.filePath, Buffer.from(base64, 'base64'))
      }
      return { path: saveResult.filePath }
    })
  )

  ipcMain.handle(IPC.SETTINGS_GET_CHECKOUT, async (): Promise<CheckoutSettings> => {
    const [allowSurcharge, surchargePercent, saveCustomItems] = await Promise.all([
      getAllowCreditCardSurcharge(db),
      getCardSurchargePercent(db),
      getSaveCustomItemsToCatalog(db)
    ])
    return {
      allowCreditCardSurcharge: allowSurcharge,
      cardSurchargePercent: surchargePercent,
      saveCustomItemsToCatalog: saveCustomItems
    }
  })

  // Only reachable from Settings (manager-only nav) — also affects card surcharge %, money-relevant.
  ipcMain.handle(IPC.SETTINGS_SAVE_CHECKOUT, async (_e, input: CheckoutSettings) => {
    requireManager()
    await Promise.all([
      saveAllowCreditCardSurcharge(db, input.allowCreditCardSurcharge),
      saveCardSurchargePercent(db, input.cardSurchargePercent),
      saveSaveCustomItemsToCatalog(db, input.saveCustomItemsToCatalog)
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
