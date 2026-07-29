import * as React from 'react'
import { BarcodeScanBuffer } from '@shared/barcodeScanner'

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void
  /** Refs to inputs that should pause auto-refocus (search, tender, etc.). */
  pauseRefs?: React.RefObject<HTMLElement | null>[]
  enabled?: boolean
}

interface UseBarcodeScannerResult {
  inputRef: React.RefObject<HTMLInputElement | null>
  scanInputProps: {
    ref: React.RefObject<HTMLInputElement | null>
    type: 'text'
    autoComplete: string
    'aria-label': string
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
    onBlur: () => void
  }
}

/**
 * Keyboard-wedge barcode scanner hook for checkout screens.
 * Keeps a hidden input focused and detects fast keystroke bursts ending in Enter.
 */
export function useBarcodeScanner({
  onScan,
  pauseRefs = [],
  enabled = true
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const bufferRef = React.useRef(new BarcodeScanBuffer())
  const pausedRef = React.useRef(false)

  const isEditableTarget = React.useCallback((el: Element | null): boolean => {
    if (!el || el === inputRef.current) return false
    return Boolean(
      el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    )
  }, [])

  const isPausedTarget = React.useCallback(
    (el: Element | null): boolean =>
      isEditableTarget(el) ||
      pauseRefs.some((ref) => ref.current && (ref.current === el || ref.current.contains(el))),
    [isEditableTarget, pauseRefs]
  )

  React.useEffect(() => {
    if (!enabled) return

    const refocus = (): void => {
      if (pausedRef.current || !inputRef.current) return
      if (isPausedTarget(document.activeElement)) return
      inputRef.current.focus()
    }

    const handleFocusIn = (e: FocusEvent): void => {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
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
