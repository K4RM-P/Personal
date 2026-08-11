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

export function registerCustomerDisplayHandlers(db: PrismaClient): void {
  ipcMain.on(IPC.CUSTOMER_DISPLAY_PUSH, (_e, state: CustomerDisplayState) => {
    broadcastCustomerDisplayState(state)
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
