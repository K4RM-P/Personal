import { dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import type { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import {
  addFunds,
  adjustCredit,
  adjustPoints,
  createCustomer,
  deleteCustomerData,
  exportCustomerData,
  findDuplicatePhone,
  getCreditSettings,
  getCustomerDebtBreakdown,
  getCustomerDetail,
  importCustomers,
  saveCreditSettings,
  searchCustomers,
  updateCustomer
} from '../db/queries/customerQueries'
import { parsePatientListCsv } from '../customers/patientListCsv'
import { requireManager } from '../auth/session'
import { log } from '../logging/logger'

export function registerCustomerHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.CUSTOMER_SEARCH, (_e, query: string) => searchCustomers(db, query))
  ipcMain.handle(IPC.CUSTOMER_GET, (_e, id: number) => getCustomerDetail(db, id))
  ipcMain.handle(IPC.CUSTOMER_CREATE, (_e, input) => createCustomer(db, input))
  ipcMain.handle(IPC.CUSTOMER_UPDATE, (_e, { id, input }) => updateCustomer(db, id, input))
  ipcMain.handle(IPC.CUSTOMER_DUPLICATE_PHONE, (_e, { phone, excludeId }) =>
    findDuplicatePhone(db, phone, excludeId)
  )
  ipcMain.handle(IPC.CUSTOMER_ADD_FUNDS, (_e, { customerId, amountCents, note }) =>
    addFunds(db, customerId, amountCents, note)
  )
  ipcMain.handle(IPC.CUSTOMER_ADJUST_CREDIT, (_e, { customerId, amountCents, note }) => {
    // managerGranted used to come straight from the renderer payload — a caller invoking
    // this channel directly (e.g. devtools) could pass true without ever authenticating.
    // Re-derive it from the real backend session instead of trusting the client.
    requireManager()
    return adjustCredit(db, customerId, amountCents, note, true)
  })
  ipcMain.handle(IPC.CUSTOMER_ADJUST_POINTS, (_e, { customerId, points, note }) => {
    requireManager()
    return adjustPoints(db, customerId, points, note, true)
  })
  ipcMain.handle(IPC.CUSTOMER_GET_DEBT_BREAKDOWN, (_e, customerId: number) =>
    getCustomerDebtBreakdown(db, customerId)
  )
  ipcMain.handle(IPC.CUSTOMER_GET_CREDIT_SETTINGS, () => getCreditSettings(db))
  ipcMain.handle(IPC.CUSTOMER_SAVE_CREDIT_SETTINGS, (_e, input) => saveCreditSettings(db, input))

  // B7 (PIPEDA) — data access / deletion requests, Manager-only.
  ipcMain.handle(IPC.CUSTOMER_EXPORT_DATA, async (_e, customerId: number) => {
    requireManager()
    const data = await exportCustomerData(db, customerId)
    const result = await dialog.showSaveDialog({
      title: 'Save customer data export',
      defaultPath: `customer-${customerId}-export-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, JSON.stringify(data, null, 2))
    log('CUSTOMER_DATA_EXPORTED', { customerId, path: result.filePath })
    return { path: result.filePath }
  })

  ipcMain.handle(IPC.CUSTOMER_DELETE_DATA, async (_e, customerId: number) => {
    requireManager()
    const updated = await deleteCustomerData(db, customerId)
    log('CUSTOMER_DATA_DELETED', { customerId })
    return updated
  })

  ipcMain.handle(IPC.CUSTOMER_IMPORT_CSV, async () => {
    requireManager()
    const result = await dialog.showOpenDialog({
      title: 'Select patient list CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const buffer = readFileSync(result.filePaths[0])
    const { customers, skipped, total } = parsePatientListCsv(buffer)
    const { imported, skippedDuplicates } = await importCustomers(db, customers)
    log('CUSTOMER_CSV_IMPORTED', {
      path: result.filePaths[0],
      total,
      imported,
      skippedDuplicates,
      skippedNoName: skipped
    })
    return { total, imported, skippedDuplicates, skippedNoName: skipped }
  })
}
