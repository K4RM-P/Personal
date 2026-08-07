# Production Readiness Plan — Pharmacy POS

This is a full audit of everything deferred, simplified, or left as "good enough for MVP" across
the entire build of this system, plus everything a real client launch needs that was never
addressed at all. Nothing here is optional to *consider* — each item is either fixed, explicitly
scheduled post-launch with the client's sign-off, or consciously accepted as a risk. What's not
acceptable is silently shipping a gap nobody decided on.

This document has two halves:
- **Part A** — every deferred item from earlier specs, with its origin and why it was deferred
- **Part B** — production concerns that were never discussed at all (security, reliability,
  deployment, compliance, real-hardware testing)

Each item is tagged:
- **P0 — Blocking.** Cannot go live with a real client without this.
- **P1 — Fast follow.** Should ship within the first weeks of live use.
- **P2 — Later.** Genuinely fine to defer; document it and move on.

---

## Part A — Deferred items collected from prior specs

### A1. Loyalty points redemption at checkout
**Origin:** customer-system-spec.md §7 — *"redemption-at-checkout is designed for but not required
to ship in this pass."* The `REDEEMED` ledger event type exists; the checkout tender never wires to
it.
**Risk if shipped as-is:** loyalty points accumulate but customers can never actually use them —
this is a customer-facing promise the pharmacy will make on day one that the software can't keep.
**Priority: P0.** If loyalty is enabled for launch, redemption must work before go-live. If the
pharmacy isn't launching with loyalty on, this can move to P1 — confirm with the client which it is.

### A2. Points expiry policy
**Origin:** customer-system-spec.md §2 — `LoyaltyEventType.EXPIRED` is reserved in the schema but no
expiry logic exists.
**Priority: P2.** Only relevant if the pharmacy wants points to expire; ask the client, don't build
speculatively.

### A3. FTS5 upgrade path for customer search
**Origin:** customer-system-spec.md §3 — deliberately using simple `LIKE` search because "a
pharmacy's customer list is realistically hundreds to low thousands of rows," with FTS5 flagged as
an upgrade path if that assumption breaks.
**Priority: P2**, but verify the assumption against the actual client's customer count before
launch — if they're migrating an existing multi-thousand-customer base from Fillware, revisit this
now rather than after it's slow.

### A4. Multi-printer support
**Origin:** checkout enhancement prompt — *"Don't add a printer-selection dropdown for MVP (assume
one configured printer; multi-printer is phase 2)."*
**Priority: P0 if the client has more than one receipt printer or more than one register.**
Otherwise P2. Confirm the client's actual hardware count before deciding.

### A5. E-Transfer bank API integration
**Origin:** payment enhancement prompt — E-Transfer is manual cashier confirmation only, no bank API.
**Priority: P2 — this is an intentional permanent design, not a gap.** Real Interac e-Transfer API
integration is a significant undertaking most independent pharmacies don't need. Confirm the client
is fine with manual confirmation permanently, and document it so nobody mistakes it for unfinished
work later.

### A6. Refund scheduling / future-dated refunds
**Origin:** refund/discount prompt — *"Don't implement refund scheduling/future refunds (MVP is
immediate)."*
**Priority: P2.**

### A7. Automatic refund reversal in accounting/reporting
**Origin:** refund/discount prompt — *"Don't implement automatic refund reversals in the accounting
system (that's phase 2)."*
**Priority: P1.** A refund that doesn't correctly net out of the Reports numbers means the owner's
daily sales total is wrong on any day a refund happens — this is a trust-breaking bug, not a nice
feature. Verify explicitly: does `getDailySalesSummary` in the Reports system actually subtract
refunds? If reports were built against Sale records only and refunds are a separate table, this is
likely broken right now. **Audit this before anything else in Part A.**

### A8. Reports — Phase 2 and Phase 3 items never built
**Origin:** reports-system-spec.md §3. Only Phase 1 was in the original build prompt.
- **P1:** Customer acquisition/frequency reports, Pharmacy Credit health report (adoption %,
  average balance, overdue accounts), low-stock alerts, period-over-period comparison. A pharmacy
  owner managing tabs needs the credit-health report early — overdue accounts are real money.
- **P1:** PDF export (CSV-only today; owners handing reports to an accountant often want PDF).
- **P2:** Loyalty points liability report, inventory turnover, payment processor fee reporting,
  forecasting/predictive alerts, trend sparklines.

### A9. Restore process for the backup system
**Origin:** data-backup-system-spec.md §3, §9 — *"For MVP, backups are write-only. Restoration is
manual"* — a documented copy-the-file procedure, no in-app restore UI.
**Priority: P0.** A backup system nobody can actually restore from under pressure is a false sense
of security, not a safety net. This doesn't require a polished restore UI, but it requires:
- The manual restore steps to be **tested end-to-end at least once** against a real backup file,
  not just documented in theory
- A basic in-app "Restore from Backup" flow in Settings (browse to a backup folder, confirm, copy
  the file, prompt for restart) — even a minimal version turns a support call into a five-minute
  fix instead of a system administrator being needed on-site

### A10. Encrypted backups
**Origin:** data-backup-system-spec.md §12 — phase 2, backups assumed to be on a drive in a secure
physical location.
**Priority: P1.** Pharmacy customer data — names, phone numbers, addresses, purchase history,
financial (tab) data — is exactly the kind of information that shouldn't sit unencrypted on a USB
drive that can walk out the door or get lost. This is a genuine privacy exposure, not a nice-to-have
(see B7, PIPEDA below). At minimum: password-protect the backup archive.

### A11. Scheduled/automatic backups
**Origin:** data-backup-system-spec.md §2, §12 — logout-triggered only; a daily-at-18:00 auto-backup
toggle exists in the UI mock but was never required to actually function.
**Priority: P1.** A backup that only happens if a human remembers to click "Yes" on logout will
eventually get skipped on a busy day — usually right before the day something goes wrong. Wire the
existing toggle to a real scheduled job.

### A12. Cloud backup destination
**Origin:** data-backup-system-spec.md §12 — local external drive only.
**Priority: P2**, but flag to the client explicitly: if the external drive and the register are both
in the same building (fire, flood, theft), there is no offsite copy. This is a business decision for
the pharmacy owner to make with eyes open, not a silent gap.

### A13. Password reset ("forgot password")
**Origin:** users-system-spec.md — *"Don't implement 'forgot password' (admin-only reset for MVP)."*
**Priority: P1.** "Admin-only reset" requires there to always be a reachable, logged-in manager with
DB access — fine on paper, painful in practice the first time it's actually needed (e.g., the sole
manager is on vacation and a cashier is locked out). Minimum viable fix: a manager can reset another
user's password from the Users tab (this may already exist per the Edit User flow — verify it works,
since the original spec listed it). If it doesn't exist, build it — this is small.

### A14. Encrypted session storage
**Origin:** users-system-spec.md — session cached in plaintext localStorage for MVP.
**Priority: P1.** This is a local desktop app, so the practical risk is lower than a web app, but
plaintext session data on disk is still an easy target if the machine itself is compromised or
shared. Encrypt it — this is a small, contained fix.

### A15. Auto-logout / session timeout
**Origin:** users-system-spec.md — *"No auto-logout timer for MVP."*
**Priority: P1.** A pharmacy checkout terminal left logged in as a manager, unattended, is a real
exposure — anyone can process a refund or adjust a customer's balance. Add a configurable idle
timeout (default something like 15–30 minutes) that returns to the login screen.

### A16. UI/UX guide's explicitly deferred scope
**Origin:** original compacted summary — *"User explicitly deferred: exact literal design tokens,
French/bilingual support, role-based visual differentiation."*
- **French/bilingual support — P0 if the client is in Quebec or serves French-speaking customers,
  otherwise P2.** The catalogue format itself already carries Quebec (`QUE`) product data, so this
  isn't hypothetical — confirm the client's province and customer base now.
- **Role-based visual differentiation — P2**, purely cosmetic (e.g., a visual badge distinguishing
  manager vs. cashier sessions beyond the name in the corner).
- **Exact literal design tokens — P2**, addressed by the UI polish pass already done.

### A17. Vendor code and category code lookup tables (McKesson)
**Origin:** mckesson-webcat-format.md §4 — 713 vendor codes and 311 category codes exist in the file
but their human-readable names are distributed separately by McKesson, not in `WEBCAT` itself.
**Priority: P1.** Right now the product catalogue shows raw codes like `PGA` and `08640` instead of
manufacturer/category names. This is a real usability gap for the pharmacist browsing the catalogue.
**Action:** the client needs to request these lookup tables from their McKesson rep — this is a
business/relationship task, not an engineering one, but it should be tracked so it doesn't fall
through the cracks before launch.

### A18. McKesson deal (`S` record) semantics
**Origin:** mckesson-webcat-format.md §3 — *"which of the four dates is order-window vs.
ship-window is inferred, not confirmed."* Deals are informational-only by design, never wired into
automatic cost calculation.
**Priority: P2 — this is a correct, permanent design decision, not a gap**, provided McKesson never
confirms the semantics. If the client's McKesson rep can clarify the date fields, revisit whether
deals should feed pricing — but don't build on an inferred field without that confirmation.

---

## Part B — Production concerns never addressed in any prior pass

These were never discussed anywhere in the build. A first real client launch needs all of the P0s
here regardless of what's in Part A.

### B1. Automated test coverage
**Priority: P0.** Across every build prompt in this project, "test explicitly" sections describe
manual test scenarios for the *agent* to run once. There is no evidence of a persisted, re-runnable
automated test suite (unit + integration) that prevents the next feature from silently breaking a
previous one. Given how much of this system is money-math (pricing, discounts, surcharges, refunds,
tab balances) and irreversible operations (catalogue refresh, backup/restore), untested regressions
here are the highest-consequence bug class in the whole app.
**Action:** build a real test suite covering, at minimum:
- Every money calculation path (tier pricing, discounts, surcharge, split tender, refunds) with
  exact-cent assertions
- The catalogue reconciliation logic (re-import idempotency, discontinued handling, override flags)
- The credit ledger (balance derivation from `balanceAfterCents`, credit-limit enforcement)
- Auth/RBAC (cashier cannot reach manager-only screens or IPC handlers)
Run this suite in CI on every change, not just once during initial build.

### B2. Error monitoring and crash reporting
**Priority: P0.** Right now, if the app crashes or throws at a customer's register at 2pm on a
Tuesday, nobody finds out unless the pharmacist calls you. Add crash reporting (e.g., Sentry's
Electron SDK, or an equivalent) so failures are visible without relying on the client to notice and
report them.

### B3. Structured application logging
**Priority: P0.** Separate from crash reporting: ordinary operational logs (sales completed, imports
run, backups run/failed, logins, errors caught and handled) written to a local rotating log file.
When something goes wrong and the client calls, "what actually happened" needs to be answerable from
logs, not from re-interviewing a stressed cashier.

### B4. Application auto-update mechanism
**Priority: P0.** There is currently no described mechanism for shipping a bug fix or feature update
to a client's installed app. For a single early client this could be manual reinstall, but that's
fragile and doesn't scale past one site. At minimum, decide and implement: `electron-updater` with a
release feed, or a documented manual-update procedure the client can follow themselves. Either is
fine — having neither decided is not.

### B5. Code signing and installer distribution
**Priority: P0 for Windows/macOS.** An unsigned Electron app triggers scary OS-level security
warnings ("unknown publisher") that will justifiably worry a pharmacy owner installing this for the
first time. Set up code signing for whichever OS the client runs, and produce a proper installer
(NSIS/Squirrel for Windows, notarized `.dmg`/`.pkg` for macOS) rather than a raw unpacked build.

### B6. Secrets and credentials management
**Priority: P0.** Payment processor API keys (Stripe Terminal, Moneris, etc.) must never be
hardcoded or committed to the repo. Audit the entire codebase now for any embedded keys, and move
all secrets to a local encrypted config or OS credential store. Verify `.env` files (if used) are
gitignored and were never committed historically — check git history, not just the current tree.

### B7. Privacy and data-handling compliance (PIPEDA)
**Priority: P0.** This system stores customer names, phone numbers, addresses, and financial (tab)
history for a Canadian pharmacy — this is personal information under PIPEDA (and Ontario/Quebec
provincial health-privacy rules may also apply depending on what the pharmacy links to Rx data).
Concretely, before launch:
- Confirm with the client what customer data retention policy they want, and whether customers can
  request deletion/export of their data — build the capability if not already present
- Confirm backups (which contain the same personal data) are handled consistently with whatever
  policy is agreed — this directly connects to A10 (encrypt backups)
- This is worth a real conversation with the client, possibly involving their own compliance advice
  — don't treat it as a pure engineering checkbox

### B8. Real hardware integration testing
**Priority: P0.** Every hardware integration in this project (barcode scanner, receipt printer,
payment terminal) has been built and reasoned about in code, but there's no confirmation anywhere in
this conversation that it's been tested against the client's **actual physical hardware** — not a
different model, not an emulator. Before go-live:
- Test the barcode scanner the client will actually use, including edge cases (12 vs 13 vs 14-digit
  barcodes, damaged/faded labels)
- Test the receipt printer under real conditions: paper-out mid-print, USB unplugged, printer
  powered off — confirm the app degrades exactly as designed (sale still completes, retry/PDF
  fallback works)
- Test the payment terminal's actual failure modes: card declined, network timeout, terminal
  disconnected — confirm these don't leave a sale in an ambiguous state (charged but not recorded,
  or recorded but not charged)

### B9. Load and data-volume testing
**Priority: P1.** Every performance number quoted in prior specs (30-second report cache, FTS5 vs.
LIKE for search, batch import speed) was reasoned about, not measured against realistic data volume.
Before launch, seed a test database with a realistic volume for this client — a few years of sales
history if migrating from Fillware, their actual customer count — and confirm checkout, search, and
reports all stay responsive. This is cheap insurance against a slow app on day one.

### B10. Multi-terminal / multi-register support
**Priority: P0 if the pharmacy has more than one register, P2 otherwise.** This entire system has
been designed around a single local SQLite database on one machine. If the client runs more than one
checkout terminal, this is a fundamental architecture question (shared database? sync? one terminal
as primary?) that needs resolving **before** launch, not discovered after. Confirm the client's
actual register count now.

### B11. Timezone correctness
**Priority: P0.** Reports spec explicitly notes *"Dates are in the pharmacy's local timezone, not
UTC"* as a requirement, but there's no confirmation this was actually implemented correctly
end-to-end (database storage, display, "today" boundary calculations for cashier sales history, and
report date-range filtering). A daily sales report that's off by a few hours around midnight is a
subtle, hard-to-notice bug that quietly corrupts the owner's trust in every number in the system.
Test explicitly: a sale made at 11:58pm and one at 12:02am should land on the correct respective
days in every report.

### B12. Comprehensive input validation
**Priority: P1.** Individual specs called out specific validations (discount can't exceed total,
password length, duplicate phone) but there's been no systematic pass confirming *every* form field
across the app rejects bad input gracefully — negative quantities, absurdly large numbers, script
injection in text fields, empty required fields, malformed phone numbers, etc.

### B13. Accessibility final audit
**Priority: P1.** The UI/UX guide specifies colorblind-safe status indicators and keyboard
navigation as requirements, and the polish pass addressed focus states generally, but there's been
no dedicated accessibility audit (screen reader pass, full keyboard-only walkthrough of checkout
start to finish, actual color-contrast measurement against WCAG AA, not just "should be fine").

### B14. Client documentation and training materials
**Priority: P0.** Nowhere in this entire project has a user-facing manual, quick-start guide, or
training document been produced. The client is a pharmacist, not a developer — they need:
- A plain-language getting-started guide (first login, ringing up a sale, handling a tab customer,
  processing a refund, running a backup)
- A quick-reference card for common tasks, printable and postable near the register
- A troubleshooting guide for the failure states already designed for (printer offline, scanner
  disconnected, payment terminal timeout) so staff know what to do without calling you every time

### B15. Rollback and incident plan
**Priority: P1.** If a bad update breaks checkout at a live pharmacy, what's the actual recovery
procedure? This needs to be a written, rehearsed answer — not something figured out live while a
line of customers waits and the pharmacist is on the phone.

### B16. Uninstall / offboarding data handling
**Priority: P2.** If the client ever stops using the system, what happens to their data? Worth a
short, honest policy (exported to them, retained for X days, then deleted) — mostly a business
decision, but the mechanism (a final export) should exist.

---

## Priority Summary (what actually blocks go-live)

**P0 — must be true before the first real customer is rung up:**
- A1 (loyalty redemption, if loyalty is enabled at launch)
- A4 (multi-printer, if client has >1 printer)
- A9 (backup restore actually tested, not just documented)
- A16 (French support, if client's customer base needs it)
- B1 (automated test suite covering money math and reconciliation)
- B2 (crash reporting)
- B3 (structured logging)
- B4 (update mechanism)
- B5 (code signing + real installer)
- B6 (secrets audit)
- B7 (PIPEDA conversation with client)
- B8 (real hardware testing — scanner, printer, terminal, all failure modes)
- B10 (multi-register architecture decision, if client has >1 register)
- B11 (timezone correctness, tested at day boundaries)
- B14 (client-facing documentation)

**P1 — fix within the first few weeks of live use, don't block launch on these:**
A7, A8 (reports phase 2 + PDF), A10, A11, A13, A14, A15, A17, B9, B12, B13, B15

**P2 — genuinely fine to defer, just make sure the client knows:**
A2, A3, A5, A6, A12, A16 (role-visual only), A18, B16

---

## What to do with this document

1. Walk through every P0 item with the client explicitly — some (multi-register, French, loyalty
   at launch) are business questions only they can answer, not engineering decisions to make alone
2. Convert the confirmed P0 list into the build prompt (below) and execute it before go-live
3. Schedule P1 items into the first month post-launch, don't let them silently become permanent
4. Document P2 decisions in writing (even briefly) so nobody mistakes "deferred on purpose" for
   "forgotten"
