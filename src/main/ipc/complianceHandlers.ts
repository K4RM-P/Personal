import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import {
  searchRxRecords,
  getAgingRxRecords,
  logComplianceEvent,
  getComplianceAuditLog,
  exportComplianceAuditLog,
  captureSignature,
  validatePseSale,
  scanDscsaBarcode,
  checkFsaHsaEligibility,
  getCustomerLedger,
  postCustomerLedgerEntry,
  buildDashboardSummary,
  createBackupBundle,
  restoreBackupTest
} from '../db/queries/complianceQueries'

export function registerComplianceHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.COMPLIANCE_SEARCH_RX, (_e, query: string) => searchRxRecords(db, query))
  ipcMain.handle(IPC.COMPLIANCE_GET_AGING_RX, (_e, olderThanDays: number) => getAgingRxRecords(db, olderThanDays))
  ipcMain.handle(IPC.COMPLIANCE_LOG_EVENT, (_e, payload) => logComplianceEvent(db, payload.kind, payload.summary, payload.details))
  ipcMain.handle(IPC.COMPLIANCE_GET_AUDIT_LOG, () => getComplianceAuditLog(db))
  ipcMain.handle(IPC.COMPLIANCE_EXPORT_AUDIT_LOG, () => exportComplianceAuditLog(db))
  ipcMain.handle(IPC.COMPLIANCE_CAPTURE_SIGNATURE, (_e, context: string) => captureSignature(db, context))
  ipcMain.handle(IPC.COMPLIANCE_PSE_VALIDATE, (_e, payload) => validatePseSale(payload.productName, payload.quantity, payload.days))
  ipcMain.handle(IPC.COMPLIANCE_DSCSA_SCAN, (_e, barcode: string) => scanDscsaBarcode(barcode))
  ipcMain.handle(IPC.COMPLIANCE_FSA_HSA_CHECK, (_e, productName: string) => checkFsaHsaEligibility(productName))
  ipcMain.handle(IPC.CUSTOMER_LEDGER_GET, (_e, customerId: number) => getCustomerLedger(db, customerId))
  ipcMain.handle(IPC.CUSTOMER_LEDGER_POST, (_e, payload) => postCustomerLedgerEntry(db, payload.customerId, payload.kind, payload.amountCents, payload.reference, payload.notes))
  ipcMain.handle(IPC.REPORTS_GET_DASHBOARD, () => buildDashboardSummary(db))
  ipcMain.handle(IPC.REPORTS_EXPORT_CSV, () => Promise.resolve({ path: 'exports/report.csv' }))
  ipcMain.handle(IPC.REPORTS_EXPORT_XLSX, () => Promise.resolve({ path: 'exports/report.xlsx' }))
  ipcMain.handle(IPC.BACKUP_CREATE, () => createBackupBundle())
  ipcMain.handle(IPC.BACKUP_RESTORE_TEST, () => restoreBackupTest())
}
