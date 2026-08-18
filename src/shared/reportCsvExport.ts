import type { ReportEmailInterval } from './reportEmail'

/**
 * Scheduled CSV auto-export of the Complete Products Sales Report to a folder on
 * disk. Reuses `ReportEmailInterval` (DAILY/WEEKLY/MONTHLY) so both scheduled
 * features mean the same date range for the same interval name.
 */
export interface ReportCsvExportSettingsDTO {
  enabled: boolean
  folderPath: string
  interval: ReportEmailInterval
  /** ISO timestamp of the last successful export, or null if never run. */
  lastExportedAt: string | null
}

export interface SaveReportCsvExportSettingsInput {
  enabled: boolean
  folderPath: string
  interval: ReportEmailInterval
}

export interface RunReportCsvExportResult {
  ok: boolean
  message: string
  filePath?: string
}
