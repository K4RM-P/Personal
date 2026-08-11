import type {
  CustomerDisplayLineItem,
  CustomerDisplayState
} from '../../../shared/customerDisplay'

export type CheckoutPaymentMethod = 'CASH' | 'E_TRANSFER' | 'CARD' | 'PHARMACY_CREDIT' | null

export interface CheckoutDisplayInput {
  /** True once a sale has completed and the receipt popup is up. */
  saleCompleted: boolean
  pharmacyName: string
  /** The pharmacy's own receiving e-transfer address (never the customer's). */
  pharmacyEmail: string
  paymentMethod: CheckoutPaymentMethod
  /** The PAY popup is open — payment screens only show while the cashier is in it. */
  payModalOpen: boolean
  lineItems: CustomerDisplayLineItem[]
  subtotalCents: number
  billDiscountCents: number
  taxCents: number
  /**
   * `effectiveTotal` from CheckoutScreen: pre-tax + tax + surcharge. Already
   * surcharge-inclusive, i.e. exactly the amount the card terminal is charged
   * (spec §4.2 / non-negotiable: this must never be a pre-surcharge number).
   */
  totalCents: number
  tenderedCents: number
  changeCents: number
  /** Attached customer's pharmacy-credit balance; positive = credit, negative = owed. */
  customerBalanceCents: number
}

/**
 * Derives the read-only customer-facing display state from checkout state.
 * Pure so it can be unit-tested without a renderer; the precedence order below
 * is what implements the spec's state transitions (§3.1, §4, §5).
 */
export function buildCustomerDisplayState(input: CheckoutDisplayInput): CustomerDisplayState {
  // A completed sale wins over everything: §5.1 fires the moment the receipt
  // popup would appear on the cashier's screen.
  if (input.saleCompleted) {
    return { mode: 'thank-you', pharmacyName: input.pharmacyName }
  }

  if (input.payModalOpen && input.paymentMethod && input.lineItems.length > 0) {
    switch (input.paymentMethod) {
      case 'CASH':
        return {
          mode: 'payment-cash',
          totalCents: input.totalCents,
          cashGivenCents: input.tenderedCents,
          changeCents: input.changeCents
        }
      case 'CARD':
        return { mode: 'payment-card', totalCents: input.totalCents }
      case 'E_TRANSFER':
        return {
          mode: 'payment-etransfer',
          totalCents: input.totalCents,
          pharmacyEmail: input.pharmacyEmail
        }
      case 'PHARMACY_CREDIT':
        return {
          mode: 'payment-tab',
          totalCents: input.totalCents,
          chargedToTabCents: input.totalCents,
          balanceAfterCents: input.customerBalanceCents - input.totalCents
        }
    }
  }

  // Cart empty (never started, all items removed, voided, or parked) → Idle (§10).
  if (input.lineItems.length === 0) return { mode: 'idle' }

  return {
    mode: 'cart',
    lineItems: input.lineItems,
    subtotalCents: input.subtotalCents,
    billDiscountCents: input.billDiscountCents > 0 ? input.billDiscountCents : undefined,
    taxCents: input.taxCents,
    totalCents: input.totalCents
  }
}
