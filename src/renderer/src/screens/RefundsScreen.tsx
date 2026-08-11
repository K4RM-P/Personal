import * as React from 'react'
import { Card, CardTitle, CardDescription } from '../components/ui/Card'
import { ManagerAuthModal } from '../components/ManagerAuthModal'
import { RefundSalesScreen } from '../components/RefundSalesScreen'
import { useCurrentUser } from '../context/CurrentUserContext'
import type { AuthUser } from '@shared/types'

interface RefundsScreenProps {
  onClose: () => void
}

/**
 * Refunds entry point, opened from the "Refunds" button on Checkout. A manager
 * who's already logged in goes straight to RefundSalesScreen — no redundant
 * re-auth. A cashier's session must have a manager authenticate first.
 */
export function RefundsScreen({ onClose }: RefundsScreenProps): React.JSX.Element {
  const { user } = useCurrentUser()
  const [authedManager, setAuthedManager] = React.useState<AuthUser | null>(null)
  const [showAuth, setShowAuth] = React.useState(false)

  const manager = user?.role === 'MANAGER' ? user : authedManager

  React.useEffect(() => {
    if (manager || showAuth) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [manager, showAuth, onClose])

  if (manager) {
    return <RefundSalesScreen manager={manager} onExit={onClose} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <div>
          <CardTitle className="text-[var(--foreground)]">Manager authentication required</CardTitle>
          <CardDescription>A manager must authenticate to search sales and process refunds.</CardDescription>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onClose}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            onClick={() => setShowAuth(true)}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            Authenticate
          </button>
        </div>
      </Card>
      {showAuth && (
        <ManagerAuthModal
          description="Refunds are restricted to Managers. Enter manager credentials to continue."
          onCancel={() => setShowAuth(false)}
          onSuccess={(authed) => {
            setAuthedManager(authed)
            setShowAuth(false)
          }}
        />
      )}
    </div>
  )
}
