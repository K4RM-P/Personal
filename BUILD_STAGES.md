# Build Stages — Pharmacy POS

Companion to `KICKOFF_MASTER_PROMPT.md`. Read that first. This document sequences the work so each
stage produces something testable before the next stage begins. References point back to
`pharmacy-pos-feature-spec.md` (sections 1–10) and `hardware-integration-architecture.md`.

**Stack**: Electron + React + Tailwind CSS + shadcn/ui + SQLite (via Prisma). See
`KICKOFF_MASTER_PROMPT.md` for the reasoning — treat this as locked in, not open for reconsideration
mid-build.

Don't skip ahead — each stage assumes the previous one actually works, not just "is written."

---

## Stage 0 — Project skeleton & feature-flag layer
**Build:**
- Electron project scaffold (main process / renderer split), renderer built with React + Tailwind CSS
  + shadcn/ui (+ lucide-react for icons) — set up the shadcn theme/design tokens early so later
  screens inherit a consistent, modern look instead of default component styling
- SQLite database (via Prisma as the ORM) as the local, embedded data store — this is what makes
  offline-first operation possible later (Section 9 of the feature spec)
- A settings/config store (per-install, not per-user) with a feature-flag table
- A basic products table, customers table, and users/roles table via Prisma schema (empty/seed data
  is fine — this is the shape, not the data)

**Why first:** every later stage either reads or writes to these tables, and Section 10 of the
feature spec depends on flags existing before any optional module gets built. Getting the UI
component system (shadcn) and theme in place now also avoids retrofitting styling across dozens of
screens later.

**Done when:** app launches showing a styled (not default-Electron-gray) shell built with real
shadcn/ui components, Prisma can read/write to the SQLite file, and flipping a feature flag in
settings conditionally shows/hides a placeholder UI element.

---

## Stage 1 — Core checkout loop (no hardware yet)
**Build (feature spec Section 1):**
- Add items to a cart by manual lookup (search/select — barcode scanning comes in Stage 3)
- Apply tax rules
- Tender a sale (cash only for now)
- Hold/park a sale and resume it
- Void/void-line with manager override
- Generate a receipt as an on-screen summary (real printing comes in Stage 4)

**Done when:** you can ring up a full multi-item sale, tax calculates correctly, and completing the
sale actually persists a transaction record.

---

## Stage 2 — Inventory, cost, and the tiered markup pricing engine
**Build (feature spec Section 3):**
- Product CRUD with cost and retail price fields
- Tiered Markup Pricing Engine: owner-editable cost ranges + markup %, auto-calculated retail price
  using `retail = cost × (1 + markup%)`, no rounding
- Cost-change triggers immediate recalculation against the tier table
- Quarterly tier-review reminder (can be a stubbed/simulated trigger for now — don't over-build the
  scheduling infrastructure yet)
- Bulk product import via spreadsheet upload (CSV/XLSX), with a validate/preview-diff step before
  committing
- Tier change impact preview (before saving a tier edit, show which items would be affected)

**Done when:** importing a spreadsheet of products with costs correctly assigns retail prices per the
tier table, and editing a tier recalculates the right set of items live.

---

## Stage 3 — Barcode scanner integration
**Build (see `hardware-integration-architecture.md` Section 1):**
- Keyboard-wedge listener: capture fast sequential keystrokes ending in Enter as a scanned barcode,
  distinct from normal typing
- Wire scanned barcodes into the Stage 1 checkout cart (scan → look up product → add to cart)

**Done when:** a real USB barcode scanner (or a keyboard fast-typing simulation) adds items to the
cart without touching the mouse.

---

## Stage 4 — Receipt printing (real hardware)
**Build (see `hardware-integration-architecture.md` Section 2):**
- Receipt template module: structured order object → formatted layout (header, line items, tax,
  total, tender, change due)
- ESC/POS encoder integration for thermal printers
- Network-socket transport (port 9100) as the primary path; USB/Windows-print-queue as fallback
- Standard-printer/PDF fallback path for pharmacies without thermal hardware yet

**Done when:** a completed Stage 1 sale prints a real receipt on a networked thermal printer, and
also falls back cleanly to a PDF/standard printer if no thermal printer is configured.

---

## Stage 5 — One working payment adapter
**Build (see `hardware-integration-architecture.md` Section 3):**
- The common `PaymentProvider` interface (`init`, `charge`, `refund`, `void`, `getReaderStatus`)
- The provider registry/factory that picks an adapter based on a settings value
- **One real adapter, fully working end-to-end** — pick whichever processor has the fastest sandbox
  signup, since the goal here is validating the interface shape, not covering every processor yet
- Encrypted credential storage (Electron `safeStorage`) for API keys — never plain text

**Done when:** a Stage 1 sale can be paid by card through the real sandbox/test terminal for your
chosen processor, and the transaction result (approved/declined) reflects correctly in the app.

---

## Stage 6 — Customer accounts, charge accounts, and the tab/store-credit ledger
**Build (feature spec Section 4, and the Section 10 toggle wiring):**
- Customer profile (contact info, purchase history)
- Charge/on-account billing: invoice + statement generation
- Customer Tab / Store Credit ledger: short-pay flow, advance-fill flow, applying tab at checkout,
  full ledger history (not a balance overwrite), per-customer credit limit setting
- Both charge accounts and tab are independently toggleable per Section 10

**Done when:** a customer can short-pay a sale (balance goes negative), separately "fill" their tab
with no purchase (balance goes positive), and a later sale can apply that balance — with every step
showing up as its own ledger line.

---

## Stage 7 — Remaining payment adapters
**Build:** the other processor adapters (whichever you didn't build in Stage 5) against the same
`PaymentProvider` interface — this should require no changes to checkout code, only new adapter
modules plus registry entries.

**Done when:** switching the settings dropdown to a different processor works without touching
checkout logic at all — this is the real test of whether Stage 5's interface was designed correctly.

---

## Stage 8 — Pharmacy compliance features
**Build (feature spec Section 2):**
- Rx lookup/pickup-status search from the register
- Unclaimed-Rx aging report
- HIPAA-compliant e-signature capture (shared pad for NOPP, counseling, and card signatures)
- Pseudoephedrine (PSE) sales workflow with ID scan and quantity-limit checks
- Controlled substance audit trail
- DSCSA 2D barcode scan for lot/expiry/serial capture
- FSA/HSA auto-eligibility detection at checkout

**Done when:** each compliance feature works in isolation against a test sale; these are independent
of each other and can be built/tested in any order within this stage.

---

## Stage 9 — Remaining toggleable modules & polish
**Build (feature spec Sections 5, 6, 7, 9, 10):**
- Reporting/analytics (X/Z reports, top-sellers, owner dashboard, CSV/XLSX export)
- Staff roles/permissions, audit log export, multi-location support
- Tap-to-pay, text-to-pay link
- Cloud sync/offline fallback, web admin console, open data export, automated backup
- Reward points program (toggle)
- Lottery ticket sales & win tracking (toggle)

**Done when:** all remaining Section 10 modules exist behind flags and default to *off* for a fresh
pharmacy install, requiring explicit opt-in.

---

## Notes on sequencing
- Hardware (Stages 3–5) comes *after* the core checkout loop (Stage 1) so transaction logic can be
  tested without waiting on physical devices or sandbox accounts.
- Pricing (Stage 2) comes before hardware because inventory needs real prices before checkout is
  meaningful to test with.
- Compliance features (Stage 8) come late deliberately — they're independent of each other and don't
  block the core sales loop, but they're not optional for a real pharmacy launch, so don't skip them.
