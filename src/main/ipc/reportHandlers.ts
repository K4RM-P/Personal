import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import {
  getDashboardData,
  getDailySalesSummary,
  getTopItems,
  getSlowItems,
  getDailySalesBreakdown,
  getSalesByTender,
  getCashierTotals,
  getCurrentInventoryValuation,
  getCreditHealth,
  getAlerts,
  clearReportCache
} from '../db/queries/reportQueries'

/**
 * Register all report IPC handlers. Each report query is a separate handler
 * (spec §5) — not one monolithic "query" handler — so they can be tested and
 * cached independently.
 */
export function registerReportHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.REPORTS_GET_DASHBOARD, () => getDashboardData(db))

  ipcMain.handle(
    IPC.REPORTS_GET_SALES_SUMMARY,
    (_e, { fromDate, toDate }: { fromDate: string; toDate: string }) =>
      getDailySalesSummary(db, fromDate, toDate)
  )

  ipcMain.handle(
    IPC.REPORTS_GET_TOP_ITEMS,
    (_e, { fromDate, toDate, limit }: { fromDate: string; toDate: string; limit?: number }) =>
      getTopItems(db, fromDate, toDate, limit ?? 10)
  )

  ipcMain.handle(
    IPC.REPORTS_GET_SLOW_ITEMS,
    (
      _e,
      { fromDate, toDate, threshold }: { fromDate: string; toDate: string; threshold?: number }
    ) => getSlowItems(db, fromDate, toDate, threshold ?? 1)
  )

  ipcMain.handle(
    IPC.REPORTS_GET_DAILY_SALES,
    (_e, { fromDate, toDate }: { fromDate: string; toDate: string }) =>
      getDailySalesBreakdown(db, fromDate, toDate)
  )

  ipcMain.handle(
    IPC.REPORTS_GET_SALES_BY_TENDER,
    (_e, { fromDate, toDate }: { fromDate: string; toDate: string }) =>
      getSalesByTender(db, fromDate, toDate)
  )

  ipcMain.handle(
    IPC.REPORTS_GET_CASHIER_TOTALS,
    (_e, { fromDate, toDate }: { fromDate: string; toDate: string }) =>
      getCashierTotals(db, fromDate, toDate)
  )

  ipcMain.handle(IPC.REPORTS_GET_INVENTORY_VALUATION, () => getCurrentInventoryValuation(db))

  ipcMain.handle(IPC.REPORTS_GET_CREDIT_HEALTH, () => getCreditHealth(db))

  ipcMain.handle(IPC.REPORTS_GET_ALERTS, () => getAlerts(db))

  // CSV export is handled in the renderer (file save dialog); the main process
  // just clears the cache so the next query is fresh. The actual CSV generation
  // happens renderer-side from the already-fetched report data.
  ipcMain.handle(IPC.REPORTS_EXPORT_CSV, () => {
    clearReportCache()
    return { path: 'exports/report.csv' }
  })

  // Phase 2 — PDF export placeholder
  ipcMain.handle(IPC.REPORTS_EXPORT_XLSX, () => Promise.resolve({ path: 'exports/report.xlsx' }))
}