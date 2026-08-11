import { dialog, ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { CatalogImportProgress } from '../../shared/catalogTypes'
import {
  autoImportCatalog,
  commitImport,
  discardImport,
  ensureSearchIndex,
  rollbackImport,
  startImport
} from '../catalog/importService'
import {
  getCatalogDeals,
  getCatalogStatus,
  promoteAllCatalogProducts,
  promoteCatalogProduct,
  scanLookup,
  searchCatalog
} from '../catalog/catalogQueries'
import { getCatalogProvince, setCatalogProvince } from '../db/queries/settingsQueries'
import { log } from '../logging/logger'
import { requireManager } from '../auth/session'

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

export function registerCatalogHandlers(db: PrismaClient): void {
  // FTS5 is a virtual table Prisma can't model, so make sure it exists on boot.
  void ensureSearchIndex(db).catch(() => undefined)

  ipcMain.handle(
    IPC.CATALOG_PICK_FILE,
    guard('Pick catalogue file', async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select McKesson WEBCAT file',
        properties: ['openFile'],
        filters: [{ name: 'Catalogue file', extensions: ['txt', 'dat', 'webcat', 'WEBCAT', '*'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
  )

  ipcMain.handle(
    IPC.CATALOG_START_IMPORT,
    guard('Catalogue import', async (event: Electron.IpcMainInvokeEvent, filePath: string) => {
      requireManager()
      const sender = event.sender
      const onProgress = (progress: CatalogImportProgress): void => {
        if (!sender.isDestroyed()) sender.send(IPC.CATALOG_IMPORT_PROGRESS, progress)
      }
      return startImport(db, filePath, onProgress)
    })
  )

  ipcMain.handle(
    IPC.CATALOG_COMMIT_IMPORT,
    guard(
      'Catalogue commit',
      async (
        _e: Electron.IpcMainInvokeEvent,
        payload: { batchId: number; confirmations?: string[] }
      ) => {
        requireManager()
        const result = await commitImport(db, payload.batchId, {
          confirmations: payload.confirmations
        })
        log('CATALOG_IMPORT', { batchId: payload.batchId })
        return result
      }
    )
  )

  ipcMain.handle(
    IPC.CATALOG_DISCARD_IMPORT,
    guard('Catalogue discard', async (_e: Electron.IpcMainInvokeEvent, batchId: number) => {
      requireManager()
      await discardImport(db, batchId)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC.CATALOG_ROLLBACK,
    guard('Catalogue rollback', async () => {
      requireManager()
      return rollbackImport(db)
    })
  )

  ipcMain.handle(
    IPC.CATALOG_GET_STATUS,
    guard('Catalogue status', async () => getCatalogStatus(db))
  )

  ipcMain.handle(
    IPC.CATALOG_SEARCH,
    guard(
      'Catalogue search',
      async (
        _e: Electron.IpcMainInvokeEvent,
        payload: { query: string; province?: string | null; limit?: number }
      ) => searchCatalog(db, payload)
    )
  )

  ipcMain.handle(
    IPC.CATALOG_SCAN_LOOKUP,
    guard('Catalogue scan', async (_e: Electron.IpcMainInvokeEvent, barcode: string) =>
      scanLookup(db, barcode)
    )
  )

  ipcMain.handle(
    IPC.CATALOG_GET_DEALS,
    guard('Catalogue deals', async (_e: Electron.IpcMainInvokeEvent, catalogProductId: number) =>
      getCatalogDeals(db, catalogProductId)
    )
  )

  ipcMain.handle(
    IPC.CATALOG_PROMOTE,
    guard(
      'Promote catalogue item',
      async (
        _e: Electron.IpcMainInvokeEvent,
        payload: { catalogProductId: number; priceCentsOverride?: number }
      ) => {
        requireManager()
        return promoteCatalogProduct(db, payload.catalogProductId, payload.priceCentsOverride)
      }
    )
  )

  ipcMain.handle(
    IPC.CATALOG_PROMOTE_ALL,
    guard('Promote all catalogue items', async () => {
      requireManager()
      return promoteAllCatalogProducts(db)
    })
  )

  ipcMain.handle(
    IPC.CATALOG_AUTO_IMPORT,
    guard('Auto import catalogue', async (event: Electron.IpcMainInvokeEvent, filePath: string) => {
      requireManager()
      const sender = event.sender
      const onProgress = (progress: CatalogImportProgress): void => {
        if (!sender.isDestroyed()) sender.send(IPC.CATALOG_IMPORT_PROGRESS, progress)
      }
      return autoImportCatalog(db, filePath, onProgress)
    })
  )

  ipcMain.handle(
    IPC.CATALOG_GET_PROVINCE,
    guard('Get catalogue province', async () => getCatalogProvince(db))
  )

  ipcMain.handle(
    IPC.CATALOG_SET_PROVINCE,
    guard('Set catalogue province', async (_e: Electron.IpcMainInvokeEvent, province: string) => {
      requireManager()
      return setCatalogProvince(db, province)
    })
  )
}
