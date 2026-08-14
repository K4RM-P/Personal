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
 * Clover, via the REST Pay Display API (docs.clover.com/dev/docs/rest-pay-*) — the
 * device-present integration for a POS driving a physical, paired Clover terminal.
 *
 * The previous version of this adapter called `/v1/charges`, which is Clover's
 * **Ecommerce API** (tokenized, card-not-present) — a different product with no
 * device-targeting concept at all. It happened to compile and look plausible, but
 * it was never going to work against a physical paired terminal. Confirmed via
 * docs.clover.com/dev/docs/rest-pay-architecture, /making-a-sale, /refunding-a-charge,
 * and the API reference at docs.clover.com/dev/reference/pay:
 *  - Cloud base URLs: sandbox `https://apisandbox.dev.clover.com/connect`, production
 *    `https://api.clover.com/connect` (there is also a local WSS-based connection mode
 *    directly to the device, `https://<device-ip>:12346/connect` — not used here since
 *    this codebase's HttpTransport is REST-only; the cloud path is used instead).
 *  - `POST /v1/payments` with headers `X-Clover-Device-Id` (routes to the paired
 *    device), `X-POS-Id`, `Idempotency-Key`, and `Authorization: Bearer <token>`.
 *  - Response: `payment.result === 'SUCCESS'` and `payment.cardTransaction.state
 *    === 'CLOSED'` indicate approval; `cardTransaction.last4`, `.authCode`,
 *    `.cardType` are the real field names (not `source.last4`/`auth_code` from the
 *    old Ecommerce-shaped code).
 *  - Refund: `POST /v1/payments/{paymentId}/refunds`, `{ fullRefund: true }` for a
 *    full refund or `{ amount }` (cents) for partial.
 *
 * NOT confirmed: a REST void endpoint. Clover's docs only document `voidPayment()`
 * on the Java/Android Remote Pay SDK (fields: paymentId, orderId, voidReason) — no
 * REST path for it was found anywhere in the public docs. `void()` below guesses
 * `/v1/payments/{id}/void` by analogy with the confirmed refund path's resource
 * naming (`/v1/payments/{id}/...`), but this specific path is NOT verified by any
 * source and must be checked against a live sandbox call before relying on it.
 *
 * `apiKey` is the Clover REST API access token; the paired device's serial number
 * goes in `terminalId`.
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
    // Confirmed: docs.clover.com/dev/reference/pay
    this.baseUrl =
      config.environment === 'production'
        ? 'https://api.clover.com/connect'
        : 'https://apisandbox.dev.clover.com/connect'
  }

  private headers(idempotencyKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-Clover-Device-Id': this.deviceId ?? '',
      'X-POS-Id': 'vantispos',
      'Idempotency-Key': idempotencyKey
    }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    if (!this.deviceId) return { status: 'error', amountCents, message: 'No Clover device id configured' }
    const res = await this.http(
      'POST',
      `${this.baseUrl}/v1/payments`,
      // Idempotency-Key reused verbatim on retry of the same logical charge (same orderRef),
      // per the confirmed Idempotency-Key header (docs.clover.com/dev/reference/pay), so a
      // retried request doesn't create a second payment.
      this.headers(`purchase-${orderRef}`),
      { amount: amountCents, externalPaymentId: orderRef, capture: true }
    )
    const payment = (res.body as any)?.payment
    if (!res.ok) return { status: 'error', amountCents, message: this.messageFrom(res) }

    const approved = payment?.result === 'SUCCESS' && payment?.cardTransaction?.state === 'CLOSED'
    if (approved) {
      return {
        status: 'approved',
        amountCents,
        transactionId: payment?.id,
        cardLast4: payment?.cardTransaction?.last4,
        authCode: payment?.cardTransaction?.authCode,
        message: 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: payment?.id,
      message: payment?.result ? `Declined (${payment.result})` : this.messageFrom(res)
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    const res = await this.http(
      'POST',
      `${this.baseUrl}/v1/payments/${transactionId}/refunds`,
      this.headers(`refund-${transactionId}-${Date.now()}`),
      amountCents != null ? { amount: amountCents } : { fullRefund: true }
    )
    if (!res.ok) return { status: 'declined', message: this.messageFrom(res) }
    return { status: 'approved', refundId: (res.body as any)?.id, message: 'Refunded' }
  }

  async void(transactionId: string): Promise<VoidResult> {
    // UNCONFIRMED path — see class doc. Verify against a live sandbox call before trusting this.
    const res = await this.http(
      'POST',
      `${this.baseUrl}/v1/payments/${transactionId}/void`,
      this.headers(`void-${transactionId}-${Date.now()}`),
      {}
    )
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
