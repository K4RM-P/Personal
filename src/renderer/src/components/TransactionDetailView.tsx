import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { formatCurrency } from '@shared/formatCurrency'
import type { TransactionWithItems } from '@shared/types'

/**
 * Read-only view of a single past transaction's line items — backs the debt
 * breakdown's [View] action and the cart's [Details] action on a brought-in-balance
 * line. Deliberately not RefundWorkflowModal, which carries refund-selection state
 * (checkboxes, refund-method flow) this view has no use for.
 */
export function TransactionDetailView({
  transactionId,
  onClose
}: {
  transactionId: string
  onClose: () => void
}): React.JSX.Element {
  const [detail, setDetail] = React.useState<TransactionWithItems | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.api.transaction
      .getDetail(transactionId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load sale detail')
      })
    return () => {
      cancelled = true
    }
  }, [transactionId])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <Card className="max-h-[85vh] w-[440px] max-w-full overflow-y-auto bg-[var(--card)]">
        <CardHeader>
          <CardTitle>Sale detail</CardTitle>
          {detail && (
            <CardDescription>
              {detail.receiptNumber} · {new Date(detail.createdAt).toLocaleString()}
            </CardDescription>
          )}
        </CardHeader>

        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}

        {!detail && !error && (
          <Alert variant="pending" className="mt-3">
            Loading sale detail…
          </Alert>
        )}

        {detail && (
          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              {detail.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {item.lineType === 'DEBT_SETTLEMENT'
                      ? 'Previous Balance'
                      : (item.product?.name ?? '(item)')}{' '}
                    <span className="text-xs text-[var(--muted-foreground)]">
                      (qty {item.quantity})
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{formatCurrency(item.totalCents)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-[var(--border)] pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>{formatCurrency(detail.totalCents)}</span>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-4 min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
        >
          Close
        </button>
      </Card>
    </div>
  )
}
