import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type {
  ProcessRefundPayload,
  ProcessRefundResult,
  SaleDateRange,
  SaleRefundDetail,
  SaleSearchResult
} from '../../shared/types'
import {
  getSaleDetailsForRefund,
  processRefund,
  searchSalesForRefund
} from '../db/queries/refundQueries'
import { startOfDay, endOfDay } from '../db/queries/reportQueries'
import { getSession } from '../auth/session'
import { log } from '../logging/logger'

/**
 * Refunds support a deliberate UX: a cashier-logged-in terminal where a manager
 * "quick-authenticates" via ManagerAuthModal (AUTH_VERIFY_MANAGER) without a full
 * re-login — the backend `Session` stays CASHIER throughout, by design (see
 * RefundsScreen). So these handlers can't gate on `requireManager()`/the session role
 * the way most manager-only actions do; the renderer instead passes the id of
 * whichever manager actually authenticated (previously trusted blindly — a caller
 * invoking these channels directly, e.g. devtools, could pass any id with no
 * verification at all). This re-derives it from the real User table every time.
 */
async function isRealManager(db: PrismaClient, userId: number | undefined): Promise<boolean> {
  if (getSession()?.role === 'MANAGER') return true
  if (!userId) return false
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'MANAGER'
}

export function registerRefundHandlers(db: PrismaClient): void {
  ipcMain.handle(
    IPC.REFUND_SEARCH_SALES,
    async (
      _e,
      args: { query?: string; managerId?: number } & SaleDateRange
    ): Promise<SaleSearchResult[]> => {
      // Cashiers can legitimately look up today's sales (Sales History screen); a
      // verified manager (full session or quick-authenticated for a refund) gets the
      // full range the renderer asked for. Anyone else is clamped server-side to
      // exactly what the UI already promises a cashier: today only.
      const verified = await isRealManager(db, args?.managerId)
      const now = new Date()
      return searchSalesForRefund(db, args?.query, {
        fromDate: verified && args?.fromDate ? new Date(args.fromDate) : startOfDay(now),
        toDate: verified && args?.toDate ? new Date(args.toDate) : endOfDay(now)
      })
    }
  )

  ipcMain.handle(
    IPC.REFUND_GET_SALE_DETAILS,
    async (_e, args: { transactionId: string; managerId: number }): Promise<SaleRefundDetail> => {
      if (!(await isRealManager(db, args?.managerId))) {
        throw new Error("You don't have permission to access this feature")
      }
      return getSaleDetailsForRefund(db, args.transactionId)
    }
  )

  ipcMain.handle(
    IPC.REFUND_PROCESS,
    async (_e, payload: ProcessRefundPayload): Promise<ProcessRefundResult> => {
      try {
        if (!(await isRealManager(db, payload?.refundedByUserId))) {
          throw new Error("You don't have permission to access this feature")
        }
        const refund = await processRefund(db, payload)
        log('REFUND_ISSUED', {
          refundId: refund.id,
          transactionId: payload.transactionId,
          amountCents: refund.amountCents,
          type: refund.type
        })
        const sale = await db.transaction.findUniqueOrThrow({
          where: { id: payload.transactionId },
          select: { status: true }
        })
        return { refund, newTransactionStatus: sale.status }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Refund failed.' }
      }
    }
  )
}
