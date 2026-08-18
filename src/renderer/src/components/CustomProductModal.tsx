import * as React from 'react'
import { Card, CardTitle } from './ui/Card'
import { Alert } from './ui/Alert'

type CustomProductMode = 'RX' | 'NONRX'

interface CustomProductModalProps {
  mode: CustomProductMode
  onApply: (data: { name: string; priceCents: number }) => void
  onCancel: () => void
}

/** Popup for adding a non-catalogue line item: RX (locked, no HST) or Non-RX (custom name/price). */
export function CustomProductModal({
  mode,
  onApply,
  onCancel
}: CustomProductModalProps): React.JSX.Element {
  const [rxNumber, setRxNumber] = React.useState('')
  const [itemName, setItemName] = React.useState('')
  const [priceInput, setPriceInput] = React.useState('')

  const priceCents = Math.round((parseFloat(priceInput || '0') || 0) * 100)
  const nameValid = mode === 'RX' ? rxNumber.trim().length > 0 : itemName.trim().length > 0
  const canSubmit = nameValid && priceCents > 0

  const handleSubmit = (): void => {
    if (!canSubmit) return
    onApply({
      name: mode === 'RX' ? `RX #${rxNumber.trim()}` : itemName.trim(),
      priceCents
    })
  }

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') handleSubmit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel, canSubmit, rxNumber, itemName, priceCents])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <div className="space-y-1">
          <CardTitle className="text-[var(--foreground)]">
            {mode === 'RX' ? 'Add RX Item' : 'Add Non-RX Item'}
          </CardTitle>
          <div className="text-xs text-[var(--muted-foreground)]">
            {mode === 'RX'
              ? 'Prescription items are never charged HST.'
              : 'Custom item not in the product catalogue.'}
          </div>
        </div>

        {mode === 'RX' ? (
          <div className="space-y-1">
            <label className="block text-xs text-[var(--muted-foreground)]">RX Number</label>
            <input
              type="text"
              value={rxNumber}
              onChange={(e) => setRxNumber(e.target.value)}
              placeholder="e.g. 123456"
              className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-base font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
              autoFocus
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-xs text-[var(--muted-foreground)]">Item Name</label>
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Custom item"
              className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-base font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
              autoFocus
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-xs text-[var(--muted-foreground)]">Price $</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="0.00"
            className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-base font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
          />
        </div>

        {mode === 'RX' && (
          <Alert variant="warning">HST is locked off for RX items and cannot be enabled.</Alert>
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--border)]/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add to Cart
          </button>
        </div>
      </Card>
    </div>
  )
}
