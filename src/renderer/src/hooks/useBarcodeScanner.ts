import * as React from 'react'
import { BarcodeScanBuffer } from '@shared/barcodeScanner'

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void
  /** Refs to inputs that should pause auto-refocus (search, tender, etc.). */
  pauseRefs?: React.RefObject<HTMLElement | null>[]
  enabled?: boolean
}

/**
 * Keyboard-wedge barcode scanner hook for checkout screens.
 * Keeps a hidden input focused and detects fast keystroke bursts ending in Enter.
 */
export function useBarcodeScanner({ onScan, pauseRefs = [], enabled = true }: UseBarcodeScannerOptions) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const bufferRef = React.useRef(new BarcodeScanBuffer())
  const pausedRef = React.useRef(false)

  const isPausedTarget = React.useCallback(
    (el: Element | null) => pauseRefs.some((ref) => ref.current && ref.current === el),
    [pauseRefs]
  )

  React.useEffect(() => {
    if (!enabled) return

    const refocus = () => {
      if (pausedRef.current || !inputRef.current) return
      if (isPausedTarget(document.activeElement)) return
      inputRef.current.focus()
    }

    const handleFocusIn = (e: FocusEvent) => {
      pausedRef.current = isPausedTarget(e.target as Element)
    }

    const interval = window.setInterval(refocus, 500)
    document.addEventListener('focusin', handleFocusIn)
    refocus()

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [enabled, isPausedTarget])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const result = bufferRef.current.processKey(e.key)
    if (result.type === 'scan') {
      e.preventDefault()
      e.currentTarget.value = ''
      onScan(result.barcode)
    }
  }

  const scanInputProps = {
    ref: inputRef,
    type: 'text' as const,
    autoComplete: 'off',
    'aria-label': 'Barcode scanner input',
    onKeyDown: handleKeyDown,
    onBlur: () => {
      if (!isPausedTarget(document.activeElement)) {
        pausedRef.current = false
      }
    }
  }

  return { inputRef, scanInputProps }
}
