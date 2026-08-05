import { app } from 'electron'
import { isAbsolute, join } from 'path'

/** Resolves the live SQLite file path from DATABASE_URL, same rule Prisma itself uses. */
export function resolveDbFilePath(): string {
  const raw = process.env.DATABASE_URL ?? 'file:./dev.db'
  const stripped = raw.replace(/^file:/, '')
  return isAbsolute(stripped) ? stripped : join(app.getAppPath(), 'prisma', stripped)
}
