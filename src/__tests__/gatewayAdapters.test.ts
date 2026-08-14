import { describe, it, expect } from 'vitest'
import { SquareTerminalAdapter } from '../main/payment/providers/SquareTerminalAdapter'
import { CloverAdapter } from '../main/payment/providers/CloverAdapter'
import { MonerisAdapter } from '../main/payment/providers/MonerisAdapter'
import { GlobalPaymentsAdapter } from '../main/payment/providers/GlobalPaymentsAdapter'
import type { HttpResponse, HttpTransport } from '../main/payment/httpTransport'

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, body })
const fail = (body: unknown): HttpResponse => ({ status: 402, ok: false, body })

/** A transport that answers based on method+url, recording calls. */
function router(routes: (method: string, url: string, body?: unknown) => HttpResponse | undefined): HttpTransport {
  return async (method, url, _headers, body) => {
    const res = routes(method, url, body)
    if (!res) throw new Error(`unrouted ${method} ${url}`)
    return res
  }
}

describe('SquareTerminalAdapter', () => {
  it('creates a terminal checkout, polls to COMPLETED, and approves', async () => {
    const http = router((method, url) => {
      if (method === 'POST' && url.endsWith('/v2/terminals/checkouts')) return ok({ checkout: { id: 'co_1', status: 'PENDING' } })
      if (method === 'GET' && url.endsWith('/v2/terminals/checkouts/co_1'))
        return ok({ checkout: { id: 'co_1', status: 'COMPLETED', payment_ids: ['pay_1'] } })
      return undefined
    })
    const a = new SquareTerminalAdapter(http)
    await a.init({ provider: 'square', environment: 'sandbox', terminalId: 'device_1', apiKey: 'tok' })
    const res = await a.charge(4217, 'SALE-1')
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('pay_1')
  })

  it('reuses the same idempotency key for the same orderRef (retry safety)', async () => {
    const seenKeys: string[] = []
    const http = router((method, url, body) => {
      if (method === 'POST' && url.endsWith('/v2/terminals/checkouts')) {
        seenKeys.push((body as { idempotency_key: string }).idempotency_key)
        return ok({ checkout: { id: 'co_1', status: 'PENDING' } })
      }
      if (method === 'GET' && url.endsWith('/v2/terminals/checkouts/co_1'))
        return ok({ checkout: { id: 'co_1', status: 'COMPLETED', payment_ids: ['pay_1'] } })
      return undefined
    })
    const a = new SquareTerminalAdapter(http)
    await a.init({ provider: 'square', environment: 'sandbox', terminalId: 'device_1', apiKey: 'tok' })
    await a.charge(4217, 'SALE-1')
    await a.charge(4217, 'SALE-1') // retry of the same logical attempt, same orderRef
    expect(seenKeys).toHaveLength(2)
    expect(seenKeys[0]).toBe(seenKeys[1])
    expect(seenKeys[0]).toBe('checkout-SALE-1')
  })

  it('declines when the checkout is canceled', async () => {
    const http = router((method, url) => {
      if (method === 'POST' && url.endsWith('/v2/terminals/checkouts')) return ok({ checkout: { id: 'co_2', status: 'PENDING' } })
      if (method === 'GET') return ok({ checkout: { id: 'co_2', status: 'CANCELED' } })
      return undefined
    })
    const a = new SquareTerminalAdapter(http)
    await a.init({ provider: 'square', environment: 'sandbox', terminalId: 'device_1', apiKey: 'tok' })
    expect((await a.charge(1000, 'SALE-2')).status).toBe('declined')
  })
})

describe('CloverAdapter', () => {
  it('approves via REST Pay Display (result SUCCESS + cardTransaction CLOSED)', async () => {
    const http = router((method, url) => {
      if (method === 'POST' && url.endsWith('/v1/payments'))
        return ok({
          payment: {
            id: 'pay_1',
            result: 'SUCCESS',
            cardTransaction: { state: 'CLOSED', authCode: 'A9', last4: '1234' }
          }
        })
      return undefined
    })
    const a = new CloverAdapter(http)
    await a.init({ provider: 'clover', environment: 'sandbox', terminalId: 'dev_1', apiKey: 'tok' })
    const res = await a.charge(4217, 'SALE-1')
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('pay_1')
    expect(res.cardLast4).toBe('1234')
    expect(res.authCode).toBe('A9')
  })

  it('declines when result is not SUCCESS', async () => {
    const http = router(() => ok({ payment: { id: 'pay_2', result: 'FAIL' } }))
    const a = new CloverAdapter(http)
    await a.init({ provider: 'clover', environment: 'sandbox', terminalId: 'dev_1', apiKey: 'tok' })
    const res = await a.charge(1000, 'SALE-2')
    expect(res.status).toBe('declined')
  })

  it('sends X-Clover-Device-Id and reuses the Idempotency-Key on retry', async () => {
    const seenHeaders: Record<string, string>[] = []
    const http: HttpTransport = async (_m, _u, headers) => {
      seenHeaders.push(headers)
      return ok({ payment: { id: 'pay_1', result: 'SUCCESS', cardTransaction: { state: 'CLOSED' } } })
    }
    const a = new CloverAdapter(http)
    await a.init({ provider: 'clover', environment: 'sandbox', terminalId: 'dev_1', apiKey: 'tok' })
    await a.charge(4217, 'SALE-3')
    await a.charge(4217, 'SALE-3')
    expect(seenHeaders[0]['X-Clover-Device-Id']).toBe('dev_1')
    expect(seenHeaders[0]['Idempotency-Key']).toBe(seenHeaders[1]['Idempotency-Key'])
  })

  it('errors without a device id', async () => {
    const a = new CloverAdapter(router(() => ok({})))
    await a.init({ provider: 'clover', environment: 'sandbox', apiKey: 'tok' })
    expect((await a.charge(1000, 'X')).status).toBe('error')
  })
})

describe('MonerisAdapter', () => {
  const monerisResponse = (entry: Record<string, unknown>) =>
    ok({ data: { response: [{ completed: 'true', ...entry }] } })

  it('approves on a low response code', async () => {
    const http = router((method, url) => {
      if (method === 'POST' && url === 'https://ippostest.moneris.com/v3/terminal')
        return monerisResponse({
          realTimeUniqueId: 'rtu1',
          authCode: 'A1',
          maskedPan: '************4242',
          responseCode: '027',
          status: 'Approved'
        })
      return undefined
    })
    const a = new MonerisAdapter(http)
    await a.init({ provider: 'moneris', environment: 'sandbox', terminalId: 'ECR1', apiKey: 'store5:token5:ist5' })
    const res = await a.charge(4217, 'SALE-1')
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('rtu1')
    expect(res.cardLast4).toBe('4242')
    expect(res.authCode).toBe('A1')
  })

  it('declines on a high response code', async () => {
    const http = router(() => monerisResponse({ responseCode: '051', status: 'DECLINED' }))
    const a = new MonerisAdapter(http)
    await a.init({ provider: 'moneris', environment: 'sandbox', terminalId: 'ECR1', apiKey: 'store5:token5:ist5' })
    expect((await a.charge(1000, 'SALE-2')).status).toBe('declined')
  })

  it('errors on an incomplete (not yet finished) response instead of guessing an outcome', async () => {
    const http = router(() => ok({ data: { response: [{ completed: 'false' }] } }))
    const a = new MonerisAdapter(http)
    await a.init({ provider: 'moneris', environment: 'sandbox', terminalId: 'ECR1', apiKey: 'store5:token5:ist5' })
    const res = await a.charge(1000, 'SALE-3')
    expect(res.status).toBe('error')
  })

  it('reuses the same idempotency key for the same orderRef (retry safety)', async () => {
    const seenKeys: string[] = []
    const http = router((_m, _u, body) => {
      const req = (body as any)?.data?.request?.[0]
      seenKeys.push(req.idempotencyKey)
      return monerisResponse({ responseCode: '027', status: 'Approved' })
    })
    const a = new MonerisAdapter(http)
    await a.init({ provider: 'moneris', environment: 'sandbox', terminalId: 'ECR1', apiKey: 'store5:token5:ist5' })
    await a.charge(4217, 'SALE-4')
    await a.charge(4217, 'SALE-4')
    expect(seenKeys).toHaveLength(2)
    expect(seenKeys[0]).toBe(seenKeys[1])
  })

  it('rejects malformed credentials', async () => {
    const a = new MonerisAdapter(router(() => ok({})))
    await expect(
      a.init({ provider: 'moneris', environment: 'sandbox', apiKey: 'nocolon' })
    ).rejects.toThrow(/store_id/)
  })

  it('rejects credentials missing the ist_config_code', async () => {
    const a = new MonerisAdapter(router(() => ok({})))
    await expect(
      a.init({ provider: 'moneris', environment: 'sandbox', apiKey: 'store5:token5' })
    ).rejects.toThrow(/ist_config_code/)
  })

  it('refund requires an explicit amount (independent refunds are not linked to the original transaction)', async () => {
    const a = new MonerisAdapter(router(() => ok({})))
    await a.init({ provider: 'moneris', environment: 'sandbox', terminalId: 'ECR1', apiKey: 'store5:token5:ist5' })
    const res = await a.refund('rtu1')
    expect(res.status).toBe('declined')
  })
})

describe('GlobalPaymentsAdapter', () => {
  it('fetches an access token then captures a transaction', async () => {
    const http = router((method, url) => {
      if (url.endsWith('/accesstoken')) return ok({ token: 'tok_123' })
      if (url.endsWith('/transactions'))
        return ok({
          id: 'trn_1',
          status: 'CAPTURED',
          payment_method: { card: { masked_number_last4: '1111' }, authcode: 'AUTH1' }
        })
      return undefined
    })
    const a = new GlobalPaymentsAdapter(http)
    await a.init({ provider: 'globalpayments', environment: 'sandbox', terminalId: 'term_1', apiKey: 'app:key' })
    const res = await a.charge(4217, 'SALE-1')
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('trn_1')
    expect(res.cardLast4).toBe('1111')
    expect(res.authCode).toBe('AUTH1')
  })

  it('sends a nonce and a SHA512(nonce+app_key) secret rather than the raw app_key', async () => {
    let seenBody: any
    const http = router((method, url, body) => {
      if (url.endsWith('/accesstoken')) {
        seenBody = body
        return ok({ token: 'tok_123' })
      }
      if (url.endsWith('/transactions')) return ok({ id: 'trn_1', status: 'CAPTURED', payment_method: {} })
      return undefined
    })
    const a = new GlobalPaymentsAdapter(http)
    await a.init({ provider: 'globalpayments', environment: 'sandbox', terminalId: 'term_1', apiKey: 'app:key' })
    await a.charge(1000, 'SALE-nonce')
    expect(seenBody.nonce).toBeTruthy()
    expect(seenBody.secret).not.toBe('key')
    expect(seenBody.secret).toMatch(/^[0-9a-f]{128}$/)
  })

  it('declines a non-captured transaction', async () => {
    const http = router((_m, url) => {
      if (url.endsWith('/accesstoken')) return ok({ token: 'tok_123' })
      if (url.endsWith('/transactions')) return ok({ id: 'trn_2', status: 'DECLINED', payment_method: { message: 'NO FUNDS' } })
      return undefined
    })
    const a = new GlobalPaymentsAdapter(http)
    await a.init({ provider: 'globalpayments', environment: 'sandbox', terminalId: 'term_1', apiKey: 'app:key' })
    const res = await a.charge(1000, 'SALE-2')
    expect(res.status).toBe('declined')
    expect(res.message).toBe('NO FUNDS')
  })

  it('surfaces an auth failure', async () => {
    const http = router((_m, url) => (url.endsWith('/accesstoken') ? fail({ error_description: 'bad creds' }) : undefined))
    const a = new GlobalPaymentsAdapter(http)
    await a.init({ provider: 'globalpayments', environment: 'sandbox', terminalId: 'term_1', apiKey: 'app:key' })
    expect((await a.charge(1000, 'X')).status).toBe('error')
  })
})
