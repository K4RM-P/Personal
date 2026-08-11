import React from 'react'
import { PaymentLayout } from './PaymentLayout'

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
  return (
    <PaymentLayout totalCents={totalCents}>
      <div style={{ fontSize: '3.5vw', fontWeight: 600 }}>Please send an E-Transfer to:</div>
      <div
        style={{
          fontSize: pharmacyEmail.length > 28 ? '3vw' : '4vw',
          fontWeight: 700,
          color: 'var(--primary)',
          wordBreak: 'break-all',
          maxWidth: '90vw'
        }}
      >
        {pharmacyEmail || 'Ask the cashier for the e-transfer address'}
      </div>
    </PaymentLayout>
  )
}
