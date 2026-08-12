# Customer Reports subtab + configurable debt-age warnings

## Problem

Managers have no way to see which customers are most active or who owes the
most on their pharmacy-credit tab, and no proactive warning when a customer's
debt has been outstanding too long. `getCreditHealth` already computes an
"overdue" count, but the 30-day cutoff is hardcoded and not manager-visible or
configurable, and there's no per-customer breakdown anywhere in Reports.

## Goals

- A new **Customers** subtab in Reports showing:
  - A warning banner at the top listing customers whose oldest unpaid debt
    exceeds a configurable threshold, longest-overdue first.
  - A **Most Active Customers** table (transaction count, date-range filtered).
  - A **Customers Who Owe the Most** table (current outstanding balance,
    all-time — a balance snapshot, not date-ranged).
- A manager-configurable "debt warning threshold" (days) in Settings.
- The existing Dashboard "Overdue tabs" alert automatically respects the same
  configurable threshold instead of a hardcoded 30 days.

## Non-goals

- Per-customer threshold overrides (deferred; single global setting only).
- New notification channels (email/SMS) — warnings are in-app, Reports-only.
- Changing how debt is recorded/settled (that's the existing credit ledger).

## Data model

No schema changes. Threshold is stored via the existing generic `Setting`
model, key `customer.debtWarningThresholdDays`, default `"30"` — same pattern
as `customer.loyaltyPointsPerDollar`.

## Backend

**`src/main/db/queries/customerQueries.ts`**
- `getCreditSettings` gains `debtWarningThresholdDays: number` (default 30).
- `saveCreditSettings` accepts and validates it (positive integer, coerced).

**`src/main/db/queries/reportQueries.ts`**
- `getCreditHealth` reads the threshold via `getCreditSettings(db)` instead of
  a hardcoded `thirtyDaysAgo`. No signature change — same caller contract.
- New `getCustomerActivityReport(db, fromDate, toDate, limit = 25)`: groups
  `Transaction` rows (`status IN COMPLETED|REFUNDED`) by `customerId` in the
  date range, returns `{ customerId, customerName, transactionCount,
  totalSpentCents }[]` sorted by `transactionCount` desc. Customers with zero
  transactions in range are omitted (nothing to rank).
- New `getCustomerDebtReport(db)`: finds every customer whose latest
  `CreditLedgerEntry.balanceAfterCents < 0` (same scan `getCreditHealth`
  already does), then for each debtor reconstructs which debits are still
  outstanding via the same FIFO-against-later-credits algorithm as
  `getCustomerDebtBreakdown` (ledger-entries-only, no transaction/item join —
  this report only needs the oldest remaining debit's `createdAt` and the
  total owed, not line-item detail). Returns:
  ```ts
  interface CustomerDebtReport {
    thresholdDays: number
    byBalance: CustomerDebtRow[]   // every debtor, sorted balance desc
    warnings: CustomerDebtRow[]    // byBalance filtered to daysOverdue >= threshold, sorted oldest first
  }
  interface CustomerDebtRow {
    customerId: number
    customerName: string
    balanceOwedCents: number       // positive
    oldestDebtDate: string | null  // ISO date of oldest unpaid debit
    daysOverdue: number
  }
  ```
  Both queries use the existing in-memory report cache (30s TTL).

**IPC** (`src/shared/channels.ts`, `src/main/ipc/reportHandlers.ts`,
`src/preload/index.ts`): two new channels,
`REPORTS_GET_CUSTOMER_ACTIVITY` and `REPORTS_GET_CUSTOMER_DEBT`, following the
existing handler/preload-wrapper pattern exactly (see
`REPORTS_GET_CASHIER_TOTALS` / `REPORTS_GET_CREDIT_HEALTH` as precedent).

## Frontend

**`src/renderer/src/screens/ReportsScreen.tsx`**
- `ReportTab` gains `'customers'`; new nav button "Customers".
- New `CustomerReportsPage` component:
  - Loads `getCustomerDebtReport()` once on mount (not date-ranged) and
    `getCustomerActivity(fromDate, toDate)` on date-range change, mirroring
    `SalesReportsPage`'s `loadData` pattern.
  - Warning banner: one `<Alert variant="warning">` per entry in
    `debtReport.warnings` (or a single collapsed summary if the list is long —
    cap individual banners at 5, then "+N more" text), each showing customer
    name, days overdue, amount owed. Rendered above the date-range picker so
    it's the first thing a manager sees, and shown even while activity data
    is still loading.
  - Sub-tab toggle `'active' | 'debt'` (same UI pattern as `SalesReportsPage`
    subTab buttons): "Most Active" table (customer, transactions, total
    spent, sortable via existing `useSort`/`SortableTh`) and "Owe the Most"
    table (customer, balance owed, oldest debt date, days overdue).
  - CSV export follows the existing per-subtab pattern in `SalesReportsPage`.

**`src/renderer/src/screens/SettingsScreen.tsx`**
- In the existing "Customer Credit & Loyalty" card, add a second numeric
  input: "Warn if a customer's debt is older than (days)", bound to
  `creditSettings.debtWarningThresholdDays`, saved by the same
  `saveCreditSettings` button.

**Dashboard** — no UI change. `getAlerts().overdueTabCount` already renders
on the Dashboard tab; it now reflects the configurable threshold automatically
once `getCreditHealth` is updated, satisfying "warnings surface on both
Dashboard and the Customers subtab" without new dashboard code.

## Testing

- Unit test for `getCustomerDebtReport`: multiple customers with varying debt
  ages, verify `warnings` is correctly filtered/sorted and `byBalance` sorted
  by amount.
- Unit test for `getCustomerActivityReport`: date-range filtering and
  transaction-count ranking.
- Unit test confirming `getCreditHealth`'s overdue threshold now follows the
  saved setting (not hardcoded 30 days).
- Existing `catalogImport.integration.test.ts`-style DB integration test
  pattern is not needed here; these are pure query-layer unit tests against
  the existing in-memory/sqlite test DB setup used by `reportQueries.test.ts`.

## Risks

- N+1 query pattern in `getCustomerDebtReport` (one ledger fetch per debtor)
  is fine at pharmacy scale (typically well under a few hundred open tabs);
  flagged here rather than optimized preemptively (YAGNI).
