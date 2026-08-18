import React from 'react'
import { useFitText } from '../useFitText'
import {
  customerDisplayMediaUrl,
  type CustomerDisplaySlideDTO
} from '../../../../shared/customerDisplay'

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
      slides.length > 0
        ? slides
        : [
            {
              id: -1,
              type: 'TEXT',
              text: pharmacyName || 'Welcome',
              imageDataUrl: null,
              videoFilePath: null,
              durationSeconds: null,
              sortOrder: 0
            }
          ],
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

  // Each slide can override the global default duration — re-arms a fresh
  // timeout keyed on the slide actually showing, rather than one fixed-period
  // interval, so a video slide (or an edited duration) advances on its own
  // schedule instead of everyone sharing one global tick.
  React.useEffect(() => {
    const globalPeriodMs = Math.max(1, durationSeconds || 8) * 1000
    const periodMs = Math.max(1, current?.durationSeconds || 0) * 1000 || globalPeriodMs
    const timer = setTimeout(() => {
      const list = slidesRef.current
      if (list.length === 0) return
      indexRef.current = (indexRef.current + 1) % list.length
      setCurrent(list[indexRef.current])
    }, periodMs)
    return () => clearTimeout(timer)
  }, [current, durationSeconds])

  const isImage = current?.type === 'IMAGE'
  const isVideo = current?.type === 'VIDEO'
  const text = current?.text ?? pharmacyName
  // Hooks must run unconditionally; fit-text sizing is simply unused for image slides.
  const fontSize = useFitText(isImage || isVideo ? '' : text, containerRef)

  return (
    <div
      ref={containerRef}
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isImage || isVideo ? 0 : '8vh 8vw',
        boxSizing: 'border-box',
        background: 'var(--background)',
        color: 'var(--primary)',
        textAlign: 'center',
        overflow: 'hidden'
      }}
    >
      {isImage && current?.imageDataUrl ? (
        <img
          key={current.id}
          src={current.imageDataUrl}
          alt=""
          style={{
            maxHeight: '100vh',
            maxWidth: '100vw',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            animation: 'cd-fade-in 400ms ease'
          }}
        />
      ) : isVideo && current?.videoFilePath ? (
        <video
          key={current.id}
          src={customerDisplayMediaUrl(current.videoFilePath)}
          autoPlay
          muted
          loop
          playsInline
          style={{
            maxHeight: '100vh',
            maxWidth: '100vw',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            animation: 'cd-fade-in 400ms ease'
          }}
        />
      ) : (
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
      )}
    </div>
  )
}
