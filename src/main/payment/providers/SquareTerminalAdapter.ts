import { randomUUID } from 'crypto'
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
 * Square Terminal (cloud-SDK category) via the Terminal Checkout REST API.
 *
 * Flow: create a Terminal Checkout targeting a paired device, poll it to a
 * terminal state, then map COMPLETED→approved / CANCELED→declined.
 *
 * Structured against Square's documented `/v2/terminals/checkouts` shape; the
 * transport is injectable so it is unit-testable without network access.
 */
const SQUARE_VERSION = '2024-10-17'

export class SquareTerminalAdapter implements PaymentProvider {
  readonly name = 'square' as const
  readonly interactionMode = 'automatic' as const

  private token = ''
  private deviceId: string | null = null
  private baseUrl = ''

  constructor(private readonly http: HttpTransport = fetchTransport) {}

  async init(config: PaymentConfig): Promise<void> {
    if (!config.apiKey) throw new Error('Square requires an access token')
    this.token = config.apiKey
    this.deviceId = config.terminalId?.trim() || null
    this.baseUrl =
      config.environment === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com'
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, 'Square-Version': SQUARE_VERSION }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    if (!this.deviceId) {
      return { status: 'error', amountCents, message: 'No Square device id configured' }
    }
    const create = await this.http('POST', `${this.baseUrl}/v2/terminals/checkouts`, this.headers(), {
      idempotency_key: randomUUID(),
      checkout: {
        amount_money: { amount: amountCents, currency: 'USD' },
        device_options: { device_id: this.deviceId },
        reference_id: orderRef
      }
    })
    if (!create.ok) return this.errorFrom(create, amountCents)

    const checkoutId = (create.body as any)?.checkout?.id as string | undefined
    if (!checkoutId) return { status: 'error', amountCents, message: 'No checkout id returned' }

    const final = await this.pollCheckout(checkoutId)
    const co = (final?.body as any)?.checkout
    const status = co?.status as string | undefined

    if (status === 'COMPLETED') {
      const paymentId = co?.payment_ids?.[0] as string | undefined
      return {
        status: 'approved',
        amountCents,
        transactionId: paymentId ?? checkoutId,
        authCode: paymentId,
        message: 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: checkoutId,
      message: `Square checkout ${status ?? 'unknown'}`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    if (amountCents == null) {
      return { status: 'error', message: 'Square refunds require an amount (payment id + amount_money)' }
    }
    const res = await this.http('POST', `${this.baseUrl}/v2/refunds`, this.headers(), {
      idempotency_key: randomUUID(),
      payment_id: transactionId,
      amount_money: { amount: amountCents, currency: 'USD' }
    })
    if (!res.ok) return { status: 'declined', message: this.messageFrom(res) }
    return { status: 'approved', refundId: (res.body as any)?.refund?.id, message: 'Refund submitted' }
  }

  async void(transactionId: string): Promise<VoidResult> {
    // Only a still-pending Terminal Checkout can be canceled; settled payments must be refunded.
    const res = await this.http(
      'POST',
      `${this.baseUrl}/v2/terminals/checkouts/${transactionId}/cancel`,
      this.headers()
    )
    if (!res.ok) {
      return { status: 'error', message: `${this.messageFrom(res)} (settled payments must be refunded)` }
    }
    return { status: 'approved', message: 'Checkout canceled' }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    if (!this.token || !this.deviceId) {
      return { connected: false, provider: this.name, message: 'Not configured' }
    }
    const res = await this.http('GET', `${this.baseUrl}/v2/devices/${this.deviceId}`, this.headers())
    return {
      connected: res.ok,
      provider: this.name,
      label: (res.body as any)?.device?.attributes?.name ?? this.deviceId,
      message: res.ok ? 'Device reachable' : this.messageFrom(res)
    }
  }

  private async pollCheckout(id: string, attempts = 30, delayMs = 1000): ReturnType<HttpTransport> {
    let res = await this.http('GET', `${this.baseUrl}/v2/terminals/checkouts/${id}`, this.headers())
    for (let i = 0; i < attempts; i++) {
      const status = (res.body as any)?.checkout?.status as string | undefined
      if (status && status !== 'PENDING' && status !== 'IN_PROGRESS') return res
      await new Promise((r) => setTimeout(r, delayMs))
      res = await this.http('GET', `${this.baseUrl}/v2/terminals/checkouts/${id}`, this.headers())
    }
    return res
  }

  private errorFrom(res: { body: unknown }, amountCents: number): ChargeResult {
    return { status: 'error', amountCents, message: this.messageFrom(res) }
  }

  private messageFrom(res: { body: unknown }): string {
    const errs = (res.body as any)?.errors
    if (Array.isArray(errs) && errs[0]?.detail) return errs[0].detail
    return 'Square API error'
  }
}
