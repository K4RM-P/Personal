import React from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatCurrency } from '../../../../shared/formatCurrency'
import type { CustomerDisplayState } from '../../../../shared/customerDisplay'
import { PaymentLayout, PaymentLine } from './PaymentLayout'
import { useFitText } from '../useFitText'

type TabState = Extract<CustomerDisplayState, { mode: 'payment-tab' }>

/**
 * Spec §4.4. Owed vs. credit is distinguished by icon + label, not colour alone,
 * matching the colourblind-safe pattern used on the customer/ledger screens.
 */
export function PaymentTabScreen({ state }: { state: TabState }): React.JSX.Element {
  const credit = state.balanceAfterCents >= 0
  const Icon = credit ? ArrowUpRight : ArrowDownRight
  const balanceText = `Balance After: ${formatCurrency(Math.abs(state.balanceAfterCents))} ${
    credit ? 'credit' : 'owed'
  }`
  const balanceRef = React.useRef<HTMLDivElement>(null)
  const balanceFontSize = useFitText(balanceText, balanceRef, {
    maxPx: 70,
    minPx: 22,
    maxLines: 2
  })

  return (
    <PaymentLayout totalCents={state.totalCents}>
      <PaymentLine
        label="Amount Charged to Tab"
        value={formatCurrency(state.chargedToTabCents)}
        emphasis
      />
      <div
        style={{
          width: '100%',
          maxHeight: '14vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.5vw',
          overflow: 'hidden'
        }}
      >
        <Icon
          style={{ width: balanceFontSize, height: balanceFontSize, flexShrink: 0 }}
          aria-hidden="true"
        />
        <div
          ref={balanceRef}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            maxWidth: '100%',
            fontSize: balanceFontSize,
            fontWeight: 600,
            lineHeight: 1.15,
            overflowWrap: 'break-word',
            color: credit ? 'var(--success)' : 'var(--owed)'
          }}
        >
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{balanceText}</span>
        </div>
      </div>
    </PaymentLayout>
  )
}
