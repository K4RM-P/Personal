import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { getActiveProvider, resetActiveProvider } from '../payment/paymentService'
import { getPaymentConfigView, savePaymentConfig } from '../payment/paymentConfig'
import { requireManager } from '../auth/session'
import type {
  ChargeOptions,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus,
  SavePaymentConfigInput
} from '../../shared/types'

/**
 * Payment IPC surface. Every handler funnels through the generic
 * PaymentProvider — the renderer never learns which processor is wired up.
 * Errors are always reflected back as a typed `status: 'error'` result rather
 * than a rejected promise, so the till can show a clean message.
 */
export function registerPaymentHandlers(db: PrismaClient): void {
  ipcMain.handle(
    IPC.PAYMENT_CHARGE,
    async (_e, args: { amountCents: number; orderRef: string; options?: ChargeOptions }): Promise<ChargeResult> => {
      try {
        const provider = await getActiveProvider(db)
        return await provider.charge(args.amountCents, args.orderRef, args.options)
      } catch (err) {
        return { status: 'error', amountCents: args.amountCents, message: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    IPC.PAYMENT_REFUND,
    async (_e, args: { transactionId: string; amountCents?: number }): Promise<RefundResult> => {
      try {
        const provider = await getActiveProvider(db)
        return await provider.refund(args.transactionId, args.amountCents)
      } catch (err) {
        return { status: 'error', message: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    IPC.PAYMENT_VOID,
    async (_e, args: { transactionId: string }): Promise<VoidResult> => {
      try {
        const provider = await getActiveProvider(db)
        return await provider.void(args.transactionId)
      } catch (err) {
        return { status: 'error', message: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.PAYMENT_GET_READER_STATUS, async (): Promise<ReaderStatus> => {
    const view = await getPaymentConfigView(db)
    try {
      const provider = await getActiveProvider(db)
      return await provider.getReaderStatus()
    } catch (err) {
      return { connected: false, provider: view.provider, message: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.SETTINGS_GET_PAYMENT, () => getPaymentConfigView(db))

  // Only reachable from the Settings screen (manager-only nav) — enforce server-side too,
  // since it changes which payment processor/credentials are live.
  ipcMain.handle(IPC.SETTINGS_SAVE_PAYMENT, async (_e, input: SavePaymentConfigInput) => {
    requireManager()
    const view = await savePaymentConfig(db, input)
    resetActiveProvider() // next operation re-inits with the new provider/creds
    return view
  })
}
