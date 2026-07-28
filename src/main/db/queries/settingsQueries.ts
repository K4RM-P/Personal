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
  'payment.apiKeyEnc': ''
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

export async function seedDefaultSettings(db: PrismaClient): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value }
    })
  }
}
