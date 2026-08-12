import { PrismaClient } from '@prisma/client'
import { getReportEmailSettings } from '../db/queries/settingsQueries'
import { sendReportDigestNow } from './reportEmailSender'
import { log } from '../logging/logger'

/**
 * Polls every 15 minutes and sends the digest once the configured interval has
 * elapsed since the last send. Polling (rather than a single long setTimeout) is
 * deliberate: the app isn't running 24/7, so elapsed-time-since-lastSentAt is the
 * only check that survives being closed overnight or over a weekend.
 */
const POLL_INTERVAL_MS = 15 * 60 * 1000

const INTERVAL_MS: Record<string, number> = {
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
  MONTHLY: 30 * 24 * 60 * 60 * 1000
}

let initialized = false

async function checkAndSend(db: PrismaClient): Promise<void> {
  try {
    const settings = await getReportEmailSettings(db)
    if (!settings.enabled) return

    const dueMs = INTERVAL_MS[settings.interval] ?? INTERVAL_MS.DAILY
    const lastSentMs = settings.lastSentAt ? new Date(settings.lastSentAt).getTime() : null
    const due = lastSentMs === null || Date.now() - lastSentMs >= dueMs
    if (!due) return

    const result = await sendReportDigestNow(db)
    if (!result.ok) {
      log('ERROR', { message: result.message, source: 'reportEmailScheduler' })
    }
  } catch (err) {
    log('ERROR', {
      message: err instanceof Error ? err.message : String(err),
      source: 'reportEmailScheduler'
    })
  }
}

/** Called once from app.whenReady(), mirroring initAutoUpdater's fire-and-forget lifecycle. */
export function initReportEmailScheduler(db: PrismaClient): void {
  if (initialized) return
  initialized = true

  void checkAndSend(db)
  setInterval(() => void checkAndSend(db), POLL_INTERVAL_MS)
}
