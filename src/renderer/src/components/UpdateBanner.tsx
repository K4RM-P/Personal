import * as React from 'react'
import { Download, X } from 'lucide-react'
import { useUpdateStatus } from '../hooks/useUpdateStatus'

/**
 * Non-blocking notice shown when a background update has been found/downloaded. Never a
 * modal — checkout must never be interrupted by an update landing (spec: B4).
 * Dismissible; the update still installs on next quit/restart regardless of dismissal.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const status = useUpdateStatus()
  const [dismissed, setDismissed] = React.useState(false)
  const lastNonIdleState = React.useRef(status.state)

  // Re-surface a dismissed banner if the update actually progressed to a new stage
  // (e.g. downloading -> ready) rather than un-dismissing on every unrelated status
  // broadcast — a periodic 'checking' pulse (when nothing is pending) shouldn't undo
  // a dismissal.
  React.useEffect(() => {
    if (status.state !== lastNonIdleState.current) {
      setDismissed(false)
      lastNonIdleState.current = status.state
    }
  }, [status.state])

  if (dismissed) return null
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'ready')
    return null

  const message =
    status.state === 'ready'
      ? `Update ${status.version ?? ''} is ready — it'll install the next time the app restarts.`
      : `Downloading update ${status.version ?? ''} in the background — it'll install on next restart.`

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm text-[var(--foreground)]">
      <div className="flex items-center gap-2">
        <Download className="icon-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notice"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--border)] hover:text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
      >
        <X className="icon-4" aria-hidden="true" />
      </button>
    </div>
  )
}
