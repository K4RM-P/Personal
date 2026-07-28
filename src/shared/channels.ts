export const IPC = {
  FEATURE_FLAG_GET_ALL: 'featureFlag:getAll',
  FEATURE_FLAG_UPSERT: 'featureFlag:upsert'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
