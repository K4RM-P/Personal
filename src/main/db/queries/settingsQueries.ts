import { PrismaClient } from '@prisma/client'
import type { PrinterConfig, StoreInfo } from '../../../shared/types'
import type { ReportEmailInterval, ReportEmailSettingsDTO } from '../../../shared/reportEmail'
import { encryptSecret, decryptSecret } from '../../payment/credentialStore'

const DEFAULTS = {
  'store.name': 'VantisPOS Rx Pharmacy',
  'store.address': '123 Health Ave, Suite 100, Cityville',
  'store.phone': '(555) 019-2831',
  'store.licenseNumber': '',
  'store.email': '',
  'store.logoDataUrl': '',
  'store.useCustomReceiptTemplate': 'false',
  'store.customReceiptTemplateHtml': '',
  'printer.type': 'PDF',
  'printer.networkIp': '',
  'printer.networkPort': '9100',
  'printer.deviceName': '',
  // Payment (Stage 5): default to Manual/External terminal until setup is run.
  'payment.provider': 'manual',
  'payment.environment': 'sandbox',
  'payment.terminalId': '',
  'payment.apiKeyEnc': '',
  // Catalogue (McKesson WEBCAT import)
  'catalog.province': 'ONT',
  'catalog.staleThresholdDays': '90',
  'customer.loyaltyPointsPerDollar': '1',
  // Payment configuration
  'payment.allowCreditCardSurcharge': 'false',
  'payment.cardSurchargePercent': '2',
  'backup.promptOnLogout': 'true',
  'backup.drivePath': '',
  'backup.driveName': '',
  // A15 — idle auto-logout. A checkout terminal left signed in as a manager,
  // unattended, can process refunds or adjust customer balances.
  'session.idleTimeoutMinutes': '20',
  // Display density — device-level, not per-user (see docs/superpowers UI guide).
  // Stores the density level number (1-8); the level -> scale multiplier mapping
  // lives in the renderer (src/renderer/src/lib/density.ts).
  'display.densityLevel': '4',
  // Customer-facing display (second screen) — see docs/superpowers/specs/
  // 2026-08-11-customer-facing-display-spec.md §6/§8.4.
  'customerDisplay.enabled': 'true',
  'customerDisplay.slideDurationSeconds': '8',
  'customerDisplay.eTransferEmail': '',
  // Scheduled report-digest emails — see reportEmailScheduler.ts.
  'reportEmail.enabled': 'false',
  'reportEmail.recipientEmail': '',
  'reportEmail.interval': 'DAILY',
  'reportEmail.smtpHost': '',
  'reportEmail.smtpPort': '587',
  'reportEmail.smtpSecure': 'false',
  'reportEmail.smtpUsername': '',
  'reportEmail.smtpPasswordEnc': '',
  'reportEmail.smtpFromAddress': '',
  'reportEmail.lastSentAt': ''
} as const

async function getSetting(db: PrismaClient, key: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? DEFAULTS[key as keyof typeof DEFAULTS] ?? ''
}

async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  })
}

export async function getStoreInfo(db: PrismaClient): Promise<StoreInfo> {
  const [name, address, phone, licenseNumber, email, logoDataUrl, useCustom, customHtml] =
    await Promise.all([
      getSetting(db, 'store.name'),
      getSetting(db, 'store.address'),
      getSetting(db, 'store.phone'),
      getSetting(db, 'store.licenseNumber'),
      getSetting(db, 'store.email'),
      getSetting(db, 'store.logoDataUrl'),
      getSetting(db, 'store.useCustomReceiptTemplate'),
      getSetting(db, 'store.customReceiptTemplateHtml')
    ])
  return {
    name,
    address,
    phone,
    licenseNumber: licenseNumber || undefined,
    email: email || undefined,
    logoDataUrl: logoDataUrl || undefined,
    useCustomReceiptTemplate: useCustom === 'true',
    customReceiptTemplateHtml: customHtml || undefined
  }
}

export async function saveStoreInfo(db: PrismaClient, info: StoreInfo): Promise<StoreInfo> {
  await setSetting(db, 'store.name', info.name)
  await setSetting(db, 'store.address', info.address)
  await setSetting(db, 'store.phone', info.phone)
  await setSetting(db, 'store.licenseNumber', info.licenseNumber ?? '')
  await setSetting(db, 'store.email', info.email ?? '')
  return getStoreInfo(db)
}

/** Persisted independently of the text fields above so an in-progress, unsaved edit to
 * name/address/etc. isn't clobbered when a logo/template upload round-trips through the DB. */
export async function saveStoreLogo(db: PrismaClient, logoDataUrl: string): Promise<void> {
  await setSetting(db, 'store.logoDataUrl', logoDataUrl)
}

export async function clearStoreLogo(db: PrismaClient): Promise<void> {
  await setSetting(db, 'store.logoDataUrl', '')
}

export async function saveCustomReceiptTemplate(db: PrismaClient, html: string): Promise<void> {
  await setSetting(db, 'store.customReceiptTemplateHtml', html)
  await setSetting(db, 'store.useCustomReceiptTemplate', 'true')
}

export async function clearCustomReceiptTemplate(db: PrismaClient): Promise<void> {
  await setSetting(db, 'store.customReceiptTemplateHtml', '')
  await setSetting(db, 'store.useCustomReceiptTemplate', 'false')
}

export async function setUseCustomReceiptTemplate(
  db: PrismaClient,
  enabled: boolean
): Promise<void> {
  await setSetting(db, 'store.useCustomReceiptTemplate', String(enabled))
}

export async function getPrinterConfig(db: PrismaClient): Promise<PrinterConfig> {
  const type = (await getSetting(db, 'printer.type')) as PrinterConfig['type']
  const ipAddress = await getSetting(db, 'printer.networkIp')
  const portStr = await getSetting(db, 'printer.networkPort')
  const port = parseInt(portStr, 10) || 9100
  const deviceName = await getSetting(db, 'printer.deviceName')

  return {
    type: type === 'NETWORK' || type === 'SYSTEM' ? type : 'PDF',
    ipAddress: ipAddress || undefined,
    port,
    deviceName: deviceName || undefined
  }
}

export async function savePrinterConfig(
  db: PrismaClient,
  config: PrinterConfig
): Promise<PrinterConfig> {
  await setSetting(db, 'printer.type', config.type)
  await setSetting(db, 'printer.networkIp', config.ipAddress ?? '')
  await setSetting(db, 'printer.networkPort', String(config.port ?? 9100))
  await setSetting(db, 'printer.deviceName', config.deviceName ?? '')
  return getPrinterConfig(db)
}

/** Province the catalogue browser filters to by default. */
export async function getCatalogProvince(db: PrismaClient): Promise<string> {
  return (await getSetting(db, 'catalog.province')) || 'ONT'
}

export async function getCatalogStaleThresholdDays(db: PrismaClient): Promise<number> {
  const raw = await getSetting(db, 'catalog.staleThresholdDays')
  return parseInt(raw, 10) || 90
}

export async function setCatalogProvince(db: PrismaClient, province: string): Promise<string> {
  await setSetting(db, 'catalog.province', province)
  return getCatalogProvince(db)
}

export async function seedDefaultSettings(db: PrismaClient): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value }
    })
  }
}

export async function getAllowCreditCardSurcharge(db: PrismaClient): Promise<boolean> {
  return (await getSetting(db, 'payment.allowCreditCardSurcharge')) === 'true'
}

export async function getCardSurchargePercent(db: PrismaClient): Promise<number> {
  const raw = await getSetting(db, 'payment.cardSurchargePercent')
  return parseInt(raw, 10) || 2
}

export async function saveAllowCreditCardSurcharge(
  db: PrismaClient,
  enabled: boolean
): Promise<void> {
  await setSetting(db, 'payment.allowCreditCardSurcharge', String(enabled))
}

export async function saveCardSurchargePercent(db: PrismaClient, percent: number): Promise<void> {
  await setSetting(db, 'payment.cardSurchargePercent', String(percent))
}

export async function getBackupPromptOnLogout(db: PrismaClient): Promise<boolean> {
  return (await getSetting(db, 'backup.promptOnLogout')) === 'true'
}

export async function saveBackupPromptOnLogout(db: PrismaClient, enabled: boolean): Promise<void> {
  await setSetting(db, 'backup.promptOnLogout', String(enabled))
}

/** The manager-configured USB drive backups are written to automatically. Null when not yet set. */
export async function getBackupDestination(
  db: PrismaClient
): Promise<{ drivePath: string; driveName: string } | null> {
  const drivePath = await getSetting(db, 'backup.drivePath')
  if (!drivePath) return null
  const driveName = await getSetting(db, 'backup.driveName')
  return { drivePath, driveName: driveName || drivePath }
}

export async function saveBackupDestination(
  db: PrismaClient,
  drivePath: string,
  driveName: string
): Promise<void> {
  await setSetting(db, 'backup.drivePath', drivePath)
  await setSetting(db, 'backup.driveName', driveName)
}

/** Minutes of inactivity before the session is force-logged-out. Manager-configurable, default 20. */
export async function getIdleTimeoutMinutes(db: PrismaClient): Promise<number> {
  const raw = await getSetting(db, 'session.idleTimeoutMinutes')
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 20
}

export async function saveIdleTimeoutMinutes(db: PrismaClient, minutes: number): Promise<void> {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
    throw new Error('Idle timeout must be between 1 and 240 minutes.')
  }
  await setSetting(db, 'session.idleTimeoutMinutes', String(Math.round(minutes)))
}

/** Display density (1-8, see src/renderer/src/lib/density.ts). Device-level — not per-user. */
export async function getDisplayDensityLevel(db: PrismaClient): Promise<number> {
  const raw = await getSetting(db, 'display.densityLevel')
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 && n <= 8 ? n : 4
}

export async function saveDisplayDensityLevel(db: PrismaClient, level: number): Promise<number> {
  if (!Number.isFinite(level) || level < 1 || level > 8) {
    throw new Error('Display density level must be between 1 and 8.')
  }
  const rounded = Math.round(level)
  await setSetting(db, 'display.densityLevel', String(rounded))
  return rounded
}

const REPORT_EMAIL_INTERVALS: ReadonlySet<string> = new Set(['DAILY', 'WEEKLY', 'MONTHLY'])

/** Renderer-safe view — never includes the SMTP password, only whether one is on file. */
export async function getReportEmailSettings(db: PrismaClient): Promise<ReportEmailSettingsDTO> {
  const [
    enabled,
    recipientEmail,
    interval,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUsername,
    smtpPasswordEnc,
    smtpFromAddress,
    lastSentAt
  ] = await Promise.all([
    getSetting(db, 'reportEmail.enabled'),
    getSetting(db, 'reportEmail.recipientEmail'),
    getSetting(db, 'reportEmail.interval'),
    getSetting(db, 'reportEmail.smtpHost'),
    getSetting(db, 'reportEmail.smtpPort'),
    getSetting(db, 'reportEmail.smtpSecure'),
    getSetting(db, 'reportEmail.smtpUsername'),
    getSetting(db, 'reportEmail.smtpPasswordEnc'),
    getSetting(db, 'reportEmail.smtpFromAddress'),
    getSetting(db, 'reportEmail.lastSentAt')
  ])
  return {
    enabled: enabled === 'true',
    recipientEmail,
    interval: REPORT_EMAIL_INTERVALS.has(interval) ? (interval as ReportEmailInterval) : 'DAILY',
    smtpHost,
    smtpPort: Number(smtpPort) || 587,
    smtpSecure: smtpSecure === 'true',
    smtpUsername,
    smtpFromAddress,
    hasSmtpPassword: Boolean(smtpPasswordEnc),
    lastSentAt: lastSentAt || null
  }
}

export async function saveReportEmailSettings(
  db: PrismaClient,
  input: {
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
): Promise<ReportEmailSettingsDTO> {
  if (input.enabled && !input.recipientEmail.trim()) {
    throw new Error('A recipient email is required to enable scheduled report emails.')
  }
  if (input.enabled && !input.smtpHost.trim()) {
    throw new Error('An SMTP host is required to enable scheduled report emails.')
  }
  if (!REPORT_EMAIL_INTERVALS.has(input.interval)) {
    throw new Error('Invalid report email interval.')
  }
  await Promise.all([
    setSetting(db, 'reportEmail.enabled', String(input.enabled)),
    setSetting(db, 'reportEmail.recipientEmail', input.recipientEmail.trim()),
    setSetting(db, 'reportEmail.interval', input.interval),
    setSetting(db, 'reportEmail.smtpHost', input.smtpHost.trim()),
    setSetting(db, 'reportEmail.smtpPort', String(Math.round(input.smtpPort) || 587)),
    setSetting(db, 'reportEmail.smtpSecure', String(input.smtpSecure)),
    setSetting(db, 'reportEmail.smtpUsername', input.smtpUsername.trim()),
    setSetting(db, 'reportEmail.smtpFromAddress', input.smtpFromAddress.trim()),
    ...(input.smtpPassword
      ? [setSetting(db, 'reportEmail.smtpPasswordEnc', encryptSecret(input.smtpPassword.trim()))]
      : [])
  ])
  return getReportEmailSettings(db)
}

/** MAIN PROCESS ONLY (mail sender) — includes the decrypted SMTP password. */
export async function getReportEmailSettingsInternal(db: PrismaClient): Promise<
  ReportEmailSettingsDTO & { smtpPassword: string }
> {
  const [view, smtpPasswordEnc] = await Promise.all([
    getReportEmailSettings(db),
    getSetting(db, 'reportEmail.smtpPasswordEnc')
  ])
  return { ...view, smtpPassword: smtpPasswordEnc ? decryptSecret(smtpPasswordEnc) : '' }
}

export async function recordReportEmailSent(db: PrismaClient, sentAt: Date): Promise<void> {
  await setSetting(db, 'reportEmail.lastSentAt', sentAt.toISOString())
}
