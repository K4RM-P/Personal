import type { ReportEmailInterval } from '../../shared/reportEmail'
import { localDateString } from '../db/queries/reportQueries'

/**
 * The reporting period a given interval covers, ending "yesterday" so a full
 * day/week/month is always complete — used by both the report-email digest and
 * the report CSV auto-export, so "DAILY"/"WEEKLY"/"MONTHLY" mean the same date
 * range everywhere in the app rather than two independent interpretations.
 */
export function resolvePeriod(
  interval: ReportEmailInterval,
  now: Date
): { fromDate: string; toDate: string; label: string } {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const toDate = localDateString(yesterday)

  if (interval === 'DAILY') {
    return { fromDate: toDate, toDate, label: `Daily — ${toDate}` }
  }
  if (interval === 'WEEKLY') {
    const from = new Date(yesterday)
    from.setDate(from.getDate() - 6)
    return {
      fromDate: localDateString(from),
      toDate,
      label: `Weekly — ${localDateString(from)} to ${toDate}`
    }
  }
  // MONTHLY — the full previous calendar month.
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1)
  return {
    fromDate: localDateString(monthStart),
    toDate: localDateString(monthEnd),
    label: `Monthly — ${localDateString(monthStart)} to ${localDateString(monthEnd)}`
  }
}
