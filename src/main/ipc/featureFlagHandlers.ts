import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import { getAllFeatureFlags, upsertFeatureFlag } from '../db/queries/featureFlagQueries'
import { requireManager } from '../auth/session'

export function registerFeatureFlagHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.FEATURE_FLAG_GET_ALL, async () => {
    return await getAllFeatureFlags(db)
  })

  // Only reachable from the Settings screen, which is manager-only nav — enforce server-side too.
  ipcMain.handle(
    IPC.FEATURE_FLAG_UPSERT,
    async (_event, { key, enabled }: { key: string; enabled: boolean }) => {
      requireManager()
      return await upsertFeatureFlag(db, key, enabled)
    }
  )
}
