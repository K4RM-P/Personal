import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  CustomerDisplayState,
  CustomerDisplaySettingsDTO,
  CustomerDisplaySlideDTO
} from '../shared/customerDisplay'

/**
 * Minimal preload for the customer-facing window. Deliberately exposes no auth,
 * no business APIs and no writes — the second screen is strictly an output
 * surface (spec §1.2/§11), so the only capabilities here are three subscriptions
 * plus read-only fetches of the slides/settings it renders.
 */
const customerDisplayApi = {
  onUpdate: (cb: (state: CustomerDisplayState) => void): (() => void) => {
    const listener = (_e: unknown, state: CustomerDisplayState): void => cb(state)
    ipcRenderer.on(IPC.CUSTOMER_DISPLAY_UPDATE, listener)
    return () => ipcRenderer.removeListener(IPC.CUSTOMER_DISPLAY_UPDATE, listener)
  },
  onSlides: (cb: (slides: CustomerDisplaySlideDTO[]) => void): (() => void) => {
    const listener = (_e: unknown, slides: CustomerDisplaySlideDTO[]): void => cb(slides)
    ipcRenderer.on(IPC.CUSTOMER_DISPLAY_SLIDES, listener)
    return () => ipcRenderer.removeListener(IPC.CUSTOMER_DISPLAY_SLIDES, listener)
  },
  onSettings: (cb: (settings: CustomerDisplaySettingsDTO) => void): (() => void) => {
    const listener = (_e: unknown, settings: CustomerDisplaySettingsDTO): void => cb(settings)
    ipcRenderer.on(IPC.CUSTOMER_DISPLAY_SETTINGS, listener)
    return () => ipcRenderer.removeListener(IPC.CUSTOMER_DISPLAY_SETTINGS, listener)
  },
  getSlides: (): Promise<CustomerDisplaySlideDTO[]> =>
    ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_GET_SLIDES),
  getSettings: (): Promise<CustomerDisplaySettingsDTO> =>
    ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_GET_SETTINGS)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('customerDisplayApi', customerDisplayApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (see customer-display.d.ts)
  window.customerDisplayApi = customerDisplayApi
}

export type CustomerDisplayApi = typeof customerDisplayApi
