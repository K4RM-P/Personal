# Pharmacy POS — Kickoff Master Prompt

Paste this whole document into Claude Code as the opening message for this project. It explains
what we're building, what's already been decided, and where the detailed specs live.

---

## What this project is

A desktop Point-of-Sale (POS) system for independent pharmacies, built as an **Electron** app
(Node.js main process + Chromium-rendered UI). It's inspired by the feature set of an existing
Canadian pharmacy POS product (Fillware POS) plus features pulled from several other real pharmacy
POS systems, plus a set of new/modernized features designed specifically for this build.

The system will be **sold to multiple independent pharmacies**, each of which configures their own
feature set (loyalty on/off, lottery on/off, tab/credit on/off, etc.) rather than getting a
one-size-fits-all product. This has a real architectural consequence: **build a feature-flag/settings
layer before building the individual feature screens**, so every optional module checks a flag before
rendering instead of being hard-wired in. Retrofitting this after the fact is expensive — decide it now.

## Where the specs live (read these before writing code)

1. **`pharmacy-pos-feature-spec.md`** — the full feature list, organized into 10 sections:
   1. Core Transaction Engine
   2. Pharmacy-Specific & Compliance
   3. Inventory & Ordering (includes the **Tiered Markup Pricing Engine**)
   4. Customer Management (includes the **Customer Tab / Store Credit Balance** ledger)
   5. Reporting & Analytics
   6. Staff, Security & Multi-Location
   7. Payments
   8. Hardware & Peripherals
   9. Modernization Layer
   10. Optional / Toggleable Modules (feature-flag list — reward points, lottery, charge accounts, tab)

   Every feature is tagged **[F]** (from Fillware), **[C]** (from competitor research), or **[N]**
   (new/modernized). Read this whole file first — it's the source of truth for *what* to build.

2. **`hardware-integration-architecture.md`** — *how* to integrate the three physical devices:
   - Barcode scanner (USB HID keyboard-wedge mode — no special driver code needed for MVP)
   - Receipt printer (ESC/POS protocol, network-socket transport preferred, USB fallback — this
     requires building a receipt template/generation module, described in that file)
   - Payment terminal (adapter/factory pattern so the pharmacy can plug in **any** processor's API key
     — Moneris, Global Payments, Stripe Terminal, Square — behind one common interface)

3. **`BUILD_STAGES.md`** — the actual step-by-step build order referencing both files above. Follow
   this in sequence; don't jump ahead to later stages before earlier ones are working end-to-end.

## Key decisions already locked in (don't relitigate these without asking)

- **Platform**: Electron desktop app, not a web app or mobile app.
- **UI stack**: React (in the renderer process) + Tailwind CSS + shadcn/ui components + lucide-react
  for icons. shadcn/ui specifically — not Material UI, Bootstrap, or default OS widgets — because the
  explicit goal is a modern, clean look, not the dated appearance of legacy pharmacy POS software like
  Fillware. Customize shadcn's components to a distinct look rather than shipping its default theme
  as-is.
- **Database**: SQLite (embedded, file-based) accessed via Prisma as the ORM, for local-first
  operation — the till must keep working with zero internet dependency (this is required by the
  offline-fallback feature in Section 9 of the feature spec). If/when multi-location cloud sync is
  built later, the pattern is: SQLite stays the source of truth per till, with a sync layer pushing to
  a central Postgres database for cross-location reporting — that central piece is explicitly out of
  scope for MVP.
- **Payment integration**: must support multiple processors interchangeably via a common
  `PaymentProvider` interface + per-processor adapters + a config-driven factory. No processor gets
  hard-wired into checkout logic.
- **Pricing formula**: retail price = cost × (1 + tier markup%), applied exactly, **no rounding**.
  Example: $1.00 cost at 200% markup = $1.00 × 3 = $3.00. Tiers (both the cost ranges and their
  markup %) are fully owner-editable.
- **Cost-change repricing**: automatic and immediate, no approval step. A quarterly reminder nudges
  the owner to review the tier table itself (not individual items).
- **Customer Tab / Store Credit**: one ledger, not two separate systems — a negative balance means
  the customer owes the store (short-pay), a positive balance means pre-loaded store credit. Every
  fill/short-pay/applied-tab event is its own timestamped ledger line, not a balance overwrite.
- **Excluded-then-restored features**: earlier in planning, reward points and lottery were
  considered for removal — **they are back in**, as opt-in toggleable modules (Section 10 of the
  feature spec). Every pharmacy chooses its own feature set; nothing gets removed at the product level.
- **Feature flags are per-install, not per-user** — one pharmacy's config doesn't affect another's.

## What "done" looks like for this kickoff

Don't try to build all 10 sections of the feature spec at once. Start with `BUILD_STAGES.md` Stage 0
and confirm the project skeleton (Electron + React/Tailwind/shadcn + SQLite/Prisma) actually runs
before writing feature code. Ask before making any other architecture-level decision not already
locked in above — those are worth a quick check-in rather than a silent choice.
