import * as React from 'react'
import { Download, X } from 'lucide-react'
import type { UpdateStatus } from '../../../shared/types'

/**
 * Non-blocking notice shown when a background update has been found/downloaded. Never a
 * modal — checkout must never be interrupted by an update landing (spec: B4).
 * Dismissible; the update still installs on next quit/restart regardless of dismissal.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [status, setStatus] = React.useState<UpdateStatus>({ state: 'idle' })
  const [dismissed, setDismissed] = React.useState(false)

  React.useEffect(() => {
    window.api.update
      .getStatus()
      .then(setStatus)
      .catch(() => undefined)
    return window.api.update.onStatusChanged((next) => {
      setDismissed(false)
      setStatus(next)
    })
  }, [])

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
        <Download className="h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notice"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--border)] hover:text-[var(--foreground)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
