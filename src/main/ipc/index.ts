import { PrismaClient } from '@prisma/client'
import { registerFeatureFlagHandlers } from './featureFlagHandlers'

export function registerAllHandlers(db: PrismaClient): void {
  registerFeatureFlagHandlers(db)
}
