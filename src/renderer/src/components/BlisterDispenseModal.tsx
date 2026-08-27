import * as React from 'react'
import { Card, CardTitle } from './ui/Card'
import { Alert } from './ui/Alert'
import { CustomerSearchPanel } from './CustomerSearchPanel'
import type { BlisterPack, Customer } from '@shared/types'

const FREQUENCY_LABEL: Record<BlisterPack['frequency'], string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Bi-weekly',
  MONTHLY: 'Monthly'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

interface BlisterDispenseModalProps {
  onClose: () => void
}

/** Checkout "Blister" button flow: attach a patient, dispense their pending blister pack. */
export function BlisterDispenseModal({ onClose }: BlisterDispenseModalProps): React.JSX.Element {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Customer[]>([])
  const [patient, setPatient] = React.useState<Customer | null>(null)
  const [pending, setPending] = React.useState<BlisterPack | null | undefined>(undefined)
  const [initials, setInitials] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)

  React.useEffect(() => {
    const q = query.trim()
    if (!q || patient) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      window.api.customer
        .search(q)
        .then(setResults)
        .catch((err) => console.error('Customer search failed:', err))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, patient])

  const attachPatient = (customer: Customer): void => {
    setPatient(customer)
    setQuery(`${customer.firstName} ${customer.lastName}`)
    setResults([])
    setError(null)
    window.api.blister
      .getPendingForCustomer(customer.id)
      .then(setPending)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to look up patient'))
  }

  const changePatient = (): void => {
    setPatient(null)
    setPending(undefined)
    setQuery('')
    setInitials('')
    setError(null)
  }

  const canDispense = pending && initials.trim().length > 0 && !submitting

  const handleDispense = async (): Promise<void> => {
    if (!pending) return
    setSubmitting(true)
    setError(null)
    try {
      await window.api.blister.dispense(pending.id, initials.trim())
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispense blister pack')
    } finally {
      setSubmitting(false)
    }
  }

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <CardTitle className="text-[var(--foreground)]">Dispense Blister Pack</CardTitle>

        {done ? (
          <>
            <Alert variant="success">
              Blister pack dispensed. Next pack scheduled automatically.
            </Alert>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--muted-foreground)]">Patient</label>
              {patient ? (
                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm">
                  <span className="font-semibold text-[var(--foreground)]">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <button
                    type="button"
                    onClick={changePatient}
                    className="text-xs font-medium text-[var(--primary)] hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <CustomerSearchPanel
                  query={query}
                  onQueryChange={setQuery}
                  results={results}
                  onSelect={attachPatient}
                  onAddNew={() =>
                    setError('Add this patient as a customer first, from the Customers tab.')
                  }
                  placeholder="Search patient name or phone"
                />
              )}
            </div>

            {patient && pending === undefined && (
              <Alert variant="pending">Looking up pending blister pack…</Alert>
            )}

            {patient && pending === null && (
              <Alert variant="warning">
                No pending blister pack for this patient — add one from Blister → Database.
              </Alert>
            )}

            {patient && pending && (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-xs">
                  <div>
                    <div className="text-[var(--muted-foreground)]">Frequency</div>
                    <div className="font-semibold text-[var(--foreground)]">
                      {FREQUENCY_LABEL[pending.frequency]}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--muted-foreground)]"># Prescriptions</div>
                    <div className="font-semibold text-[var(--foreground)]">
                      {pending.numPrescriptions}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--muted-foreground)]">Prep Date</div>
                    <div className="font-semibold text-[var(--foreground)]">
                      {formatDate(pending.prepDate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--muted-foreground)]">Due Date</div>
                    <div className="font-semibold text-[var(--foreground)]">
                      {formatDate(pending.dueDate)}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs text-[var(--muted-foreground)]">
                    Prepared by (initials)
                  </label>
                  <input
                    type="text"
                    value={initials}
                    onChange={(e) => setInitials(e.target.value)}
                    placeholder="e.g. KP"
                    className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-base font-semibold text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                    autoFocus
                  />
                </div>
              </>
            )}

            {error && <Alert variant="error">{error}</Alert>}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--border)]/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDispense()}
                disabled={!canDispense}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dispense Blister
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
