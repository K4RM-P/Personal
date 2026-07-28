import { PrismaClient } from '@prisma/client'
import type { PaymentConfig } from '../../shared/types'
import type { PaymentProvider } from './PaymentProvider'
import { createPaymentProvider } from './registry'
import { getPaymentConfig } from './paymentConfig'

/**
 * Owns the single active PaymentProvider for the app. It lazily instantiates and
 * `init()`s the adapter from stored settings, and transparently re-initialises
 * when the provider or credentials change — so switching from Manual mode today
 * to a real semi-integrated terminal later needs no checkout changes at all.
 */
let provider: PaymentProvider | null = null
let signature: string | null = null

function signatureOf(cfg: PaymentConfig): string {
  return `${cfg.provider}|${cfg.environment}|${cfg.terminalId ?? ''}|${cfg.apiKey ? 'K' : ''}`
}

export async function getActiveProvider(db: PrismaClient): Promise<PaymentProvider> {
  const cfg = await getPaymentConfig(db)
  const sig = signatureOf(cfg)
  if (!provider || provider.name !== cfg.provider || signature !== sig) {
    const next = createPaymentProvider(cfg.provider)
    await next.init(cfg)
    provider = next
    signature = sig
  }
  return provider
}

/** Drop the cached provider so the next operation re-reads config and re-inits. */
export function resetActiveProvider(): void {
  provider = null
  signature = null
}
