# Pharmacy POS — Feature Spec (v1)

Sources: Fillware POS, PioneerRx, BestRx/BestPOS, PrimeRx, Liberty Software, QS/1,
SRS PKon POS, Auto-Star RxPOS, Emporos, AbacusRx, POSiTrack Rx — plus new modernization features.

All Fillware features are kept. Ones that don't fit every pharmacy (loyalty, lottery, etc.) are
built as toggleable modules — see Section 10 — so each pharmacy configures its own feature set
rather than getting features removed at the product level.

Legend: **[F]** kept from Fillware · **[C]** added from competitor research · **[N]** new/modernized idea

---

## 1. Core Transaction Engine
- Standard checkout: scan/lookup item, apply tax rules, tender, print/email receipt **[F]**
- Returns & refunds, with reason codes **[F]**
- Hold/park a sale and resume later (e.g. customer forgot wallet, waiting on Rx) **[F]**
- Void/void-line with manager override **[C]**
- Discount levels by customer type (senior, staff, insurance-plan cash price) — not loyalty, just pricing tiers **[F, refined]**
- Promotions/sales at item or category level, with start/end dates **[F]**
- Split tender (cash + card + charge account in one sale) **[C]**
- Lay-away / hold-check management **[C — POSiTrack]**

## 2. Pharmacy-Specific & Compliance (the part Fillware barely covers)
- Rx lookup from the POS register — search by patient, Rx #, or drug to confirm pickup status/balance **[F]**
- Prescription pickup log with unclaimed-Rx tracking/aging report **[C — POSiTrack, PrimeRx]**
- HIPAA-compliant electronic signature capture (NOPP, counseling acknowledgment, Rx pickup) from one signature pad, reused for card signatures too **[C — SRS, AbacusRx]**
- Pseudoephedrine (PSE) sales workflow: ID scan, quantity/day and 30-day limit checks, NPLEx-style e-reporting **[C — critical gap vs. Fillware]**
- Controlled substance sale audit trail (who, what, when) for DEA-style diversion prevention **[C]**
- DSCSA-style 2D barcode scan at sale (captures lot #, expiration, serial) for track-and-trace **[C]**
- FSA/HSA auto-eligibility detection at checkout (flags qualifying OTC/Rx items automatically) **[C — IIAS-style]**
- Charge/on-account billing: invoice generation, monthly statements, post payments at register **[F]**
- Insurance/third-party claim status flag on OTC-adjacent items (informational, not a claims engine) **[N]**

## 3. Inventory & Ordering
- Real-time stock levels tied to sales as they happen **[C]**
- Low-stock and expiring-stock alerts (flag items nearing expiry before they become dead stock) **[C]**
- Electronic ordering to suppliers + invoice upload/reconciliation **[F]**
- Barcode generation + in-store shelf label printing **[F]**
- Handheld/mobile scanner support for receiving and cycle counts **[C]**
- **[N] Bulk product import/update via spreadsheet upload** — drag in a CSV/XLSX of SKU, price, cost, qty, supplier, expiry; validate and preview diffs before committing. This is the single biggest quality-of-life upgrade over legacy systems like Fillware, which assume manual entry or vendor-specific EDI only.
- **[N] Auto-reorder rules** — set a reorder point/quantity per SKU; system drafts a PO automatically when stock crosses the threshold
- **[N] Expiry-based markdown automation** — auto-flag or auto-discount items inside a configurable expiry window

### Tiered Markup Pricing Engine **[N]**
Flat universal markup breaks at both ends of the price range (100% markup makes $1 profit on a $1 item —
too thin — but $100 profit on a $100 item — too much). Instead, the owner defines **cost-based tiers**,
each with its own markup percentage, and every item's retail price is derived from its supplier cost
automatically:

- **Tier setup**: owner defines ranges by cost price (what the pharmacy paid), e.g. $0–$3 → 200%
  markup, $3.01–$10 → 100% markup, $10.01–$30 → 60% markup, $30.01+ → 30% markup — as many tiers as
  needed, fully editable.
- **Auto-calculated retail price**: whenever an item's cost is entered or updated (manual entry, supplier
  invoice upload, or the bulk spreadsheet import from Section 3), the system finds which tier the cost
  falls into and computes retail price = cost × (1 + tier markup%). No per-item manual pricing needed
  unless the owner wants to override.
- **Per-item override**: any individual item can be pinned to a manual price that ignores the tier rule
  (e.g. a loss-leader OTC item, or a price-matched competitor item) — tiers set the default, not a hard
  rule.
- **Formula (no rounding)**: retail price = cost × (1 + markup%), applied exactly, no rounding to a
  price-ending. Worked example: $1.00 cost at a 200% markup tier → $1.00 × (1 + 2.00) = **$3.00**. A
  $5.00 cost item in a 100% markup tier → $5.00 × (1 + 1.00) = **$10.00**. Whatever decimal the formula
  produces is the shelf price, exactly as calculated.
- **Recalculation on cost change**: when a supplier raises/lowers cost, the item's retail price
  recalculates **automatically and immediately** against the tier table — no approval step. The item is
  simply re-evaluated against the same tier ranges (e.g. cost moving from $3 to $5 either lands in a new
  tier or stays in the same one if both fall within it), and the new price applies right away.
- **Quarterly tier-review alert**: every 3 months, the system automatically notifies the
  pharmacist/owner to review the tier table itself — not individual items — as a prompt to reconsider
  whether the ranges and markup percentages still make sense (supplier costs drift, competitors change,
  etc.). This is a reminder only; nothing changes unless the owner edits the tiers themselves.
- **Tier change impact preview**: before saving a change to the tier table itself (e.g. owner adjusts the
  $10–$30 tier from 60% to 50%), show how many items and which ones would be affected, so it's not a
  blind mass-repricing.
- **Multiple tier tables** (later, optional): different tier sets per category (e.g. front-store retail
  vs. OTC pharmacy items) if a flat one cost-based scale doesn't fit every product type — start with one
  universal tier table for MVP, extend to per-category tables only if needed.

## 4. Customer Management (non-loyalty)
- Customer profile: contact info, purchase history, charge account balance **[F]**
- Detailed purchase & payment history lookup **[F]**
- **[N] Refill/pickup text & email reminders** (not marketing — operational: "your prescription is ready")
- **[N] Household/family linking** (spouse, kids, dependents) for shared charge accounts or pickup on behalf of

### Customer Tab / Store Credit Balance **[N]**
One running balance per customer that can go **negative** (they owe the store — a short-pay tab) or
**positive** (they've pre-loaded funds — store credit). Build this as a single ledger rather than two
separate features:

- **Short-pay flow**: at checkout, if the customer can't cover the full total, cashier records the
  partial payment and the shortfall is added to that customer's tab (balance decreases). Receipt shows
  amount paid, amount owed, and new tab balance.
- **Advance-fill flow**: customer pays money in with no purchase attached — cashier runs a "fill tab"
  transaction (cash, card, etc.) and the balance increases by that amount. Receipt shows amount added
  and new balance.
- **Applying the tab**: at any future checkout, cashier can apply the customer's tab balance toward the
  total — if positive, it reduces what's owed (like store credit); if negative, the new sale total
  includes what was already owed, so the customer has to close the gap before/along with the new
  purchase (configurable: allow stacking more debt vs. require payoff first).
- **Ledger, not just a number**: every fill, short-pay, and applied-tab event is a timestamped line item
  tied to a user/station, not just a balance overwrite — this is what makes it auditable and matches
  the transaction-traceability requirement in Section 6.
- **Statements**: reuse the existing charge-account invoice/statement printing (Section 2) for tab
  balances too — a customer's "tab" and "charge account" are really the same underlying ledger with two
  different names, so this doesn't need a separate reporting path.
- **Toggle**: like everything in Section 10, this ships as an opt-in module — pharmacies that don't want
  to extend informal credit can leave it off entirely.
- **Caution flag for later**: extending credit like this is a real financial/legal exposure for the
  pharmacy (uncollected tabs, disputes over balances) — worth a plain "this is not a loan/credit product,
  just an in-store bookkeeping convenience" note in the settings screen when a pharmacy turns it on, and
  worth putting a per-customer credit limit option in from the start so it doesn't turn into unbounded
  informal lending.

## 5. Reporting & Analytics
- Full audit reports (X/Z reports, cashier reconciliation) **[F]**
- Top-selling products / sales-by-category **[F]**
- Sales by cashier, station, or time/date **[F]**
- **[N] Simple owner dashboard**: daily sales, margin, top movers, low-stock count — one screen, no report-building required
- **[N] Exportable reports** (CSV/XLSX) for the accountant, no proprietary format lock-in

## 6. Staff, Security & Multi-Location
- Role-based permissions (cashier vs. pharmacist vs. manager/owner) **[F]**
- Transaction traceability by user/station **[F]**
- **[C] Multi-location support** — centralized inventory + unified reporting across stores, if/when they expand
- **[N] Audit log export** — every price override, void, and discount tied to a user and timestamp, exportable for compliance review

## 7. Payments
- Debit/credit integration (EMV-capable) **[F, modernized]**
- **[N] Tap-to-pay / contactless** support (table stakes in 2026, absent from Fillware's list)
- **[N] Text-to-pay link** for phone/delivery orders, so patients can pay before pickup **[C — BestRx/PrimeRx pattern]**

## 8. Hardware & Peripherals
- Customer-facing pole/screen display showing total & change due **[F]**
- Receipt printer, barcode scanner, signature pad — standard **[F/C]**
- Touch-screen ready UI **[F]**

## 9. Modernization Layer (net-new, not in any legacy competitor)
- **[N] Cloud-based with local offline fallback** — keep selling if internet drops, sync when it's back
- **[N] Web-based admin console** — manage pricing/inventory from a browser, not just the till
- **[N] Open data export / API-first design** — no vendor lock-in; your own data is always extractable
- **[N] Built-in automated backup with restore test**, not just "backup exists"
- **[N] Simple onboarding wizard** for spreadsheet-based initial inventory load (pairs with the bulk import feature above)

---

## 10. Optional / Toggleable Modules
Every pharmacy that buys this won't want the same feature set (a clinical/compounding-focused
pharmacy has very different needs than a high-volume retail-front one). Rather than hard-baking
opinions about what belongs, these ship as modules each pharmacy can turn on or off from settings —
same pattern as the "provider" toggle for payment adapters.

- **Reward Points program** **[F]** — dollar- or product-based loyalty points, redeemable on future
  purchases. Off by default for clinical-only locations, on for retail-front pharmacies that compete
  with drugstores on front-of-store sales.
- **Ontario Lottery ticket sales & win tracking** **[F]** — regional and legacy-specific, but real for
  Ontario independents; built as a toggle rather than assumed, so it's a no-op for pharmacies outside
  Ontario or without a lottery terminal.
- **Charge/on-account billing** (from Section 2) — also toggleable; some pharmacies want it, some don't
  carry receivables at all.
- **Customer Tab / Store Credit Balance** (Section 4) — shares the same underlying ledger as charge
  accounts; toggle independently since some pharmacies want statements/invoicing but not informal tabs,
  or vice versa.
- Any future region-specific or business-model-specific feature should default to this pattern: build
  it as a module with a settings toggle, not baked into the core checkout path.

**Implementation note for Claude Code:** this argues for a feature-flag/settings table from day one
(per-install config, not per-user) — each module's UI (buttons, screens, reports) checks the flag before
rendering, and checkout logic never assumes a module is present. Cheaper to build this in from the start
than to retrofit it once features are hard-wired in.

---

*Next step: turn each section into a module list (data model + screens) so Claude Code can scaffold the build incrementally rather than all at once.*
