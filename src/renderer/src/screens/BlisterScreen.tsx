import * as React from 'react'
import { LayoutGrid, Trash2, Search } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { EmptyState } from '../components/ui/EmptyState'
import { CustomerSearchPanel } from '../components/CustomerSearchPanel'
import { cn } from '../lib/utils'
import type { BlisterPack, BlisterFrequency, BlisterDateField, Customer } from '@shared/types'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2'

const FREQUENCY_LABEL: Record<BlisterFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Bi-weekly',
  MONTHLY: 'Monthly'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type BlisterSubTab = 'database' | 'dashboard'

export function BlisterScreen(): React.JSX.Element {
  const [subTab, setSubTab] = React.useState<BlisterSubTab>('database')

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--foreground)]">
          <LayoutGrid className="icon-5" aria-hidden="true" />
          Blister Packs
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Track blister pack prep, due, and pickup cycles per patient.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-1">
        {(['database', 'dashboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={cn(
              'min-h-11 rounded-[var(--radius)] px-4 text-xs font-semibold',
              subTab === tab
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
              FOCUS_RING
            )}
          >
            {tab === 'database' ? 'Database' : 'Dashboard'}
          </button>
        ))}
      </div>

      {subTab === 'database' ? <BlisterDatabaseTab /> : <BlisterDashboardTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Database sub-tab — manual CRUD + searchable table (Complete Products Sales
// Report layout).
// ---------------------------------------------------------------------------

function BlisterDatabaseTab(): React.JSX.Element {
  const [packs, setPacks] = React.useState<BlisterPack[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')

  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [patient, setPatient] = React.useState<Customer | null>(null)
  const [patientQuery, setPatientQuery] = React.useState('')
  const [patientResults, setPatientResults] = React.useState<Customer[]>([])
  const [frequency, setFrequency] = React.useState<BlisterFrequency>('WEEKLY')
  const [dueDate, setDueDate] = React.useState(todayStr())
  const [numPrescriptions, setNumPrescriptions] = React.useState('1')
  const [preparedBy, setPreparedBy] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPacks(await window.api.blister.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load blister packs')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    const q = patientQuery.trim()
    if (!q || patient) {
      setPatientResults([])
      return
    }
    const timer = setTimeout(() => {
      window.api.customer
        .search(q)
        .then(setPatientResults)
        .catch((err) => console.error('Customer search failed:', err))
    }, 150)
    return () => clearTimeout(timer)
  }, [patientQuery, patient])

  const resetForm = (): void => {
    setEditingId(null)
    setPatient(null)
    setPatientQuery('')
    setPatientResults([])
    setFrequency('WEEKLY')
    setDueDate(todayStr())
    setNumPrescriptions('1')
    setPreparedBy('')
    setFormError(null)
  }

  const handleEdit = (pack: BlisterPack): void => {
    setEditingId(pack.id)
    setPatient({
      id: pack.customer.id,
      firstName: pack.customer.firstName,
      lastName: pack.customer.lastName,
      phone: pack.customer.phone
    } as Customer)
    setPatientQuery(`${pack.customer.firstName} ${pack.customer.lastName}`)
    setFrequency(pack.frequency)
    setDueDate(pack.dueDate.slice(0, 10))
    setNumPrescriptions(String(pack.numPrescriptions))
    setPreparedBy(pack.preparedBy)
    setFormError(null)
  }

  const handleDelete = async (id: number): Promise<void> => {
    try {
      await window.api.blister.delete(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete blister pack')
    }
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFormError(null)
    if (!patient) {
      setFormError('Attach a patient first.')
      return
    }
    const count = parseInt(numPrescriptions, 10)
    if (!Number.isFinite(count) || count < 0) {
      setFormError('# of prescriptions must be a non-negative number.')
      return
    }
    if (!preparedBy.trim()) {
      setFormError('Prepared by (initials) is required.')
      return
    }
    try {
      if (editingId) {
        await window.api.blister.update(editingId, {
          customerId: patient.id,
          frequency,
          dueDate,
          numPrescriptions: count,
          preparedBy: preparedBy.trim()
        })
      } else {
        await window.api.blister.create({
          customerId: patient.id,
          frequency,
          dueDate,
          numPrescriptions: count,
          preparedBy: preparedBy.trim()
        })
      }
      resetForm()
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save blister pack')
    }
  }

  const prepDatePreview = React.useMemo(() => {
    if (!dueDate) return null
    const d = new Date(dueDate)
    d.setDate(d.getDate() - 7)
    return d.toLocaleDateString()
  }, [dueDate])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return packs
    return packs.filter((p) =>
      `${p.customer.firstName} ${p.customer.lastName}`.toLowerCase().includes(q)
    )
  }, [packs, search])

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-4">
        <Card className="space-y-3 p-4">
          <CardHeader className="p-0">
            <CardTitle>{editingId ? 'Edit Blister Pack' : 'Add Blister Pack'}</CardTitle>
          </CardHeader>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs text-[var(--muted-foreground)]">Patient</label>
              {patient ? (
                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm">
                  <span className="font-semibold text-[var(--foreground)]">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPatient(null)
                      setPatientQuery('')
                    }}
                    className="text-xs font-medium text-[var(--primary)] hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <CustomerSearchPanel
                  query={patientQuery}
                  onQueryChange={setPatientQuery}
                  results={patientResults}
                  onSelect={(c) => {
                    setPatient(c)
                    setPatientQuery(`${c.firstName} ${c.lastName}`)
                    setPatientResults([])
                  }}
                  onAddNew={() =>
                    setFormError('Add this patient as a customer first, from the Customers tab.')
                  }
                  placeholder="Search patient name or phone"
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as BlisterFrequency)}
                className="input"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Bi-weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
              />
              {prepDatePreview && (
                <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  Prep date auto-set to {prepDatePreview} (7 days before due).
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                # of Prescriptions
              </label>
              <input
                type="number"
                min="0"
                value={numPrescriptions}
                onChange={(e) => setNumPrescriptions(e.target.value)}
                className="input"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                Prepared By (initials)
              </label>
              <input
                type="text"
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                placeholder="e.g. KP"
                className="input"
              />
            </div>

            {formError && <Alert variant="error">{formError}</Alert>}

            <div className="flex justify-end gap-2 pt-2">
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-4 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-xs font-semibold text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
              >
                {editingId ? 'Update Blister Pack' : 'Create Blister Pack'}
              </button>
            </div>
          </form>
        </Card>
      </div>

      <div className="col-span-8 space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <Card>
          <CardHeader>
            <CardTitle>Blister Packs ({packs.length})</CardTitle>
            <CardDescription>Click a row to edit.</CardDescription>
          </CardHeader>
          <div className="relative mb-3">
            <Search
              className="icon-4 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search by patient name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn('input pl-9', FOCUS_RING)}
            />
          </div>
          {loading && <Alert variant="pending">Loading…</Alert>}
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={LayoutGrid}
              title="No blister packs yet"
              description="Add one using the form to the left."
            />
          )}
          {!loading && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Patient Name</th>
                    <th className="py-2 pr-3 font-medium">Frequency</th>
                    <th className="py-2 pr-3 font-medium">Prep Date</th>
                    <th className="py-2 pr-3 font-medium">Due Date</th>
                    <th className="py-2 pr-3 font-medium">Pickup Date</th>
                    <th className="py-2 pr-3 font-medium">Prepared By</th>
                    <th className="py-2 pr-3 text-right font-medium"># Rx</th>
                    <th className="py-2 pr-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((pack) => (
                    <tr
                      key={pack.id}
                      onClick={() => handleEdit(pack)}
                      className={cn(
                        'cursor-pointer border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30',
                        editingId === pack.id && 'bg-[var(--muted)]'
                      )}
                    >
                      <td className="py-3 pr-3 font-medium text-[var(--foreground)]">
                        {pack.customer.firstName} {pack.customer.lastName}
                      </td>
                      <td className="py-3 pr-3">{FREQUENCY_LABEL[pack.frequency]}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatDate(pack.prepDate)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatDate(pack.dueDate)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatDate(pack.pickupDate)}</td>
                      <td className="py-3 pr-3">{pack.preparedBy || '—'}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{pack.numPrescriptions}</td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleDelete(pack.id)
                          }}
                          aria-label={`Delete blister pack for ${pack.customer.firstName} ${pack.customer.lastName}`}
                          className="min-h-9 min-w-9 rounded-[var(--radius)] text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--destructive)]"
                        >
                          <Trash2 className="icon-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard sub-tab — search/filter by prep/due/pickup date, with
// overdue/due-soon flagging.
// ---------------------------------------------------------------------------

type Status = 'OVERDUE' | 'DUE_SOON' | 'PICKED_UP' | null

function computeStatus(pack: BlisterPack): Status {
  if (pack.pickupDate) return 'PICKED_UP'
  const due = new Date(pack.dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'OVERDUE'
  if (diffDays <= 3) return 'DUE_SOON'
  return null
}

function StatusBadge({ status }: { status: Status }): React.JSX.Element {
  if (status === 'OVERDUE') {
    return (
      <span className="rounded-full bg-[var(--error-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--error)]">
        Overdue
      </span>
    )
  }
  if (status === 'DUE_SOON') {
    return (
      <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
        Due soon
      </span>
    )
  }
  if (status === 'PICKED_UP') {
    return (
      <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
        Picked up
      </span>
    )
  }
  return <span className="text-[11px] text-[var(--muted-foreground)]">—</span>
}

function BlisterDashboardTab(): React.JSX.Element {
  const [dateField, setDateField] = React.useState<BlisterDateField>('due')
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')
  const [patientQuery, setPatientQuery] = React.useState('')
  const [packs, setPacks] = React.useState<BlisterPack[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.blister
      .list({
        dateField,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        patientQuery: patientQuery.trim() || undefined
      })
      .then((rows) => {
        if (!cancelled) setPacks(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dateField, fromDate, toDate, patientQuery])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">View by</label>
          <select
            value={dateField}
            onChange={(e) => setDateField(e.target.value as BlisterDateField)}
            className="input w-auto"
          >
            <option value="prep">Preparation Date</option>
            <option value="due">Customer Due Date</option>
            <option value="pickup">Customer Pickup Date</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={cn('input w-auto', FOCUS_RING)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={cn('input w-auto', FOCUS_RING)}
          />
        </div>
        <div className="flex flex-1 min-w-[200px] flex-col gap-1">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Patient</label>
          <input
            type="text"
            value={patientQuery}
            onChange={(e) => setPatientQuery(e.target.value)}
            placeholder="Search patient name…"
            className={cn('input', FOCUS_RING)}
          />
        </div>
      </div>

      {loading && <Alert variant="pending">Loading…</Alert>}
      {!loading && error && <Alert variant="error">{error}</Alert>}

      {!loading && !error && (
        <Card>
          <CardHeader>
            <CardTitle>Results ({packs.length})</CardTitle>
          </CardHeader>
          {packs.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="No blister packs found"
              description="Try widening the date range or clearing the patient search."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Patient Name</th>
                    <th className="py-2 pr-3 font-medium">Frequency</th>
                    <th className="py-2 pr-3 font-medium">Prep Date</th>
                    <th className="py-2 pr-3 font-medium">Due Date</th>
                    <th className="py-2 pr-3 font-medium">Pickup Date</th>
                    <th className="py-2 pr-3 font-medium">Prepared By</th>
                    <th className="py-2 pr-3 text-right font-medium"># Rx</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {packs.map((pack) => (
                    <tr
                      key={pack.id}
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30"
                    >
                      <td className="py-3 pr-3 font-medium text-[var(--foreground)]">
                        {pack.customer.firstName} {pack.customer.lastName}
                      </td>
                      <td className="py-3 pr-3">{FREQUENCY_LABEL[pack.frequency]}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatDate(pack.prepDate)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatDate(pack.dueDate)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatDate(pack.pickupDate)}</td>
                      <td className="py-3 pr-3">{pack.preparedBy || '—'}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{pack.numPrescriptions}</td>
                      <td className="py-3 pr-3">
                        <StatusBadge status={computeStatus(pack)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
