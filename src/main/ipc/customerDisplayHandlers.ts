import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { CustomerDisplayState } from '../../shared/customerDisplay'
import {
  getCustomerDisplaySlides,
  saveCustomerDisplaySlides,
  deleteCustomerDisplaySlide,
  getCustomerDisplaySettings,
  saveCustomerDisplaySettings
} from '../db/queries/customerDisplayQueries'
import {
  broadcastCustomerDisplayState,
  broadcastCustomerDisplaySlides,
  broadcastCustomerDisplaySettings,
  reconcileCustomerDisplayWindowNow
} from '../customerDisplayWindow'

/** Spec §5.2: Thank You is shown for a short fixed duration, then falls back to Idle. */
const THANK_YOU_DURATION_MS = 5000

let thankYouTimer: NodeJS.Timeout | null = null
let lastPushSeq = 0

export function registerCustomerDisplayHandlers(db: PrismaClient): void {
  ipcMain.on(IPC.CUSTOMER_DISPLAY_PUSH, (_e, state: CustomerDisplayState) => {
    // Any newer push supersedes a pending auto-return: if the next customer's
    // first item is scanned before the 5s elapses, the display must jump
    // straight to Cart rather than waiting the timer out (spec §5.2).
    lastPushSeq += 1
    const seq = lastPushSeq
    if (thankYouTimer) {
      clearTimeout(thankYouTimer)
      thankYouTimer = null
    }

    broadcastCustomerDisplayState(state)

    if (state.mode === 'thank-you') {
      thankYouTimer = setTimeout(() => {
        thankYouTimer = null
        if (seq !== lastPushSeq) return
        broadcastCustomerDisplayState({ mode: 'idle' })
      }, THANK_YOU_DURATION_MS)
    }
  })

  ipcMain.handle(IPC.CUSTOMER_DISPLAY_GET_SLIDES, async () => getCustomerDisplaySlides(db))

  ipcMain.handle(
    IPC.CUSTOMER_DISPLAY_SAVE_SLIDES,
    async (_e: IpcMainInvokeEvent, slides: Array<{ id?: number; text: string }>) => {
      const saved = await saveCustomerDisplaySlides(db, slides)
      broadcastCustomerDisplaySlides(saved)
      return saved
    }
  )

  ipcMain.handle(IPC.CUSTOMER_DISPLAY_DELETE_SLIDE, async (_e: IpcMainInvokeEvent, id: number) => {
    await deleteCustomerDisplaySlide(db, id)
    const slides = await getCustomerDisplaySlides(db)
    broadcastCustomerDisplaySlides(slides)
  })

  ipcMain.handle(IPC.CUSTOMER_DISPLAY_GET_SETTINGS, async () => getCustomerDisplaySettings(db))

  ipcMain.handle(
    IPC.CUSTOMER_DISPLAY_SAVE_SETTINGS,
    async (
      _e: IpcMainInvokeEvent,
      input: { enabled: boolean; slideDurationSeconds: number; eTransferEmail: string }
    ) => {
      const saved = await saveCustomerDisplaySettings(db, input)
      broadcastCustomerDisplaySettings(saved)
      reconcileCustomerDisplayWindowNow()
      return saved
    }
  )
}
