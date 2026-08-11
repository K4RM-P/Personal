import React from 'react'
import { formatCurrency } from '../../../../shared/formatCurrency'
import type { CustomerDisplayState } from '../../../../shared/customerDisplay'
import { useFitText } from '../useFitText'

type CartState = Extract<CustomerDisplayState, { mode: 'cart' }>

/**
 * Cart mirror (spec §3). Line items scroll; subtotal/discount/tax/total sit in a
 * flex footer that never scrolls away, so the total is always on screen.
 */
export function CartScreen({ state }: { state: CartState }): React.JSX.Element {
  const listRef = React.useRef<HTMLDivElement>(null)
  const itemCount = state.lineItems.length
  const totalRef = React.useRef<HTMLDivElement>(null)
  const totalText = `Total: ${formatCurrency(state.totalCents)}`
  const totalFontSize = useFitText(totalText, totalRef, { maxPx: 90, minPx: 28, maxLines: 1 })

  // Keep the most recently added item in view (spec §3.3).
  React.useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [itemCount])

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        background: 'var(--background)',
        color: 'var(--foreground)',
        padding: '3vh 4vw'
      }}
    >
      <div
        ref={listRef}
        style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0, fontSize: '2.2vw' }}
      >
        {state.lineItems.map((item, index) => {
          const originalCents = item.lineTotalCents + (item.discountCents ?? 0)
          return (
            <div
              key={`${item.name}:${index}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '2vw',
                padding: '1.2vh 0',
                borderBottom: '1px solid var(--border)'
              }}
            >
              <span style={{ flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' }}>
                {item.name}
                {item.qty > 1 ? ` (${item.qty})` : ''}
              </span>
              <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {item.discountCents ? (
                  <>
                    <span
                      style={{
                        textDecoration: 'line-through',
                        color: 'var(--muted-foreground)',
                        marginRight: '0.6vw'
                      }}
                    >
                      {formatCurrency(originalCents)}
                    </span>
                    {formatCurrency(item.lineTotalCents)}
                  </>
                ) : (
                  formatCurrency(item.lineTotalCents)
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div
        style={{
          flex: '0 0 auto',
          borderTop: '2px solid var(--border)',
          paddingTop: '2vh',
          marginTop: '1vh',
          fontSize: '2vw'
        }}
      >
        <FooterRow label="Subtotal" value={formatCurrency(state.subtotalCents)} />
        {state.billDiscountCents ? (
          <FooterRow
            label="Discount"
            value={`-${formatCurrency(state.billDiscountCents)}`}
            color="var(--primary)"
          />
        ) : null}
        <FooterRow label="Tax" value={formatCurrency(state.taxCents)} />
        <div
          ref={totalRef}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            marginTop: '1.5vh',
            maxHeight: '12vh',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              fontSize: totalFontSize,
              fontWeight: 700,
              lineHeight: 1.15,
              color: 'var(--primary)'
            }}
          >
            <span>Total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrency(state.totalCents)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function FooterRow({
  label,
  value,
  color
}: {
  label: string
  value: string
  color?: string
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0.4vh 0',
        color: color ?? 'var(--muted-foreground)'
      }}
    >
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
