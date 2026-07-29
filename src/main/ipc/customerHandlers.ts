import { ipcMain } from 'electron'
import type { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { addFunds, adjustCredit, adjustPoints, createCustomer, findDuplicatePhone, getCreditSettings, getCustomerDetail, saveCreditSettings, searchCustomers, updateCustomer } from '../db/queries/customerQueries'

export function registerCustomerHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.CUSTOMER_SEARCH, (_e, query: string) => searchCustomers(db, query))
  ipcMain.handle(IPC.CUSTOMER_GET, (_e, id: number) => getCustomerDetail(db, id))
  ipcMain.handle(IPC.CUSTOMER_CREATE, (_e, input) => createCustomer(db, input))
  ipcMain.handle(IPC.CUSTOMER_UPDATE, (_e, { id, input }) => updateCustomer(db, id, input))
  ipcMain.handle(IPC.CUSTOMER_DUPLICATE_PHONE, (_e, { phone, excludeId }) => findDuplicatePhone(db, phone, excludeId))
  ipcMain.handle(IPC.CUSTOMER_ADD_FUNDS, (_e, { customerId, amountCents, note }) => addFunds(db, customerId, amountCents, note))
  ipcMain.handle(IPC.CUSTOMER_ADJUST_CREDIT, (_e, { customerId, amountCents, note, managerGranted }) => adjustCredit(db, customerId, amountCents, note, managerGranted))
  ipcMain.handle(IPC.CUSTOMER_ADJUST_POINTS, (_e, { customerId, points, note, managerGranted }) => adjustPoints(db, customerId, points, note, managerGranted))
  ipcMain.handle(IPC.CUSTOMER_GET_CREDIT_SETTINGS, () => getCreditSettings(db))
  ipcMain.handle(IPC.CUSTOMER_SAVE_CREDIT_SETTINGS, (_e, input) => saveCreditSettings(db, input))
}
