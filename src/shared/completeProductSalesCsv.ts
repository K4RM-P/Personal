import type { CompleteProductSaleRow } from './types'

/**
 * Cents -> plain decimal string for CSV, e.g. 4950 -> "49.50". Deliberately no "$"
 * and no thousands separator — a currency symbol turns the column into text in
 * Excel/Sheets, breaking SUM()/AVERAGE() on it. Formatting for on-screen display
 * (formatCurrency, with "$") is a separate concern from formatting for a
 * spreadsheet to compute on.
 */
export function centsToCsvDecimal(cents: number): string {
  const negative = cents < 0
  const abs = Math.round(Math.abs(cents))
  const dollars = Math.floor(abs / 100)
  const remainder = (abs % 100).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${dollars}.${remainder}`
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const HEADERS = [
  'Date',
  'Receipt #',
  'Product',
  'Qty',
  'Supplier Cost',
  'Retail Cost',
  'Discount',
  'HST',
  'Total Price',
  'Profit'
]

/**
 * Builds the full Complete Products Sales Report CSV text, including a totals
 * row and a leading UTF-8 BOM (so Excel opens it without mangling non-ASCII
 * product names) — used identically by the manual "Export CSV" button and the
 * scheduled auto-export, so the two never drift apart in format.
 */
export function buildCompleteProductSalesCsv(
  rows: CompleteProductSaleRow[],
  meta: { fromDate: string; toDate: string; generatedAt: Date }
): string {
  const dataRows = rows.map((r) => [
    r.date,
    r.receiptNumber,
    r.productName,
    String(r.quantity),
    centsToCsvDecimal(r.supplierCostCents),
    centsToCsvDecimal(r.retailCostCents),
    centsToCsvDecimal(r.discountCents),
    centsToCsvDecimal(r.hstCents),
    centsToCsvDecimal(r.totalPriceCents),
    centsToCsvDecimal(r.profitCents)
  ])

  const totals = rows.reduce(
    (sum, r) => ({
      quantity: sum.quantity + r.quantity,
      discountCents: sum.discountCents + r.discountCents,
      hstCents: sum.hstCents + r.hstCents,
      totalPriceCents: sum.totalPriceCents + r.totalPriceCents,
      profitCents: sum.profitCents + r.profitCents
    }),
    { quantity: 0, discountCents: 0, hstCents: 0, totalPriceCents: 0, profitCents: 0 }
  )
  const totalsRow = [
    '',
    '',
    'TOTAL',
    String(totals.quantity),
    '',
    '',
    centsToCsvDecimal(totals.discountCents),
    centsToCsvDecimal(totals.hstCents),
    centsToCsvDecimal(totals.totalPriceCents),
    centsToCsvDecimal(totals.profitCents)
  ]

  const lines = [
    `# Report: Complete Products Sales Report`,
    `# Period: ${meta.fromDate} to ${meta.toDate}`,
    `# Generated: ${meta.generatedAt.toISOString()}`,
    `# Rows: ${rows.length}`,
    '',
    HEADERS.map(csvEscape).join(','),
    ...dataRows.map((row) => row.map(csvEscape).join(',')),
    totalsRow.map(csvEscape).join(',')
  ]

  // Leading BOM: Excel (esp. on Windows) otherwise guesses the wrong encoding for
  // any non-ASCII character in a product name and silently corrupts it on open.
  return '﻿' + lines.join('\n')
}
