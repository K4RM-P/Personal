import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { TransactionDetailView } from './TransactionDetailView'
import { formatCurrency } from '@shared/formatCurrency'
import type { DebtBreakdown, DebtBreakdownEntry } from '@shared/types'

/**
 * Itemized "bring in outstanding balance" breakdown. In interactive mode (readOnly
 * false) the cashier checks off exactly which outstanding items to bring into this
 * bill — one, several, or all — and the amount is the sum of what's checked. In
 * read-only mode it just re-displays the evidence trail already brought in (the
 * cart's [Details] action) — no checkboxes, no Add to Bill.
 */
export function BringInBalanceModal({
  customerId,
  customerName,
  readOnly,
  fixedLedgerEntryIds,
  onAdd,
  onClose
}: {
  customerId: number
  customerName: string
  readOnly: boolean
  /** When readOnly, the ledger entry ids already brought in — used to mark them as checked for display. */
  fixedLedgerEntryIds?: number[]
  onAdd?: (ledgerEntryIds: number[], amountCents: number, entries: DebtBreakdownEntry[]) => void
  onClose: () => void
}): React.JSX.Element {
  const [breakdown, setBreakdown] = React.useState<DebtBreakdown | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [viewTransactionId, setViewTransactionId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.api.customer
      .getDebtBreakdown(customerId)
      .then((b) => {
        if (cancelled) return
        setBreakdown(b)
        // Default: everything selected, so "bring in everything" is a single click.
        setSelected(
          new Set(readOnly ? (fixedLedgerEntryIds ?? []) : b.entries.map((e) => e.ledgerEntryId))
        )
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load balance breakdown')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const totalOutstandingCents = breakdown?.totalOutstandingCents ?? 0
  const selectedEntries = (breakdown?.entries ?? []).filter((e) => selected.has(e.ledgerEntryId))
  const selectedAmountCents = selectedEntries.reduce((sum, e) => sum + e.amountCents, 0)
  const isValid = selected.size > 0

  const toggle = (ledgerEntryId: number): void => {
    if (readOnly) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ledgerEntryId)) next.delete(ledgerEntryId)
      else next.add(ledgerEntryId)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="max-h-[90vh] w-[520px] max-w-full overflow-y-auto bg-[var(--card)]">
        <CardHeader>
          <CardTitle>
            {readOnly ? 'Outstanding Balance Details' : 'Bring In Outstanding Balance'} — {customerName}
          </CardTitle>
          <CardDescription>
            {readOnly
              ? `Brought in: ${formatCurrency(selectedAmountCents)}`
              : `${customerName} currently owes ${formatCurrency(totalOutstandingCents)}`}
          </CardDescription>
        </CardHeader>

        {error && <div className="mt-3 text-sm text-[var(--error)]">{error}</div>}
        {!breakdown && !error && (
          <div className="mt-3 text-sm text-[var(--muted-foreground)]">Loading…</div>
        )}

        {breakdown && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between text-sm font-medium text-[var(--foreground)]">
              <span>
                {readOnly ? 'This balance was made up of:' : 'Select which items to bring in:'}
              </span>
              {!readOnly && breakdown.entries.length > 1 && (
                <button
                  onClick={() =>
                    setSelected(
                      selected.size === breakdown.entries.length
                        ? new Set()
                        : new Set(breakdown.entries.map((e) => e.ledgerEntryId))
                    )
                  }
                  className="text-xs font-medium text-[var(--primary)] underline"
                >
                  {selected.size === breakdown.entries.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--border)]">
              {breakdown.entries.length === 0 && (
                <div className="p-3 text-center text-sm text-[var(--muted-foreground)]">
                  No outstanding entries.
                </div>
              )}
              {breakdown.entries.map((entry) => {
                const checked = selected.has(entry.ledgerEntryId)
                return (
                  <div
                    key={entry.ledgerEntryId}
                    className="flex items-start gap-2 border-b border-[var(--border)] p-2.5 text-sm last:border-0"
                  >
                    {!readOnly && (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(entry.ledgerEntryId)}
                        className="icon-4 mt-0.5 shrink-0"
                        aria-label={`Bring in ${entry.type === 'SALE_CHARGE' ? `sale ${entry.receiptNumber}` : 'manual adjustment'}`}
                      />
                    )}
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
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
                )
              })}
            </div>

            {!readOnly && (
              <>
                <div className="flex justify-between border-t border-[var(--border)] pt-2 text-sm font-semibold text-[var(--foreground)]">
                  <span>Amount to add to this bill</span>
                  <span>{formatCurrency(selectedAmountCents)}</span>
                </div>
                {!isValid && (
                  <div className="text-xs text-[var(--error)]">
                    Select at least one item to bring in.
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() =>
                      isValid && onAdd?.(Array.from(selected), selectedAmountCents, selectedEntries)
                    }
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
