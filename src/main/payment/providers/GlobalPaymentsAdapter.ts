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
 * Structured against GP-API's JSON REST shape (`/ucp/transactions`, bearer
 * access token). Field names should be finalized against the GP-API sandbox;
 * the transport is injectable for unit tests.
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
    const res = await this.http('POST', `${this.baseUrl}/accesstoken`, { 'X-GP-Version': '2021-03-22' }, {
      app_id: this.appId,
      secret: this.appKey,
      grant_type: 'client_credentials'
    })
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

    const status = body?.status as string | undefined
    if (status === 'CAPTURED' || status === 'PREAUTHORIZED') {
      return {
        status: 'approved',
        amountCents,
        transactionId: body?.id,
        cardLast4: body?.payment_method?.card?.masked_number_last4,
        authCode: body?.payment_method?.result,
        message: 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: body?.id,
      message: body?.payment_method?.message ?? `Declined (status ${status})`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
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
