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
 * Moneris (semi-integrated category).
 *
 * The PIN pad is a separate device on the network; the POS sends "charge $X" to
 * the Moneris integrated-terminal cloud and receives approved/declined — raw
 * card data never touches this app, which keeps the POS mostly out of PCI scope.
 *
 * Structured against Moneris's JSON integrated-terminal shape (store_id +
 * api_token auth, ECR/terminal id). Field names should be finalized against the
 * live Moneris sandbox; the transport is injectable for unit tests.
 *
 * `apiKey` is stored as "<store_id>:<api_token>".
 */
export class MonerisAdapter implements PaymentProvider {
  readonly name = 'moneris' as const
  readonly interactionMode = 'automatic' as const

  private storeId = ''
  private apiToken = ''
  private ecrId: string | null = null
  private baseUrl = ''

  constructor(private readonly http: HttpTransport = fetchTransport) {}

  async init(config: PaymentConfig): Promise<void> {
    if (!config.apiKey) throw new Error('Moneris requires credentials as "<store_id>:<api_token>"')
    const [storeId, apiToken] = config.apiKey.split(':')
    if (!storeId || !apiToken) throw new Error('Moneris apiKey must be "<store_id>:<api_token>"')
    this.storeId = storeId
    this.apiToken = apiToken
    this.ecrId = config.terminalId?.trim() || null
    this.baseUrl =
      config.environment === 'production'
        ? 'https://gateway.moneris.com'
        : 'https://gatewayt.moneris.com'
  }

  private auth(): Record<string, string> {
    return { 'X-Store-Id': this.storeId, 'X-API-Token': this.apiToken }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    if (!this.ecrId) return { status: 'error', amountCents, message: 'No Moneris terminal (ECR) id configured' }
    const res = await this.http('POST', `${this.baseUrl}/terminal/purchase`, this.auth(), {
      order_id: `${orderRef}-${Date.now()}`,
      terminal_id: this.ecrId,
      amount: this.dollars(amountCents)
    })
    const body = res.body as any
    if (!res.ok) return { status: 'error', amountCents, message: this.messageFrom(res) }

    // Moneris signals approval with a numeric response_code < 50.
    const approved = body?.approved === true || Number(body?.response_code) < 50
    if (approved) {
      return {
        status: 'approved',
        amountCents,
        transactionId: String(body?.transaction_id ?? body?.txn_number ?? orderRef),
        cardLast4: body?.card_last4,
        authCode: body?.auth_code,
        message: body?.message ?? 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: body?.transaction_id ? String(body.transaction_id) : undefined,
      message: body?.message ?? `Declined (code ${body?.response_code})`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    const res = await this.http('POST', `${this.baseUrl}/terminal/refund`, this.auth(), {
      original_transaction_id: transactionId,
      ...(amountCents != null ? { amount: this.dollars(amountCents) } : {})
    })
    if (!res.ok) return { status: 'declined', message: this.messageFrom(res) }
    return { status: 'approved', refundId: String((res.body as any)?.transaction_id ?? ''), message: 'Refunded' }
  }

  async void(transactionId: string): Promise<VoidResult> {
    const res = await this.http('POST', `${this.baseUrl}/terminal/void`, this.auth(), {
      original_transaction_id: transactionId
    })
    if (!res.ok) return { status: 'error', message: this.messageFrom(res) }
    return { status: 'approved', message: 'Voided' }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    if (!this.storeId || !this.ecrId) {
      return { connected: false, provider: this.name, message: 'Not configured' }
    }
    const res = await this.http('GET', `${this.baseUrl}/terminal/${this.ecrId}/status`, this.auth())
    return {
      connected: res.ok && (res.body as any)?.online !== false,
      provider: this.name,
      label: `Moneris terminal ${this.ecrId}`,
      message: res.ok ? 'Terminal reachable' : this.messageFrom(res)
    }
  }

  private dollars(cents: number): string {
    return (cents / 100).toFixed(2)
  }

  private messageFrom(res: { body: unknown }): string {
    return (res.body as any)?.message ?? (res.body as any)?.error ?? 'Moneris API error'
  }
}
