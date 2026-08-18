import { dialog, ipcMain, IpcMainInvokeEvent } from 'electron'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'
import { extname } from 'path'
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
import { requireManager } from '../auth/session'
import { storeSlideVideo } from '../customerDisplay/slideMediaStore'

/** Spec §5.2: Thank You is shown for a short fixed duration, then falls back to Idle. */
const THANK_YOU_DURATION_MS = 5000

const MAX_SLIDE_IMAGE_BYTES = 2 * 1024 * 1024
const SLIDE_IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

const MAX_SLIDE_VIDEO_BYTES = 100 * 1024 * 1024
const SLIDE_VIDEO_EXTS = ['mp4', 'webm', 'mov']

/** Wraps a handler so a thrown error surfaces as a clean message, not an unhandled rejection. */
function guard<A extends unknown[], R>(
  label: string,
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${label}: ${message}`)
    }
  }
}

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
    async (
      _e: IpcMainInvokeEvent,
      slides: Array<{
        id?: number
        type?: 'TEXT' | 'IMAGE' | 'VIDEO'
        text: string
        imageDataUrl?: string | null
        videoFilePath?: string | null
        durationSeconds?: number | null
      }>
    ) => {
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

  ipcMain.handle(
    IPC.CUSTOMER_DISPLAY_UPLOAD_SLIDE_IMAGE,
    guard('Upload slide image', async () => {
      requireManager()
      const result = await dialog.showOpenDialog({
        title: 'Select slide image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const filePath = result.filePaths[0]
      const ext = extname(filePath).slice(1).toLowerCase()
      const mime = SLIDE_IMAGE_MIME_BY_EXT[ext]
      if (!mime) throw new Error('Unsupported image format. Use PNG, JPG, GIF, or WebP.')

      const buffer = await readFile(filePath)
      if (buffer.length > MAX_SLIDE_IMAGE_BYTES) {
        throw new Error('Slide image must be smaller than 2MB.')
      }

      const imageDataUrl = `data:${mime};base64,${buffer.toString('base64')}`
      return { imageDataUrl }
    })
  )

  ipcMain.handle(
    IPC.CUSTOMER_DISPLAY_UPLOAD_SLIDE_VIDEO,
    guard('Upload slide video', async () => {
      requireManager()
      const result = await dialog.showOpenDialog({
        title: 'Select slide video',
        properties: ['openFile'],
        filters: [{ name: 'Videos', extensions: SLIDE_VIDEO_EXTS }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const filePath = result.filePaths[0]
      const ext = extname(filePath).slice(1).toLowerCase()
      if (!SLIDE_VIDEO_EXTS.includes(ext)) {
        throw new Error('Unsupported video format. Use MP4, WebM, or MOV.')
      }

      const buffer = await readFile(filePath)
      if (buffer.length > MAX_SLIDE_VIDEO_BYTES) {
        throw new Error('Slide video must be smaller than 100MB.')
      }

      const videoFilePath = await storeSlideVideo(buffer, `.${ext}`)
      return { videoFilePath }
    })
  )

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
