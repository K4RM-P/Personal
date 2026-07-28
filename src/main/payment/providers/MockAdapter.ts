import type {
  PaymentConfig,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus
} from '../../../shared/types'
import type { PaymentProvider } from '../PaymentProvider'

/**
 * A fully offline provider used as the default and for tests/demos. It exercises
 * the entire PaymentProvider → IPC → checkout path without any network, SDK, or
 * credentials, so approved/declined handling can be verified end-to-end.
 *
 * Behaviour is deterministic so the outcome can be triggered on demand:
 *   - an amount whose cents portion is `.01` is DECLINED
 *   - every other amount is APPROVED (test card `4242`)
 */
export class MockAdapter implements PaymentProvider {
  readonly name = 'mock' as const
  readonly interactionMode = 'automatic' as const
  private ready = false

  async init(_config: PaymentConfig): Promise<void> {
    this.ready = true
  }

  async charge(amountCents: number, orderRef: string): Promise<ChargeResult> {
    this.ensureReady()
    if (amountCents <= 0) {
      return { status: 'error', amountCents, message: 'Amount must be greater than zero' }
    }

    // `.01` amounts simulate a decline so both paths are testable from the till.
    if (amountCents % 100 === 1) {
      return {
        status: 'declined',
        amountCents,
        transactionId: `mock_${orderRef}_${Date.now()}`,
        message: 'Card declined (simulated: amount ends in .01)'
      }
    }

    return {
      status: 'approved',
      amountCents,
      transactionId: `mock_${orderRef}_${Date.now()}`,
      cardLast4: '4242',
      authCode: `AUTH${String(amountCents).padStart(6, '0')}`,
      message: 'Approved (simulated)'
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    this.ensureReady()
    return {
      status: 'approved',
      refundId: `mockref_${transactionId}_${Date.now()}`,
      message:
        amountCents != null
          ? `Refunded ${amountCents} cents (simulated)`
          : 'Full refund (simulated)'
    }
  }

  async void(transactionId: string): Promise<VoidResult> {
    this.ensureReady()
    return { status: 'approved', message: `Voided ${transactionId} (simulated)` }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    return {
      connected: this.ready,
      batteryLevel: 100,
      label: 'Simulated Reader',
      provider: this.name,
      message: this.ready ? 'Ready' : 'Not initialized'
    }
  }

  private ensureReady(): void {
    if (!this.ready) throw new Error('MockAdapter.init() must be called before use')
  }
}
