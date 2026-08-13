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
 * Moneris Go Cloud Integration.
 *
 * Confirmed against the real Moneris Go developer docs (developer.moneris.com/moneris-go/docs/*):
 *  - base URLs: cloud-integration.md
 *  - action strings "purchase" / "independentRefund" / "void": purchase-api.md,
 *    card-present-refund-api.md, void-api.md
 *  - totalAmount is cents-as-a-string, e.g. "$10.50 must be sent as '1050'": message-field-data-description.md
 *  - responseCode < 050 = approved, >= 050 = declined, null = incomplete: message-field-data-description.md
 *  - idempotencyKey retry semantics (same action+amount+key on retry returns the original result
 *    rather than double-processing): idempotent-request.md
 *  - Independent Refund's request has no field referencing the original transaction — it is a
 *    standalone card-present refund, not a linked reversal: card-present-refund-api.md
 *
 * Two things are NOT confirmed by any fetched example and are called out inline where they matter:
 *  1. Exact placement of storeId/apiToken. cloud-integration.md states they're "included in the POST
 *     request payload" but no sample request in purchase-api.md/void-api.md/etc. shows them (likely
 *     redacted from the docs). They're placed inside `data.request[0]` here, next to terminalId — the
 *     only place any per-call field appears in every confirmed sample. If a live sandbox call shows
 *     otherwise, it's a one-line move in `envelope()`.
 *  2. Async delivery. cloud-integration.md says a transaction can complete asynchronously via a
 *     receiptUrl/postback instead of in the initial HTTP response, but no field name for that
 *     poll/receipt URL is documented anywhere fetchable. Every purchase/void/refund/getDeviceInfo
 *     sample in the docs shows `"completed": "true"` directly in the response, so this adapter
 *     handles that synchronous case and returns a clear "pending" error otherwise, rather than
 *     guessing a polling field name. Confirm the receiptUrl field name with a live sandbox
 *     transaction before relying on this for slow/async terminals.
 *
 * `apiKey` is stored as "<store_id>:<api_token>:<ist_config_code>". `istConfigCode` has no
 * public self-service source — it's issued by a Moneris Client Consultant per store.
 */
export class MonerisAdapter implements PaymentProvider {
  readonly name = 'moneris' as const
  readonly interactionMode = 'automatic' as const

  private storeId = ''
  private apiToken = ''
  private istConfigCode = ''
  private terminalId: string | null = null
  private baseUrl = ''

  constructor(private readonly http: HttpTransport = fetchTransport) {}

  async init(config: PaymentConfig): Promise<void> {
    if (!config.apiKey) {
      throw new Error('Moneris requires credentials as "<store_id>:<api_token>:<ist_config_code>"')
    }
    const [storeId, apiToken, istConfigCode] = config.apiKey.split(':')
    if (!storeId || !apiToken || !istConfigCode) {
      throw new Error(
        'Moneris apiKey must be "<store_id>:<api_token>:<ist_config_code>" — ist_config_code is ' +
          'issued by your Moneris Client Consultant, it is not the same as the API token'
      )
    }
    this.storeId = storeId
    this.apiToken = apiToken
    this.istConfigCode = istConfigCode
    this.terminalId = config.terminalId?.trim() || null
    // Confirmed: developer.moneris.com/moneris-go/docs/cloud-integration.md
    this.baseUrl =
      config.environment === 'production'
        ? 'https://ippos.moneris.com/v3/terminal'
        : 'https://ippostest.moneris.com/v3/terminal'
  }

  private envelope(action: string, requestFields: Record<string, unknown>): Record<string, unknown> {
    return {
      apiVersion: '3.0',
      istConfigCode: this.istConfigCode,
      dataId: `${action}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      dataTimestamp: this.timestamp(),
      data: {
        request: [
          {
            storeId: this.storeId,
            apiToken: this.apiToken,
            terminalId: this.terminalId,
            action,
            ...requestFields
          }
        ]
      }
    }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    if (!this.terminalId) {
      return { status: 'error', amountCents, message: 'No Moneris terminal id configured' }
    }
    const res = await this.http(
      'POST',
      this.baseUrl,
      {},
      this.envelope('purchase', {
        orderId: orderRef,
        // Reused verbatim on retry of the same logical charge (same orderRef) so Moneris's own
        // idempotency handling (idempotent-request.md) returns the original result instead of
        // double-processing a retried request.
        idempotencyKey: `purchase-${orderRef}`,
        totalAmount: this.cents(amountCents)
      })
    )
    if (!res.ok) return { status: 'error', amountCents, message: this.messageFrom(res) }

    const entry = this.entryFrom(res)
    if (!entry) return { status: 'error', amountCents, message: 'No response entry from Moneris' }
    if (entry.completed !== 'true') {
      return {
        status: 'error',
        amountCents,
        message:
          'Moneris returned a pending (not yet completed) response — this adapter does not poll ' +
          'for async completion since the receiptUrl field name is unconfirmed; check the terminal ' +
          'directly before retrying'
      }
    }

    const approved = this.isApproved(entry.responseCode)
    if (approved) {
      return {
        status: 'approved',
        amountCents,
        // realTimeUniqueId is what Independent Refund needs later (Moneris Go Integration Guide
        // §9.6), so it — not transactionId — is threaded forward as ChargeResult.transactionId.
        transactionId: String(entry.realTimeUniqueId ?? entry.transactionId ?? orderRef),
        cardLast4: this.last4(entry.maskedPan),
        authCode: entry.authCode,
        message: entry.status ?? 'Approved'
      }
    }
    return {
      status: 'declined',
      amountCents,
      transactionId: entry.realTimeUniqueId ? String(entry.realTimeUniqueId) : undefined,
      message: entry.status ?? `Declined (code ${entry.responseCode})`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    // Independent Refund is not linked to the original transaction (see class doc), so there is no
    // "refund the original amount" fallback — an explicit amount is required.
    if (amountCents == null) {
      return {
        status: 'declined',
        message:
          'Moneris independent refunds are not linked to the original transaction and require an explicit amount'
      }
    }
    const orderId = `refund-${transactionId}-${Date.now()}`
    const res = await this.http(
      'POST',
      this.baseUrl,
      {},
      this.envelope('independentRefund', {
        orderId,
        idempotencyKey: orderId,
        totalAmount: this.cents(amountCents)
      })
    )
    if (!res.ok) return { status: 'declined', message: this.messageFrom(res) }
    const entry = this.entryFrom(res)
    if (!entry || entry.completed !== 'true') {
      return { status: 'declined', message: 'Moneris refund did not complete synchronously' }
    }
    if (!this.isApproved(entry.responseCode)) {
      return { status: 'declined', message: entry.status ?? `Declined (code ${entry.responseCode})` }
    }
    return {
      status: 'approved',
      refundId: String(entry.realTimeUniqueId ?? entry.transactionId ?? orderId),
      message: entry.status ?? 'Refunded'
    }
  }

  async void(transactionId: string): Promise<VoidResult> {
    const orderId = `void-${transactionId}-${Date.now()}`
    const res = await this.http(
      'POST',
      this.baseUrl,
      {},
      this.envelope('void', {
        orderId,
        transactionId,
        idempotencyKey: orderId
      })
    )
    if (!res.ok) return { status: 'error', message: this.messageFrom(res) }
    const entry = this.entryFrom(res)
    if (!entry || entry.completed !== 'true' || !this.isApproved(entry.responseCode)) {
      return { status: 'error', message: entry?.status ?? this.messageFrom(res) }
    }
    return { status: 'approved', message: entry.status ?? 'Voided' }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    if (!this.storeId || !this.terminalId) {
      return { connected: false, provider: this.name, message: 'Not configured' }
    }
    // Action string confirmed (get-device-info-api.md). Moneris does not document a dedicated
    // online/offline flag on this response, so "the terminal answered at all" is the strongest
    // reachability signal available from this call.
    const res = await this.http(
      'POST',
      this.baseUrl,
      {},
      this.envelope('getDeviceInfo', { idempotencyKey: `status-${Date.now()}` })
    )
    const entry = this.entryFrom(res)
    const reachable = res.ok && entry?.completed === 'true'
    return {
      connected: reachable,
      provider: this.name,
      label: `Moneris terminal ${this.terminalId}`,
      message: res.ok ? (reachable ? 'Terminal reachable' : 'No response from terminal') : this.messageFrom(res)
    }
  }

  private entryFrom(res: { body: unknown }): Record<string, any> | null {
    const arr = (res.body as any)?.data?.response
    return Array.isArray(arr) ? arr[0] : null
  }

  private isApproved(responseCode: unknown): boolean {
    if (responseCode == null) return false
    return Number(responseCode) < 50
  }

  private last4(maskedPan: unknown): string | undefined {
    const s = typeof maskedPan === 'string' ? maskedPan : undefined
    return s ? s.slice(-4) : undefined
  }

  private cents(amountCents: number): string {
    return String(Math.round(amountCents))
  }

  private timestamp(): string {
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  private messageFrom(res: { body: unknown }): string {
    const entry = this.entryFrom(res)
    return entry?.status ?? (res.body as any)?.status ?? (res.body as any)?.error ?? 'Moneris API error'
  }
}
