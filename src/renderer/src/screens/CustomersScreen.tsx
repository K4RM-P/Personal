import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Lock, Plus, Search, UserPlus } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'

type CustomerRow = any
const blank = { firstName: '', lastName: '', phone: '', address: '', email: '' }
const cents = (value: string) => Math.round(Number(value) * 100)

function Balance({ value }: { value: number }) {
  const credit = value >= 0
  const Icon = credit ? ArrowUpRight : ArrowDownRight
  return <div className={`flex items-center gap-2 font-semibold ${credit ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}><Icon className="h-5 w-5" /><span>{credit ? `Credit available: ${formatCurrency(value)}` : `Customer owes: ${formatCurrency(Math.abs(value))}`}</span></div>
}

export function CustomersScreen() {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<CustomerRow[]>([])
  const [selected, setSelected] = React.useState<any>(null)
  const [form, setForm] = React.useState(blank)
  const [newCustomer, setNewCustomer] = React.useState(false)
  const [duplicate, setDuplicate] = React.useState<any>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [loyaltyOn, setLoyaltyOn] = React.useState(false)
  const [money, setMoney] = React.useState('')
  const [note, setNote] = React.useState('')
  const [points, setPoints] = React.useState('')
  const [managerMode, setManagerMode] = React.useState(false)
  const [action, setAction] = React.useState<'funds' | 'credit' | 'points' | null>(null)

  const refresh = React.useCallback(async (id?: number) => {
    if (id) setSelected(await window.api.customer.get(id))
    const rows = await window.api.customer.search(query)
    setResults(rows)
  }, [query])

  React.useEffect(() => { const timer = window.setTimeout(() => { void refresh() }, 200); return () => window.clearTimeout(timer) }, [refresh])
  React.useEffect(() => { void window.api.featureFlag.getAll().then(flags => setLoyaltyOn(Boolean(flags.find(f => f.key === 'rewardPoints')?.enabled))) }, [])

  const choose = async (id: number) => { setNewCustomer(false); setSelected(await window.api.customer.get(id)); setMessage(null) }
  const updateForm = (key: keyof typeof blank, value: string) => setForm(prev => ({ ...prev, [key]: value }))
  const checkDuplicate = async () => setDuplicate(await window.api.customer.findDuplicatePhone(form.phone, selected?.id))
  const saveCustomer = async () => {
    try {
      if (newCustomer) {
        const created = await window.api.customer.create(form)
        await choose(created.id)
      } else if (selected) {
        await window.api.customer.update(selected.id, { ...selected, ...form })
        await refresh(selected.id)
      }
      setNewCustomer(false); setDuplicate(null); setMessage('Customer saved.')
    } catch (error: any) { setMessage(error.message) }
  }
  const openNew = () => { setSelected(null); setForm(blank); setNewCustomer(true); setDuplicate(null); setMessage(null) }
  const selectForEdit = () => setForm({ firstName: selected.firstName, lastName: selected.lastName, phone: selected.phone, address: selected.address, email: selected.email ?? '' })
  React.useEffect(() => { if (selected) selectForEdit() }, [selected?.id])
  const post = async () => {
    if (!selected || !action) return
    try {
      if (action === 'funds') await window.api.customer.addFunds(selected.id, cents(money), note || undefined)
      if (action === 'credit') await window.api.customer.adjustCredit(selected.id, cents(money), note, managerMode)
      if (action === 'points') await window.api.customer.adjustPoints(selected.id, Number(points), note, managerMode)
      await refresh(selected.id); setAction(null); setMoney(''); setPoints(''); setNote(''); setMessage('Ledger updated.')
    } catch (error: any) { setMessage(error.message) }
  }
  const editing = newCustomer || Boolean(selected)

  return <div className="space-y-5">
    <div className="flex items-start justify-between"><div><h1 className="text-2xl font-semibold">Customers</h1><p className="text-sm text-[var(--muted-foreground)]">Profiles, Pharmacy Credit, loyalty, and purchase history.</p></div><button onClick={openNew} className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)]"><UserPlus className="h-4 w-4" />New customer</button></div>
    {message && <div className="rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-sm text-[var(--foreground)]">{message}</div>}
    <div className="grid grid-cols-12 gap-5">
      <Card className="col-span-4 h-fit"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[var(--muted-foreground)]"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone, address, email" className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 text-sm" /></div><div className="mt-3 space-y-2">{results.map(customer => <button key={customer.id} onClick={() => void choose(customer.id)} className={`w-full rounded-[var(--radius)] border p-3 text-left ${selected?.id === customer.id ? 'border-[var(--primary)] bg-[var(--muted)]' : 'border-[var(--border)] bg-[var(--background)]'}`}><div className="font-semibold">{customer.firstName} {customer.lastName}</div><div className="text-xs text-[var(--muted-foreground)]">{customer.phone} · {customer.address}</div></button>)}{!results.length && <p className="p-4 text-center text-sm text-[var(--muted-foreground)]">No customer matches. Create one without leaving this screen.</p>}</div></Card>
      <div className="col-span-8 space-y-5">
        {!editing && <Card><CardHeader><CardTitle>Select a customer</CardTitle><CardDescription>Search by name, phone, address, or email. Phone matches are prioritized for numeric input.</CardDescription></CardHeader></Card>}
        {editing && <Card><CardHeader><CardTitle>{newCustomer ? 'New customer' : 'Customer profile'}</CardTitle><CardDescription>Required contact details are kept inline for quick corrections.</CardDescription></CardHeader><div className="grid grid-cols-2 gap-3"><input value={form.firstName} onChange={e => updateForm('firstName', e.target.value)} placeholder="First name" className="input"/><input value={form.lastName} onChange={e => updateForm('lastName', e.target.value)} placeholder="Last name" className="input"/><input value={form.phone} onBlur={() => void checkDuplicate()} onChange={e => updateForm('phone', e.target.value)} placeholder="Phone" className="input"/><input value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="Email (optional)" className="input"/><input value={form.address} onChange={e => updateForm('address', e.target.value)} placeholder="Address" className="input col-span-2"/></div>{duplicate && <div className="mt-3 rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-sm">Possible duplicate: {duplicate.firstName} {duplicate.lastName} already uses this phone number. You may still save this customer.</div>}<div className="mt-4 flex gap-2"><button onClick={() => void saveCustomer()} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)]">Save customer</button>{newCustomer && <button onClick={() => setNewCustomer(false)} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm">Cancel</button>}</div></Card>}
        {selected && <><div className="grid grid-cols-2 gap-5"><Card><CardHeader><CardTitle>Pharmacy Credit</CardTitle><CardDescription>Auditable running balance</CardDescription></CardHeader><Balance value={selected.currentBalanceCents}/><div className="mt-4 flex gap-2"><button onClick={() => setAction('funds')} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"><Plus className="mr-1 inline h-4 w-4"/>Add funds</button><button onClick={() => setAction('credit')} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"><Lock className="mr-1 inline h-4 w-4"/>Adjust balance</button></div></Card>{loyaltyOn && selected.loyaltyEnabled && <Card><CardHeader><CardTitle>Loyalty points</CardTitle><CardDescription>{selected.currentPoints} points available</CardDescription></CardHeader><div className="text-2xl font-semibold tabular-nums">{selected.currentPoints}</div><button onClick={() => setAction('points')} className="mt-4 min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"><Lock className="mr-1 inline h-4 w-4"/>Adjust points</button></Card>}</div>
        <Card><CardHeader><CardTitle>Activity</CardTitle><CardDescription>Credit and loyalty events, newest first.</CardDescription></CardHeader><div className="space-y-2">{[...selected.ledgerEntries.map((e: any) => ({ ...e, unit: 'money' })), ...selected.pointEvents.map((e: any) => ({ ...e, unit: 'points' }))].sort((a: any,b: any) => +new Date(b.createdAt)-+new Date(a.createdAt)).map((event: any) => <div key={`${event.unit}-${event.id}`} className="flex justify-between border-t border-[var(--border)] py-2 text-sm"><div><span className="font-semibold">{event.type.replaceAll('_', ' ')}</span>{event.note && <span className="ml-2 text-[var(--muted-foreground)]">{event.note}</span>}<div className="text-xs text-[var(--muted-foreground)]">{new Date(event.createdAt).toLocaleString()}</div></div><span className="tabular-nums">{event.unit === 'money' ? formatCurrency(event.amountCents) : `${event.points > 0 ? '+' : ''}${event.points} pts`}</span></div>) || <p>No activity yet.</p>}</div></Card>
        <Card><CardHeader><CardTitle>Purchase history</CardTitle><CardDescription>All sales attached to this customer.</CardDescription></CardHeader><div className="space-y-2">{selected.transactions.map((sale: any) => <div key={sale.id} className="flex justify-between border-t border-[var(--border)] py-2 text-sm"><span>{sale.receiptNumber} · {new Date(sale.createdAt).toLocaleDateString()}</span><span className="font-semibold">{formatCurrency(sale.totalCents)}</span></div>)}{!selected.transactions.length && <p className="text-sm text-[var(--muted-foreground)]">No purchase history yet.</p>}</div></Card></>}
      </div>
    </div>
    {action && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><Card className="w-[420px]"><CardHeader><CardTitle>{action === 'funds' ? 'Add funds' : action === 'credit' ? 'Manager adjustment' : 'Manager points adjustment'}</CardTitle><CardDescription>{action === 'funds' ? 'A customer prepayment; manager approval is not required.' : 'Manager override and a non-empty explanation are required.'}</CardDescription></CardHeader>{action !== 'points' ? <input value={money} onChange={e => setMoney(e.target.value)} placeholder="Amount (e.g. 10.00; use - for debit adjustment)" type="number" step="0.01" className="input w-full"/> : <input value={points} onChange={e => setPoints(e.target.value)} placeholder="Points (positive or negative)" type="number" step="1" className="input w-full"/>}{action !== 'funds' && <label className="mt-3 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-sm"><input type="checkbox" checked={managerMode} onChange={e => setManagerMode(e.target.checked)}/><Lock className="h-4 w-4"/>Manager override confirmed</label>}<textarea value={note} onChange={e => setNote(e.target.value)} placeholder={action === 'funds' ? 'Note (optional)' : 'Reason for adjustment (required)'} className="input mt-3 min-h-20 w-full"/><div className="mt-4 flex justify-end gap-2"><button onClick={() => setAction(null)} className="min-h-11 px-3 text-sm">Cancel</button><button onClick={() => void post()} disabled={(action !== 'funds' && (!managerMode || !note.trim())) || (action === 'funds' && cents(money) <= 0)} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">Confirm</button></div></Card></div>}
  </div>
}
