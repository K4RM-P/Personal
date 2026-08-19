import type { PrismaClient } from '@prisma/client'
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { resolveDbFilePath } from '../backup/dbPath'
import { log } from '../logging/logger'

function migrationsDir(): string {
  return join(app.getAppPath(), 'prisma', 'migrations')
}

/**
 * Snapshots the live DB file once, right before the first not-yet-applied migration of
 * this run is executed. If an update ships a destructive migration, this file is the only
 * way to recover the pre-update data/settings — the runner itself has no down-migrations.
 */
function backupDbBeforeMigrating(): void {
  const dbPath = resolveDbFilePath()
  if (!existsSync(dbPath)) return
  const backupPath = `${dbPath}.pre-migrate.bak`
  try {
    copyFileSync(dbPath, backupPath)
  } catch (err) {
    // Non-fatal: don't block startup on a failed backup, but surface it for diagnosis.
    log('ERROR', {
      message: err instanceof Error ? err.message : String(err),
      source: 'backupDbBeforeMigrating'
    })
  }
}

function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Applies any prisma/migrations/* not yet recorded, in filename (timestamp) order.
 * Stands in for `prisma migrate deploy` in production: that command needs Prisma's
 * native schema-engine binary, which would add tens of MB per platform to the
 * installer just to run CREATE TABLE statements once on first launch.
 */
export async function runPendingMigrations(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  )
  const appliedRows = await db.$queryRawUnsafe<{ name: string }[]>('SELECT name FROM _app_migrations')
  const applied = new Set(appliedRows.map((r) => r.name))

  const dir = migrationsDir()
  if (!existsSync(dir)) return

  const migrationNames = readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'migration.sql')))
    .sort()

  let backedUp = false
  for (const name of migrationNames) {
    if (applied.has(name)) continue
    if (!backedUp) {
      backupDbBeforeMigrating()
      backedUp = true
    }
    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf-8')
    for (const statement of splitStatements(sql)) {
      await db.$executeRawUnsafe(statement)
    }
    await db.$executeRawUnsafe('INSERT INTO _app_migrations (name) VALUES (?)', name)
  }
}
