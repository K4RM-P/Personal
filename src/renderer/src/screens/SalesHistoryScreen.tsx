import * as React from 'react'
import { CheckCircle2, Loader2, Receipt, XCircle } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { RefundWorkflowModal } from '../components/RefundWorkflowModal'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '@shared/formatCurrency'
import { useCurrentUser } from '../context/CurrentUserContext'
import type { SaleSearchResult } from '@shared/types'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999`)
}

/**
 * Managers get a date-range-filterable "Past Sales" tab and can refund
 * directly from a row. Cashiers get a read-only view capped to the last 24
 * hours — no date pickers, no refund action (refunds require a manager, via
 * the Checkout Refunds button).
 */
export function SalesHistoryScreen(): React.JSX.Element {
  const { user } = useCurrentUser()
  const isManager = user?.role === 'MANAGER'
  const today = React.useMemo(() => toDateInputValue(new Date()), [])

  const [sales, setSales] = React.useState<SaleSearchResult[]>([])
  const [loading, setLoading] = React.useState(true)
  const [fromDate, setFromDate] = React.useState(today)
  const [toDate, setToDate] = React.useState(today)
  const [query, setQuery] = React.useState('')
  const [refundTargetId, setRefundTargetId] = React.useState<string | null>(null)

  const load = React.useCallback(async (): Promise<void> => {
    if (!window.api?.refund) return
    setLoading(true)
    try {
      const range = isManager
        ? { fromDate: startOfDay(fromDate).toISOString(), toDate: endOfDay(toDate).toISOString() }
        : {
            fromDate: new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString(),
            toDate: new Date().toISOString()
          }
      setSales(await window.api.refund.searchSales(query || undefined, range))
    } catch (err) {
      console.error('Failed to load sales history:', err)
    } finally {
      setLoading(false)
    }
  }, [isManager, fromDate, toDate, query])

  React.useEffect(() => {
    const timer = setTimeout(() => void load(), 200)
    return () => clearTimeout(timer)
  }, [load])

  const totalCents = sales
    .filter((s) => s.status !== 'VOIDED')
    .reduce((sum, s) => sum + s.totalCents, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">
          {isManager ? 'Past Sales' : "Today's Sales"}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {sales.length} transactions • {formatCurrency(totalCents)} in sales
          {!isManager && ' • last 24 hours only'}
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          {isManager && (
            <>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">From</label>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:shadow-[0_0_0_3px_rgba(15,118,110,0.15)] focus:outline-none"
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
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:shadow-[0_0_0_3px_rgba(15,118,110,0.15)] focus:outline-none"
                />
              </div>
            </>
          )}
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
              Search by Sale # (receipt number)
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. R-1024"
              className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:shadow-[0_0_0_3px_rgba(15,118,110,0.15)] focus:outline-none"
            />
          </div>
          {isManager && (
            <button
              onClick={() => {
                setFromDate(today)
                setToDate(today)
                setQuery('')
              }}
              className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-sm text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--card)]"
            >
              Reset to Today
            </button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            {isManager
              ? 'Sales across all cashiers for the selected date range.'
              : 'Sales you and other cashiers rang up in the last 24 hours.'}
          </CardDescription>
        </CardHeader>
        <div className="mt-2">
          {!loading && sales.length > 0 && (
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <div className="flex-1">Sale</div>
              <div className="w-24 shrink-0 text-right">Total</div>
              {isManager && <div className="w-24 shrink-0 text-right">Action</div>}
            </div>
          )}
          <div className="space-y-2 pt-2">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="icon-4 animate-spin" aria-hidden="true" />
                Loading sales…
              </div>
            )}
            {!loading && sales.length === 0 && (
              <EmptyState
                icon={Receipt}
                title="No sales match this filter"
                description="Try a different date range or sale number."
              />
            )}
            {!loading &&
              sales.map((sale) => {
                const isRefundable =
                  isManager && sale.status !== 'VOIDED' && sale.refundedCents < sale.totalCents
                const isVoided = sale.status === 'VOIDED'
                const StatusIcon = isVoided ? XCircle : CheckCircle2
                return (
                  <div
                    key={sale.id}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-[var(--foreground)]">{sale.receiptNumber}</div>
                      <div className="flex flex-wrap items-center gap-x-1 text-[var(--muted-foreground)]">
                        <span>
                          {new Date(sale.createdAt).toLocaleString()} • {sale.itemCount} items •{' '}
                          {sale.tenderType}
                          {sale.cashierName ? ` • ${sale.cashierName}` : ''} •
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${isVoided ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}
                        >
                          <StatusIcon className="icon-3_5 shrink-0" aria-hidden="true" />
                          {sale.status}
                        </span>
                        {sale.refundedCents > 0 && (
                          <span>• refunded {formatCurrency(sale.refundedCents)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-[var(--primary)]">
                        {formatCurrency(sale.totalCents)}
                      </span>
                      {isManager && (
                        <button
                          onClick={() => setRefundTargetId(sale.id)}
                          disabled={!isRefundable}
                          title={
                            !isRefundable
                              ? 'This sale has already been fully refunded or was voided.'
                              : undefined
                          }
                          className="min-h-11 w-24 shrink-0 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Refund
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </Card>

      {refundTargetId && user && (
        <RefundWorkflowModal
          transactionId={refundTargetId}
          manager={user}
          onClose={(refunded) => {
            setRefundTargetId(null)
            if (refunded) void load()
          }}
        />
      )}
    </div>
  )
}
