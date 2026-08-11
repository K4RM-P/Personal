import React from 'react'
import { PaymentLayout } from './PaymentLayout'
import { useFitText } from '../useFitText'

/**
 * Spec §4.2. The total passed in is CheckoutScreen's `effectiveTotal`, which is
 * surcharge-inclusive — i.e. exactly the amount sent to the terminal, so a
 * customer comparing this screen against the terminal sees the same number.
 */
export function PaymentCardScreen({ totalCents }: { totalCents: number }): React.JSX.Element {
  const headlineRef = React.useRef<HTMLDivElement>(null)
  const headlineText = 'Please Tap, Insert, or Swipe Your Card'
  const headlineFontSize = useFitText(headlineText, headlineRef, {
    maxPx: 90,
    minPx: 26,
    maxLines: 2
  })

  const subtextRef = React.useRef<HTMLDivElement>(null)
  const subtext = '(Follow instructions on the payment terminal)'
  const subtextFontSize = useFitText(subtext, subtextRef, { maxPx: 48, minPx: 18, maxLines: 2 })

  return (
    <PaymentLayout totalCents={totalCents}>
      <div
        ref={headlineRef}
        style={{
          width: '100%',
          maxHeight: '16vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            fontSize: headlineFontSize,
            fontWeight: 600,
            lineHeight: 1.15,
            maxWidth: '100%',
            overflowWrap: 'break-word'
          }}
        >
          {headlineText}
        </div>
      </div>
      <div
        ref={subtextRef}
        style={{
          width: '100%',
          maxHeight: '10vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            fontSize: subtextFontSize,
            lineHeight: 1.15,
            color: 'var(--muted-foreground)',
            maxWidth: '100%',
            overflowWrap: 'break-word'
          }}
        >
          {subtext}
        </div>
      </div>
    </PaymentLayout>
  )
}
