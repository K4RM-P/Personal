# Link Customer + Bring In Outstanding Balance — Design

Date: 2026-08-12

## Origin note

This feature was originally specified against a `customer-system-spec.md` file and a
`Sale`/`SaleLineItem` data model with `CreditLedgerEntry.saleId` and a prebuilt reusable
`CustomerSearchModal` component. None of these exist in this repo. This document translates
the original intent onto what actually exists:

| Original doc | Actual repo |
|---|---|
| `Sale` / `SaleLineItem` | `Transaction` / `TransactionItem` |
| `CreditLedgerEntry.saleId` | `CreditLedgerEntry.transactionId` (already exists, optional `String`) |
| Reusable `CustomerSearchModal` | Inline search state/JSX in `CheckoutScreen.tsx` (~lines 68-290) — extracted as part of this work |
| Refund system's "special line item" pattern | Does not exist; refunds are a separate `Refund` model, not a line-item mechanism |

All functional requirements, non-negotiables, and the 18 test scenarios from the original task
brief carry over unchanged — only the vocabulary and integration points below are adapted to the
real codebase.

## Goals

1. A persistent, always-visible "Link Customer" control + overflow (⋮) menu at the top of
   checkout, independent of the existing Pharmacy-Credit-conditional customer search.
2. The ability to pull a linked customer's outstanding Pharmacy Credit debt into the current
   bill, paid via whatever tender is used today (never Pharmacy Credit itself), with a fully
   itemized, provably-correct breakdown of what the debt is for.

## Data model changes

```prisma
model TransactionItem {
  id             String @id @default(uuid())
  transactionId  String
  productId      Int?               // was required; now optional
  lineType       String @default("PRODUCT")   // "PRODUCT" | "DEBT_SETTLEMENT"
  quantity       Int
  costCents      Int
  unitPriceCents Int
  discountCents  Int?   @default(0) // must stay 0/omitted for DEBT_SETTLEMENT lines
  totalCents     Int
  isVoided       Boolean @default(false)
  hstApplied     Boolean @default(true) // DEBT_SETTLEMENT lines always false
}

enum CreditEntryType {
  FUNDS_ADDED
  SALE_CHARGE
  MANUAL_ADJUSTMENT
  REFUND_CREDIT
  DEBT_SETTLED   // NEW — debt paid off via a checkout transaction, distinct from FUNDS_ADDED
}
```

A `DEBT_SETTLEMENT` line: `productId: null`, `lineType: "DEBT_SETTLEMENT"`, `hstApplied: false`,
`discountCents: 0` (UI never offers a discount control on it), `unitPriceCents`/`totalCents` =
the amount brought in, `quantity: 1`.

Migration required (`prisma migrate`) — no other schema changes.

## Backend

### `customerQueries.ts`

**`getCustomerDebtBreakdown(customerId): DebtBreakdown`**

Reconstructs which ledger entries make up the customer's current outstanding balance:

- Load `ledgerEntries` for the customer ordered oldest → newest (same source `getCustomerDetail`
  already uses).
- Replay them in order, maintaining a FIFO queue of unoffset debit entries (`SALE_CHARGE`,
  `MANUAL_ADJUSTMENT` when negative). Each credit (`FUNDS_ADDED`, `DEBT_SETTLED`,
  `MANUAL_ADJUSTMENT` when positive) offsets the oldest outstanding debits first — this must
  match the same running-balance math already used for `balanceAfterCents`, just attributed
  per-entry instead of only tracking the running total.
- For each remaining (partially or fully unoffset) `SALE_CHARGE`, join the linked `Transaction`
  + its `TransactionItem`s (non-debt lines only). Compare `transaction.tabAmountCents` to
  `transaction.totalCents`:
  - `tabAmountCents === totalCents` → full charge to tab
  - `0 < tabAmountCents < totalCents` → short-pay, shortfall = `tabAmountCents` (unoffset portion)
- For each remaining unoffset `MANUAL_ADJUSTMENT`, include it with its `note`.
- Cap the walk at 12 months of history OR the point where the running remainder reaches the full
  current balance, whichever bound is reached first — but never truncate entries that are still
  part of the unoffset total.
- Before returning, assert `sum(breakdown entries' contributed amounts) === currentBalanceCents`
  (from the latest `balanceAfterCents`). Throw on mismatch — this is a correctness bug, not a
  display nuance.

### `getTransactionDetail(transactionId)` (new, in `posQueries.ts` or `transactionQueries.ts`
alongside existing transaction reads)

Read-only fetch of a single transaction's non-debt line items (product name, quantity, price),
total, date, tender — same shape as `refund.getSaleDetails` but without refund-specific fields.
Backs both `[View]` (from the breakdown modal) and `[Details]` (from the cart line).

### `posQueries.ts::createTransaction`

Extend the existing function (already wraps everything in one `db.$transaction`, ~line 312):

- Accept an optional debt-settlement line item plus `settledCustomerId` /
  `settledAmountCents` in its input.
- Continue writing `TransactionItem` rows as today, including the debt line (`lineType:
  "DEBT_SETTLEMENT"`, `hstApplied: false`).
- Tax calculation: unchanged — already sums only `hstApplied` items, so the debt line is
  naturally excluded.
- Bill discount: before computing/capping `billDiscountCents` against the subtotal, subtract the
  debt line's `totalCents` from the discountable base first, so `billDiscountCents` can never
  apply against the debt portion.
- **Inside the transaction**, immediately before writing the `DEBT_SETTLED` ledger entry:
  re-fetch the customer's current `balanceAfterCents` and re-validate
  `settledAmountCents <= currentOutstanding`. If it now fails (e.g. a concurrent manual
  adjustment), throw and let the whole `$transaction` roll back — nothing is written, UI surfaces
  a retry-able error.
- Write the `DEBT_SETTLED` entry via the same `customerLedgerInternals.appendCreditEntry`
  helper already used for `SALE_CHARGE`, with:
  - `type: 'DEBT_SETTLED'`
  - `amountCents: settledAmountCents` (positive)
  - `transactionId: transaction.id`
  - `note`: auto-composed from the breakdown that was shown to the cashier, e.g. `"Debt settled
    via transaction <id> — covers transaction <id2> ($8.00), transaction <id3> ($39.00)"`,
    preserving the evidence trail permanently.

Failure anywhere in the `$transaction` (including the re-validation) rolls back both the
`Transaction`/items and the `DEBT_SETTLED` entry together — no separate failure boundary needed
since it reuses the existing wrapper.

## Frontend

### `CustomerSearchPanel.tsx` (new, extracted)

Pulled out of `CheckoutScreen.tsx`'s existing inline Pharmacy-Credit search state (search by
name/phone/email/address + "add new customer" inline-form fallback, mirroring the existing
duplicate-phone-check pattern). Props: `onSelect(customer)`, `onCreateNew(...)`. Used by:
- The new Link Customer button's search flow.
- The existing PHARMACY_CREDIT conditional search (unchanged behavior, just now backed by a
  shared component instead of duplicated inline state).

### `TransactionDetailView.tsx` (new, read-only)

Renders a single transaction's line items/date/total via `getTransactionDetail`. No selection
state, no refund flow — deliberately not sharing code with `RefundWorkflowModal` (confirmed too
entangled with refund-step state to extract cleanly). Used by `[View]` and `[Details]`.

### `BringInBalanceModal.tsx` (new)

Fetches `getCustomerDebtBreakdown(customerId)` on open. Renders the itemized list (date,
transaction number, short-pay/full-charge label with amounts, item names+quantities, `[View]`
per line, manual adjustments with their note). Editable amount field, defaulted to full
outstanding balance, validated `0 < amount <= balance` client-side (and re-validated
server-side at completion per above). On "Add to Bill," returns the chosen amount + breakdown
summary to `CheckoutScreen`, which adds a local (not-yet-persisted) `DEBT_SETTLEMENT` cart line.

### `CheckoutScreen.tsx` changes

- Header row: `[ product search ] [ Link Customer button ] [ ⋮ ]`, per §1.1 of the original
  brief (button shows linked customer's name + balance-owed indicator once linked; overflow menu
  has View customer profile / Unlink customer / Bring in outstanding balance, gated exactly as
  specified).
- If a customer is already linked via the top control and PHARMACY_CREDIT is then selected as
  tender, skip `CustomerSearchPanel` entirely and use the linked customer directly.
- Cart rendering: new branch for `lineType === 'DEBT_SETTLEMENT'` lines — no per-item discount
  button, `[Details]` (opens `BringInBalanceModal` read-only / or `TransactionDetailView`-style
  static breakdown) + `Remove` (deletes the local line, no backend call, no ledger effect).
- Subtotal/tax/discount display: debt line shown outside the taxed/discounted product subtotal,
  per §2.4 layout.
- PAY popup: PHARMACY_CREDIT option disabled with tooltip reason whenever a `DEBT_SETTLEMENT`
  line is present in the cart; re-enabled immediately if the line is removed.
- On completion: pass the debt line's amount + originating customer id through to
  `createTransaction`; on failure, cart state (including the debt line) is preserved for retry,
  matching existing transaction-failure handling.

## Non-negotiables (carried over from original brief)

- Debt-settlement line never taxed, never discounted (per-item or whole-bill).
- Pharmacy Credit never offered as tender while a debt-settlement line is present.
- `DEBT_SETTLED` entry written atomically with the transaction — enforced by both being in the
  same `db.$transaction`.
- Breakdown total must always exactly equal the customer's current outstanding balance — enforced
  by an assertion in `getCustomerDebtBreakdown`, not just a UI expectation.
- Amount brought in is capped at current outstanding balance, validated both client-side (on
  Add to Bill) and server-side (at transaction completion, against a fresh balance read).
- Removing the debt line pre-completion has zero backend/ledger side effects (it's purely local
  cart state until completion).
- Linking a customer via the top control never charges anything by itself.
- The evidence trail persists permanently in the `DEBT_SETTLED` entry's `note`, not just
  transiently in the modal.

## Testing

Unit tests (vitest, `src/__tests__/`):
- `getCustomerDebtBreakdown`: short-pay attribution, full-charge attribution, manual-adjustment
  inclusion, FIFO offset correctness across mixed entry types, sum-equals-balance invariant,
  behavior after a partial payoff (remainder correctly reflected on a subsequent call), 12-month
  cap behavior.
- `createTransaction` with a debt-settlement line: tax exclusion, bill-discount exclusion,
  successful atomic write of `Transaction` + `TransactionItem` + `DEBT_SETTLED` entry, rollback
  on simulated failure (nothing written), race-condition re-validation rejecting a now-too-large
  amount.

Maps directly onto all 18 scenarios listed in the original task brief (§5) — each has a
corresponding unit and/or integration test; UI-only scenarios (button states, modal display,
menu gating) verified via manual run-through per this project's CLAUDE.md guidance to test UI
changes in the running app before calling them complete.
