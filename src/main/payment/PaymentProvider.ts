import type {
  PaymentConfig,
  PaymentProviderName,
  PaymentInteractionMode,
  ChargeOptions,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus
} from '../../shared/types'

/**
 * The single interface every payment processor adapter implements.
 *
 * Checkout / IPC code only ever talks to this shape — it never learns which
 * processor is actually wired up. Swapping Stripe for Moneris means writing a
 * new adapter + a registry entry, with zero changes to callers.
 */
export interface PaymentProvider {
  /** Which processor this adapter speaks to. */
  readonly name: PaymentProviderName

  /**
   * How checkout must drive this adapter. `automatic` adapters resolve the
   * result themselves; `manual` adapters expect the cashier's observed outcome
   * to be passed through `charge()`'s options.
   */
  readonly interactionMode: PaymentInteractionMode

  /** One-time setup with decrypted credentials. Called before any charge. */
  init(config: PaymentConfig): Promise<void>

  /** Take a card payment for `amountCents`, tagged with an order reference. */
  charge(amountCents: number, orderRef: string, options?: ChargeOptions): Promise<ChargeResult>

  /** Refund a prior charge in full, or partially if `amountCents` is given. */
  refund(transactionId: string, amountCents?: number): Promise<RefundResult>

  /** Cancel/void a charge before it settles. */
  void(transactionId: string): Promise<VoidResult>

  /** Report whether the paired reader/terminal is reachable. */
  getReaderStatus(): Promise<ReaderStatus>
}
