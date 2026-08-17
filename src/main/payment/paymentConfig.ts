import { PrismaClient } from '@prisma/client'
import type {
  PaymentConfig,
  PaymentConfigView,
  PaymentEnvironment,
  PaymentProviderName,
  SavePaymentConfigInput
} from '../../shared/types'
import { providerInteractionMode } from './registry'
import { decryptSecret, encryptSecret } from './credentialStore'

const KEYS = {
  provider: 'payment.provider',
  environment: 'payment.environment',
  terminalId: 'payment.terminalId',
  apiKeyEnc: 'payment.apiKeyEnc',
  terminalIp: 'payment.terminalIp',
  terminalPort: 'payment.terminalPort'
} as const

// Safe real-world default for a fresh pharmacy: assume a standalone terminal
// with no integration until the owner completes setup.
const DEFAULT_PROVIDER: PaymentProviderName = 'manual'
const DEFAULT_ENVIRONMENT: PaymentEnvironment = 'sandbox'

async function get(db: PrismaClient, key: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? ''
}

async function set(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/** Full config incl. decrypted secret — MAIN PROCESS ONLY (provider init). */
export async function getPaymentConfig(db: PrismaClient): Promise<PaymentConfig> {
  const provider = ((await get(db, KEYS.provider)) || DEFAULT_PROVIDER) as PaymentProviderName
  const environment = ((await get(db, KEYS.environment)) ||
    DEFAULT_ENVIRONMENT) as PaymentEnvironment
  const terminalId = (await get(db, KEYS.terminalId)) || undefined
  const terminalIp = (await get(db, KEYS.terminalIp)) || undefined
  const terminalPort = (await get(db, KEYS.terminalPort)) || undefined
  const enc = await get(db, KEYS.apiKeyEnc)
  const apiKey = enc ? decryptSecret(enc) : undefined
  return { provider, environment, terminalId, apiKey, terminalIp, terminalPort }
}

/** Renderer-safe view — never includes the secret key. */
export async function getPaymentConfigView(db: PrismaClient): Promise<PaymentConfigView> {
  const provider = ((await get(db, KEYS.provider)) || DEFAULT_PROVIDER) as PaymentProviderName
  const environment = ((await get(db, KEYS.environment)) ||
    DEFAULT_ENVIRONMENT) as PaymentEnvironment
  const terminalId = (await get(db, KEYS.terminalId)) || undefined
  const terminalIp = (await get(db, KEYS.terminalIp)) || undefined
  const terminalPort = (await get(db, KEYS.terminalPort)) || undefined
  const hasApiKey = Boolean(await get(db, KEYS.apiKeyEnc))
  return {
    provider,
    environment,
    terminalId,
    terminalIp,
    terminalPort,
    hasApiKey,
    interactionMode: providerInteractionMode(provider)
  }
}

/**
 * Persist config. A blank/omitted `apiKey` keeps the existing encrypted key,
 * so re-saving other fields never wipes credentials. A non-blank key is
 * encrypted via the OS keychain before storage.
 */
export async function savePaymentConfig(
  db: PrismaClient,
  input: SavePaymentConfigInput
): Promise<PaymentConfigView> {
  await set(db, KEYS.provider, input.provider)
  await set(db, KEYS.environment, input.environment)
  await set(db, KEYS.terminalId, input.terminalId ?? '')
  await set(db, KEYS.terminalIp, input.terminalIp ?? '')
  await set(db, KEYS.terminalPort, input.terminalPort ?? '')

  if (input.apiKey && input.apiKey.trim()) {
    await set(db, KEYS.apiKeyEnc, encryptSecret(input.apiKey.trim()))
  }

  return getPaymentConfigView(db)
}
