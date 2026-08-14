import { createHash, randomUUID } from 'crypto'
import type {
  PaymentConfig,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus
} from '../../../shared/types'
import type { PaymentProvider } from '../PaymentProvider'
import { fetchTransport, type HttpTransport } from '../httpTransport'

/**
 * Global Payments (semi-integrated category) via GP-API.
 *
 * Like Moneris, the terminal handles card entry; the POS asks GP-API to run the
 * amount on a paired terminal and gets approved/declined back.
 *
 * Base URLs, the `/accesstoken` nonce+secret scheme, and the response field
 * names below marked "confirmed" were checked against Global Payments' own
 * open-source SDKs (github.com/globalpayments/php-sdk, dotnet-sdk) since the
 * live docs site is a JS-rendered SPA that couldn't be fetched as text. Fields
 * marked "unconfirmed" below are still inferred, not verified — do not treat
 * this adapter as fully verified end-to-end; confirm the remaining fields
 * against a live GP-API sandbox call before relying on it for a real charge.
 *
 * `apiKey` is stored as "<app_id>:<app_key>" and exchanged for an access token.
 */
export class GlobalPaymentsAdapter implements PaymentProvider {
  readonly name = 'globalpayments' as const
  readonly interactionMode = 'automatic' as const

  private appId = ''
  private appKey = ''
  private terminalId: string | null = null
  private baseUrl = ''
  private accessToken: string | null = null

  constructor(private readonly http: HttpTransport = fetchTransport) {}

  async init(config: PaymentConfig): Promise<void> {
    if (!config.apiKey) throw new Error('Global Payments requires credentials as "<app_id>:<app_key>"')
    const [appId, appKey] = config.apiKey.split(':')
    if (!appId || !appKey) throw new Error('Global Payments apiKey must be "<app_id>:<app_key>"')
    this.appId = appId
    this.appKey = appKey
    this.terminalId = config.terminalId?.trim() || null
    this.baseUrl =
      config.environment === 'production'
        ? 'https://apis.globalpay.com/ucp'
        : 'https://apis.sandbox.globalpay.com/ucp'
    this.accessToken = null
  }

  private async token(): Promise<string> {
    if (this.accessToken) return this.accessToken
    // Confirmed via php-sdk (generateSecret): GP-API never accepts the raw app_key as `secret`.
    // It requires secret = SHA512(nonce + app_key) hex, with that same nonce sent alongside it.
    const nonce = randomUUID()
    const secret = createHash('sha512').update(nonce + this.appKey).digest('hex')
    const res = await this.http('POST', `${this.baseUrl}/accesstoken`, { 'X-GP-Version': '2021-03-22' }, {
      app_id: this.appId,
      nonce,
      secret,
      grant_type: 'client_credentials'
    })
    // `token` confirmed against dotnet-sdk's GpApiTokenResponse (JSON `token` -> Token property).
    const tok = (res.body as any)?.token
    if (!res.ok || !tok) throw new Error(this.messageFrom(res) || 'GP-API auth failed')
    this.accessToken = tok
    return tok
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}`, 'X-GP-Version': '2021-03-22' }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    if (!this.terminalId) return { status: 'error', amountCents, message: 'No Global Payments terminal id configured' }
    let res
    try {
      // POST /transactions path confirmed (direct endpoint references found for
      // apis.sandbox.globalpay.com/ucp/transactions). The request body fields below
      // (account_name/channel/capture_mode/amount/currency/reference/device) are UNCONFIRMED —
      // the SDK source files that would confirm them weren't reachable. Verify against a live
      // GP-API sandbox call before trusting this shape for a real charge.
      res = await this.http('POST', `${this.baseUrl}/transactions`, await this.authHeaders(), {
        account_name: 'transaction_processing',
        channel: 'CP', // card present
        capture_mode: 'AUTO',
        amount: String(amountCents),
        currency: 'USD',
        reference: orderRef,
        device: { id: this.terminalId }
      })
    } catch (err) {
      return { status: 'error', amountCents, message: (err as Error).message }
    }
    const body = res.body as any
    if (!res.ok) return { status: 'error', amountCents, message: this.messageFrom(res) }

    // `status`, `CAPTURED`/`PREAUTHORIZED`/`PENDING`/`REVERSED`, `id`, and
    // `payment_method.card.masked_number_last4` are confirmed (dotnet-sdk transaction mapping).
    // A literal `DECLINED` status value is UNCONFIRMED — GP-API may instead signal a decline via
    // a non-2xx response rather than status:"DECLINED" on a 200; treating any non-approved status
    // as declined here is a reasonable fallback, not a confirmed mapping.
    const status = body?.status as string | undefined
    if (status === 'CAPTURED' || status === 'PREAUTHORIZED') {
      return {
        status: 'approved',
        amountCents,
        transactionId: body?.id,
        cardLast4: body?.payment_method?.card?.masked_number_last4,
        // Confirmed: authcode lives at payment_method.authcode (dotnet-sdk mapping), NOT
        // payment_method.result — .result is a different (response/result code) field.
        authCode: body?.payment_method?.authcode,
        message: 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: body?.id,
      // payment_method.message is UNCONFIRMED — dotnet-sdk instead uses the `status` string
      // itself as the response message, so that's used as the primary fallback here.
      message: body?.payment_method?.message ?? status ?? `Declined (status ${status})`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    // Path is weakly confirmed (search summaries reference a /refund sub-path on a transaction
    // id, not a primary doc/SDK source); the {amount} body shape is UNCONFIRMED. Verify against
    // a live sandbox call before relying on this for a real refund.
    const res = await this.http(
      'POST',
      `${this.baseUrl}/transactions/${transactionId}/refund`,
      await this.authHeaders(),
      amountCents != null ? { amount: String(amountCents) } : {}
    )
    if (!res.ok) return { status: 'declined', message: this.messageFrom(res) }
    return { status: 'approved', refundId: (res.body as any)?.id, message: 'Refunded' }
  }

  async void(transactionId: string): Promise<VoidResult> {
    // UNCONFIRMED — no source found for this sub-path name specifically. The `REVERSED` status
    // value is confirmed to exist on the transaction status enum, which is at least consistent
    // with "reversal" as the concept, but the actual endpoint path was not verified. Do not rely
    // on this without a live sandbox test.
    const res = await this.http(
      'POST',
      `${this.baseUrl}/transactions/${transactionId}/reversal`,
      await this.authHeaders(),
      {}
    )
    if (!res.ok) return { status: 'error', message: this.messageFrom(res) }
    return { status: 'approved', message: 'Reversed' }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    if (!this.appId || !this.terminalId) {
      return { connected: false, provider: this.name, message: 'Not configured' }
    }
    try {
      await this.token()
      return {
        connected: true,
        provider: this.name,
        label: `Global Payments terminal ${this.terminalId}`,
        message: 'Authenticated with GP-API'
      }
    } catch (err) {
      return { connected: false, provider: this.name, message: (err as Error).message }
    }
  }

  private messageFrom(res: { body: unknown }): string {
    return (res.body as any)?.error_description ?? (res.body as any)?.detailed_error_description ?? 'GP-API error'
  }
}
