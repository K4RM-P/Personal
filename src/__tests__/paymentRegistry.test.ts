import { describe, it, expect } from 'vitest'
import { createPaymentProvider, providerInteractionMode, IMPLEMENTED_PROVIDERS } from '../main/payment/registry'
import type { PaymentProviderName } from '../shared/types'

describe('payment registry / factory', () => {
  it('instantiates a concrete adapter for every implemented provider', () => {
    for (const name of IMPLEMENTED_PROVIDERS) {
      const provider = createPaymentProvider(name)
      expect(provider.name).toBe(name)
      expect(typeof provider.charge).toBe('function')
      expect(typeof provider.refund).toBe('function')
      expect(typeof provider.void).toBe('function')
      expect(typeof provider.getReaderStatus).toBe('function')
    }
  })

  it('marks only the manual/external terminal as a manual interaction mode', () => {
    expect(providerInteractionMode('manual')).toBe('manual')
    for (const name of ['mock', 'stripe', 'square', 'moneris', 'globalpayments'] as PaymentProviderName[]) {
      expect(providerInteractionMode(name)).toBe('automatic')
    }
  })

  it('throws on an unknown provider name', () => {
    expect(() => createPaymentProvider('nope' as PaymentProviderName)).toThrow(/Unknown payment provider/)
  })
})
