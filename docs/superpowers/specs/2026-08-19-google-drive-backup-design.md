# Feature Spec — Google Drive Auto-Backup

## 1. Overview

Extends the existing local/USB backup system (`docs/data-backup-system-spec.md`) with Google
Drive as a backup destination. A manager connects a Google account once from Settings; after
that, backups upload to Drive automatically — on logout (silently, no prompt) and on a
recurring schedule — with no further interaction required. This is additive: local/USB backup
behavior is unchanged and independently configurable.

This spec also expands what a backup contains, so "everything important" is genuinely covered,
and adds the Complete Sales Report as a backed-up artifact.

## 2. Expanded backup content

Current backups (`performBackup` in `src/main/backup/backupService.ts`) produce 8 files:
`backup.sqlite`, `backup-metadata.json`, `sales.json`, `customers.json`, `users.json`,
`discounts.json`, `refunds.json`, `inventory-snapshot.json`.

Add four more exporters to `src/main/backup/exporters.ts`, four more files to `ALL_FILES` in
`backupService.ts`, and checksum/verify them the same way as existing files:

- `settings.json` — all `Setting` rows, **except** any key used to store the Google refresh
  token (see §3.3) or other credential-shaped values. `settingsQueries.ts` already has a
  `SETTING_KEYS`-style enumeration; the exporter allowlists non-secret keys explicitly rather
  than blocklisting, so a future secret key defaults to excluded, not included.
- `feature-flags.json` — all `FeatureFlag` rows
- `pricing-tiers.json` — all `PricingTier` rows
- `inventory-adjustments.json` — all `InventoryAdjustment` rows
- `complete-sales-report.csv` — the CSV produced by `getCompleteProductSales` (already used by
  `src/shared/completeProductSalesCsv.ts` for on-demand export), written as UTF-8 CSV text
  rather than JSON, matching how a manager would already read it in the Reports screen

`CustomerDisplaySlide` and `ReceiptSequence` remain excluded — device-local UI/operational
state, not data a pharmacy would need to recover.

`dataSnapshot` in `backup-metadata.json` gains counts for the four new JSON files
(`settingsCount`, `featureFlagsCount`, `pricingTiersCount`, `inventoryAdjustmentsCount`).

This expanded file set applies to **both** local/USB backups and Google Drive backups — one
`performBackup()` pipeline, one set of files, uploaded to whichever destinations are configured.

## 3. Google Drive integration

### 3.1 Dependencies

- `google-auth-library` — OAuth2 flow + token refresh
- `googleapis/drive` — scoped import, not the full `googleapis` bundle (keeps Electron bundle
  size down; `googleapis` re-exports every Google API as one package)

### 3.2 One-time setup (you do this in Google Cloud Console before first use)

1. Create a Google Cloud project (or reuse one)
2. Enable the **Google Drive API** for it
3. Configure the OAuth consent screen (External or Internal, depending on your Google
   Workspace setup) — app name, support email
4. Create an **OAuth client ID** of type **Desktop app**
5. Copy the generated Client ID and Client Secret into the app's config (see §3.6 —
   `.env`/build-time config, not hardcoded, not committed)

Desktop-app OAuth clients are Google's supported flow for installed apps with no server-side
component; secrets in this client type are not treated as confidential by Google's own model
(they're paired with PKCE + loopback redirect), so shipping the client ID in the built app is
expected and safe.

### 3.3 Auth flow

- New module `src/main/backup/googleDrive.ts`
- "Connect Google Drive" (Settings, manager-only) starts a loopback OAuth flow:
  1. Main process starts a temporary HTTP server on `127.0.0.1:<ephemeral port>`
  2. Opens the system browser to Google's consent URL (`access_type=offline`,
     `prompt=consent` to guarantee a refresh token, scope
     `https://www.googleapis.com/auth/drive.file` — least-privilege: only files this app
     creates, not full Drive access)
  3. User signs in / approves in their normal browser
  4. Google redirects to `http://127.0.0.1:<port>/callback?code=...`; the temp server
     captures the code, shows a plain "You can close this tab" page, then shuts itself down
  5. Main process exchanges the code for `{ access_token, refresh_token }`
- Refresh token is encrypted with Electron's `safeStorage` (OS keychain-backed: Keychain on
  macOS, DPAPI on Windows) and written to a file in `app.getPath('userData')` —
  **deliberately not** the `Setting` table, since Settings get included verbatim in backup
  JSON and must never contain a credential
- Connected-account email (for display only, e.g. "Connected as pharmacy@gmail.com") is
  fetched once via `drive.about.get` and cached in `Setting` (non-secret)
- "Disconnect" clears the stored token file and the cached email, and turns off Drive
  auto-backup

### 3.4 Upload

- New function `uploadBackupToDrive(localBackupDir: string, driveClient): Promise<void>` in
  `googleDrive.ts`
- Creates a Drive folder named `PHARMACY_POS_BACKUP_<timestamp>` (same naming convention as
  local backups) under a fixed top-level `Pharmacy POS Backups` Drive folder (created once,
  found-or-created by name on each run so it survives even if the cached folder ID is stale)
- Uploads each file in the already-written local backup dir as a child of that folder via
  resumable upload (`drive.files.create` with `media`)
- Runs strictly **after** local `performBackup()` finishes writing to disk — it uploads the
  same files it already wrote, so cloud and local backups are byte-identical for a given run,
  and a Drive failure never blocks or corrupts the local backup that already succeeded

### 3.5 Trigger integration

- `performBackup()` itself is unchanged; a new orchestration wrapper decides destinations:
  - Local/USB: existing logout-prompt flow, unaffected
  - Google Drive, if connected and enabled: runs automatically, no prompt, on:
    - **Logout**, right after (or in parallel with) any local backup the user chose,
      using a local temp directory as the source if the user declined a local backup
    - **Scheduled interval** (default 24h, configurable in Settings) via a `setInterval`
      registered once at app startup in the main process
- Each Drive backup writes a `BackupLog` row like local backups, with `driveName: 'Google
  Drive'` and `drivePath` set to the Drive folder's web link, so "last backup" status in
  Settings and the backup history list both work unmodified
- The local write always happens first, into a temp staging directory
  (`app.getPath('temp')/pharmacy-pos-backup-<timestamp>`) when the user has local/USB backup
  turned off but Drive is enabled, and is deleted after a successful upload — Drive backup
  never requires the manager to also have USB backup configured

### 3.6 Config

- `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` — build-time env vars (electron-vite
  `.env`, not committed; `.env.example` documents the two keys), embedded into the built app
  the same way other build-time config in this repo works today

## 4. Settings UI

New card in the Settings screen, manager-only, near the existing backup settings:

- **Not connected:** "Connect Google Drive" button → opens system browser for OAuth →
  card updates to connected state on success (polls/listens for the local callback server
  completing)
- **Connected:** shows "Connected as `<email>`", a "Disconnect" button, a toggle
  "Auto-backup to Google Drive" (on by default once connected), and an interval picker
  (6h / 12h / 24h / 48h, default 24h) enabled only while the toggle is on
- Last Drive backup timestamp + status, reusing the existing `BackupLogSummary` display
  pattern already used for local backups

## 5. Retention

Same 30-day policy as local backups (`RETENTION_DAYS = 30` in `backupService.ts`), ported to
Drive: after each successful Drive upload, list folders under `Pharmacy POS Backups` matching
`PHARMACY_POS_BACKUP_*`, parse the timestamp from each folder's `backup-metadata.json` (or the
folder name if that read fails), and delete (`drive.files.delete`) any older than 30 days.
Mirrors `cleanupExpiredBackups`'s best-effort behavior: a folder whose age can't be positively
confirmed is left alone rather than deleted.

## 6. New IPC surface

Following the existing three-touchpoint pattern (`shared/channels.ts`, a handler in
`main/ipc/`, a wrapper in `preload/index.ts`):

- `BACKUP_DRIVE_CONNECT` — starts the OAuth flow, resolves with `{ email }` on success
- `BACKUP_DRIVE_DISCONNECT` — clears stored token
- `BACKUP_DRIVE_GET_STATUS` — `{ connected: boolean; email?: string; autoBackupEnabled: boolean; intervalHours: number; lastBackup?: BackupLogSummary }`
- `BACKUP_DRIVE_SAVE_SETTINGS` — `{ autoBackupEnabled: boolean; intervalHours: number }`
- `BACKUP_DRIVE_RUN_NOW` — manual "back up now" trigger, reuses the same upload path

## 7. Error handling

- OAuth failures (user closes browser tab, denies consent, network error): surfaced as a
  toast/inline error in Settings; no partial token state persisted
- Upload failures (network, quota, revoked access): logged as a `BackupLog` row with
  `status: 'FAILED'`, exactly like local backup failures; does not retry mid-cycle, next
  scheduled run or logout attempt tries again
- Revoked/expired refresh token detected on next scheduled run: mark Drive as disconnected in
  Settings (so the manager sees "Connect Google Drive" again) rather than failing silently
  forever

## 8. Testing

- Unit tests for the new exporters (`settings.json`, `feature-flags.json`, etc.) following the
  existing `exporters.ts` test pattern
- Unit tests for `cleanupExpiredBackups`-equivalent Drive retention logic, mocking the Drive
  client
- Unit tests for the secret-key allowlist in the settings exporter (never leaks a token)
- OAuth flow and actual Drive API calls are not unit-testable without live credentials —
  verified manually against a real Google account during implementation
