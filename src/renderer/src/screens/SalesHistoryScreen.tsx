import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type { TransactionWithItems } from '@shared/types'

function isToday(iso: string | Date): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

/**
 * Cashier-facing sales history: today's completed sales only, no date range or
 * filtering (per spec — cashiers see ONLY today). Managers use the Reports
 * screen for full-range history.
 */
export function SalesHistoryScreen(): React.JSX.Element {
  const [transactions, setTransactions] = React.useState<TransactionWithItems[]>([])

  React.useEffect(() => {
    void (async () => {
      if (!window.api?.transaction) return
      try {
        const all = await window.api.transaction.getAll()
        setTransactions(all.filter((tx) => isToday(tx.createdAt)))
      } catch (err) {
        console.error('Failed to load sales history:', err)
      }
    })()
  }, [])

  const totalCents = transactions
    .filter((tx) => tx.status === 'COMPLETED')
    .reduce((sum, tx) => sum + tx.totalCents, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Today&apos;s Sales</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{transactions.length} transactions • {formatCurrency(totalCents)} in completed sales</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>Sales you and other cashiers rang up today.</CardDescription>
        </CardHeader>
        <div className="mt-2 space-y-2">
          {transactions.length === 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center text-sm text-[var(--muted-foreground)]">No sales yet today.</div>
          )}
          {transactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs">
              <div>
                <div className="font-bold text-[var(--foreground)]">{tx.receiptNumber}</div>
                <div className="text-[var(--muted-foreground)]">
                  {new Date(tx.createdAt).toLocaleTimeString()} • {tx.items.length} items • {tx.tenderType}
                  {tx.user?.fullName ? ` • ${tx.user.fullName}` : ''}
                  {' • '}
                  <span className={tx.status === 'VOIDED' ? 'font-bold text-[var(--error)]' : 'text-[var(--success)]'}>{tx.status}</span>
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
