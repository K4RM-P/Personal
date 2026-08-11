import React from 'react'
import { useFitText } from '../useFitText'
import type { CustomerDisplaySlideDTO } from '../../../../shared/customerDisplay'

interface IdleScreenProps {
  slides: CustomerDisplaySlideDTO[]
  pharmacyName: string
  durationSeconds: number
}

/**
 * Idle/slideshow state (spec §2). Digital-signage scale: the slide text is the
 * dominant element on the screen, sized by measure-and-shrink at render time.
 */
export function IdleScreen({
  slides,
  pharmacyName,
  durationSeconds
}: IdleScreenProps): React.JSX.Element {
  // Never render blank: with zero slides configured, the pharmacy name is the
  // single fallback slide (spec §2.2).
  const effectiveSlides = React.useMemo<CustomerDisplaySlideDTO[]>(
    () =>
      slides.length > 0 ? slides : [{ id: -1, text: pharmacyName || 'Welcome', sortOrder: 0 }],
    [slides, pharmacyName]
  )

  const containerRef = React.useRef<HTMLDivElement>(null)
  const slidesRef = React.useRef(effectiveSlides)
  const indexRef = React.useRef(0)

  // The slide currently on screen is a snapshot, not a live lookup: editing a
  // slide while it is showing must not yank the text mid-display — the change
  // lands on the next rotation (spec §10).
  const [current, setCurrent] = React.useState<CustomerDisplaySlideDTO>(effectiveSlides[0])

  React.useEffect(() => {
    slidesRef.current = effectiveSlides
    if (indexRef.current >= effectiveSlides.length) indexRef.current = 0
    setCurrent((prev) => prev ?? effectiveSlides[indexRef.current])
  }, [effectiveSlides])

  React.useEffect(() => {
    const periodMs = Math.max(1, durationSeconds || 8) * 1000
    const timer = setInterval(() => {
      const list = slidesRef.current
      if (list.length === 0) return
      indexRef.current = (indexRef.current + 1) % list.length
      setCurrent(list[indexRef.current])
    }, periodMs)
    return () => clearInterval(timer)
  }, [durationSeconds])

  const text = current?.text ?? pharmacyName
  const fontSize = useFitText(text, containerRef)

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
        key={`${current?.id ?? 'fallback'}:${text}`}
        style={{
          fontSize,
          fontWeight: 700,
          lineHeight: 1.15,
          maxWidth: '100%',
          animation: 'cd-fade-in 400ms ease'
        }}
      >
        {text}
      </div>
    </div>
  )
}
