import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type {
  DashboardData,
  SalesSummary,
  TopItemRow,
  SlowItemRow,
  DailySalesRow,
  TenderBreakdownRow,
  CashierTotalRow,
  InventoryValuation
} from '@shared/types'

type ReportTab = 'dashboard' | 'sales' | 'inventory' | 'cashiers'

function formatPercent(value: number): string {
  return `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthStartStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function thirtyDaysAgoStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Date-range picker component (used across all reports)
// ---------------------------------------------------------------------------

function DateRangePicker({
  fromDate,
  toDate,
  onChange,
  presets
}: {
  fromDate: string
  toDate: string
  onChange: (from: string, to: string) => void
  presets?: { label: string; from: string; to: string }[]
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex items-center gap-2 text-sm">
        <label className="text-[var(--muted-foreground)]">From:</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => onChange(e.target.value, toDate)}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="text-[var(--muted-foreground)]">To:</label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => onChange(fromDate, e.target.value)}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        />
      </div>
      {presets?.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.from, p.to)}
          className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  const now = new Date()
  const header = `# Report: ${filename}\n# Generated: ${now.toISOString()}\n`
  const csv = [
    header,
    headers.map(csvEscape).join(','),
    ...rows.map((r) => r.map(csvEscape).join(','))
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${todayStr()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Dashboard page (landing page)
// ---------------------------------------------------------------------------

function DashboardPage(): React.JSX.Element {
  const [data, setData] = React.useState<DashboardData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    window.api.reports
      .getDashboard()
      .then((d) => {
        if (active) setData(d)
      })
      .catch((err: Error) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  if (loading) return <div className="p-8 text-center text-[var(--muted-foreground)]">Loading dashboard…</div>
  if (error) return <div className="p-8 text-center text-[var(--error)]">Error: {error}</div>
  if (!data) return <div className="p-8 text-center text-[var(--muted-foreground)]">No data yet.</div>

  const renderSalesCard = (title: string, sales: SalesSummary, topItems: TopItemRow[]) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Sales summary</CardDescription>
      </CardHeader>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between border-b border-[var(--border)] pb-1">
          <span className="text-[var(--muted-foreground)]">Gross</span>
          <span className="font-semibold tabular-nums">{formatCurrency(sales.grossCents)}</span>
        </div>
        <div className="flex justify-between border-b border-[var(--border)] pb-1">
          <span className="text-[var(--muted-foreground)]">Returns</span>
          <span className="font-semibold tabular-nums text-[var(--error)]">{formatCurrency(sales.returnsCents)}</span>
        </div>
        <div className="flex justify-between border-b border-[var(--border)] pb-1">
          <span className="font-semibold">Net</span>
          <span className="font-bold tabular-nums">{formatCurrency(sales.netCents)}</span>
        </div>
        <div className="flex justify-between border-b border-[var(--border)] pb-1">
          <span className="text-[var(--muted-foreground)]">COGS</span>
          <span className="tabular-nums">{formatCurrency(sales.cogsCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--muted-foreground)]">Margin</span>
          <span className="font-semibold tabular-nums">{formatPercent(sales.marginPercent)}</span>
        </div>
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">Transactions</span>
            <span className="tabular-nums">{sales.transactionCount}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">Avg. value</span>
            <span className="tabular-nums">{formatCurrency(sales.avgTransactionCents)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">New / Repeat</span>
            <span className="tabular-nums">{sales.newCustomers} / {sales.repeatCustomers}</span>
          </div>
        </div>
        {topItems.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-[var(--muted-foreground)]">Top Items</div>
            {topItems.slice(0, 3).map((item) => (
              <div key={item.productId} className="flex justify-between text-xs border-t border-[var(--border)] py-1">
                <span className="truncate">{item.name}</span>
                <span className="tabular-nums">{item.quantity} × {formatCurrency(item.revenueCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Today and this month at a glance.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {renderSalesCard('Today', data.today.sales, data.today.topItems)}
        {renderSalesCard('This Month', data.thisMonth.sales, data.thisMonth.topItems)}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
            <CardDescription>Items needing attention</CardDescription>
          </CardHeader>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted-foreground)]">Low stock</span>
              <span className="font-semibold">{data.alerts.lowStockCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted-foreground)]">Out of stock</span>
              <span className="font-semibold">{data.alerts.outOfStockCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted-foreground)]">Overdue tabs</span>
              <span className="font-semibold">{data.alerts.overdueTabCount}</span>
            </div>
          </div>
        </Card>

        {data.creditHealth && (
          <Card>
            <CardHeader>
              <CardTitle>Pharmacy Credit</CardTitle>
              <CardDescription>Tab account health</CardDescription>
            </CardHeader>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Active accounts</span>
                <span className="font-semibold">{data.creditHealth.activeAccounts} ({formatPercent(data.creditHealth.adoptionPercent)} of customers)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Total outstanding</span>
                <span className="font-semibold">{formatCurrency(data.creditHealth.totalOutstandingCents)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Overdue accounts</span>
                <span className="font-semibold text-[var(--owed)]">{data.creditHealth.overdueAccounts} ({formatCurrency(data.creditHealth.overdueCents)})</span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sales Reports page
// ---------------------------------------------------------------------------

function SalesReportsPage(): React.JSX.Element {
  const [fromDate, setFromDate] = React.useState(thirtyDaysAgoStr)
  const [toDate, setToDate] = React.useState(todayStr)
  const [dailySales, setDailySales] = React.useState<DailySalesRow[]>([])
  const [tenderData, setTenderData] = React.useState<TenderBreakdownRow[]>([])
  const [topItems, setTopItems] = React.useState<TopItemRow[]>([])
  const [slowItems, setSlowItems] = React.useState<SlowItemRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [subTab, setSubTab] = React.useState<'daily' | 'tender' | 'top' | 'slow'>('daily')

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const [daily, tender, top, slow] = await Promise.all([
        window.api.reports.getDailySales(fromDate, toDate),
        window.api.reports.getSalesByTender(fromDate, toDate),
        window.api.reports.getTopItems(fromDate, toDate, 25),
        window.api.reports.getSlowItems(fromDate, toDate, 1)
      ])
      setDailySales(daily)
      setTenderData(tender)
      setTopItems(top)
      setSlowItems(slow)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  React.useEffect(() => { void loadData() }, [loadData])

  const presets = [
    { label: 'Today', from: todayStr(), to: todayStr() },
    { label: 'This Month', from: monthStartStr(), to: todayStr() },
    { label: 'Last 30 Days', from: thirtyDaysAgoStr(), to: todayStr() }
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Reports</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Daily breakdown, tender analysis, top and slow items.</p>
        </div>
        <button
          onClick={() => {
            const csvRows = (() => {
              if (subTab === 'daily') return dailySales.map((r) => [r.date, String(r.transactionCount), String(r.grossCents), String(r.returnsCents), String(r.netCents), formatPercent(r.marginPercent)])
              if (subTab === 'tender') return tenderData.map((r) => [r.tender, String(r.amountCents), formatPercent(r.percent)])
              if (subTab === 'top') return topItems.map((r) => [r.name, r.sku, String(r.quantity), String(r.revenueCents), formatPercent(r.marginPercent)])
              return slowItems.map((r) => [r.name, r.sku, String(r.quantitySold), String(r.currentOnHand)])
            })()
            const csvHeaders = (() => {
              if (subTab === 'daily') return ['Date', 'Transactions', 'Gross', 'Returns', 'Net', 'Margin%']
              if (subTab === 'tender') return ['Tender', 'Amount', '%']
              if (subTab === 'top') return ['Item', 'SKU', 'Qty', 'Revenue', 'Margin%']
              return ['Item', 'SKU', 'Qty Sold', 'On Hand']
            })()
            downloadCsv(`sales-${subTab}`, csvHeaders, csvRows)
          }}
          className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          Export CSV
        </button>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        onChange={(f, t) => { setFromDate(f); setToDate(t) }}
        presets={presets}
      />

      <div className="flex space-x-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-1">
        {(['daily', 'tender', 'top', 'slow'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`rounded-[var(--radius)] px-3 py-1.5 text-xs font-semibold ${
              subTab === tab ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {tab === 'daily' ? 'Daily Breakdown' : tab === 'tender' ? 'By Tender' : tab === 'top' ? 'Top Items' : 'Slow Items'}
          </button>
        ))}
      </div>

      {loading && <div className="p-4 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>}

      {!loading && subTab === 'daily' && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Sales</CardTitle>
            <CardDescription>Sorted by date descending (most recent first).</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Transactions</th>
                  <th className="pb-2 pr-3 text-right font-medium">Gross</th>
                  <th className="pb-2 pr-3 text-right font-medium">Returns</th>
                  <th className="pb-2 pr-3 text-right font-medium">Net</th>
                  <th className="pb-2 text-right font-medium">Margin%</th>
                </tr>
              </thead>
              <tbody>
                {dailySales.map((row) => (
                  <tr key={row.date} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                    <td className="py-2 pr-3 font-medium">{row.date}</td>
                    <td className="py-2 pr-3">{row.transactionCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.grossCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--error)]">{row.returnsCents !== 0 ? formatCurrency(row.returnsCents) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatCurrency(row.netCents)}</td>
                    <td className="py-2 text-right tabular-nums">{formatPercent(row.marginPercent)}</td>
                  </tr>
                ))}
                {dailySales.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-[var(--muted-foreground)]">No sales in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && subTab === 'tender' && (
        <Card>
          <CardHeader>
            <CardTitle>Sales by Tender</CardTitle>
            <CardDescription>Revenue split across payment methods.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Tender</th>
                  <th className="pb-2 pr-3 text-right font-medium">Amount</th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {tenderData
                  .filter((r) => r.amountCents !== 0 || r.tender === 'Cash')
                  .map((row) => (
                    <tr key={row.tender} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                      <td className="py-2 pr-3 font-medium">{row.tender}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.amountCents)}</td>
                      <td className="py-2 text-right tabular-nums">{formatPercent(row.percent)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && subTab === 'top' && (
        <Card>
          <CardHeader>
            <CardTitle>Top Items</CardTitle>
            <CardDescription>Ranked by revenue, descending.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="pb-2 pr-3 font-medium">Category</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qty</th>
                  <th className="pb-2 pr-3 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Margin%</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((item) => (
                  <tr key={item.productId} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                    <td className="py-2 pr-3 font-medium">{item.name}</td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)]">{item.category ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(item.revenueCents)}</td>
                    <td className="py-2 text-right tabular-nums">{formatPercent(item.marginPercent)}</td>
                  </tr>
                ))}
                {topItems.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-[var(--muted-foreground)]">No sales in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && subTab === 'slow' && (
        <Card>
          <CardHeader>
            <CardTitle>Slow Items</CardTitle>
            <CardDescription>Items with zero or near-zero sales in the period.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="pb-2 pr-3 font-medium">Category</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qty Sold</th>
                  <th className="pb-2 text-right font-medium">On Hand</th>
                </tr>
              </thead>
              <tbody>
                {slowItems.slice(0, 50).map((item) => (
                  <tr key={item.productId} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                    <td className="py-2 pr-3 font-medium">{item.name}</td>
                    <td className="py-2 pr-3 text-[var(--muted-foreground)]">{item.category ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.quantitySold}</td>
                    <td className="py-2 text-right tabular-nums">{item.currentOnHand}</td>
                  </tr>
                ))}
                {slowItems.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-[var(--muted-foreground)]">All items have sold in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inventory Reports page
// ---------------------------------------------------------------------------

function InventoryReportsPage(): React.JSX.Element {
  const [valuation, setValuation] = React.useState<InventoryValuation | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    window.api.reports
      .getInventoryValuation()
      .then((v) => { if (active) setValuation(v) })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory Reports</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Current inventory valuation by category.</p>
        </div>
        {valuation && (
          <button
            onClick={() => {
              const headers = ['Category', 'Items', 'Cost Value', 'Retail Value', 'Variance%']
              const rows = valuation.rows.map((r) => [r.category, String(r.itemCount), String(r.costValueCents), String(r.retailValueCents), formatPercent(r.variancePercent)])
              rows.push(['TOTAL', String(valuation.totalItemCount), String(valuation.totalCostValueCents), String(valuation.totalRetailValueCents), formatPercent(valuation.totalVariancePercent)])
              downloadCsv('inventory-valuation', headers, rows)
            }}
            className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            Export CSV
          </button>
        )}
      </div>

      {loading && <div className="p-4 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>}

      {!loading && valuation && (
        <Card>
          <CardHeader>
            <CardTitle>Inventory Valuation</CardTitle>
            <CardDescription>At cost and retail, grouped by category.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Category</th>
                  <th className="pb-2 pr-3 text-right font-medium">Items</th>
                  <th className="pb-2 pr-3 text-right font-medium">Cost Value</th>
                  <th className="pb-2 pr-3 text-right font-medium">Retail Value</th>
                  <th className="pb-2 text-right font-medium">Variance%</th>
                </tr>
              </thead>
              <tbody>
                {valuation.rows.map((row) => (
                  <tr key={row.category} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                    <td className="py-2 pr-3 font-medium">{row.category}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.itemCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.costValueCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.retailValueCents)}</td>
                    <td className="py-2 text-right tabular-nums">{formatPercent(row.variancePercent)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] font-semibold">
                  <td className="py-2 pr-3">TOTAL</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{valuation.totalItemCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(valuation.totalCostValueCents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(valuation.totalRetailValueCents)}</td>
                  <td className="py-2 text-right tabular-nums">{formatPercent(valuation.totalVariancePercent)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cashier Reports page
// ---------------------------------------------------------------------------

function CashierReportsPage(): React.JSX.Element {
  const [fromDate, setFromDate] = React.useState(monthStartStr)
  const [toDate, setToDate] = React.useState(todayStr)
  const [cashiers, setCashiers] = React.useState<CashierTotalRow[]>([])
  const [loading, setLoading] = React.useState(false)

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.reports.getCashierTotals(fromDate, toDate)
      setCashiers(data)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  React.useEffect(() => { void loadData() }, [loadData])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cashier Reports</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Reconciliation view: sales, discounts, voids per cashier.</p>
        </div>
        <button
          onClick={() => {
            const headers = ['Cashier', 'Transactions', 'Total Sales', 'Avg Trans', 'Discounts', 'Voids', 'Void Amt']
            const rows = cashiers.map((r) => [r.cashierName, String(r.transactionCount), String(r.totalSalesCents), String(r.avgTransactionCents), String(r.discountsCents), String(r.voidsCount), String(r.voidsCents)])
            downloadCsv('cashier-totals', headers, rows)
          }}
          className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          Export CSV
        </button>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        onChange={(f, t) => { setFromDate(f); setToDate(t) }}
        presets={[
          { label: 'Today', from: todayStr(), to: todayStr() },
          { label: 'This Month', from: monthStartStr(), to: todayStr() }
        ]}
      />

      {loading && <div className="p-4 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>}

      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle>Cashier Totals</CardTitle>
            <CardDescription>Per-cashier transaction summary for reconciliation.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Cashier</th>
                  <th className="pb-2 pr-3 text-right font-medium">Transactions</th>
                  <th className="pb-2 pr-3 text-right font-medium">Total Sales</th>
                  <th className="pb-2 pr-3 text-right font-medium">Avg Trans</th>
                  <th className="pb-2 pr-3 text-right font-medium">Discounts</th>
                  <th className="pb-2 pr-3 text-right font-medium">Voids</th>
                  <th className="pb-2 text-right font-medium">Void Amt</th>
                </tr>
              </thead>
              <tbody>
                {cashiers.map((r) => (
                  <tr key={r.userId ?? 'unassigned'} className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/30">
                    <td className="py-2 pr-3 font-medium">{r.cashierName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.transactionCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{formatCurrency(r.totalSalesCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(r.avgTransactionCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(r.discountsCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.voidsCount}</td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(r.voidsCents)}</td>
                  </tr>
                ))}
                {cashiers.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-[var(--muted-foreground)]">No data in this period.</td></tr>
                )}
              </tbody>
              {cashiers.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-semibold">
                    <td className="py-2 pr-3">TOTAL</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{cashiers.reduce((s, r) => s + r.transactionCount, 0)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(cashiers.reduce((s, r) => s + r.totalSalesCents, 0))}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">—</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(cashiers.reduce((s, r) => s + r.discountsCents, 0))}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{cashiers.reduce((s, r) => s + r.voidsCount, 0)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(cashiers.reduce((s, r) => s + r.voidsCents, 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ReportsScreen — sub-nav controller
// ---------------------------------------------------------------------------

export function ReportsScreen(): React.JSX.Element {
  const [activeTab, setActiveTab] = React.useState<ReportTab>('dashboard')

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex space-x-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-1">
        {(['dashboard', 'sales', 'inventory', 'cashiers'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-[var(--radius)] px-4 py-2 text-sm font-semibold ${
              activeTab === tab ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {tab === 'dashboard' ? 'Dashboard' : tab === 'sales' ? 'Sales' : tab === 'inventory' ? 'Inventory' : 'Cashiers'}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && <DashboardPage />}
      {activeTab === 'sales' && <SalesReportsPage />}
      {activeTab === 'inventory' && <InventoryReportsPage />}
      {activeTab === 'cashiers' && <CashierReportsPage />}
    </div>
  )
}