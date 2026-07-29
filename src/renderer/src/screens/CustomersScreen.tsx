import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

export function CustomersScreen() {
  const [customerId, setCustomerId] = React.useState('1')
  const [ledger, setLedger] = React.useState<Array<{ reference: string; balanceCents: number; kind: string }>>([])
  const [loading, setLoading] = React.useState(false)

  const loadLedger = React.useCallback(async () => {
    setLoading(true)
    try {
      const rows = await window.api.customerLedger.get(Number(customerId))
      setLedger(rows.map((row) => ({ reference: row.reference, balanceCents: row.balanceCents, kind: row.kind })))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [customerId])

  React.useEffect(() => {
    void loadLedger()
  }, [loadLedger])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">Customers</h1>
        <p className="text-[var(--muted-foreground)]">Customer ledger, short-pay history, advance fills, and localized compliance notes.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Tab / Store Credit</CardTitle>
          <CardDescription>Review the running ledger as a real sequence of events, not just a single balance number.</CardDescription>
        </CardHeader>
        <div className="mt-2 grid gap-3 text-sm">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Customer ID</label>
            <input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)]"
            />
          </div>
          <button onClick={() => void loadLedger()} className="w-fit rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-[var(--primary-foreground)]">
            {loading ? 'Loading…' : 'Load ledger'}
          </button>

          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
            {ledger.length === 0 ? (
              <div className="text-sm text-[var(--muted-foreground)]">No ledger entries found yet.</div>
            ) : (
              <div className="space-y-2">
                {ledger.map((row) => {
                  const isPositive = row.balanceCents >= 0
                  const amountLabel = isPositive ? 'Credit' : 'Owed'
                  return (
                    <div key={row.reference} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {isPositive ? <ArrowUpRight className="h-4 w-4 text-[var(--success)]" /> : <ArrowDownRight className="h-4 w-4 text-[var(--owed)]" />}
                        <div>
                          <div className="font-semibold text-[var(--foreground)]">{row.reference}</div>
                          <div className="text-xs text-[var(--muted-foreground)]">{row.kind} • {amountLabel}</div>
                        </div>
                      </div>
                      <div className={`text-right font-semibold ${isPositive ? 'text-[var(--success)]' : 'text-[var(--owed)]'}`}>
                        {isPositive ? '+' : ''}{(row.balanceCents / 100).toFixed(2)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
