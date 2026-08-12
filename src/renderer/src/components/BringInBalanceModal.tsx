import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { TransactionDetailView } from './TransactionDetailView'
import { formatCurrency } from '@shared/formatCurrency'
import type { DebtBreakdown } from '@shared/types'

/**
 * Itemized "bring in outstanding balance" breakdown. In interactive mode (readOnly
 * false) it lets the cashier pick an amount and add a debt-settlement line to the
 * cart. In read-only mode it just re-displays the evidence trail already brought in
 * (the cart's [Details] action) — no amount field, no Add to Bill.
 */
export function BringInBalanceModal({
  customerId,
  customerName,
  readOnly,
  fixedAmountCents,
  onAdd,
  onClose
}: {
  customerId: number
  customerName: string
  readOnly: boolean
  /** When readOnly, the amount already brought in (for display only). */
  fixedAmountCents?: number
  onAdd?: (amountCents: number) => void
  onClose: () => void
}): React.JSX.Element {
  const [breakdown, setBreakdown] = React.useState<DebtBreakdown | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [amountDollars, setAmountDollars] = React.useState('')
  const [viewTransactionId, setViewTransactionId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.api.customer
      .getDebtBreakdown(customerId)
      .then((b) => {
        if (cancelled) return
        setBreakdown(b)
        setAmountDollars((b.totalOutstandingCents / 100).toFixed(2))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load balance breakdown')
      })
    return () => {
      cancelled = true
    }
  }, [customerId])

  const amountCents = Math.round(parseFloat(amountDollars || '0') * 100)
  const totalOutstandingCents = breakdown?.totalOutstandingCents ?? 0
  const isValid = Number.isInteger(amountCents) && amountCents > 0 && amountCents <= totalOutstandingCents

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="max-h-[90vh] w-[520px] max-w-full overflow-y-auto bg-[var(--card)]">
        <CardHeader>
          <CardTitle>
            {readOnly ? 'Outstanding Balance Details' : 'Bring In Outstanding Balance'} — {customerName}
          </CardTitle>
          <CardDescription>
            {readOnly
              ? `Brought in: ${formatCurrency(fixedAmountCents ?? 0)}`
              : `${customerName} currently owes ${formatCurrency(totalOutstandingCents)}`}
          </CardDescription>
        </CardHeader>

        {error && <div className="mt-3 text-sm text-[var(--error)]">{error}</div>}
        {!breakdown && !error && (
          <div className="mt-3 text-sm text-[var(--muted-foreground)]">Loading…</div>
        )}

        {breakdown && (
          <div className="mt-3 space-y-3">
            <div className="text-sm font-medium text-[var(--foreground)]">
              This balance is made up of:
            </div>
            <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--border)]">
              {breakdown.entries.length === 0 && (
                <div className="p-3 text-center text-sm text-[var(--muted-foreground)]">
                  No outstanding entries.
                </div>
              )}
              {breakdown.entries.map((entry) => (
                <div
                  key={entry.ledgerEntryId}
                  className="border-b border-[var(--border)] p-2.5 text-sm last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {entry.type === 'SALE_CHARGE' ? (
                        <>
                          <div className="font-medium text-[var(--foreground)]">
                            {entry.transactionDate
                              ? new Date(entry.transactionDate).toLocaleDateString()
                              : ''}{' '}
                            — Sale {entry.receiptNumber}{' '}
                            <span className="text-xs font-normal text-[var(--muted-foreground)]">
                              (
                              {entry.chargeKind === 'SHORT_PAY'
                                ? `short ${formatCurrency(entry.tabAmountCents ?? 0)} of ${formatCurrency(entry.transactionTotalCents ?? 0)}`
                                : 'full charge to tab'}
                              )
                            </span>
                          </div>
                          <div className="truncate text-xs text-[var(--muted-foreground)]">
                            {entry.items?.map((i) => `${i.productName} (${i.quantity})`).join(', ')}
                          </div>
                          {entry.transactionId && (
                            <button
                              onClick={() => setViewTransactionId(entry.transactionId!)}
                              className="mt-1 text-xs font-medium text-[var(--primary)] underline"
                            >
                              View
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-[var(--foreground)]">
                            {new Date(entry.createdAt).toLocaleDateString()} — Manual adjustment
                          </div>
                          <div className="truncate text-xs text-[var(--muted-foreground)]">
                            {entry.note || 'No reason recorded'}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="shrink-0 font-semibold text-[var(--foreground)]">
                      {formatCurrency(entry.amountCents)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {!readOnly && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-[var(--foreground)]">
                    Amount to add to this bill
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={(totalOutstandingCents / 100).toFixed(2)}
                    value={amountDollars}
                    onChange={(e) => setAmountDollars(e.target.value)}
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                  />
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                    You can bring in less than the full amount if needed.
                  </div>
                  {!isValid && amountDollars.trim() !== '' && (
                    <div className="mt-1 text-xs text-[var(--error)]">
                      Amount must be greater than $0 and cannot exceed{' '}
                      {formatCurrency(totalOutstandingCents)}.
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => isValid && onAdd?.(amountCents)}
                    disabled={!isValid}
                    className="min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                  >
                    Add to Bill
                  </button>
                </div>
              </>
            )}

            {readOnly && (
              <button
                onClick={onClose}
                className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
              >
                Close
              </button>
            )}
          </div>
        )}
      </Card>

      {viewTransactionId && (
        <TransactionDetailView
          transactionId={viewTransactionId}
          onClose={() => setViewTransactionId(null)}
        />
      )}
    </div>
  )
}
