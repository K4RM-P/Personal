# Future Work / Deferred / "Coming Soon"

A single tracking list of everything in this codebase that is documented, stubbed, or flagged as
not-yet-built — compiled while working the Data Backup System upgrade (see git history around
2026-08-10) so cloud backup (Google Drive / OneDrive) wasn't silently built against fake OAuth
credentials with no way to test it end-to-end. Consolidated from `docs/*.md` "future" sections,
in-code TODO/stub markers, disabled UI, and the open P1/P2 items in
`docs/PRODUCTION_READINESS_PLAN.md`.

---

## 1. Cloud / offsite backup (Google Drive + OneDrive) — NEXT UP

**Origin:** this task. Deferred because it requires OAuth client credentials (Google Cloud Console
project + Azure AD app registration) that aren't available in this environment, and real connected
accounts to test connect/upload/verify/disconnect end-to-end — neither of which can be faked
without risking a false "it works" on code that's never touched a real API.

When picked up, the target design (already scoped, not yet implemented):
- Destination picker: External Drive / Google Drive / OneDrive, same backup content/format
- `CloudBackupAccount` Prisma model + `BackupLog.destination` / `cloudProvider` / `cloudFolderId`
- OAuth: Google `drive.file` scope (desktop app flow), Microsoft `Files.ReadWrite.AppFolder` scope
  (MSAL) — both minimal-scope, app-isolated storage
- Refresh tokens in OS credential store (keytar / Electron `safeStorage`) — never in the DB or logs
- Upload + re-fetch verification (size/checksum), same 30-day age-based retention as external
  drive, scoped independently per provider account
- IPC: `backup:connectCloudProvider`, `backup:disconnectCloudProvider`, `backup:listCloudAccounts`,
  `backup:startCloudBackup`

Related, also deferred: `docs/data-backup-system-spec.md` §12 also lists incremental backups,
backup compression, multi-destination backup, and backup validation as phase 2+.

## 2. Auto-backup daily schedule (A11)

Toggle exists in Settings (`SettingsScreen.tsx` — "Auto-backup daily at 18:00") but is rendered
disabled with copy "Phase 2 — not yet available." The scheduled job itself was never built; backup
today only happens on manual trigger or logout prompt.

## 3. Encrypted backups (A10)

`docs/data-backup-system-spec.md` §12. Backup files (JSON exports + `backup.sqlite`) are currently
unencrypted at rest. Contains customer PII and financial data — a drive walking out the door is a
real exposure. At minimum: password-protect the backup archive.

## 4. Reports system — Phase 2/3 (A7, A8)

- A7: refund reversals in report totals not yet verified for correctness — audit before trusting
  net sales figures where refunds are involved.
- A8: customer acquisition/frequency reports, Pharmacy Credit health report (adoption %, average
  balance, overdue accounts), low-stock alerts, period-over-period comparison, PDF export.
  `reportHandlers.ts` has a `REPORTS_EXPORT_XLSX` handler that currently just resolves a fake path
  (`exports/report.xlsx`) — no real file is generated.
- `getCreditHealth` in `reportQueries.ts` returns an all-zero/disabled summary whenever the
  `customerTabs` feature flag is off — i.e. credit-health reporting is gated behind a module most
  pharmacies won't have turned on yet.

## 5. Security / session hardening (A13, A14, A15)

- A13: no self-service "forgot password" — admin/manager-only reset. Fine on paper, painful if the
  only manager is unreachable.
- A14: session token stored in plaintext localStorage in the renderer.
- A15: no auto-logout / idle timeout — a register left unlocked stays unlocked indefinitely.

## 6. Data quality / lookups (A17)

Vendor and category codes from the McKesson catalogue import are shown as raw codes, not
human-readable names — no lookup table exists yet.

## 7. Testing / audit gaps (B9, B12, B13, B15)

- B9: no load/data-volume testing at realistic pharmacy scale.
- B12: no comprehensive input-validation audit across IPC handlers.
- B13: no accessibility audit (screen reader / WCAG) — explicitly out of scope per
  `docs/superpowers/pharmacy-pos-ui-ux-guide.md`.
- B15: no written rollback/incident response plan if a release goes bad in production.

## 8. Lower-priority / intentionally deferred (P2)

- A2: loyalty points expiry — schema field reserved (`pointsAfter` etc.), logic not implemented.
- A3: customer search uses `LIKE`, not FTS5 — fine at current scale, revisit if search gets slow.
- A5: E-Transfer reconciliation is permanently manual-only by design (no bank API integration
  planned) — not a gap so much as a documented decision.
- A6: refund scheduling / future-dated refunds not supported.
- A16: role-based visual differentiation between manager/cashier UI is cosmetic-only today.
- A18: McKesson "deal" (`S` record) semantics aren't used for pricing yet — intentional per catalog
  design, revisit if deals become a pricing requirement.
- B16: no defined data-export/offboarding policy if a pharmacy stops using the system.
- Bilingual/French support not implemented.
- No multi-printer support (A4).
- Loyalty point redemption isn't wired into the checkout tender flow yet (A1).

## 9. In-code stubs / placeholders (grep for these before assuming a feature works)

- `src/main/db/queries/complianceQueries.ts:22` — `searchRxRecords` returns
  `patientName: 'Patient Placeholder'` — Rx/patient search is not backed by real data yet.
- `src/main/db/queries/complianceQueries.ts:88` — signature capture returns a stub data URL
  (`data:image/png;base64,stub-...`), not a real captured image.
- `src/main/catalog/reconcile.ts:193` — falls back to a placeholder zero value when a catalogue
  file is missing a field, rather than a validated real value.
- `src/renderer/src/screens/SettingsScreen.tsx` — "OTC-Only Mode Preview" card is explicitly a
  placeholder, rendered only when the `otcMode` feature flag is on, with no real functionality
  behind it yet.

## 10. Notes on items that turned out to already be done

- **A9 (backup restore)** — `PRODUCTION_READINESS_PLAN.md` still describes this as undone
  ("backups are write-only... restoration is manual"), but as of this task's investigation, a full
  in-app restore flow already exists and works: `RestoreBackupModal.tsx` → IPC → checksum-verified
  staging → `applyPendingRestoreIfStaged` on next launch, covered by a passing end-to-end test in
  `src/__tests__/backupService.test.ts`. **The production-readiness doc is stale on this point** —
  update it to reflect A9 as done rather than re-building something that already works.
