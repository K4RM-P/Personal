# Complete Products Sales Report — Design Spec

Date: 2026-08-13

## Summary

Add a new sub-tab, "Complete Products Sales Report", inside the existing Sales
tab of the Reports screen (`ReportsScreen.tsx` → `SalesReportsPage`). It shows
one row per product line item sold, across a date range, with cost/price/
discount/tax/profit detail, and exports to CSV.

## Scope

- Table columns: `Date | Receipt # | Product Name | Qty | Supplier Cost |
  Retail Cost | Discount | HST | Total Price | Profit`
- One row per `TransactionItem` (line item), not per unit — quantity is its
  own column and all money columns are line-item totals (already qty-aware).
- Reuses the existing Sales-tab date range picker.
- CSV export reuses the existing client-side `downloadCsv()` pattern used by
  other Sales/Inventory/Cashier/Customer report tabs.

## Data sources

### Normal product sales

`db.transactionItem.findMany` filtered to:
- `lineType: 'PRODUCT'`
- `isVoided: false`
- parent `Transaction.status in [COMPLETED, REFUNDED]`
- parent `Transaction.createdAt` within `[fromDate, toDate]`

joined to `Product` (name, `costCents`) and `Transaction` (`receiptNumber`,
`createdAt`, `taxCents`, `subtotalCents`, `billDiscountCents`).

### Debt-payoff product sales

Tab/credit sales don't get a distinct `lineType` — they're normal `PRODUCT`
line items on a `Transaction` with a non-null `tabAmountCents`, which
generates a `CreditLedgerEntry` of `type: 'SALE_CHARGE'` (negative
`amountCents`) tied back to that transaction via `transactionId`.

Per product decision: **debt-financed product lines only enter this report on
the date their debt is fully paid off**, not on their original sale date, and
they appear as ordinary rows (same columns, real cost/price/profit) — not a
placeholder "Debt Payoff" row.

New helper `getDebtPayoffAttributedSales(db, fromDate, toDate)`:

1. For every customer with `CreditLedgerEntry` activity, walk their entries
   chronologically (same FIFO debit/credit offsetting logic as
   `getCustomerDebtBreakdown`, `customerQueries.ts:158-270`): each
   `SALE_CHARGE` debit's `remainingCents` is reduced in order by subsequent
   credits (`FUNDS_ADDED`, `DEBT_SETTLED`, `REFUND_CREDIT`, positive
   `MANUAL_ADJUSTMENT`).
2. Unlike `getCustomerDebtBreakdown` (which returns only entries still
   outstanding), this walk records, for each `SALE_CHARGE`, the specific
   ledger entry whose offset brought its `remainingCents` to exactly `0` —
   i.e. the moment that debt became fully paid — and that entry's
   transaction date.
3. If a single settlement/credit transaction zeroes out multiple prior
   `SALE_CHARGE`s (FIFO order), all of those debts' product lines are
   attributed to that settlement's date.
4. A `SALE_CHARGE` that's only partially offset contributes nothing (it's
   still outstanding, so excluded, same as today's debt-breakdown report).
5. For each `SALE_CHARGE` that reached zero, only if the zeroing date falls
   within `[fromDate, toDate]`: fetch that original transaction's
   `TransactionItem` rows (`lineType: 'PRODUCT'`, `isVoided: false`) with
   their real `unitPriceCents`, `discountCents`, `Product.costCents`, and
   `hstApplied`, and emit them as report rows dated to the **zeroing date**.

Combined result = normal product sales rows ∪ debt-payoff-attributed rows,
sorted by date.

## Per-row calculations

- Supplier Cost (shown per unit) = `Product.costCents / 100`
- Retail Cost (shown per unit) = `unitPriceCents / 100`
- Discount = `discountCents / 100` (line total)
- HST: no per-line tax is persisted (`TransactionItem.hstApplied` is a
  boolean flag only; the dollar amount lives solely in
  `Transaction.taxCents`). Reconstruct by proportional apportionment,
  replicating the engine's own taxable-base calculation
  (`posQueries.ts:277-333`):
  ```
  taxableSubtotalCents = Σ (unitPriceCents*qty - discountCents) over lines where hstApplied !== false
  lineTaxableCents     = unitPriceCents*qty - discountCents   // this line, if hstApplied
  lineTaxCents          = round(Transaction.taxCents * lineTaxableCents / taxableSubtotalCents)
  ```
  Non-taxable lines get `0`. Rounding remainder (pennies) is assigned to the
  last taxable line in the transaction so per-transaction HST sums exactly to
  `Transaction.taxCents`.
- Total Price = `unitPriceCents*qty - discountCents` (line total, excludes
  tax, matches `TransactionItem.totalCents`)
- Profit = `Total Price − Discount − (Product.costCents × qty) − HST`
  (quantity-accurate, per user direction)

## UI changes (`ReportsScreen.tsx`)

- Extend `SalesReportsPage`'s `subTab` union:
  `'daily' | 'tender' | 'top' | 'slow' | 'products'`
- Add a "Complete Products Sales Report" button to the existing sub-tab
  button row.
- Add fetch of `window.api.reports.getCompleteProductSales(fromDate, toDate)`
  in the existing effect, gated on `subTab === 'products'` (or fetched
  alongside others, following existing pattern).
- New `CompleteProductSalesTable` component, following `DailySalesTable`'s
  structure (sortable columns via the existing `useSort` hook).
- New case in the existing CSV-builder switch for `subTab === 'products'`,
  producing the same 10 columns, currency-formatted, via `downloadCsv()`.

## Wiring (new plumbing, following existing report pattern)

1. `src/shared/channels.ts`: add
   `REPORTS_GET_COMPLETE_PRODUCT_SALES: 'reports:getCompleteProductSales'`
2. `src/shared/types.ts`: add `CompleteProductSaleRow` type (the 10 report
   fields, cents-based, formatted in the renderer).
3. `src/main/db/queries/reportQueries.ts`: add
   `getCompleteProductSales(fromDate, toDate)` — combines the two data
   sources above, following existing cache helper pattern
   (`getCached`/`setCached`) used by sibling functions.
4. `src/main/ipc/reportHandlers.ts`: register
   `ipcMain.handle(IPC.REPORTS_GET_COMPLETE_PRODUCT_SALES, ...)`.
5. `src/preload/index.ts`: add `getCompleteProductSales` wrapper under the
   `reports` object.

## Testing

- Unit test for the HST apportionment + profit math against a known
  transaction fixture (mirrors existing `reportQueries.test.ts` style).
- Unit test for the debt-payoff FIFO zeroing logic: a customer with two
  `SALE_CHARGE`s and a single settlement that fully covers both should
  attribute both original transactions' items to the settlement's date; a
  settlement that only partially covers a `SALE_CHARGE` should attribute
  nothing.
- Manual verification in the running app: generate a tab sale, pay it off in
  full, confirm the products appear in this report dated to the payoff date
  and not the original sale date.

## Out of scope

- XLSX export (existing placeholder stays a placeholder).
- Refund handling beyond excluding voided lines (refunded transactions with
  `status: REFUNDED` are included as-is, matching existing report
  conventions — no special negative-row treatment).
