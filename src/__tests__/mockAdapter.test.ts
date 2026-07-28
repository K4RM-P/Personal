import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter } from '../main/payment/providers/MockAdapter'

describe('MockAdapter (offline simulator)', () => {
  let adapter: MockAdapter

  beforeEach(async () => {
    adapter = new MockAdapter()
    await adapter.init({ provider: 'mock', environment: 'sandbox' })
  })

  it('approves a normal amount and returns a test card', async () => {
    const res = await adapter.charge(2500, 'SALE-1')
    expect(res.status).toBe('approved')
    expect(res.cardLast4).toBe('4242')
    expect(res.transactionId).toBeTruthy()
  })

  it('declines the magic .01 amount so both paths are testable', async () => {
    const res = await adapter.charge(1001, 'SALE-2')
    expect(res.status).toBe('declined')
  })

  it('rejects a non-positive amount as an error', async () => {
    const res = await adapter.charge(0, 'SALE-3')
    expect(res.status).toBe('error')
  })

  it('refunds and voids', async () => {
    expect((await adapter.refund('mock_1')).status).toBe('approved')
    expect((await adapter.void('mock_1')).status).toBe('approved')
  })

  it('throws if used before init', async () => {
    const fresh = new MockAdapter()
    await expect(fresh.charge(100, 'X')).rejects.toThrow(/init/)
  })
})
