import type { FeatureFlag, Setting } from '@prisma/client'

export type { FeatureFlag, Setting }

export interface IpcChannelMap {
  'featureFlag:getAll': {
    params: void
    result: FeatureFlag[]
  }
  'featureFlag:upsert': {
    params: { key: string; enabled: boolean }
    result: FeatureFlag
  }
}
