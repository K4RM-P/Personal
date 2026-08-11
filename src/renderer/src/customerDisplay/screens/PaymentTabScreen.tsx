import React from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatCurrency } from '../../../../shared/formatCurrency'
import type { CustomerDisplayState } from '../../../../shared/customerDisplay'
import { PaymentLayout, PaymentLine } from './PaymentLayout'

type TabState = Extract<CustomerDisplayState, { mode: 'payment-tab' }>

/**
 * Spec §4.4. Owed vs. credit is distinguished by icon + label, not colour alone,
 * matching the colourblind-safe pattern used on the customer/ledger screens.
 */
export function PaymentTabScreen({ state }: { state: TabState }): React.JSX.Element {
  const credit = state.balanceAfterCents >= 0
  const Icon = credit ? ArrowUpRight : ArrowDownRight
  return (
    <PaymentLayout totalCents={state.totalCents}>
      <PaymentLine
        label="Amount Charged to Tab"
        value={formatCurrency(state.chargedToTabCents)}
        emphasis
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1.5vw',
          fontSize: '3.2vw',
          fontWeight: 600,
          color: credit ? 'var(--success)' : 'var(--owed)'
        }}
      >
        <Icon style={{ width: '3.2vw', height: '3.2vw', flexShrink: 0 }} aria-hidden="true" />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          Balance After: {formatCurrency(Math.abs(state.balanceAfterCents))}{' '}
          {credit ? 'credit' : 'owed'}
        </span>
      </div>
    </PaymentLayout>
  )
}
