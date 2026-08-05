import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { ProcessRefundPayload, ProcessRefundResult, SaleDateRange, SaleRefundDetail, SaleSearchResult } from '../../shared/types'
import { getSaleDetailsForRefund, processRefund, searchSalesForRefund } from '../db/queries/refundQueries'

export function registerRefundHandlers(db: PrismaClient): void {
  ipcMain.handle(
    IPC.REFUND_SEARCH_SALES,
    (_e, args: { query?: string } & SaleDateRange): Promise<SaleSearchResult[]> =>
      searchSalesForRefund(db, args?.query, {
        fromDate: args?.fromDate ? new Date(args.fromDate) : undefined,
        toDate: args?.toDate ? new Date(args.toDate) : undefined
      })
  )

  ipcMain.handle(IPC.REFUND_GET_SALE_DETAILS, (_e, transactionId: string): Promise<SaleRefundDetail> =>
    getSaleDetailsForRefund(db, transactionId)
  )

  ipcMain.handle(IPC.REFUND_PROCESS, async (_e, payload: ProcessRefundPayload): Promise<ProcessRefundResult> => {
    try {
      const refund = await processRefund(db, payload)
      const sale = await db.transaction.findUniqueOrThrow({ where: { id: payload.transactionId }, select: { status: true } })
      return { refund, newTransactionStatus: sale.status }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Refund failed.' }
    }
  })
}
