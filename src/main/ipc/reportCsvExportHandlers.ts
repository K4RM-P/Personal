import { dialog, ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { SaveReportCsvExportSettingsInput } from '../../shared/reportCsvExport'
import {
  getReportCsvExportSettings,
  saveReportCsvExportSettings
} from '../db/queries/settingsQueries'
import { requireManager } from '../auth/session'
import { runReportCsvExportNow } from '../reports/reportCsvExporter'

export function registerReportCsvExportHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.REPORT_CSV_EXPORT_GET_SETTINGS, () => getReportCsvExportSettings(db))

  ipcMain.handle(
    IPC.REPORT_CSV_EXPORT_SAVE_SETTINGS,
    async (_e, input: SaveReportCsvExportSettingsInput) => {
      requireManager()
      return saveReportCsvExportSettings(db, input)
    }
  )

  ipcMain.handle(IPC.REPORT_CSV_EXPORT_PICK_FOLDER, async () => {
    requireManager()
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder for scheduled sales report exports',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.REPORT_CSV_EXPORT_RUN_NOW, async () => {
    requireManager()
    return runReportCsvExportNow(db)
  })
}
