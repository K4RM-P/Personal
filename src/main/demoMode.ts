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

/** Resolves which SQLite file to connect to, honoring demo mode in both dev and packaged builds. */
export function resolveDatabaseUrl(): string {
  const demoDbPath = is.dev
    ? join(app.getAppPath(), 'prisma', 'dev-demo.db')
    : join(app.getPath('userData'), 'pharmapos-demo.db')
  const liveDbPath = join(app.getPath('userData'), 'pharmapos.db')

  if (isDemoModeEnabled()) return `file:${demoDbPath}`
  return `file:${liveDbPath}`
}

/** True the first time demo mode is activated — the demo DB file doesn't exist yet. */
export function isDemoDatabaseUninitialized(): boolean {
  const url = resolveDatabaseUrl()
  const path = url.replace(/^file:/, '')
  return !existsSync(path)
}
