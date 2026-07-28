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
 * Clover (semi-integrated category) via the Clover REST/Ecommerce API.
 *
 * The Clover terminal handles card entry; the POS asks Clover to run the amount
 * and gets approved/declined back. `apiKey` is the Clover access token; the
 * paired device / merchant id goes in `terminalId`. The transport is injectable
 * for unit tests.
 */
export class CloverAdapter implements PaymentProvider {
  readonly name = 'clover' as const
  readonly interactionMode = 'automatic' as const

  private token = ''
  private deviceId: string | null = null
  private baseUrl = ''

  constructor(private readonly http: HttpTransport = fetchTransport) {}

  async init(config: PaymentConfig): Promise<void> {
    if (!config.apiKey) throw new Error('Clover requires an access token')
    this.token = config.apiKey
    this.deviceId = config.terminalId?.trim() || null
    this.baseUrl =
      config.environment === 'production'
        ? 'https://scl.clover.com'
        : 'https://scl-sandbox.dev.clover.com'
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    if (!this.deviceId) return { status: 'error', amountCents, message: 'No Clover device id configured' }
    const res = await this.http('POST', `${this.baseUrl}/v1/charges`, this.headers(), {
      amount: amountCents,
      currency: 'usd',
      external_reference_id: orderRef,
      device_id: this.deviceId,
      capture: true
    })
    const body = res.body as any
    if (!res.ok) return { status: 'error', amountCents, message: this.messageFrom(res) }

    const status = String(body?.status ?? '').toLowerCase()
    if (status === 'succeeded' || status === 'paid' || status === 'approved') {
      return {
        status: 'approved',
        amountCents,
        transactionId: body?.id,
        cardLast4: body?.source?.last4,
        authCode: body?.auth_code ?? body?.ref_num,
        message: 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: body?.id,
      message: body?.failure_message ?? `Declined (status ${body?.status})`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    const res = await this.http('POST', `${this.baseUrl}/v1/refunds`, this.headers(), {
      charge: transactionId,
      ...(amountCents != null ? { amount: amountCents } : {})
    })
    if (!res.ok) return { status: 'declined', message: this.messageFrom(res) }
    return { status: 'approved', refundId: (res.body as any)?.id, message: 'Refunded' }
  }

  async void(transactionId: string): Promise<VoidResult> {
    const res = await this.http('POST', `${this.baseUrl}/v1/charges/${transactionId}/void`, this.headers(), {})
    if (!res.ok) return { status: 'error', message: this.messageFrom(res) }
    return { status: 'approved', message: 'Voided' }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    if (!this.token || !this.deviceId) {
      return { connected: false, provider: this.name, message: 'Not configured' }
    }
    return {
      connected: true,
      provider: this.name,
      label: `Clover device ${this.deviceId}`,
      message: 'Configured'
    }
  }

  private messageFrom(res: { body: unknown }): string {
    return (res.body as any)?.error?.message ?? (res.body as any)?.message ?? 'Clover API error'
  }
}
