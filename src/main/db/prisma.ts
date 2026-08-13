import { PrismaClient } from '@prisma/client'
import { resolveDbFilePath } from '../backup/dbPath'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export function getDb(): PrismaClient {
  if (!global.__prisma) {
    // Prisma's CLI (migrate/generate) resolves a relative `file:./dev.db` DATABASE_URL
    // relative to schema.prisma's directory, but the generated Client resolves the same
    // relative URL relative to process.cwd() at runtime — these can silently diverge
    // (they did: migrations applied via the CLI landed in prisma/dev.db, while the
    // running app's Client connected to a different, stale file at the same relative
    // path, resolved from whatever cwd Electron happened to launch with). Passing an
    // explicit absolute datasource URL — the same resolution `resolveDbFilePath()`
    // already uses for the backup/restore system — removes the ambiguity entirely.
    global.__prisma = new PrismaClient({
      datasources: { db: { url: `file:${resolveDbFilePath()}` } }
    })
  }
  return global.__prisma
}

export async function closeDb(): Promise<void> {
  if (global.__prisma) {
    await global.__prisma.$disconnect()
    global.__prisma = undefined
  }
}
