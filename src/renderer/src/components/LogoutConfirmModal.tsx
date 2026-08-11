import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { BackupModal } from './BackupModal'
import { useCurrentUser } from '../context/CurrentUserContext'
import { useUpdateStatus } from '../hooks/useUpdateStatus'

interface LogoutConfirmModalProps {
  onCancel: () => void
}

/** "Ready to log out?" prompt (spec §1.1) — offers to back up before logging out. */
export function LogoutConfirmModal({ onCancel }: LogoutConfirmModalProps): React.JSX.Element {
  const { user, logout } = useCurrentUser()
  const [showBackup, setShowBackup] = React.useState(false)
  const updateStatus = useUpdateStatus()
  const updateReadyVersion = updateStatus.state === 'ready' ? (updateStatus.version ?? '') : null

  // Only cancelable from the base confirm view — once a backup run has started
  // (showBackup), BackupModal owns its own lifecycle and shouldn't be Escape-dismissed
  // mid-copy.
  React.useEffect(() => {
    if (showBackup) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, showBackup])

  if (showBackup && user) {
    return <BackupModal userId={user.id} standalone={false} onClose={() => void logout()} />
  }

  // Logout is a safe, natural moment to apply a downloaded update — the cashier is
  // stepping away, not mid-sale — so offer it here rather than waiting for a spontaneous
  // app quit that may never come on a POS device left running for days.
  if (updateReadyVersion !== null) {
    return (
      <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <Card role="dialog" aria-modal="true" aria-labelledby="update-ready-title" className="w-[480px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4 shadow-lg">
          <div>
            <CardTitle id="update-ready-title" className="text-[var(--foreground)]">Update ready to install</CardTitle>
          </div>
          <CardDescription>
            {`Version ${updateReadyVersion} has finished downloading. Install it now while you're logging out? This
            takes a few seconds and the app will restart automatically.`}
          </CardDescription>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => void logout()}
              className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              Not Now, Just Log Out
            </button>
            <button
              onClick={() => void window.api.update.installNow()}
              className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              Install & Restart
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title" className="w-[480px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4 shadow-lg">
        <div>
          <CardTitle id="logout-confirm-title" className="text-[var(--foreground)]">Ready to log out?</CardTitle>
        </div>
        <CardDescription>
          Before you go, would you like to back up all your pharmacy data to an external drive? This
          backs up all sales, customers, transactions, and other important data. The McKesson
          catalogue is not included (it can be re-imported).
        </CardDescription>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <button
            onClick={onCancel}
            className="min-h-11 rounded-[var(--radius)] px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void logout()}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            No, Just Logout
          </button>
          <button
            onClick={() => setShowBackup(true)}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            Yes, Back Up
          </button>
        </div>
      </Card>
    </div>
  )
}
