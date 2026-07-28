import type StripeSdk from 'stripe'
import type {
  PaymentConfig,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus
} from '../../../shared/types'
import type { PaymentProvider } from '../PaymentProvider'

/**
 * Stripe Terminal (cloud-SDK category).
 *
 * Server-driven integration: we create a card_present PaymentIntent, hand it to
 * a paired reader to collect the card, and poll the intent to its result. In
 * sandbox with a simulated reader we auto-present a test card so the flow can be
 * driven end-to-end without physical hardware.
 *
 * The `stripe` SDK is imported lazily so the app builds/loads even when a
 * pharmacy never selects Stripe.
 */
export class StripeTerminalAdapter implements PaymentProvider {
  readonly name = 'stripe' as const
  readonly interactionMode = 'automatic' as const

  private stripe: StripeSdk | null = null
  private readerId: string | null = null
  private environment: PaymentConfig['environment'] = 'sandbox'

  async init(config: PaymentConfig): Promise<void> {
    if (!config.apiKey) throw new Error('Stripe requires a secret API key (sk_test_… / sk_live_…)')
    const mod = await import('stripe')
    const Stripe = mod.default
    this.stripe = new Stripe(config.apiKey)
    this.environment = config.environment
    this.readerId = config.terminalId?.trim() || null

    // No reader configured → auto-discover one (a simulated reader in test mode).
    if (!this.readerId) {
      const readers = await this.stripe.terminal.readers.list({ limit: 1 })
      this.readerId = readers.data[0]?.id ?? null
    }
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    const stripe = this.requireStripe()
    const reader = this.requireReader()

    let intent: StripeSdk.PaymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { orderRef }
    })

    await stripe.terminal.readers.processPaymentIntent(reader, { payment_intent: intent.id })

    // In sandbox the simulated reader needs an explicit card presentation (test helper).
    if (this.environment === 'sandbox') {
      try {
        await stripe.testHelpers.terminal.readers.presentPaymentMethod(reader)
      } catch {
        // If the reader is real hardware in a test account, presentation is physical.
      }
    }

    intent = await this.pollIntent(intent.id)
    const status = intent.status

    if (status === 'succeeded' || status === 'requires_capture') {
      const cardPresent = this.extractCardPresent(intent)
      return {
        status: 'approved',
        amountCents,
        transactionId: intent.id,
        cardLast4: cardPresent?.last4 ?? undefined,
        authCode: this.latestChargeId(intent) ?? undefined,
        message: 'Approved'
      }
    }

    return {
      status: 'declined',
      amountCents,
      transactionId: intent.id,
      message: intent.last_payment_error?.message ?? `Not approved (status: ${status})`
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    const stripe = this.requireStripe()
    const refund = await stripe.refunds.create({
      payment_intent: transactionId,
      ...(amountCents != null ? { amount: amountCents } : {})
    })
    return {
      status: refund.status === 'failed' ? 'declined' : 'approved',
      refundId: refund.id,
      message: refund.status ?? undefined
    }
  }

  async void(transactionId: string): Promise<VoidResult> {
    const stripe = this.requireStripe()
    const intent = await stripe.paymentIntents.cancel(transactionId)
    return {
      status: intent.status === 'canceled' ? 'approved' : 'error',
      message: `PaymentIntent ${intent.status}`
    }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    const stripe = this.stripe
    if (!stripe || !this.readerId) {
      return { connected: false, provider: this.name, message: 'Not initialized / no reader paired' }
    }
    const reader = (await stripe.terminal.readers.retrieve(this.readerId)) as StripeSdk.Terminal.Reader
    return {
      connected: reader.status === 'online',
      provider: this.name,
      label: reader.label ?? reader.id,
      message: `Reader ${reader.status}`
    }
  }

  // --- helpers -----------------------------------------------------------

  private async pollIntent(id: string, attempts = 15, delayMs = 400): Promise<StripeSdk.PaymentIntent> {
    const stripe = this.requireStripe()
    let intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] })
    for (let i = 0; i < attempts; i++) {
      if (intent.status !== 'processing' && intent.status !== 'requires_action') return intent
      await new Promise((r) => setTimeout(r, delayMs))
      intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] })
    }
    return intent
  }

  private extractCardPresent(
    intent: StripeSdk.PaymentIntent
  ): { last4: string | null } | undefined {
    const charge = intent.latest_charge
    if (!charge || typeof charge === 'string') return undefined
    const details = charge.payment_method_details?.card_present
    return details ? { last4: details.last4 ?? null } : undefined
  }

  private latestChargeId(intent: StripeSdk.PaymentIntent): string | null {
    const charge = intent.latest_charge
    if (!charge) return null
    return typeof charge === 'string' ? charge : charge.id
  }

  private requireStripe(): StripeSdk {
    if (!this.stripe) throw new Error('StripeTerminalAdapter.init() must run before use')
    return this.stripe
  }

  private requireReader(): string {
    if (!this.readerId) {
      throw new Error('No Stripe reader configured. Set a reader id in Settings → Payments.')
    }
    return this.readerId
  }
}
