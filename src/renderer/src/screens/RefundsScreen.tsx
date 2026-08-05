import * as React from 'react'
import { Card, CardTitle, CardDescription } from '../components/ui/Card'
import { ManagerAuthModal } from '../components/ManagerAuthModal'
import { RefundSalesScreen } from '../components/RefundSalesScreen'
import type { AuthUser } from '@shared/types'

/**
 * Manager-only tab: search past sales and issue refunds. Access to this tab
 * is already gated to managers by AppShell/App, but we still require a fresh
 * manager credential re-auth before revealing sales data or allowing refunds,
 * matching the prior in-checkout "Refund Past Sales" flow.
 */
export function RefundsScreen(): React.JSX.Element {
  const [manager, setManager] = React.useState<AuthUser | null>(null)
  const [showAuth, setShowAuth] = React.useState(false)

  if (manager) {
    return <RefundSalesScreen manager={manager} onExit={() => setManager(null)} />
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Refunds</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Search past sales and issue refunds.</p>
      </div>
      <Card>
        <CardTitle className="text-[var(--foreground)]">Manager authentication required</CardTitle>
        <CardDescription>Re-enter manager credentials to search sales and process refunds.</CardDescription>
        <button
          onClick={() => setShowAuth(true)}
          className="mt-4 min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          Authenticate
        </button>
      </Card>
      {showAuth && (
        <ManagerAuthModal
          description="Refunds are restricted to Managers. Re-enter manager credentials to continue."
          onCancel={() => setShowAuth(false)}
          onSuccess={(authed) => {
            setManager(authed)
            setShowAuth(false)
          }}
        />
      )}
    </div>
  )
}
