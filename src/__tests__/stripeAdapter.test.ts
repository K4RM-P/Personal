import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted state the fake SDK reads so each test can steer the outcome.
const h = vi.hoisted(() => ({
  intentStatus: 'succeeded' as string,
  lastError: undefined as { message: string } | undefined
}))

vi.mock('stripe', () => {
  class FakeStripe {
    constructor(_key: string) {}
    terminal = {
      readers: {
        list: async () => ({ data: [{ id: 'reader_1', status: 'online', label: 'Sim' }] }),
        processPaymentIntent: async () => ({}),
        retrieve: async () => ({ id: 'reader_1', status: 'online', label: 'Sim Reader' })
      }
    }
    testHelpers = { terminal: { readers: { presentPaymentMethod: async () => ({}) } } }
    paymentIntents = {
      create: async () => ({ id: 'pi_1', status: 'requires_confirmation' }),
      retrieve: async () => ({
        id: 'pi_1',
        status: h.intentStatus,
        last_payment_error: h.lastError,
        latest_charge: { id: 'ch_1', payment_method_details: { card_present: { last4: '4242' } } }
      }),
      cancel: async () => ({ id: 'pi_1', status: 'canceled' })
    }
    refunds = { create: async () => ({ id: 're_1', status: 'succeeded' }) }
  }
  return { default: FakeStripe }
})

import { StripeTerminalAdapter } from '../main/payment/providers/StripeTerminalAdapter'

describe('StripeTerminalAdapter (cloud SDK reader)', () => {
  let adapter: StripeTerminalAdapter

  beforeEach(async () => {
    h.intentStatus = 'succeeded'
    h.lastError = undefined
    adapter = new StripeTerminalAdapter()
    // No terminalId → auto-discovers the simulated reader in sandbox.
    await adapter.init({ provider: 'stripe', environment: 'sandbox', apiKey: 'sk_test_x' })
  })

  it('approves a succeeded PaymentIntent and extracts the card last4', async () => {
    const res = await adapter.charge(4217, 'SALE-1')
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('pi_1')
    expect(res.cardLast4).toBe('4242')
    expect(res.authCode).toBe('ch_1')
  })

  it('declines when the intent needs another payment method', async () => {
    h.intentStatus = 'requires_payment_method'
    h.lastError = { message: 'Your card was declined.' }
    const res = await adapter.charge(1000, 'SALE-2')
    expect(res.status).toBe('declined')
    expect(res.message).toBe('Your card was declined.')
  })

  it('refunds, voids, and reports reader status', async () => {
    expect((await adapter.refund('pi_1')).status).toBe('approved')
    expect((await adapter.void('pi_1')).status).toBe('approved')
    const status = await adapter.getReaderStatus()
    expect(status.connected).toBe(true)
    expect(status.provider).toBe('stripe')
  })

  it('requires an API key', async () => {
    const fresh = new StripeTerminalAdapter()
    await expect(fresh.init({ provider: 'stripe', environment: 'sandbox' })).rejects.toThrow(/secret API key/)
  })
})
