import { PrismaClient } from '@prisma/client'
import { getReportCsvExportSettings } from '../db/queries/settingsQueries'
import { runReportCsvExportNow } from './reportCsvExporter'
import { log } from '../logging/logger'

/**
 * Polls every 15 minutes and exports once the configured interval has elapsed
 * since the last export. Polling (rather than a single long setTimeout) is
 * deliberate — mirrors reportEmailScheduler.ts: the app isn't running 24/7, so
 * elapsed-time-since-lastExportedAt is the only check that survives being
 * closed overnight or over a weekend.
 */
const POLL_INTERVAL_MS = 15 * 60 * 1000

const INTERVAL_MS: Record<string, number> = {
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
  MONTHLY: 30 * 24 * 60 * 60 * 1000
}

let initialized = false

async function checkAndExport(db: PrismaClient): Promise<void> {
  try {
    const settings = await getReportCsvExportSettings(db)
    if (!settings.enabled) return

    const dueMs = INTERVAL_MS[settings.interval] ?? INTERVAL_MS.DAILY
    const lastExportedMs = settings.lastExportedAt ? new Date(settings.lastExportedAt).getTime() : null
    const due = lastExportedMs === null || Date.now() - lastExportedMs >= dueMs
    if (!due) return

    const result = await runReportCsvExportNow(db)
    if (!result.ok) {
      log('ERROR', { message: result.message, source: 'reportCsvExportScheduler' })
    }
  } catch (err) {
    log('ERROR', {
      message: err instanceof Error ? err.message : String(err),
      source: 'reportCsvExportScheduler'
    })
  }
}

/** Called once from app.whenReady(), mirroring initReportEmailScheduler's lifecycle. */
export function initReportCsvExportScheduler(db: PrismaClient): void {
  if (initialized) return
  initialized = true

  void checkAndExport(db)
  setInterval(() => void checkAndExport(db), POLL_INTERVAL_MS)
}
