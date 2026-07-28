import type {
  PaymentConfig,
  ChargeOptions,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus
} from '../../../shared/types'
import type { PaymentProvider } from '../PaymentProvider'

/**
 * Manual / External Terminal.
 *
 * For the enormous number of pharmacies running a standalone "dumb" card
 * terminal that has no connection to the POS at all: the cashier keys the total
 * into that terminal separately, then records the outcome here. This adapter
 * therefore talks to no hardware and holds no credentials — it simply captures
 * the human-observed result so the sale ledger stays truthful.
 *
 * This is a deliberate, first-class mode, NOT a degraded fallback: `charge()`
 * expects the observed `manualOutcome` (and optionally a `manualReference` the
 * cashier copied from the terminal's paper receipt) to be supplied by checkout.
 */
export class ManualTerminalAdapter implements PaymentProvider {
  readonly name = 'manual' as const
  readonly interactionMode = 'manual' as const

  async init(_config: PaymentConfig): Promise<void> {
    // Nothing to connect to — the terminal is entirely external.
  }

  async charge(amountCents: number, orderRef: string, options?: ChargeOptions): Promise<ChargeResult> {
    if (amountCents <= 0) {
      return { status: 'error', amountCents, message: 'Amount must be greater than zero' }
    }

    const outcome = options?.manualOutcome
    if (!outcome) {
      // Defensive: checkout should always pass the cashier's decision in manual mode.
      return {
        status: 'error',
        amountCents,
        message: 'Manual terminal requires the cashier to confirm Approved or Declined'
      }
    }

    const reference = options?.manualReference?.trim() || undefined

    if (outcome === 'declined') {
      return {
        status: 'declined',
        amountCents,
        transactionId: reference,
        message: reference
          ? `Declined on external terminal (ref ${reference})`
          : 'Declined on external terminal'
      }
    }

    return {
      status: 'approved',
      amountCents,
      // No auto-captured processor id; the cashier's reference is the only trace.
      transactionId: reference ?? `MANUAL-${orderRef}`,
      authCode: reference,
      message: reference
        ? `Approved on external terminal (ref ${reference})`
        : 'Approved on external terminal'
    }
  }

  async refund(transactionId: string, amountCents?: number): Promise<RefundResult> {
    // The refund is performed by the cashier on the external terminal; we only record it.
    return {
      status: 'approved',
      refundId: transactionId,
      message:
        amountCents != null
          ? `Process a ${amountCents}-cent refund on the external terminal, then record it`
          : 'Process the refund on the external terminal, then record it'
    }
  }

  async void(transactionId: string): Promise<VoidResult> {
    return {
      status: 'approved',
      message: `Void/cancel ${transactionId} on the external terminal, then record it`
    }
  }

  async getReaderStatus(): Promise<ReaderStatus> {
    // There is no reader to poll — report the mode clearly rather than "disconnected".
    return {
      connected: true,
      provider: this.name,
      label: 'External / standalone terminal',
      message: 'Manual mode — run the card on your standalone terminal, then confirm here'
    }
  }
}
