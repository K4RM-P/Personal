import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { BackupModal } from './BackupModal'
import { useCurrentUser } from '../context/CurrentUserContext'

interface LogoutConfirmModalProps {
  onCancel: () => void
}

/** "Ready to log out?" prompt (spec §1.1) — offers to back up before logging out. */
export function LogoutConfirmModal({ onCancel }: LogoutConfirmModalProps): React.JSX.Element {
  const { user, logout } = useCurrentUser()
  const [showBackup, setShowBackup] = React.useState(false)

  if (showBackup && user) {
    return <BackupModal userId={user.id} standalone={false} onClose={() => void logout()} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[480px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <div>
          <CardTitle className="text-[var(--foreground)]">Ready to log out?</CardTitle>
        </div>
        <CardDescription>
          Before you go, would you like to back up all your pharmacy data to an external drive? This backs up all
          sales, customers, transactions, and other important data. The McKesson catalogue is not included (it can be
          re-imported).
        </CardDescription>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <button
            onClick={onCancel}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            onClick={() => void logout()}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            No, Just Logout
          </button>
          <button
            onClick={() => setShowBackup(true)}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            Yes, Back Up
          </button>
        </div>
      </Card>
    </div>
  )
}
