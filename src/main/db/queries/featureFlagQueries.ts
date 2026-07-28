import { PrismaClient, FeatureFlag } from '@prisma/client'

export async function getAllFeatureFlags(db: PrismaClient): Promise<FeatureFlag[]> {
  return db.featureFlag.findMany({
    orderBy: { key: 'asc' }
  })
}

export async function upsertFeatureFlag(
  db: PrismaClient,
  key: string,
  enabled: boolean
): Promise<FeatureFlag> {
  return db.featureFlag.update({
    where: { key },
    data: { enabled }
  })
}
