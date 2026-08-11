import React from 'react'
import { formatCurrency } from '../../../../shared/formatCurrency'
import type { CustomerDisplayState } from '../../../../shared/customerDisplay'
import { PaymentLayout, PaymentLine } from './PaymentLayout'

type CashState = Extract<CustomerDisplayState, { mode: 'payment-cash' }>

/** Spec §4.1 — live cash given and change (or the deposit-to-credit variant). */
export function PaymentCashScreen({ state }: { state: CashState }): React.JSX.Element {
  const depositing = state.depositedToCreditCents !== undefined && state.depositedToCreditCents > 0
  return (
    <PaymentLayout totalCents={state.totalCents}>
      <PaymentLine label="Cash Given" value={formatCurrency(state.cashGivenCents)} />
      {depositing ? (
        <PaymentLine
          label="Deposited to Pharmacy Credit"
          value={formatCurrency(state.depositedToCreditCents ?? 0)}
          emphasis
        />
      ) : (
        <PaymentLine label="Change" value={formatCurrency(state.changeCents)} emphasis />
      )}
    </PaymentLayout>
  )
}
