import * as React from 'react'
import { Loader2, X } from 'lucide-react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type { SaleRefundDetail } from '@shared/types'

interface ViewSaleModalProps {
  transactionId: string
  managerId: number
  onClose: () => void
}

/** Read-only detail view of a past sale: line items, discounts, tax, tender, and any refunds. */
export function ViewSaleModal({
  transactionId,
  managerId,
  onClose
}: ViewSaleModalProps): React.JSX.Element {
  const [detail, setDetail] = React.useState<SaleRefundDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void window.api.refund
      .getSaleDetails(transactionId, managerId)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [transactionId, managerId])

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const itemDiscountTotalCents =
    detail?.items.reduce((sum, item) => sum + (item.discountCents ?? 0), 0) ?? 0

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-sale-title"
        className="max-h-[85vh] w-[520px] overflow-y-auto border-[var(--primary)] bg-[var(--card)] p-6 space-y-4 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div>
            <CardTitle id="view-sale-title">
              {detail ? `Sale ${detail.receiptNumber}` : 'Sale Details'}
            </CardTitle>
            {detail && (
              <CardDescription>{new Date(detail.createdAt).toLocaleString()}</CardDescription>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-9 min-w-9 rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="icon-4" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div className="rounded-[var(--radius)] border border-[var(--error)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error)]">
            {error}
          </div>
        )}

        {!detail && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="icon-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {detail && (
          <div className="space-y-4 text-sm">
            <div className="space-y-2">
              {detail.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[var(--foreground)]">
                      {item.lineType === 'DEBT_SETTLEMENT'
                        ? 'Previous Balance'
                        : (item.product?.name ?? '(item)')}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      qty {item.quantity} @ {formatCurrency(item.unitPriceCents)}
                      {(item.discountCents ?? 0) > 0 &&
                        ` • discount ${formatCurrency(item.discountCents ?? 0)}`}
                      {item.isVoided && ' • voided'}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(item.totalCents)}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-1 border-t border-[var(--border)] pt-3">
              <div className="flex justify-between text-[var(--muted-foreground)]">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatCurrency(detail.subtotalCents)}</span>
              </div>
              {itemDiscountTotalCents > 0 && (
                <div className="flex justify-between text-[var(--muted-foreground)]">
                  <span>Item discounts</span>
                  <span className="tabular-nums">-{formatCurrency(itemDiscountTotalCents)}</span>
                </div>
              )}
              {(detail.billDiscountCents ?? 0) > 0 && (
                <div className="flex justify-between text-[var(--muted-foreground)]">
                  <span>Bill discount</span>
                  <span className="tabular-nums">
                    -{formatCurrency(detail.billDiscountCents ?? 0)}
                  </span>
                </div>
              )}
              {(detail.surchargeCents ?? 0) > 0 && (
                <div className="flex justify-between text-[var(--muted-foreground)]">
                  <span>Card surcharge</span>
                  <span className="tabular-nums">{formatCurrency(detail.surchargeCents ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between text-[var(--muted-foreground)]">
                <span>HST</span>
                <span className="tabular-nums">{formatCurrency(detail.taxCents)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-[var(--foreground)]">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(detail.totalCents)}</span>
              </div>
            </div>

            <div className="space-y-1 border-t border-[var(--border)] pt-3 text-[var(--muted-foreground)]">
              <div className="flex justify-between">
                <span>Tender</span>
                <span>{detail.tenderType}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier</span>
                <span>{detail.user?.fullName ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span>{detail.status}</span>
              </div>
            </div>

            {detail.refunds.length > 0 && (
              <div className="space-y-1 border-t border-[var(--border)] pt-3">
                <p className="font-semibold text-[var(--foreground)]">Refunds</p>
                {detail.refunds.map((refund) => (
                  <div
                    key={refund.id}
                    className="flex justify-between text-[var(--muted-foreground)]"
                  >
                    <span>
                      {new Date(refund.createdAt).toLocaleDateString()} • {refund.type}
                    </span>
                    <span className="tabular-nums">{formatCurrency(refund.amountCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
