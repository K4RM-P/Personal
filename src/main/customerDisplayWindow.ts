import { BrowserWindow, screen, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { PrismaClient } from '@prisma/client'
import { log } from './logging/logger'
import { getCustomerDisplaySettings } from './db/queries/customerDisplayQueries'
import { IPC } from '../shared/channels'
import type {
  CustomerDisplayState,
  CustomerDisplaySettingsDTO,
  CustomerDisplaySlideDTO
} from '../shared/customerDisplay'

/**
 * Customer-facing display (second screen) window lifecycle.
 *
 * Non-negotiable (spec §11): this is an enhancement, never critical path — every
 * operation here is wrapped so a failure logs and returns rather than propagating
 * into the main window's startup/runtime path.
 */

let customerWindow: BrowserWindow | null = null
let pollTimer: NodeJS.Timeout | null = null
let dbRef: PrismaClient | null = null
let reconciling = false

/**
 * Dev-only escape hatch for machines without a second physical monitor: set
 * POS_CUSTOMER_DISPLAY_FORCE=1 to open the customer display on the primary
 * display (windowed, non-kiosk) so the renderer and IPC path can be exercised.
 */
function isForcedDevWindow(): boolean {
  return is.dev && process.env['POS_CUSTOMER_DISPLAY_FORCE'] === '1'
}

function safelyCall(label: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    log('ERROR', {
      source: 'customerDisplay',
      message: `${label} failed: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

function pickSecondaryDisplay(): Electron.Display | null {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  if (displays.length < 2) {
    return isForcedDevWindow() ? primary : null
  }
  return displays.find((d) => d.id !== primary.id) ?? null
}

async function loadCustomerRenderer(win: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    await win.loadURL(`${devUrl}/customer-display.html`)
    return
  }
  const builtFile = join(__dirname, '../renderer/customer-display.html')
  if (existsSync(builtFile)) {
    await win.loadFile(builtFile)
  }
}

async function createCustomerWindow(): Promise<void> {
  if (customerWindow && !customerWindow.isDestroyed()) return
  const display = pickSecondaryDisplay()
  if (!display) return
  if (!dbRef) return
  const settings = await getCustomerDisplaySettings(dbRef)
  if (!settings.enabled) return

  const forced = isForcedDevWindow() && screen.getAllDisplays().length < 2
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: forced ? 900 : display.bounds.width,
    height: forced ? 600 : display.bounds.height,
    fullscreen: !forced,
    frame: forced,
    kiosk: !forced,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/customer-display.js'),
      sandbox: false,
      devTools: is.dev
    }
  })
  win.setMenuBarVisibility(false)
  win.on('closed', () => {
    if (customerWindow === win) customerWindow = null
  })
  customerWindow = win
  await loadCustomerRenderer(win)
}

function destroyCustomerWindow(): void {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.destroy()
  }
  customerWindow = null
}

async function reconcileWindow(): Promise<void> {
  if (!dbRef || reconciling) return
  reconciling = true
  try {
    const settings = await getCustomerDisplaySettings(dbRef)
    const display = pickSecondaryDisplay()
    const shouldExist = settings.enabled && display !== null
    const exists = customerWindow !== null && !customerWindow.isDestroyed()
    if (shouldExist && !exists) {
      await createCustomerWindow()
    } else if (!shouldExist && exists) {
      destroyCustomerWindow()
    }
  } catch (err) {
    log('ERROR', {
      source: 'customerDisplay',
      message: `reconcile failed: ${err instanceof Error ? err.message : String(err)}`
    })
  } finally {
    reconciling = false
  }
}

export function initCustomerDisplayWindow(db: PrismaClient): void {
  dbRef = db
  safelyCall('initial reconcile', () => {
    void reconcileWindow()
  })
  screen.on('display-added', () =>
    safelyCall('display-added handler', () => void reconcileWindow())
  )
  screen.on('display-removed', () =>
    safelyCall('display-removed handler', () => void reconcileWindow())
  )
  // Polling fallback per spec §8.2: covers a monitor powered on after the PC boots,
  // where the OS may not emit a display-added event the app sees.
  pollTimer = setInterval(() => {
    safelyCall('poll reconcile', () => void reconcileWindow())
  }, 30_000)
  app.on('before-quit', () => {
    safelyCall('before-quit teardown', () => teardownCustomerDisplayWindow())
  })
}

export function teardownCustomerDisplayWindow(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  destroyCustomerWindow()
}

/** Called by Settings when the enabled toggle changes, to apply immediately. */
export function reconcileCustomerDisplayWindowNow(): void {
  safelyCall('manual reconcile', () => void reconcileWindow())
}

function send(channel: string, payload: unknown): void {
  safelyCall(`send ${channel}`, () => {
    if (customerWindow && !customerWindow.isDestroyed()) {
      customerWindow.webContents.send(channel, payload)
    }
  })
}

export function broadcastCustomerDisplayState(state: CustomerDisplayState): void {
  send(IPC.CUSTOMER_DISPLAY_UPDATE, state)
}

export function broadcastCustomerDisplaySlides(slides: CustomerDisplaySlideDTO[]): void {
  send(IPC.CUSTOMER_DISPLAY_SLIDES, slides)
}

export function broadcastCustomerDisplaySettings(settings: CustomerDisplaySettingsDTO): void {
  send(IPC.CUSTOMER_DISPLAY_SETTINGS, settings)
}
