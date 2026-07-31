import * as React from 'react'
import { Card, CardTitle } from './ui/Card'
import { formatCurrency } from '@shared/formatCurrency'

type DiscountMode = 'PERCENT' | 'DOLLAR'

interface DiscountModalProps {
  title: string
  baseLabel: string
  /** The amount the discount is computed against (line total or bill total, in cents). */
  baseCents: number
  initialDiscountCents?: number
  initialReason?: string
  onApply: (discountCents: number, reason?: string) => void
  onCancel: () => void
}

/** Shared % / $ discount editor used for both per-item and whole-bill discounts. */
export function DiscountModal({
  title,
  baseLabel,
  baseCents,
  initialDiscountCents = 0,
  initialReason,
  onApply,
  onCancel
}: DiscountModalProps): React.JSX.Element {
  const [mode, setMode] = React.useState<DiscountMode>('DOLLAR')
  const [percentInput, setPercentInput] = React.useState(
    initialDiscountCents > 0 && baseCents > 0 ? String(Math.round((initialDiscountCents / baseCents) * 100)) : ''
  )
  const [dollarInput, setDollarInput] = React.useState(
    initialDiscountCents > 0 ? (initialDiscountCents / 100).toFixed(2) : ''
  )
  const [reason, setReason] = React.useState(initialReason ?? '')

  const rawDiscountCents =
    mode === 'PERCENT'
      ? Math.floor((baseCents * (parseFloat(percentInput || '0') || 0)) / 100)
      : Math.round((parseFloat(dollarInput || '0') || 0) * 100)

  const exceedsBase = rawDiscountCents > baseCents
  const clampedDiscountCents = Math.max(0, Math.min(rawDiscountCents, baseCents))
  const newTotalCents = baseCents - clampedDiscountCents

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <div>
          <CardTitle className="text-[var(--foreground)]">{title}</CardTitle>
          <div className="text-xs text-[var(--muted-foreground)]">{baseLabel}</div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setMode('PERCENT')}
            className={`flex-1 min-h-10 rounded-[var(--radius)] border px-3 text-sm font-semibold ${mode === 'PERCENT' ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)] text-[var(--foreground)]'}`}
          >
            % Percentage
          </button>
          <button
            onClick={() => setMode('DOLLAR')}
            className={`flex-1 min-h-10 rounded-[var(--radius)] border px-3 text-sm font-semibold ${mode === 'DOLLAR' ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)] text-[var(--foreground)]'}`}
          >
            $ Dollar Amount
          </button>
        </div>

        {mode === 'PERCENT' ? (
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Discount %</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              placeholder="0"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
              autoFocus
            />
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Discount $</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={dollarInput}
              onChange={(e) => setDollarInput(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
              autoFocus
            />
          </div>
        )}

        <div className="space-y-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          <div className="flex justify-between text-[var(--foreground)]">
            <span>Discount amount</span>
            <span>{formatCurrency(clampedDiscountCents)}</span>
          </div>
          <div className="flex justify-between font-semibold text-[var(--foreground)]">
            <span>New total</span>
            <span>{formatCurrency(newTotalCents)}</span>
          </div>
        </div>

        {exceedsBase && (
          <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">
            Discount cannot exceed the total.
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. price match, damaged packaging"
            className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(clampedDiscountCents, reason.trim() || undefined)}
            disabled={exceedsBase || clampedDiscountCents <= 0}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            Apply Discount
          </button>
        </div>
      </Card>
    </div>
  )
}
