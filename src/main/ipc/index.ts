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
import { registerUserHandlers } from './userHandlers'
import { registerRefundHandlers } from './refundHandlers'
import { registerBackupHandlers } from './backupHandlers'
import { registerCustomerDisplayHandlers } from './customerDisplayHandlers'
import { registerReportEmailHandlers } from './reportEmailHandlers'
import { registerDangerZoneHandlers } from './dangerZoneHandlers'

export function registerAllHandlers(db: PrismaClient): void {
  registerUserHandlers(db)
  registerFeatureFlagHandlers(db)
  registerPosHandlers(db)
  registerBarcodeHandlers(db)
  registerReceiptHandlers(db)
  registerPaymentHandlers(db)
  registerComplianceHandlers(db)
  registerCatalogHandlers(db)
  registerCustomerHandlers(db)
  registerReportHandlers(db)
  registerRefundHandlers(db)
  registerBackupHandlers(db)
  registerCustomerDisplayHandlers(db)
  registerReportEmailHandlers(db)
  registerDangerZoneHandlers(db)
}
