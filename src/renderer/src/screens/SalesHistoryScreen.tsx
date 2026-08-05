import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type { TransactionWithItems } from '@shared/types'

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isWithinDateRange(iso: string | Date, fromDate: string, toDate: string): boolean {
  const day = toDateInputValue(new Date(iso))
  return day >= fromDate && day <= toDate
}

/**
 * Manager-only tab: browse and filter past sales by date range and receipt/cashier
 * search. Cashiers have no access to sales history at all — their only sales-related
 * capability is the manager-gated Refunds button on Checkout.
 */
export function SalesHistoryScreen(): React.JSX.Element {
  const today = React.useMemo(() => toDateInputValue(new Date()), [])
  const [transactions, setTransactions] = React.useState<TransactionWithItems[]>([])
  const [loading, setLoading] = React.useState(true)
  const [fromDate, setFromDate] = React.useState(today)
  const [toDate, setToDate] = React.useState(today)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    void (async () => {
      if (!window.api?.transaction) return
      try {
        setTransactions(await window.api.transaction.getAll())
      } catch (err) {
        console.error('Failed to load sales history:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filtered = transactions.filter((tx) => {
    if (!isWithinDateRange(tx.createdAt, fromDate, toDate)) return false
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return tx.receiptNumber.toLowerCase().includes(q) || (tx.user?.fullName ?? '').toLowerCase().includes(q)
  })

  const totalCents = filtered.filter((tx) => tx.status === 'COMPLETED').reduce((sum, tx) => sum + tx.totalCents, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Past Sales</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {filtered.length} transactions • {formatCurrency(totalCents)} in completed sales
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">From</label>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              max={today}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Search receipt # or cashier</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. R-1024 or Jane"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
          <button
            onClick={() => {
              setFromDate(today)
              setToDate(today)
              setQuery('')
            }}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--card)]"
          >
            Reset to Today
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>Sales across all cashiers for the selected date range.</CardDescription>
        </CardHeader>
        <div className="mt-2 space-y-2">
          {!loading && filtered.length === 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center text-sm text-[var(--muted-foreground)]">
              No sales match this filter.
            </div>
          )}
          {filtered.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs"
            >
              <div>
                <div className="font-bold text-[var(--foreground)]">{tx.receiptNumber}</div>
                <div className="text-[var(--muted-foreground)]">
                  {new Date(tx.createdAt).toLocaleString()} • {tx.items.length} items • {tx.tenderType}
                  {tx.user?.fullName ? ` • ${tx.user.fullName}` : ''}
                  {' • '}
                  <span className={tx.status === 'VOIDED' ? 'font-bold text-[var(--error)]' : 'text-[var(--success)]'}>
                    {tx.status}
                  </span>
                </div>
              </div>
              <span className="text-sm font-bold text-[var(--primary)]">{formatCurrency(tx.totalCents)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
