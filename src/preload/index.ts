import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type { FeatureFlag } from '../shared/types'

const api = {
  featureFlag: {
    getAll: (): Promise<FeatureFlag[]> => ipcRenderer.invoke(IPC.FEATURE_FLAG_GET_ALL),
    upsert: (key: string, enabled: boolean): Promise<FeatureFlag> =>
      ipcRenderer.invoke(IPC.FEATURE_FLAG_UPSERT, { key, enabled })
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (see index.d.ts)
  window.api = api
}

export type PosApi = typeof api
