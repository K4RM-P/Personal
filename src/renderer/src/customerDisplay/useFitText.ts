import { useEffect, useState } from 'react'

export const FIT_MAX_PX = 220
export const FIT_MIN_PX = 32
export const FIT_STEP_PX = 4
export const FIT_LINE_HEIGHT = 1.15

export interface FitOptions {
  maxPx?: number
  minPx?: number
  maxLines?: number
  stepPx?: number
}

/** What a measurement at a candidate font size reported back. */
export interface FitMeasurement {
  /** Rendered height in px of the text wrapped to the container width. */
  heightPx: number
}

/**
 * Pure core of the measure-and-shrink algorithm (spec §2.4): start at the max
 * size and step down until the text fits both the available height and the
 * line cap. Deliberately not a per-character-count lookup table — the caller
 * supplies a real measurement function, so sizing is always computed for the
 * actual text at the actual container size.
 */
export function computeFitFontSize(
  measure: (fontSizePx: number) => FitMeasurement,
  availableHeightPx: number,
  opts?: FitOptions
): number {
  const maxPx = opts?.maxPx ?? FIT_MAX_PX
  const minPx = opts?.minPx ?? FIT_MIN_PX
  const maxLines = opts?.maxLines ?? 2
  const stepPx = opts?.stepPx ?? FIT_STEP_PX

  let size = maxPx
  while (size > minPx) {
    const { heightPx } = measure(size)
    const lines = Math.max(1, Math.round(heightPx / (size * FIT_LINE_HEIGHT)))
    if (heightPx <= availableHeightPx && lines <= maxLines) break
    size -= stepPx
  }
  return Math.max(minPx, Math.min(maxPx, size))
}

/**
 * Measures a hidden clone of `text` at decreasing font sizes until it fits the
 * container within `maxLines`. Re-runs whenever the text or container size
 * changes, so edited slide text is always re-fitted at render time.
 */
export function useFitText(
  text: string,
  containerRef: React.RefObject<HTMLElement | null>,
  opts?: FitOptions
): number {
  const maxPx = opts?.maxPx ?? FIT_MAX_PX
  const minPx = opts?.minPx ?? FIT_MIN_PX
  const maxLines = opts?.maxLines ?? 2
  const stepPx = opts?.stepPx ?? FIT_STEP_PX
  const [fontSize, setFontSize] = useState(maxPx)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false

    const run = (): void => {
      if (cancelled || !container.clientWidth) return
      const cs = getComputedStyle(container)
      const paddingX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
      const paddingY = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
      const availableWidth = Math.max(0, container.clientWidth - paddingX)
      const availableHeight = Math.max(0, container.clientHeight - paddingY)

      const measurer = document.createElement('div')
      measurer.style.position = 'absolute'
      measurer.style.left = '-99999px'
      measurer.style.top = '0'
      measurer.style.visibility = 'hidden'
      measurer.style.whiteSpace = 'normal'
      measurer.style.wordBreak = 'break-word'
      measurer.style.fontWeight = '700'
      measurer.style.lineHeight = String(FIT_LINE_HEIGHT)
      measurer.style.width = `${availableWidth}px`
      measurer.textContent = text
      document.body.appendChild(measurer)
      try {
        const next = computeFitFontSize(
          (size) => {
            measurer.style.fontSize = `${size}px`
            return { heightPx: measurer.scrollHeight }
          },
          availableHeight,
          { maxPx, minPx, maxLines, stepPx }
        )
        if (!cancelled) setFontSize(next)
      } finally {
        document.body.removeChild(measurer)
      }
    }

    run()
    const observer = new ResizeObserver(run)
    observer.observe(container)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [text, containerRef, maxPx, minPx, maxLines, stepPx])

  return fontSize
}
