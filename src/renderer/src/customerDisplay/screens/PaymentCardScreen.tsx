import React from 'react'
import { PaymentLayout } from './PaymentLayout'

/**
 * Spec §4.2. The total passed in is CheckoutScreen's `effectiveTotal`, which is
 * surcharge-inclusive — i.e. exactly the amount sent to the terminal, so a
 * customer comparing this screen against the terminal sees the same number.
 */
export function PaymentCardScreen({ totalCents }: { totalCents: number }): React.JSX.Element {
  return (
    <PaymentLayout totalCents={totalCents}>
      <div style={{ fontSize: '4vw', fontWeight: 600 }}>Please Tap, Insert, or Swipe Your Card</div>
      <div style={{ fontSize: '2.2vw', color: 'var(--muted-foreground)' }}>
        (Follow instructions on the payment terminal)
      </div>
    </PaymentLayout>
  )
}
