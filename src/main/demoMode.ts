import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

interface AppState {
  demoMode: boolean
}

function stateFilePath(): string {
  return join(app.getPath('userData'), 'app-state.json')
}

/**
 * Whether demo mode is active. Stored outside both SQLite files (they get
 * swapped by this very flag) so it survives quit/relaunch and app updates.
 */
export function isDemoModeEnabled(): boolean {
  try {
    const raw = readFileSync(stateFilePath(), 'utf-8')
    return (JSON.parse(raw) as AppState).demoMode === true
  } catch {
    return false
  }
}

export function setDemoModeEnabled(enabled: boolean): void {
  writeFileSync(stateFilePath(), JSON.stringify({ demoMode: enabled }), 'utf-8')
}

/**
 * Resolves which SQLite file to connect to, honoring demo mode in both dev and
 * packaged builds.
 *
 * `app.relaunch()` (used both here and for staged backup restores) spawns a bare
 * `electron` process outside electron-vite's dev orchestration, so `.env` never gets
 * reinjected into `process.env` on the relaunched process — see the loadRenderer()
 * comment in main/index.ts for the same gotcha. That means `process.env.DATABASE_URL`
 * can legitimately be unset here even in dev, right after a relaunch. Falling back to
 * the packaged-style userData path in that case would silently connect to a brand-new,
 * unmigrated database instead of the real `prisma/dev.db` — so the dev fallback below
 * must match what `.env` normally provides, not the production path.
 */
export function resolveDatabaseUrl(): string {
  if (isDemoModeEnabled()) {
    const demoDbPath = is.dev
      ? join(app.getAppPath(), 'prisma', 'dev-demo.db')
      : join(app.getPath('userData'), 'pharmapos-demo.db')
    return `file:${demoDbPath}`
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (is.dev) return `file:${join(app.getAppPath(), 'prisma', 'dev.db')}`
  return `file:${join(app.getPath('userData'), 'pharmapos.db')}`
}

/** True the first time demo mode is activated — the demo DB file doesn't exist yet. */
export function isDemoDatabaseUninitialized(): boolean {
  const url = resolveDatabaseUrl()
  const path = url.replace(/^file:/, '')
  return !existsSync(path)
}
