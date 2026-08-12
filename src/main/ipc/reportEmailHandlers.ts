import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { SaveReportEmailSettingsInput } from '../../shared/reportEmail'
import { getReportEmailSettings, saveReportEmailSettings } from '../db/queries/settingsQueries'
import { requireManager } from '../auth/session'
import { sendReportDigestNow } from '../reports/reportEmailSender'

export function registerReportEmailHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.REPORT_EMAIL_GET_SETTINGS, () => getReportEmailSettings(db))

  ipcMain.handle(
    IPC.REPORT_EMAIL_SAVE_SETTINGS,
    async (_e, input: SaveReportEmailSettingsInput) => {
      requireManager()
      return saveReportEmailSettings(db, input)
    }
  )

  ipcMain.handle(IPC.REPORT_EMAIL_SEND_TEST, async () => {
    requireManager()
    return sendReportDigestNow(db)
  })
}
