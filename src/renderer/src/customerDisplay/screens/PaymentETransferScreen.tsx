import React from 'react'
import { PaymentLayout } from './PaymentLayout'
import { useFitText } from '../useFitText'

/**
 * Spec §4.3 — always the pharmacy's own receiving address (the address the
 * customer must send to), never the customer email the cashier keyed in.
 */
export function PaymentETransferScreen({
  totalCents,
  pharmacyEmail
}: {
  totalCents: number
  pharmacyEmail: string
}): React.JSX.Element {
  const headlineRef = React.useRef<HTMLDivElement>(null)
  const headlineText = 'Please send an E-Transfer to:'
  const headlineFontSize = useFitText(headlineText, headlineRef, {
    maxPx: 70,
    minPx: 22,
    maxLines: 2
  })

  const emailRef = React.useRef<HTMLDivElement>(null)
  const emailText = pharmacyEmail || 'Ask the cashier for the e-transfer address'
  const emailFontSize = useFitText(emailText, emailRef, { maxPx: 90, minPx: 20, maxLines: 3 })

  return (
    <PaymentLayout totalCents={totalCents}>
      <div
        ref={headlineRef}
        style={{
          width: '100%',
          maxHeight: '12vh',
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
        ref={emailRef}
        style={{
          width: '100%',
          maxHeight: '20vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            fontSize: emailFontSize,
            fontWeight: 700,
            lineHeight: 1.15,
            color: 'var(--primary)',
            wordBreak: 'break-all',
            maxWidth: '90vw'
          }}
        >
          {emailText}
        </div>
      </div>
    </PaymentLayout>
  )
}
