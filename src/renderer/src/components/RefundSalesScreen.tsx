import * as React from 'react'
import { Receipt } from 'lucide-react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { EmptyState } from './ui/EmptyState'
import { formatCurrency } from '@shared/formatCurrency'
import type { AuthUser, SaleSearchResult } from '@shared/types'
import { RefundWorkflowModal } from './RefundWorkflowModal'

interface RefundSalesScreenProps {
  manager: AuthUser
  onExit: () => void
}

/**
 * Full-screen sales search for the manager-authenticated refund flow. No date
 * range — spec requires showing all past sales, searchable by receipt number.
 */
export function RefundSalesScreen({ manager, onExit }: RefundSalesScreenProps): React.JSX.Element {
  const [query, setQuery] = React.useState('')
  const [sales, setSales] = React.useState<SaleSearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [activeSaleId, setActiveSaleId] = React.useState<string | null>(null)

  const load = React.useCallback(async (q: string): Promise<void> => {
    setLoading(true)
    try {
      const results = await window.api.refund.searchSales(q || undefined)
      setSales(results)
    } catch (err) {
      console.error('Failed to search sales:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timer = setTimeout(() => void load(query), 200)
    return () => clearTimeout(timer)
  }, [query, load])

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Refund Past Sales</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Authenticated as {manager.fullName}
            </p>
          </div>
          <button
            onClick={onExit}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-sm font-semibold text-[var(--foreground)]"
          >
            Exit Refunds
          </button>
        </div>

        <Card>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Sale # (receipt number)…"
            className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            autoFocus
          />
        </Card>

        <Card>
          <CardTitle className="text-[var(--foreground)]">Sales</CardTitle>
          <CardDescription>
            {loading ? 'Searching…' : `${sales.length} sale${sales.length === 1 ? '' : 's'}`}
          </CardDescription>
          <div className="mt-3 space-y-2">
            {sales.length === 0 && !loading && (
              <EmptyState
                icon={Receipt}
                title={query.trim() ? `No sales found for "${query}"` : 'No sales yet'}
                description={
                  query.trim()
                    ? 'Check the receipt number and try again.'
                    : 'Completed sales will appear here.'
                }
              />
            )}
            {sales.map((sale) => {
              const isRefundable = sale.status !== 'VOIDED' && sale.refundedCents < sale.totalCents
              return (
                <div
                  key={sale.id}
                  className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-sm"
                >
                  <div>
                    <div className="font-bold text-[var(--foreground)]">{sale.receiptNumber}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {new Date(sale.createdAt).toLocaleString()} • {sale.customerName ?? '—'} •{' '}
                      {sale.tenderType}
                      {' • '}
                      <span
                        className={
                          sale.status === 'REFUNDED'
                            ? 'font-semibold text-[var(--error)]'
                            : sale.status === 'VOIDED'
                              ? 'font-semibold text-[var(--muted-foreground)]'
                              : 'text-[var(--success)]'
                        }
                      >
                        {sale.status}
                      </span>
                      {sale.refundedCents > 0 &&
                        ` • refunded ${formatCurrency(sale.refundedCents)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-[var(--primary)]">
                      {formatCurrency(sale.totalCents)}
                    </span>
                    <button
                      onClick={() => setActiveSaleId(sale.id)}
                      disabled={!isRefundable}
                      title={
                        !isRefundable
                          ? 'This sale has already been fully refunded or was voided.'
                          : undefined
                      }
                      className="min-h-9 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-40"
                    >
                      Refund
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {activeSaleId && (
        <RefundWorkflowModal
          transactionId={activeSaleId}
          manager={manager}
          onClose={(refunded) => {
            setActiveSaleId(null)
            if (refunded) void load(query)
          }}
        />
      )}
    </div>
  )
}
