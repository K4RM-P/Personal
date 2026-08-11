import React from 'react'
import { useFitText } from '../useFitText'

/** Spec §5.2 — same visual weight as a slideshow slide. */
export function ThankYouScreen({ pharmacyName }: { pharmacyName: string }): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const text = pharmacyName ? `Thank you for choosing ${pharmacyName}!` : 'Thank you!'
  const fontSize = useFitText(text, containerRef, { maxPx: 220, minPx: 32, maxLines: 2 })

  return (
    <div
      ref={containerRef}
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8vh 8vw',
        boxSizing: 'border-box',
        background: 'var(--background)',
        color: 'var(--primary)',
        textAlign: 'center',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          fontSize,
          fontWeight: 700,
          lineHeight: 1.15,
          maxWidth: '100%',
          wordBreak: 'break-word',
          animation: 'cd-fade-in 400ms ease'
        }}
      >
        {text}
      </div>
    </div>
  )
}
