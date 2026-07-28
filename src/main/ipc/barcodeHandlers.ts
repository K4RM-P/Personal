import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { getProductByBarcode } from '../db/queries/posQueries'

export function registerBarcodeHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.BARCODE_SCAN, async (_e, barcode: string) => {
    const trimmed = (barcode ?? '').trim()
    if (!trimmed) {
      return { barcode: trimmed, product: null, found: false }
    }
    const product = await getProductByBarcode(db, trimmed)
    return { barcode: trimmed, product, found: !!product }
  })

  ipcMain.handle(IPC.PRODUCT_GET_BY_BARCODE, async (_e, barcode: string) => {
    return getProductByBarcode(db, (barcode ?? '').trim())
  })
}
