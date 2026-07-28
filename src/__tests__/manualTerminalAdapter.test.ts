import { describe, it, expect, beforeEach } from 'vitest'
import { ManualTerminalAdapter } from '../main/payment/providers/ManualTerminalAdapter'

describe('ManualTerminalAdapter (standalone/dumb terminal)', () => {
  let adapter: ManualTerminalAdapter

  beforeEach(async () => {
    adapter = new ManualTerminalAdapter()
    await adapter.init({ provider: 'manual', environment: 'sandbox' })
  })

  it('declares a manual interaction mode', () => {
    expect(adapter.interactionMode).toBe('manual')
  })

  it('records an approved outcome the cashier confirmed', async () => {
    const res = await adapter.charge(4217, 'SALE-1', { manualOutcome: 'approved' })
    expect(res.status).toBe('approved')
    expect(res.amountCents).toBe(4217)
    expect(res.transactionId).toBe('MANUAL-SALE-1')
  })

  it('keeps an optional reference number as the trace', async () => {
    const res = await adapter.charge(1000, 'SALE-2', { manualOutcome: 'approved', manualReference: 'RCPT-99' })
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('RCPT-99')
    expect(res.authCode).toBe('RCPT-99')
  })

  it('records a declined outcome', async () => {
    const res = await adapter.charge(1000, 'SALE-3', { manualOutcome: 'declined' })
    expect(res.status).toBe('declined')
  })

  it('errors (does not silently approve) when no outcome is supplied', async () => {
    const res = await adapter.charge(1000, 'SALE-4')
    expect(res.status).toBe('error')
    expect(res.message).toMatch(/confirm/i)
  })

  it('reports a reader status that reads as a mode, not a failure', async () => {
    const status = await adapter.getReaderStatus()
    expect(status.connected).toBe(true)
    expect(status.provider).toBe('manual')
    expect(status.message).toMatch(/standalone terminal/i)
  })
})
