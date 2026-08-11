import React from 'react'
import { formatCurrency } from '../../../../shared/formatCurrency'
import { useFitText } from '../useFitText'

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
  const totalRef = React.useRef<HTMLDivElement>(null)
  const totalText = `Total: ${formatCurrency(totalCents)}`
  const totalFontSize = useFitText(totalText, totalRef, { maxPx: 130, minPx: 40, maxLines: 1 })

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
      <div
        ref={totalRef}
        style={{
          width: '100%',
          maxHeight: '22vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            fontSize: totalFontSize,
            fontWeight: 700,
            lineHeight: 1.15,
            color: 'var(--primary)',
            maxWidth: '100%',
            wordBreak: 'break-word'
          }}
        >
          Total:{' '}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalCents)}</span>
        </div>
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
  const lineRef = React.useRef<HTMLDivElement>(null)
  const lineText = `${label}: ${value}`
  const fontSize = useFitText(lineText, lineRef, {
    maxPx: emphasis ? 90 : 70,
    minPx: 26,
    maxLines: 2
  })

  return (
    <div
      ref={lineRef}
      style={{
        width: '100%',
        maxHeight: emphasis ? '16vh' : '12vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          fontSize,
          fontWeight: emphasis ? 700 : 500,
          lineHeight: 1.15,
          color: emphasis ? 'var(--foreground)' : 'var(--muted-foreground)',
          maxWidth: '100%',
          wordBreak: 'break-word'
        }}
      >
        {label}: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
    </div>
  )
}
