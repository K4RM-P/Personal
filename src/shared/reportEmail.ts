/**
 * Shared types for scheduled report-digest emails. Imported by both the main
 * process (scheduler/sender) and the renderer (Settings card) — keep
 * framework-agnostic.
 */

export type ReportEmailInterval = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export interface ReportEmailSettingsDTO {
  enabled: boolean
  recipientEmail: string
  interval: ReportEmailInterval
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUsername: string
  smtpFromAddress: string
  /** True when a password is on file, so the UI can show "•••• set" without exposing it. */
  hasSmtpPassword: boolean
  /** ISO timestamp of the last successful send, or null if never sent. */
  lastSentAt: string | null
}

/** What the renderer sends when saving. Omit/blank `smtpPassword` to keep the existing one. */
export interface SaveReportEmailSettingsInput {
  enabled: boolean
  recipientEmail: string
  interval: ReportEmailInterval
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUsername: string
  smtpFromAddress: string
  smtpPassword?: string
}

export interface SendTestReportEmailResult {
  ok: boolean
  message: string
}
