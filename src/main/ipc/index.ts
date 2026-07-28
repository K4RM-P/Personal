import { PrismaClient } from '@prisma/client'
import { registerFeatureFlagHandlers } from './featureFlagHandlers'
import { registerPosHandlers } from './posHandlers'

export function registerAllHandlers(db: PrismaClient): void {
  registerFeatureFlagHandlers(db)
  registerPosHandlers(db)
}
