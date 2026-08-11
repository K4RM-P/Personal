import React from 'react'

/** Spec §5.2 — same visual weight as a slideshow slide. */
export function ThankYouScreen({ pharmacyName }: { pharmacyName: string }): React.JSX.Element {
  return (
    <div
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
        textAlign: 'center'
      }}
    >
      <div
        style={{
          fontSize: '7vw',
          fontWeight: 700,
          lineHeight: 1.15,
          animation: 'cd-fade-in 400ms ease'
        }}
      >
        {pharmacyName ? `Thank you for choosing ${pharmacyName}!` : 'Thank you!'}
      </div>
    </div>
  )
}
