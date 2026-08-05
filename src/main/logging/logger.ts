import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

/**
 * B3 — structured operational logging: sales completed, imports run, backups
 * run/failed, logins, and errors caught, written to a local rotating log file.
 * Separate from crash reporting (B2, out of scope here) — this answers "what
 * actually happened" from a log instead of re-interviewing a stressed cashier.
 *
 * One file per local calendar day, JSON-lines. Files older than
 * RETENTION_DAYS are pruned on each write so the log directory doesn't grow
 * unbounded on a machine nobody maintains.
 */

export type LogEventType =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'SALE_COMPLETED'
  | 'REFUND_ISSUED'
  | 'CATALOG_IMPORT'
  | 'BACKUP_RUN'
  | 'BACKUP_FAILED'
  | 'RESTORE_STAGED'
  | 'ERROR'

const RETENTION_DAYS = 90

let logDir: string | null = null

/** Must be called once at app startup (main/index.ts) before any log() call. */
export function initLogger(dir: string): void {
  logDir = dir
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  pruneOldLogs()
}

function currentLogFile(): string {
  if (!logDir) throw new Error('initLogger() must be called before logging.')
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  return join(logDir, `${y}-${m}-${d}.log`)
}

function pruneOldLogs(): void {
  if (!logDir) return
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    for (const entry of readdirSync(logDir)) {
      if (!entry.endsWith('.log')) continue
      const path = join(logDir, entry)
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
    }
  } catch {
    // best-effort — a failed prune shouldn't block logging
  }
}

export function log(type: LogEventType, details: Record<string, unknown> = {}): void {
  if (!logDir) return // logging is best-effort infrastructure, never a hard dependency for app function
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), type, ...details })
    appendFileSync(currentLogFile(), line + '\n')
  } catch {
    // best-effort — a failed log write must never crash the operation it's describing
  }
}

/** Test-only accessor for the resolved log directory. */
export function getLogDir(): string | null {
  return logDir
}
