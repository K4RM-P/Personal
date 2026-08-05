import * as React from 'react'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const

/**
 * A15 — logs the current user out after a configurable stretch of inactivity.
 * A checkout terminal left signed in as a manager, unattended, is a real
 * exposure (refunds, customer balance adjustments) — this returns to the
 * login screen on its own rather than relying on staff to remember.
 */
export function useIdleLogout(timeoutMinutes: number | null, onIdle: () => void): void {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  React.useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return

    const timeoutMs = timeoutMinutes * 60_000

    const reset = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(onIdle, timeoutMs)
    }

    reset()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true })
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset)
      }
    }
  }, [timeoutMinutes, onIdle])
}
