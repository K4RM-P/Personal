import { PrismaClient } from '@prisma/client'
import type { PrinterConfig, StoreInfo } from '../../../shared/types'

const DEFAULTS = {
  'store.name': 'PharmaPOS Rx Pharmacy',
  'store.address': '123 Health Ave, Suite 100, Cityville',
  'store.phone': '(555) 019-2831',
  'printer.type': 'PDF',
  'printer.networkIp': '',
  'printer.networkPort': '9100',
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
  'customer.allowShortPayToTab': 'false'
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
  return {
    name: await getSetting(db, 'store.name'),
    address: await getSetting(db, 'store.address'),
    phone: await getSetting(db, 'store.phone')
  }
}

export async function saveStoreInfo(db: PrismaClient, info: StoreInfo): Promise<StoreInfo> {
  await setSetting(db, 'store.name', info.name)
  await setSetting(db, 'store.address', info.address)
  await setSetting(db, 'store.phone', info.phone)
  return getStoreInfo(db)
}

export async function getPrinterConfig(db: PrismaClient): Promise<PrinterConfig> {
  const type = (await getSetting(db, 'printer.type')) as PrinterConfig['type']
  const ipAddress = await getSetting(db, 'printer.networkIp')
  const portStr = await getSetting(db, 'printer.networkPort')
  const port = parseInt(portStr, 10) || 9100

  return {
    type: type === 'NETWORK' || type === 'SYSTEM' ? type : 'PDF',
    ipAddress: ipAddress || undefined,
    port
  }
}

export async function savePrinterConfig(db: PrismaClient, config: PrinterConfig): Promise<PrinterConfig> {
  await setSetting(db, 'printer.type', config.type)
  await setSetting(db, 'printer.networkIp', config.ipAddress ?? '')
  await setSetting(db, 'printer.networkPort', String(config.port ?? 9100))
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

export async function getAllowShortPayToTab(db: PrismaClient): Promise<boolean> {
  return (await getSetting(db, 'customer.allowShortPayToTab')) === 'true'
}

export async function saveAllowCreditCardSurcharge(db: PrismaClient, enabled: boolean): Promise<void> {
  await setSetting(db, 'payment.allowCreditCardSurcharge', String(enabled))
}

export async function saveCardSurchargePercent(db: PrismaClient, percent: number): Promise<void> {
  await setSetting(db, 'payment.cardSurchargePercent', String(percent))
}

export async function saveAllowShortPayToTab(db: PrismaClient, enabled: boolean): Promise<void> {
  await setSetting(db, 'customer.allowShortPayToTab', String(enabled))
}
