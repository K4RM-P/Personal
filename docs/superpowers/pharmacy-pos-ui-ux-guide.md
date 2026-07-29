# Pharmacy POS — UI/UX Design Guide

Research-grounded design direction for Claude Code/Cursor to implement the actual screens. This is
not a moodboard — it's a set of concrete, enforceable rules, because the two failure modes for an
AI-built UI are (1) defaulting to generic "AI slop" aesthetics, and (2) defaulting to bad POS UX
patterns that slow down a till operator during a real transaction. Both are addressed below.

---

## Part 1 — What real POS UX research says (not opinion, established practice)

Current commercial POS systems (Square, Toast, Clover, Lightspeed) and UX research on POS interfaces
converge on the same handful of hard rules, because a checkout counter is one of the least forgiving
UI contexts that exists — every wasted tap multiplies across thousands of transactions a day, and the
person using it is often standing, rushed, and half-watching a customer instead of the screen.

- **The three-tap rule.** Any core action (add item, apply discount, tender a sale) should be
  reachable in three taps or fewer. If it takes more, it's in the wrong place in the hierarchy.
- **Touch targets, not click targets.** Buttons need real finger-sized hit areas — this is not a
  desktop mouse-precision UI. Undersized buttons cause mis-taps, which cause wrong items rung up,
  which cause refunds and distrust in the system.
- **High contrast over subtlety.** A checkout screen is glanced at, not read. Low-contrast gray-on-gray
  text (common in "elegant" SaaS dashboards) actively hurts a POS — text and price numbers need to be
  readable at a glance, from arm's length, sometimes under bad store lighting.
- **Flat information hierarchy, not nested menus.** Cashiers shouldn't hunt through submenus mid-sale.
  Core actions live on one visible surface (the cart/checkout screen itself), not buried in settings-
  style navigation.
- **Speed and lag-free response are UX, not just performance.** A checkout screen that visibly delays
  after a tap breaks trust immediately — a POS UI has to feel instantaneous, which constrains motion
  design (heavy transition animations are a liability here, not a delight feature).
- **The physical/software pairing matters.** Hardware peripherals (scanner, receipt printer, card
  reader) need to feel like one integrated flow in the UI, not bolted-on side panels — this is a UX
  point as much as a technical one from the hardware-integration doc.
- **Legacy systems are hideous but functional — don't confuse "looks dated" with "is unusable."**
  Cashiers who've used the same clunky POS for years develop real muscle memory around its quirks.
  When redesigning, the goal is looking modern *without* breaking the fast, predictable interaction
  patterns that make a POS usable under pressure — not novelty for its own sake.

**Translation for this project:** the checkout screen is the most important screen in the entire
app. It should look and feel closer to a fast, high-contrast, touch-first tool (think an airport
check-in kiosk or a well-designed restaurant POS) than a typical polished SaaS dashboard. Aesthetic
decisions always yield to speed and clarity on this screen specifically.

---

## Part 2 — What to explicitly avoid ("AI slop") and why it's actively wrong here

AI coding agents have a well-documented default aesthetic that shows up constantly across unrelated
projects — this isn't a style preference, it's a recognized failure pattern with a name, because
models default to the statistical average of everything they've seen rather than making an actual
design decision. **None of it is acceptable in this build, and several of these patterns are actively
dangerous specifically in a POS context, not just dated-looking:**

| Anti-pattern | Why it's generic | Why it's *worse* here specifically |
|---|---|---|
| Purple-to-blue/indigo gradients | The single most recognizable AI-generated-UI tell — traced back to a widely-copied Tailwind UI default color | Reads as generic SaaS, not a clinical/retail tool; undermines trust in a pharmacy context |
| Permanent dark mode as the default | AI agents reach for dark mode reflexively even when unasked | A checkout counter is often under bright retail lighting — dark UI fights glare and readability |
| Glassmorphism / blur effects everywhere | Applied because it "looks modern," not because it serves a purpose | Blur reduces text legibility exactly where a cashier needs a fast, certain read of a price |
| Soft, ambiguous drop shadows on every card | Generic "elevate everything" habit | Ambiguous depth cues slow down at-a-glance parsing of what's tappable |
| Three-feature-card grids, nested cards inside cards | Copy-pasted SaaS marketing-page pattern, meaningless on an operational screen | A POS isn't a marketing page; this pattern adds visual noise with zero functional benefit |
| One big centered rounded icon above a heading | Generic dashboard/empty-state filler | Wastes vertical space a cashier needs for actual controls |
| Inter font by default, with no real typographic hierarchy | The most overused typeface in AI-generated interfaces | Contributes to the generic "template" feel this project is explicitly trying to avoid |
| Floating gradient orbs / abstract 3D blobs as decoration | Decoration with no functional role | Pure noise on a working tool — nothing on this screen should be decorative-only |
| Hover states that do nothing, uniform fade-in on every element | Motion added by reflex, not by decision | Unnecessary animation on a POS reads as *latency* to a cashier mid-sale, which erodes trust |

**The fix is the same one design researchers give for any AI-agent UI work: pick a real, specific
direction and lock it down before writing component code, rather than asking for "modern and clean"
and hoping.** Part 3 is that direction, made concrete and locked.

---

## Part 3 — The locked design direction for this project

This builds on and formalizes the "calm clinical base + confident accent" direction already approved
in the Stage 0 design doc — this section is the full expansion of that, now covering every screen.

### Design identity
**Direction: "Clinical-calm, high-contrast operational tool" — closer to a well-built medical device
interface or airport kiosk than a SaaS dashboard.** Not playful, not decorative, not trend-chasing.
Every visual choice below exists to serve fast, certain, glanceable interaction — if a component
doesn't earn its place functionally, it doesn't go on the checkout screen.

### Color
- **Base palette:** cool neutral grays (already locked: deep slate background tones), **light-mode
  first — confirmed and locked**, not a tentative recommendation. Per Part 1's lighting point, dark
  mode is wrong for a bright retail counter; this decision has been made deliberately and should not
  be revisited without a real reason (e.g. a specific pharmacy requesting dark mode as an optional
  per-install toggle, which is a fine later addition but not the default).
- **One accent color, used deliberately, not as decoration:** the medical teal already chosen for
  primary actions. It appears *only* on things the user should act on (primary buttons, active nav
  state, the "complete sale" button) — never as background wash, never as gradient, never paired with
  a second competing accent.
- **No gradients anywhere in the working UI.** Flat, solid fills only. This is a hard rule, not a
  preference — it's the single fastest visual tell that separates a deliberately-designed tool from a
  generic AI output.
- **Status colors are functional, not decorative:** a small, fixed set — success/confirmed (green),
  warning/needs-attention (amber), error/declined (red), owed/negative-balance (a distinct signal
  color, not just red reused, since "customer owes tab" and "transaction failed" are different
  severities and shouldn't share a color).
- **Contrast target: WCAG AA minimum (4.5:1) for all text, checked against the actual palette — not
  assumed.** This matters more than it does on a marketing site because of the glance-and-go nature of
  checkout use.

### Typography
- **Not Inter as the unexamined default.** Pick one real typeface pairing and commit: a clean,
  slightly condensed grotesque/sans (e.g. IBM Plex Sans, Public Sans, or similar — something with a
  distinct enough character that it doesn't read as "the AI default") for UI chrome, paired with a
  **tabular-figure numeric style** for all prices/quantities so digits align in columns without
  jitter — this matters concretely for a cart list where prices need to visually line up.
- **Real hierarchy, not just size steps:** headings, prices, and body text should be distinguishable
  by weight and spacing, not only font-size — this is what "actual typographic hierarchy" (the
  documented fix for AI-slop typography) means in practice.
- **Price text is the most important text on the whole app.** It gets the largest, highest-contrast,
  most deliberate treatment on the checkout screen — bigger and bolder than any heading.

### Shape, elevation, borders
- **Cards default to a thin, deliberate 1px border, not a soft ambiguous shadow.** Borders communicate
  boundaries instantly; shadows are used sparingly and only for genuinely elevated/floating elements
  (a modal, a dropdown) — never for static content cards, which is where AI-generated UIs over-apply
  them.
- **Radius: consistent and moderate, not maximalist-rounded.** The touch-friendly generous radius
  already locked in Stage 0 stays, but it's a fixed token used everywhere identically — not
  varying per-component by whim.
- **No decorative elements without function.** No abstract shapes, no illustration filler, no icon
  used purely as visual spacing. Every icon on screen either labels a real action or communicates real
  state (e.g. a lock icon on a manager-override field).

### Motion
- **Motion is functional, not ambient.** Transitions exist only to communicate a state change the user
  needs to track (item added to cart, screen changed, error surfaced) — snappy and immediate (under
  ~150ms), never a slow fade used purely for polish. No animation should ever make an action *feel*
  slower than it is; on a POS, perceived latency is a direct UX cost.

### Touch & layout rules (POS-specific, non-negotiable)
- Minimum touch target: 44×44px equivalent, larger for primary actions (tender/complete sale button
  should be the single largest tappable element on the checkout screen).
- Checkout screen layout: **cart list + running total permanently visible on one side, numeric/action
  controls on the other** — never buried behind a tab switch mid-sale.
- Settings, reporting, and admin screens can use a calmer, denser, more traditional layout (sidebar +
  content, per the Stage 0 app shell) — the strict speed/glanceability rules above apply most strictly
  to the **checkout screen itself**, which is the one screen used constantly, under time pressure, all
  day.

---

## Part 4 — Screen-by-screen direction

### Checkout (highest priority screen — build this to the strictest standard)
- Persistent cart panel: item name, quantity (steppable inline, large tap targets), line price
  (tabular-aligned), running subtotal/tax/total always visible without scrolling on a normal
  till-sized display.
- Large, unmistakable primary action for tendering — teal accent, biggest element on screen.
- Barcode scan input always focused/ready (per the hardware-integration doc's keyboard-wedge design)
  — no click-to-activate step before a scan works.
- Hold/park and void actions present but visually secondary (smaller, neutral-colored) — accessible,
  not competing with the primary flow.
- Manager-override actions (void, discount) require a distinct, deliberate visual state (e.g. a lock
  icon + confirmation), so it's never ambiguous whether an elevated action is happening.

### Products / Inventory
- Dense, scannable table for the product catalog — sortable, searchable, with cost/price/tier columns
  clearly distinguished (tier-derived prices visually flagged as "auto" vs. manually pinned, per the
  tiered markup pricing engine's override feature).
- Bulk-import (spreadsheet upload) gets a clear preview/diff step before committing, matching the
  "validate before commit" design already locked in the feature spec.

### Customers / Tab
- Customer profile shows the running tab/store-credit ledger as an actual transaction list (fills,
  short-pays, applied balances each their own line), not just a single number — this is a direct
  requirement from the ledger design, not a style choice.
- Negative balance (owed) and positive balance (credit) are visually distinguished by more than color
  alone (e.g. a "-" sign is never dropped, per the earlier currency-formatting convention) —
  accessibility rule, not decoration.

### Settings / Feature Flags
- Every toggleable module (Section 10 of the feature spec) appears as a clearly labeled switch with a
  one-line description — no jargon, since this screen is what a pharmacy owner configures themselves.
- Grouped logically (Payments, Compliance, Optional Modules) rather than one long flat list.

### Payment
- Processor-agnostic UI — the screen never visually implies a specific processor's branding beyond
  what's contractually required (e.g. a card network logo), since the whole point of the adapter
  pattern is that any processor can sit behind it.
- Clear, large states for each stage of a card transaction: awaiting card, processing, approved,
  declined — no ambiguity about what the terminal is currently doing.

## Part 5 — Error, empty, and offline states (not optional, not an afterthought)

These states happen constantly in real retail use, and they're usually where a POS's actual design
quality gets tested — not the happy path. Every one of these needs an explicit, designed state before
a screen is considered done, not a default browser/framework fallback.

- **Barcode scanner disconnected/unresponsive:** the checkout screen should show a clear, persistent
  but non-blocking indicator (not a modal that stops the sale) — the cashier can still search/add items
  manually while this is shown, since a disconnected scanner shouldn't halt a transaction.
- **Receipt printer offline or out of paper:** the sale still completes — payment and inventory are
  never blocked by a printer failure. Show a clear "receipt didn't print" state with a retry action and
  a fallback to the PDF/standard-printer path already defined in the hardware doc, so the cashier isn't
  stuck.
- **Payment terminal fails to respond / times out:** distinct from a decline — a decline means the
  customer's card didn't work; a timeout means the system doesn't know what happened. These need
  visually different treatments, since retrying a genuinely-declined card wastes time, but retrying a
  timed-out charge risks a double-charge if not handled carefully at the adapter level (flag for the
  payment adapter logic, not just the UI).
- **Product search returns nothing:** a real empty state (not a blank list) — "No results for
  '[query]'" with a suggestion to check spelling or scan the barcode directly, not a silent void.
- **Database/local connectivity issue:** if SQLite access fails (rare, but possible — e.g. disk full,
  file lock), the app should surface this clearly rather than silently failing a transaction. This is
  the one failure mode serious enough to justify an actual blocking modal, since a sale can't safely
  proceed without a working local database.
- **First-run / no data yet:** Products, Customers, and Reports screens need real empty states for a
  brand-new install before any data exists — not a blank white screen that looks broken.

**Rule of thumb:** hardware and printer failures should degrade gracefully and never block a sale;
data-integrity failures (DB, payment ambiguity) should stop and clearly say so rather than silently
proceeding. Every state above should be an explicit design deliverable per screen, not something left
to whatever a component library defaults to.

---

## Part 6 — Accessibility beyond color contrast

Contrast (Part 3) is necessary but not sufficient. Two more requirements, scoped deliberately to what
matters for this specific tool rather than a generic accessibility checklist:

- **Colorblind-safe status colors.** The success/warning/error/owed-balance color set (Part 3) must be
  distinguishable without relying on hue alone — red/green confusion (deuteranopia/protanopia) is the
  most common form of color blindness, so every status needs a secondary cue: an icon, a label, or a
  distinct shape/weight, not color as the only signal. This matters concretely for the tab ledger
  (owed vs. credit) and payment states (approved vs. declined vs. timeout).
- **Keyboard-navigable fallback for the checkout flow.** If the touchscreen or barcode scanner fails
  entirely, a cashier needs to be able to complete a sale using just a keyboard (tab order, enter to
  confirm, escape to cancel) — this isn't about supporting a niche use case, it's the same failure-
  mode thinking as Part 6: hardware fails sometimes, and the software shouldn't become unusable when
  it does.

Screen-reader support and broader WCAG conformance are explicitly out of scope for this build — the
two items above are the ones that matter given this tool's actual failure modes and real usage
context, not a general accessibility audit.

---

## Part 7 — Implementation notes for Claude Code / Cursor

- Treat this document as a `DESIGN.md`-equivalent constraint file — read it before writing any new
  screen, the same way the architecture docs get read before writing new features.
- If shadcn/ui is used as the component base (already locked in Stage 0), **override the theme tokens
  to match Part 3 exactly** — do not ship shadcn's default palette, spacing, or shadow tokens
  unmodified. The customization already started in Stage 0 (distinct palette, touch-ready sizing)
  extends to every rule in this document, not just the two decisions made so far.
- Any new screen should be checked against Part 2's table before being considered done — if a
  gradient, unexplained blur, decorative floating shape, or unused hover animation shows up, it's a
  bug, not a style choice, and should be fixed before merging.
- When in doubt on a new screen not covered explicitly above, default to Part 1's rules (three-tap,
  touch targets, high contrast, flat hierarchy) over Part 3's aesthetic rules — usability on a POS
  always wins a tiebreak against visual polish.
