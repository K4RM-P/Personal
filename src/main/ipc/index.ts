import { PrismaClient } from '@prisma/client'
import { registerFeatureFlagHandlers } from './featureFlagHandlers'
import { registerPosHandlers } from './posHandlers'
import { registerBarcodeHandlers } from './barcodeHandlers'
import { registerReceiptHandlers } from './receiptHandlers'
import { registerPaymentHandlers } from './paymentHandlers'

export function registerAllHandlers(db: PrismaClient): void {
  registerFeatureFlagHandlers(db)
  registerPosHandlers(db)
  registerBarcodeHandlers(db)
  registerReceiptHandlers(db)
  registerPaymentHandlers(db)
}
