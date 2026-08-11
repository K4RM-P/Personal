import React from 'react'
import { formatCurrency } from '../../../../shared/formatCurrency'

/**
 * Shared frame for the four payment states (spec §4): the total always stays on
 * screen so the customer never has to wonder which number is being discussed.
 */
export function PaymentLayout({
  totalCents,
  children
}: {
  totalCents: number
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4vh',
        padding: '6vh 6vw',
        boxSizing: 'border-box',
        background: 'var(--background)',
        color: 'var(--foreground)',
        textAlign: 'center'
      }}
    >
      <div style={{ fontSize: '6vw', fontWeight: 700, color: 'var(--primary)' }}>
        Total:{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalCents)}</span>
      </div>
      {children}
    </div>
  )
}

export function PaymentLine({
  label,
  value,
  emphasis
}: {
  label: string
  value: string
  emphasis?: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: emphasis ? '4.5vw' : '3.5vw',
        fontWeight: emphasis ? 700 : 500,
        color: emphasis ? 'var(--foreground)' : 'var(--muted-foreground)'
      }}
    >
      {label}: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
