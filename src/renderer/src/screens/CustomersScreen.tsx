import * as React from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Lock,
  Plus,
  Search,
  UserPlus,
  Users as UsersIcon
} from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '@shared/formatCurrency'
import { useHasRole } from '../context/CurrentUserContext'

type CustomerRow = any
const blank = { firstName: '', lastName: '', phone: '', address: '', email: '' }
const cents = (value: string): number => Math.round(Number(value) * 100)

function Balance({ value }: { value: number }): React.JSX.Element {
  const credit = value >= 0
  const Icon = credit ? ArrowUpRight : ArrowDownRight
  return (
    <div
      className={`flex items-center gap-2 text-lg font-semibold ${credit ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>
        {credit
          ? `Credit available: ${formatCurrency(value)}`
          : `Customer owes: ${formatCurrency(Math.abs(value))}`}
      </span>
    </div>
  )
}

export function CustomersScreen(): React.JSX.Element {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<CustomerRow[]>([])
  const [selected, setSelected] = React.useState<any>(null)
  const [form, setForm] = React.useState(blank)
  const [newCustomer, setNewCustomer] = React.useState(false)
  const [duplicate, setDuplicate] = React.useState<any>(null)
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )
  const [loyaltyOn, setLoyaltyOn] = React.useState(false)
  const [money, setMoney] = React.useState('')
  const [note, setNote] = React.useState('')
  const [points, setPoints] = React.useState('')
  const [managerMode, setManagerMode] = React.useState(false)
  const [action, setAction] = React.useState<'funds' | 'credit' | 'points' | null>(null)
  const isManager = useHasRole('MANAGER')
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  const refresh = React.useCallback(
    async (id?: number) => {
      if (id) setSelected(await window.api.customer.get(id))
      if (!query.trim()) {
        setResults([])
        return
      }
      const rows = await window.api.customer.search(query)
      setResults(rows)
    },
    [query]
  )

  React.useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const timer = window.setTimeout(() => {
      void refresh()
    }, 200)
    return () => window.clearTimeout(timer)
  }, [refresh, query])

  React.useEffect(() => {
    void window.api.featureFlag
      .getAll()
      .then((flags) => setLoyaltyOn(Boolean(flags.find((f) => f.key === 'rewardPoints')?.enabled)))
  }, [])

  const choose = async (id: number): Promise<void> => {
    setNewCustomer(false)
    setSelected(await window.api.customer.get(id))
    setMessage(null)
  }

  const updateForm = (key: keyof typeof blank, value: string): void =>
    setForm((prev) => ({ ...prev, [key]: value }))
  const checkDuplicate = async (): Promise<void> =>
    setDuplicate(await window.api.customer.findDuplicatePhone(form.phone, selected?.id))

  const saveCustomer = async (): Promise<void> => {
    try {
      if (newCustomer) {
        const created = await window.api.customer.create(form)
        await choose(created.id)
      } else if (selected) {
        await window.api.customer.update(selected.id, { ...selected, ...form })
        await refresh(selected.id)
      }
      setNewCustomer(false)
      setDuplicate(null)
      setMessage({ type: 'success', text: 'Customer saved.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  const exportCustomer = async (): Promise<void> => {
    if (!selected) return
    try {
      const result = await window.api.customer.exportData(selected.id)
      setMessage(
        result
          ? { type: 'success', text: `Exported to ${result.path}` }
          : { type: 'error', text: 'Export cancelled.' }
      )
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  const deleteCustomerData = async (): Promise<void> => {
    if (!selected) return
    try {
      const updated = await window.api.customer.deleteData(selected.id)
      setConfirmingDelete(false)
      setMessage({
        type: 'success',
        text: 'Customer data deleted. Financial records were retained for accounting.'
      })
      await refresh(updated.id)
    } catch (error: any) {
      setConfirmingDelete(false)
      setMessage({ type: 'error', text: error.message })
    }
  }

  const openNew = (): void => {
    setSelected(null)
    setForm(blank)
    setNewCustomer(true)
    setDuplicate(null)
    setMessage(null)
  }

  const selectForEdit = (): void =>
    setForm({
      firstName: selected.firstName,
      lastName: selected.lastName,
      phone: selected.phone,
      address: selected.address,
      email: selected.email ?? ''
    })

  React.useEffect(() => {
    if (selected) selectForEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const post = async (): Promise<void> => {
    if (!selected || !action) return
    try {
      if (action === 'funds')
        await window.api.customer.addFunds(selected.id, cents(money), note || undefined)
      if (action === 'credit')
        await window.api.customer.adjustCredit(selected.id, cents(money), note, managerMode)
      if (action === 'points')
        await window.api.customer.adjustPoints(selected.id, Number(points), note, managerMode)
      await refresh(selected.id)
      setAction(null)
      setMoney('')
      setPoints('')
      setNote('')
      setMessage({ type: 'success', text: 'Ledger updated.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  const editing = newCustomer || Boolean(selected)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Customers</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Profiles, Pharmacy Credit, loyalty, and purchase history.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
        >
          <UserPlus className="h-4 w-4" />
          New customer
        </button>
      </div>

      {message && <Alert variant={message.type}>{message.text}</Alert>}

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-4 h-fit">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, address, email"
              className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 text-sm focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          <div className="mt-3 space-y-2">
            {results.map((customer) => (
              <button
                key={customer.id}
                onClick={() => void choose(customer.id)}
                className={`w-full rounded-[var(--radius)] border p-3 text-left transition-colors duration-150 ${
                  selected?.id === customer.id
                    ? 'border-[var(--primary)] bg-[var(--muted)]'
                    : 'border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)]'
                }`}
              >
                <div className="font-semibold text-[var(--foreground)]">
                  {customer.firstName} {customer.lastName}
                </div>
                <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {customer.phone} · {customer.address}
                </div>
              </button>
            ))}
            {!results.length && (
              <EmptyState
                icon={UsersIcon}
                title={query.trim() ? `No matches for "${query}"` : 'Search to find a customer'}
                description="Create one without leaving this screen."
                action={
                  <button
                    onClick={openNew}
                    className="min-h-9 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)]"
                  >
                    + Add customer
                  </button>
                }
              />
            )}
          </div>
        </Card>

        <div className="col-span-8 space-y-4">
          {!editing && (
            <Card>
              <CardHeader>
                <CardTitle>Select a customer</CardTitle>
                <CardDescription>
                  Search by name, phone, address, or email. Phone matches are prioritized for
                  numeric input.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {editing && (
            <Card>
              <CardHeader>
                <CardTitle>{newCustomer ? 'New customer' : 'Customer profile'}</CardTitle>
                <CardDescription>
                  Required contact details are kept inline for quick corrections.
                </CardDescription>
              </CardHeader>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={form.firstName}
                  onChange={(e) => updateForm('firstName', e.target.value)}
                  placeholder="First name"
                  className="input"
                />
                <input
                  value={form.lastName}
                  onChange={(e) => updateForm('lastName', e.target.value)}
                  placeholder="Last name"
                  className="input"
                />
                <input
                  value={form.phone}
                  onBlur={() => void checkDuplicate()}
                  onChange={(e) => updateForm('phone', e.target.value)}
                  placeholder="Phone"
                  className="input"
                />
                <input
                  value={form.email}
                  onChange={(e) => updateForm('email', e.target.value)}
                  placeholder="Email (optional)"
                  className="input"
                />
                <input
                  value={form.address}
                  onChange={(e) => updateForm('address', e.target.value)}
                  placeholder="Address"
                  className="input col-span-2"
                />
              </div>
              {duplicate && (
                <Alert variant="warning" className="mt-3">
                  Possible duplicate: {duplicate.firstName} {duplicate.lastName} already uses this
                  phone number. You may still save this customer.
                </Alert>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => void saveCustomer()}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
                >
                  Save customer
                </button>
                {newCustomer && (
                  <button
                    onClick={() => setNewCustomer(false)}
                    className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--muted)]"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </Card>
          )}

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Pharmacy Credit</CardTitle>
                    <CardDescription>Auditable running balance</CardDescription>
                  </CardHeader>
                  <Balance value={selected.currentBalanceCents} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => setAction('funds')}
                      className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
                    >
                      <Plus className="h-4 w-4" />
                      Add funds
                    </button>
                    <button
                      onClick={() => setAction('credit')}
                      className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--muted)]"
                    >
                      <Lock className="h-4 w-4" />
                      Adjust balance
                    </button>
                  </div>
                </Card>
                {loyaltyOn && selected.loyaltyEnabled && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Loyalty points</CardTitle>
                      <CardDescription>{selected.currentPoints} points available</CardDescription>
                    </CardHeader>
                    <div className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                      {selected.currentPoints}
                    </div>
                    <button
                      onClick={() => setAction('points')}
                      className="mt-4 flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--muted)]"
                    >
                      <Lock className="h-4 w-4" />
                      Adjust points
                    </button>
                  </Card>
                )}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>Credit and loyalty events, newest first.</CardDescription>
                </CardHeader>
                <div className="space-y-1">
                  {[
                    ...selected.ledgerEntries.map((e: any) => ({ ...e, unit: 'money' })),
                    ...selected.pointEvents.map((e: any) => ({ ...e, unit: 'points' }))
                  ]
                    .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))
                    .map((event: any) => (
                      <div
                        key={`${event.unit}-${event.id}`}
                        className="flex items-center justify-between gap-4 border-t border-[var(--border)] py-3 text-sm first:border-t-0"
                      >
                        <div>
                          <span className="font-semibold text-[var(--foreground)]">
                            {event.type.replaceAll('_', ' ')}
                          </span>
                          {event.note && (
                            <span className="ml-2 text-[var(--muted-foreground)]">
                              {event.note}
                            </span>
                          )}
                          <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                            {new Date(event.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <span className="shrink-0 tabular-nums font-semibold text-[var(--foreground)]">
                          {event.unit === 'money'
                            ? formatCurrency(event.amountCents)
                            : `${event.points > 0 ? '+' : ''}${event.points} pts`}
                        </span>
                      </div>
                    ))}
                  {!selected.ledgerEntries.length && !selected.pointEvents.length && (
                    <p className="py-2 text-sm text-[var(--muted-foreground)]">No activity yet.</p>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Purchase history</CardTitle>
                  <CardDescription>All sales attached to this customer.</CardDescription>
                </CardHeader>
                <div className="space-y-1">
                  {selected.transactions.map((sale: any) => (
                    <div
                      key={sale.id}
                      className="flex items-center justify-between gap-4 border-t border-[var(--border)] py-3 text-sm first:border-t-0"
                    >
                      <span className="text-[var(--foreground)]">
                        {sale.receiptNumber} · {new Date(sale.createdAt).toLocaleDateString()}
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold text-[var(--foreground)]">
                        {formatCurrency(sale.totalCents)}
                      </span>
                    </div>
                  ))}
                  {!selected.transactions.length && (
                    <p className="py-2 text-sm text-[var(--muted-foreground)]">
                      No purchase history yet.
                    </p>
                  )}
                </div>
              </Card>

              {isManager && (
                <Card>
                  <CardHeader>
                    <CardTitle>Customer data</CardTitle>
                    <CardDescription>
                      {selected.deletedAt
                        ? `Data was deleted on ${new Date(selected.deletedAt).toLocaleDateString()}. Financial records were retained for accounting.`
                        : 'Export everything on file for this customer, or permanently remove their personal details on request.'}
                    </CardDescription>
                  </CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void exportCustomer()}
                      className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                    >
                      Export Customer Data…
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      disabled={Boolean(selected.deletedAt)}
                      className="min-h-11 rounded-[var(--radius)] border border-[var(--error)] px-4 text-sm text-[var(--error)] hover:bg-[var(--error-bg)] disabled:opacity-50"
                    >
                      Delete Customer Data…
                    </button>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {confirmingDelete && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-[420px] p-6 space-y-4">
            <CardHeader>
              <CardTitle>Delete Customer Data</CardTitle>
              <CardDescription>
                This permanently clears {selected.firstName} {selected.lastName}&apos;s name, phone,
                address, and email. Sales and credit history are kept for accounting records but
                will no longer be linked to a name. This cannot be undone.
              </CardDescription>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteCustomerData()}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--error)] px-3 text-sm font-semibold text-white"
              >
                Delete Data
              </button>
            </div>
          </Card>
        </div>
      )}

      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-[420px] p-6">
            <CardHeader>
              <CardTitle>
                {action === 'funds'
                  ? 'Add funds'
                  : action === 'credit'
                    ? 'Manager adjustment'
                    : 'Manager points adjustment'}
              </CardTitle>
              <CardDescription>
                {action === 'funds'
                  ? 'A customer prepayment; manager approval is not required.'
                  : 'Manager override and a non-empty explanation are required.'}
              </CardDescription>
            </CardHeader>
            {action !== 'points' ? (
              <input
                value={money}
                onChange={(e) => setMoney(e.target.value)}
                placeholder="Amount (e.g. 10.00; use - for debit adjustment)"
                type="number"
                step="0.01"
                className="input w-full"
              />
            ) : (
              <input
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="Points (positive or negative)"
                type="number"
                step="1"
                className="input w-full"
              />
            )}
            {action !== 'funds' && (
              <label className="mt-3 flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={managerMode}
                  onChange={(e) => setManagerMode(e.target.checked)}
                />
                <Lock className="h-4 w-4 shrink-0" />
                Manager override confirmed
              </label>
            )}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                action === 'funds' ? 'Note (optional)' : 'Reason for adjustment (required)'
              }
              className="input mt-3 min-h-20 w-full"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setAction(null)}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void post()}
                disabled={
                  (action !== 'funds' && (!managerMode || !note.trim())) ||
                  (action === 'funds' && cents(money) <= 0)
                }
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
