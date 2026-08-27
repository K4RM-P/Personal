# Blister Pack Feature — Design Spec

Date: 2026-08-27

## 1. Purpose

Track pharmacy blister-pack (dosette/pill organizer) prep/due/pickup cycles per
patient, with a checkout-integrated "dispense" action that closes out the
current cycle and automatically schedules the next one.

## 2. Data model

New Prisma model `BlisterPack`:

| Field | Type | Notes |
|---|---|---|
| `id` | Int, PK, autoincrement | |
| `customerId` | Int, FK → `Customer.id` | Patient — required |
| `frequency` | String enum-like: `WEEKLY` \| `BIWEEKLY` \| `MONTHLY` | Refill interval; drives next-cycle math |
| `prepDate` | DateTime | Always `dueDate − 7 days`, computed, never entered directly |
| `dueDate` | DateTime | Primary date input — when the patient needs their next pack |
| `pickupDate` | DateTime? | Null = pending (not yet picked up). Set when dispensed at checkout |
| `preparedBy` | String | Free-text initials, manually entered — not tied to login session |
| `numPrescriptions` | Int | Simple count, no linkage to a prescription entity (none exists in this app yet) |
| `createdAt` / `updatedAt` | DateTime | Standard |

Indexes: `@@index([customerId])`, `@@index([dueDate])`, `@@index([pickupDate])` (dashboard filters/sorts on all three).

A record is "pending" when `pickupDate IS NULL`. A customer should generally
have at most one pending record at a time (created manually or by the
previous dispense), though this is not DB-enforced — the checkout flow always
picks the pending record with the soonest `dueDate` if more than one exists.

## 3. Frequency → interval mapping

| Frequency | Interval added to pickup date for next due date |
|---|---|
| WEEKLY | +7 days |
| BIWEEKLY | +14 days |
| MONTHLY | +28 days |

`prepDate` is always `dueDate − 7 days`, in both manual creation and
auto-generated next-cycle records.

## 4. Checkout integration

A new **Blister** button sits next to the existing RX / Non-RX custom-item
buttons in `CheckoutScreen.tsx`. It does not touch the cart or pricing —
purely a tracking/workflow action (confirmed: no billable line item).

Flow (`BlisterDispenseModal`, new component, following the same
conditional-render + Escape-key-close pattern as `CustomProductModal`):

1. **Search & attach patient** — reuses `CustomerSearchPanel` exactly as
   checkout's existing "Link Customer" flow does.
2. Once a patient is attached, the modal calls
   `window.api.blister.getPendingForCustomer(customerId)`.
   - **No pending record found** → show "No pending blister pack for this
     patient — add one from Blister → Database." No dispense action
     available. This is a terminal state for the modal (patient can be
     changed to search again, or modal closed).
   - **Pending record found** → show frequency, prep date, due date, #
     prescriptions, plus a required initials textbox and a **Dispense
     Blister** button (disabled until initials are non-empty).
3. Clicking **Dispense Blister** calls `window.api.blister.dispense(id,
   preparedByInitials)`, which atomically (single Prisma transaction):
   - Sets `pickupDate = now` and `preparedBy = preparedByInitials` on the
     existing pending record — the checkout initials box is the point staff
     confirm who's handing the pack over, and overwrites whatever
     `preparedBy` value the record had at creation.
   - Creates a new record: same `customerId`, same `frequency`, same
     `numPrescriptions`, `dueDate = pickupDate + frequency interval`,
     `prepDate = dueDate − 7`, `pickupDate = null`, `preparedBy = ''`
     (blank — the next pack hasn't been prepared yet; filled in later via
     the Database tab when it's physically assembled).
4. On success, modal shows a brief confirmation and closes.

## 5. Blister tab (new top-level nav)

`NavTab` union gets `'blister'`; entry added to `allNavItems` in
`AppShell.tsx` (icon: `Package` or similar — not RX-specific since this
isn't dispensing a prescription itself). Not manager-only — same access as
Checkout, per your answer. Lazy-loaded screen `BlisterScreen.tsx`, wired into
`App.tsx`'s `renderTab()` switch.

Two sub-tabs via the same pill-button `subTab` state pattern used in
`ReportsScreen.tsx`:

### 5.1 Database sub-tab

Table layout modeled on `CompleteProductSalesTable` (search box, sortable
columns via the existing `useSort`/`SortableTh` helpers, no CSV export in
this iteration — YAGNI, easy to add later following
`buildCompleteProductSalesCsv` as a template if requested):

Columns: Patient Name, Frequency, Prep Date, Due Date, Pickup Date, Prepared
By, # Prescriptions.

Plus an **Add Blister Pack** form (same manual-entry pattern as the existing
"Custom Products" panel in `ProductsScreen.tsx`): patient search (attach a
`Customer`), frequency dropdown, due date picker (prep date auto-displays,
non-editable), # of prescriptions, prepared-by initials textbox. Each row
gets edit (pencil) and delete (trash) actions, matching the Custom Products
row-action pattern — full CRUD, no restrictions on editing/deleting
historical records.

### 5.2 Dashboard sub-tab

Single search/filter screen:
- A dropdown to choose which date column drives the filter/sort: Prep Date /
  Due Date / Pickup Date.
- A date-range picker (reuse the shared `DateRangePicker` component) applied
  to whichever column is selected.
- A patient-name search box.
- Results table (same columns as Database, plus a computed **Status**
  badge):
  - **OVERDUE** (red) — `pickupDate IS NULL AND dueDate < today`
  - **DUE SOON** (amber) — `pickupDate IS NULL AND dueDate` within the next
    3 days (inclusive of today)
  - **PICKED UP** (neutral/green) — `pickupDate IS NOT NULL`
  - *(no badge)* — pending, due date more than 3 days out

Status is computed at query time, not stored.

## 6. Backend

- `prisma/schema.prisma` — new `BlisterPack` model (§2).
- New migration: `ALTER`/`CREATE TABLE` for `BlisterPack` per the custom
  migration-runner pattern (plain SQL file under `prisma/migrations/`).
- `src/main/db/queries/blisterQueries.ts`:
  - `listBlisterPacks(db, filters)` — filters: `dateField: 'prep' | 'due' |
    'pickup'`, `fromDate`, `toDate`, `patientQuery`. Used by both Database
    (unfiltered/search-only) and Dashboard (date-range + column) tabs.
  - `createBlisterPack(db, data)` — computes `prepDate` from `dueDate`.
  - `updateBlisterPack(db, id, data)` — recomputes `prepDate` if `dueDate`
    changes.
  - `deleteBlisterPack(db, id)`.
  - `getPendingBlisterPackForCustomer(db, customerId)` — returns the pending
    record with soonest `dueDate`, or `null`.
  - `dispenseBlisterPack(db, id, preparedByInitials)` — the transactional
    pickup + next-cycle-creation described in §4.
- `src/shared/channels.ts` — `BLISTER_LIST`, `BLISTER_CREATE`,
  `BLISTER_UPDATE`, `BLISTER_DELETE`, `BLISTER_GET_PENDING_FOR_CUSTOMER`,
  `BLISTER_DISPENSE`.
- `src/main/ipc/blisterHandlers.ts` — thin wrappers, registered in
  `registerAllHandlers()`.
- `src/preload/index.ts` — `window.api.blister.*`.
- `src/shared/types.ts` — `BlisterPack`, `BlisterPackFilters`,
  `CreateBlisterPackInput` etc. DTOs.

## 7. Out of scope (YAGNI, revisit if requested)

- CSV export for the Database/Dashboard tables.
- Enforcing "at most one pending record per customer" at the DB level.
- Linking `numPrescriptions` to a real prescription entity (none exists).
- Manager-only restriction (explicitly not wanted).
- Auto-filling `preparedBy` from the logged-in session (explicitly wanted as
  free-text initials instead).

## 8. Testing

- `blisterQueries` unit tests: create computes correct `prepDate`; dispense
  correctly stamps pickup and creates next cycle with correct math for all
  three frequencies; `getPendingBlisterPackForCustomer` picks soonest due
  date among multiple pending records; dashboard filter by each date column.
- Typecheck + existing suite must stay green; new tests follow existing
  `src/__tests__/*.test.ts` conventions.
