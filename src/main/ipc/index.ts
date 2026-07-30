import { PrismaClient } from '@prisma/client'
import { registerFeatureFlagHandlers } from './featureFlagHandlers'
import { registerPosHandlers } from './posHandlers'
import { registerBarcodeHandlers } from './barcodeHandlers'
import { registerReceiptHandlers } from './receiptHandlers'
import { registerPaymentHandlers } from './paymentHandlers'
import { registerComplianceHandlers } from './complianceHandlers'
import { registerCatalogHandlers } from './catalogHandlers'
import { registerCustomerHandlers } from './customerHandlers'
import { registerReportHandlers } from './reportHandlers'

export function registerAllHandlers(db: PrismaClient): void {
  registerFeatureFlagHandlers(db)
  registerPosHandlers(db)
  registerBarcodeHandlers(db)
  registerReceiptHandlers(db)
  registerPaymentHandlers(db)
  registerComplianceHandlers(db)
  registerCatalogHandlers(db)
  registerCustomerHandlers(db)
  registerReportHandlers(db)
}