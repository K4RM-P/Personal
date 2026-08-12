import { PrismaClient } from '@prisma/client'
import { formatCurrency } from '../../shared/formatCurrency'
import type { ReportEmailInterval } from '../../shared/reportEmail'
import { getStoreInfo } from '../db/queries/settingsQueries'
import {
  getDailySalesSummary,
  getTopItems,
  getSlowItems,
  getDailySalesBreakdown,
  getSalesByTender,
  getCashierTotals,
  getCurrentInventoryValuation,
  getCreditHealth,
  getAlerts,
  localDateString
} from '../db/queries/reportQueries'

/** The reporting period a given interval digest covers, ending "yesterday" so a full day/week/month is always complete. */
function resolvePeriod(
  interval: ReportEmailInterval,
  now: Date
): { fromDate: string; toDate: string; label: string } {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const toDate = localDateString(yesterday)

  if (interval === 'DAILY') {
    return { fromDate: toDate, toDate, label: `Daily digest — ${toDate}` }
  }
  if (interval === 'WEEKLY') {
    const from = new Date(yesterday)
    from.setDate(from.getDate() - 6)
    return {
      fromDate: localDateString(from),
      toDate,
      label: `Weekly digest — ${localDateString(from)} to ${toDate}`
    }
  }
  // MONTHLY — the full previous calendar month.
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const monthStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 1)
  return {
    fromDate: localDateString(monthStart),
    toDate: localDateString(monthEnd),
    label: `Monthly digest — ${localDateString(monthStart)} to ${localDateString(monthEnd)}`
  }
}

const styles = {
  page: 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:24px;color:#1f2430;',
  card: 'max-width:760px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e6ea;',
  header: 'background:#1f2937;padding:24px 28px;color:#ffffff;',
  section: 'padding:20px 28px;border-top:1px solid #eef0f3;',
  h2: 'margin:0 0 12px;font-size:15px;font-weight:700;color:#111827;',
  table: 'width:100%;border-collapse:collapse;font-size:13px;',
  th: 'text-align:left;padding:6px 8px;color:#6b7280;font-weight:600;border-bottom:1px solid #e3e6ea;',
  td: 'padding:6px 8px;border-bottom:1px solid #f1f2f4;color:#1f2430;',
  tdRight: 'padding:6px 8px;border-bottom:1px solid #f1f2f4;color:#1f2430;text-align:right;',
  statRow: 'display:flex;flex-wrap:wrap;gap:12px;',
  stat: 'flex:1 1 140px;background:#f8f9fb;border-radius:8px;padding:12px 14px;',
  statLabel: 'font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;',
  statValue: 'font-size:18px;font-weight:700;color:#111827;margin-top:2px;'
}

function esc(value: string | number | null | undefined): string {
  return String(value ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!
  )
}

function stat(label: string, value: string): string {
  return `<div style="${styles.stat}"><div style="${styles.statLabel}">${esc(label)}</div><div style="${styles.statValue}">${esc(value)}</div></div>`
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `<p style="font-size:13px;color:#6b7280;">No data for this period.</p>`
  }
  const head = headers.map((h) => `<th style="${styles.th}">${esc(h)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td style="${i === 0 ? styles.td : styles.tdRight}">${esc(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('')
  return `<table style="${styles.table}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

export async function buildReportEmailDigest(
  db: PrismaClient,
  interval: ReportEmailInterval
): Promise<{ subject: string; html: string }> {
  const now = new Date()
  const { fromDate, toDate, label } = resolvePeriod(interval, now)

  const [store, summary, tender, topItems, slowItems, daily, cashiers, inventory, credit, alerts] =
    await Promise.all([
      getStoreInfo(db),
      getDailySalesSummary(db, fromDate, toDate),
      getSalesByTender(db, fromDate, toDate),
      getTopItems(db, fromDate, toDate, 10),
      getSlowItems(db, fromDate, toDate, 1),
      getDailySalesBreakdown(db, fromDate, toDate),
      getCashierTotals(db, fromDate, toDate),
      getCurrentInventoryValuation(db),
      getCreditHealth(db),
      getAlerts(db)
    ])

  const html = `<!doctype html>
<html>
<body style="${styles.page}">
  <div style="${styles.card}">
    <div style="${styles.header}">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">${esc(store.name)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">${esc(label)}</div>
    </div>

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Sales Summary</h2>
      <div style="${styles.statRow}">
        ${stat('Gross Sales', formatCurrency(summary.grossCents))}
        ${stat('Returns', formatCurrency(summary.returnsCents))}
        ${stat('Net Sales', formatCurrency(summary.netCents))}
        ${stat('Margin', `${formatCurrency(summary.marginCents)} (${summary.marginPercent.toFixed(1)}%)`)}
        ${stat('Transactions', String(summary.transactionCount))}
        ${stat('Avg. Sale', formatCurrency(summary.avgTransactionCents))}
        ${stat('New Customers', String(summary.newCustomers))}
        ${stat('Repeat Customers', String(summary.repeatCustomers))}
      </div>
    </div>

    ${
      daily.length > 1
        ? `<div style="${styles.section}">
      <h2 style="${styles.h2}">Daily Breakdown</h2>
      ${table(
        ['Date', 'Transactions', 'Gross', 'Net', 'Margin'],
        daily.map((d) => [
          d.date,
          String(d.transactionCount),
          formatCurrency(d.grossCents),
          formatCurrency(d.netCents),
          `${d.marginPercent.toFixed(1)}%`
        ])
      )}
    </div>`
        : ''
    }

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Sales by Tender</h2>
      ${table(
        ['Tender', 'Amount', 'Share'],
        tender.map((t) => [t.tender, formatCurrency(t.amountCents), `${t.percent.toFixed(1)}%`])
      )}
    </div>

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Top Items</h2>
      ${table(
        ['Item', 'SKU', 'Qty Sold', 'Revenue', 'Margin'],
        topItems.map((i) => [
          i.name,
          i.sku,
          String(i.quantity),
          formatCurrency(i.revenueCents),
          `${i.marginPercent.toFixed(1)}%`
        ])
      )}
    </div>

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Slow Movers</h2>
      ${table(
        ['Item', 'SKU', 'On Hand', 'Qty Sold', 'Last Sold'],
        slowItems.map((i) => [
          i.name,
          i.sku,
          String(i.currentOnHand),
          String(i.quantitySold),
          i.lastSoldAt ?? 'Never'
        ])
      )}
    </div>

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Cashier Totals</h2>
      ${table(
        ['Cashier', 'Transactions', 'Total Sales', 'Avg. Sale', 'Voids'],
        cashiers.map((c) => [
          c.cashierName,
          String(c.transactionCount),
          formatCurrency(c.totalSalesCents),
          formatCurrency(c.avgTransactionCents),
          String(c.voidsCount)
        ])
      )}
    </div>

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Inventory Valuation (current)</h2>
      ${table(
        ['Category', 'Items', 'Cost Value', 'Retail Value'],
        inventory.rows.map((r) => [
          r.category,
          String(r.itemCount),
          formatCurrency(r.costValueCents),
          formatCurrency(r.retailValueCents)
        ])
      )}
      <p style="font-size:12px;color:#6b7280;margin-top:8px;">
        Total: ${inventory.totalItemCount} items · ${formatCurrency(inventory.totalCostValueCents)} cost ·
        ${formatCurrency(inventory.totalRetailValueCents)} retail
      </p>
    </div>

    <div style="${styles.section}">
      <h2 style="${styles.h2}">Alerts &amp; Credit Health</h2>
      <div style="${styles.statRow}">
        ${stat('Low Stock', String(alerts.lowStockCount))}
        ${stat('Out of Stock', String(alerts.outOfStockCount))}
        ${stat('Overdue Tabs', String(alerts.overdueTabCount))}
        ${credit.enabled ? stat('Outstanding Credit', formatCurrency(credit.totalOutstandingCents)) : ''}
      </div>
    </div>

    <div style="${styles.section}">
      <p style="font-size:11px;color:#9ca3af;margin:0;">
        Automatically generated by ${esc(store.name)}'s point-of-sale system. Manage this schedule in Settings → Reporting.
      </p>
    </div>
  </div>
</body>
</html>`

  return { subject: `${store.name} — ${label}`, html }
}
