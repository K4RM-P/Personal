import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export function getDb(): PrismaClient {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient()
  }
  return global.__prisma
}

export async function closeDb(): Promise<void> {
  if (global.__prisma) {
    await global.__prisma.$disconnect()
    global.__prisma = undefined
  }
}
