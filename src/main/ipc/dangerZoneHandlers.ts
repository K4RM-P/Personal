import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { requireManager } from '../auth/session'
import { wipeAllData } from '../db/queries/dangerZoneQueries'
import { log } from '../logging/logger'

/**
 * Confirmation code for the "DELETE ALL DATA" danger-zone action. Deliberately
 * hardcoded here rather than stored anywhere visible to the renderer or logs —
 * it is compared server-side only and is never sent to, or requested from, the
 * renderer process.
 */
const DELETE_ALL_DATA_CODE = 'Admindelete1234'

export function registerDangerZoneHandlers(db: PrismaClient): void {
  ipcMain.handle(
    IPC.DANGER_ZONE_DELETE_ALL_DATA,
    async (_e, { code }: { code: string }): Promise<{ ok: boolean; message: string }> => {
      const session = requireManager()
      if (code !== DELETE_ALL_DATA_CODE) {
        return { ok: false, message: 'Incorrect confirmation code.' }
      }

      await wipeAllData(db)
      log('ALL_DATA_DELETED', { initiatedBy: session.fullName })
      return { ok: true, message: 'All data has been deleted.' }
    }
  )
}
