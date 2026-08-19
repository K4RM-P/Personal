# Google Drive Auto-Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Drive as an auto-backup destination (connect once, then silent backup on logout + on a schedule), and expand what every backup (local and Drive) contains.

**Architecture:** Reuse `performBackup()` unchanged as the file-producing pipeline; add a `googleDrive.ts` module that uploads an already-written backup directory to Drive via OAuth2 (loopback flow) + the Drive API, storing the refresh token encrypted in the existing `Setting`-table secret pattern (`safeStorage` via `credentialStore.ts`, `*Enc` key naming so it's excluded from `settings.json` exports). Trigger points: logout flow (existing `LogoutConfirmModal`) and a `setInterval` scheduler started at app boot.

**Tech Stack:** `google-auth-library`, `@googleapis/drive`, Electron `safeStorage`, existing Prisma/IPC/React stack.

**Spec:** `docs/superpowers/specs/2026-08-19-google-drive-backup-design.md`

## Global Constraints

- Google OAuth scope: `https://www.googleapis.com/auth/drive.file` only (least privilege)
- Refresh token: encrypted via `encryptSecret`/`decryptSecret` (`src/main/payment/credentialStore.ts`), stored under `Setting` key `backup.driveRefreshTokenEnc` — never in plaintext, never in `settings.json` export
- Backup file set (both local and Drive): `backup.sqlite`, `backup-metadata.json`, `sales.json`, `customers.json`, `users.json`, `discounts.json`, `refunds.json`, `inventory-snapshot.json`, `settings.json`, `feature-flags.json`, `pricing-tiers.json`, `inventory-adjustments.json`, `complete-sales-report.csv`
- Drive retention: 30 days, same policy shape as `cleanupExpiredBackups` in `backupService.ts` (best-effort, never delete on ambiguous age)
- IPC: every new renderer-callable function touches `src/shared/channels.ts`, a handler in `src/main/ipc/backupHandlers.ts`, and a wrapper in `src/preload/index.ts`
- Manager-only: connect/disconnect/settings changes require `requireManager()` (see existing `BACKUP_LIST_RESTORABLE` handler for the pattern)

---

### Task 1: Expand exporters and `performBackup()` file set

**Files:**
- Modify: `src/main/backup/exporters.ts`
- Modify: `src/main/backup/backupService.ts`
- Test: `src/__tests__/backupExporters.test.ts` (new)

**Interfaces:**
- Produces: `exportSettings(db): Promise<{ settings: unknown[] }>`, `exportFeatureFlags(db): Promise<{ featureFlags: unknown[] }>`, `exportPricingTiers(db): Promise<{ pricingTiers: unknown[] }>`, `exportInventoryAdjustments(db): Promise<{ inventoryAdjustments: unknown[] }>`, `exportCompleteSalesReportCsv(db): Promise<string>` — all exported from `src/main/backup/exporters.ts`

- [ ] **Step 1: Write failing tests for the new exporters**

```typescript
// src/__tests__/backupExporters.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  exportSettings,
  exportFeatureFlags,
  exportPricingTiers,
  exportInventoryAdjustments,
  exportCompleteSalesReportCsv
} from '../main/backup/exporters'

const db = new PrismaClient()

describe('backup exporters — new file set', () => {
  beforeEach(async () => {
    await db.setting.deleteMany()
    await db.featureFlag.deleteMany()
    await db.pricingTier.deleteMany()
  })

  it('exportSettings excludes any *Enc secret key', async () => {
    await db.setting.create({ data: { key: 'store.name', value: 'Test Pharmacy' } })
    await db.setting.create({ data: { key: 'backup.driveRefreshTokenEnc', value: 'super-secret' } })
    const { settings } = await exportSettings(db)
    const keys = (settings as Array<{ key: string }>).map((s) => s.key)
    expect(keys).toContain('store.name')
    expect(keys).not.toContain('backup.driveRefreshTokenEnc')
  })

  it('exportFeatureFlags returns all rows', async () => {
    await db.featureFlag.create({ data: { key: 'testFlag', enabled: true, label: 'Test' } })
    const { featureFlags } = await exportFeatureFlags(db)
    expect(featureFlags).toHaveLength(1)
  })

  it('exportPricingTiers returns all rows', async () => {
    await db.pricingTier.create({ data: { minCostCents: 0, maxCostCents: 100, markupPercent: 20 } })
    const { pricingTiers } = await exportPricingTiers(db)
    expect(pricingTiers).toHaveLength(1)
  })

  it('exportInventoryAdjustments returns an array (possibly empty)', async () => {
    const { inventoryAdjustments } = await exportInventoryAdjustments(db)
    expect(Array.isArray(inventoryAdjustments)).toBe(true)
  })

  it('exportCompleteSalesReportCsv returns a CSV string with a header row', async () => {
    const csv = await exportCompleteSalesReportCsv(db)
    expect(csv.split('\n')[0]).toContain('Date')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/backupExporters.test.ts`
Expected: FAIL — the five functions don't exist yet.

- [ ] **Step 3: Implement the new exporters**

Append to `src/main/backup/exporters.ts` (keep the existing five functions untouched):

```typescript
import { getCompleteProductSales, startOfDay } from '../db/queries/reportQueries'
import { buildCompleteProductSalesCsv } from '../../shared/completeProductSalesCsv'

/** Settings are exported allowlisted-by-exclusion: any key ending in "Enc" holds an
 * encrypted secret (payment API keys, SMTP password, Google Drive refresh token) and
 * must never appear in a backup file, encrypted or not. */
export async function exportSettings(db: PrismaClient): Promise<{ settings: unknown[] }> {
  const rows = await db.setting.findMany({ orderBy: { key: 'asc' } })
  return {
    settings: rows
      .filter((row) => !row.key.endsWith('Enc'))
      .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt }))
  }
}

export async function exportFeatureFlags(db: PrismaClient): Promise<{ featureFlags: unknown[] }> {
  const rows = await db.featureFlag.findMany({ orderBy: { key: 'asc' } })
  return { featureFlags: rows }
}

export async function exportPricingTiers(db: PrismaClient): Promise<{ pricingTiers: unknown[] }> {
  const rows = await db.pricingTier.findMany({ orderBy: { orderIndex: 'asc' } })
  return { pricingTiers: rows }
}

export async function exportInventoryAdjustments(
  db: PrismaClient
): Promise<{ inventoryAdjustments: unknown[] }> {
  const rows = await db.inventoryAdjustment.findMany({
    orderBy: { createdAt: 'asc' },
    include: { product: { select: { name: true } } }
  })
  return {
    inventoryAdjustments: rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product?.name ?? null,
      quantityDelta: r.quantityDelta,
      reason: r.reason,
      adjustedByUserId: r.adjustedByUserId,
      createdAt: r.createdAt
    }))
  }
}

/** All-time complete product sales report, reusing the same row builder and CSV
 * formatter the on-demand Reports-screen export uses (src/shared/completeProductSalesCsv.ts). */
export async function exportCompleteSalesReportCsv(db: PrismaClient): Promise<string> {
  const earliest = await db.transaction.findFirst({ orderBy: { createdAt: 'asc' } })
  const from = earliest ? earliest.createdAt.toISOString().slice(0, 10) : '2000-01-01'
  const to = new Date().toISOString().slice(0, 10)
  const rows = await getCompleteProductSales(db, from, to)
  return buildCompleteProductSalesCsv(rows)
}
```

Check `src/shared/completeProductSalesCsv.ts` for the exact exported CSV-building function name (it wraps `HEADERS` + row formatting) and use that exact name instead of `buildCompleteProductSalesCsv` if it differs — read the file's exports before writing this step's final code.

- [ ] **Step 4: Wire the four new JSON files + CSV into `performBackup()`**

In `src/main/backup/backupService.ts`:
- Add `'settings.json', 'feature-flags.json', 'pricing-tiers.json', 'inventory-adjustments.json'` to `JSON_FILES`
- Add `'complete-sales-report.csv'` directly to `ALL_FILES` (it's not JSON, so keep `JSON_FILES` JSON-only and add the CSV filename separately: `const ALL_FILES = ['backup.sqlite', ...JSON_FILES, 'complete-sales-report.csv', 'backup-metadata.json'] as const`)
- Import the four new exporters + `exportCompleteSalesReportCsv` from `./exporters`
- In `performBackup()`, extend the `Promise.all` that currently fetches `[sales, customers, users, discounts, refunds, inventory]` to also fetch `settings, featureFlags, pricingTiers, inventoryAdjustments`, and separately fetch `const salesReportCsv = await exportCompleteSalesReportCsv(db)`
- `writeFileSync` each new JSON file the same way as the existing six, and `writeFileSync(join(backupDir, 'complete-sales-report.csv'), salesReportCsv)`
- Extend the checksum loop (`for (const file of ['backup.sqlite', ...JSON_FILES] as const)`) to also checksum `'complete-sales-report.csv'`
- Extend `dataSnapshot` with `settingsCount`, `featureFlagsCount`, `pricingTiersCount`, `inventoryAdjustmentsCount` (each `.length` of the corresponding array)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/backupExporters.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full existing backup test suite to check nothing broke**

Run: `npx vitest run src/__tests__/backupService.test.ts` (or whatever the existing backup service test file is named — locate it with `find src/__tests__ -iname '*backup*'` first)
Expected: PASS — existing tests should still pass since `ALL_FILES`/`dataSnapshot` grew but existing fields/files are untouched. If an existing test asserts an exact file count or exact `ALL_FILES` array, update that assertion to match the new 13-file set.

- [ ] **Step 7: Commit**

```bash
git add src/main/backup/exporters.ts src/main/backup/backupService.ts src/__tests__/backupExporters.test.ts
git commit -m "Expand backups to include settings, feature flags, pricing tiers, inventory adjustments, and the complete sales report"
```

---

### Task 2: Google Drive OAuth + upload module

**Files:**
- Create: `src/main/backup/googleDrive.ts`
- Modify: `src/main/db/queries/settingsQueries.ts` (add new `DEFAULTS` keys)
- Modify: `package.json` (add `google-auth-library`, `@googleapis/drive`)
- Modify: `.env.example`
- Test: `src/__tests__/googleDriveRetention.test.ts` (new — retention logic only; OAuth/network calls aren't unit-tested per spec §8)

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` from `src/main/payment/credentialStore.ts`; `sha256File` from `src/main/backup/checksum.ts`
- Produces (all exported from `src/main/backup/googleDrive.ts`):
  - `getDriveStatus(db: PrismaClient): Promise<DriveBackupStatus>`
  - `connectGoogleDrive(db: PrismaClient): Promise<{ email: string }>` — runs the full loopback OAuth flow
  - `disconnectGoogleDrive(db: PrismaClient): Promise<void>`
  - `saveDriveBackupSettings(db: PrismaClient, args: { autoBackupEnabled: boolean; intervalHours: number }): Promise<void>`
  - `uploadBackupToDrive(db: PrismaClient, localBackupDir: string, args: { driveName: string; initiatedByUserId: number }): Promise<void>` — uploads, writes a `BackupLog` row (`driveName: 'Google Drive'`), then runs retention
  - `pickBackupsToDelete(folders: Array<{ name: string; createdTime: string }>, now: Date): string[]` — pure function, retention logic factored out for testability (returns folder `name`s older than 30 days)

- [ ] **Step 1: Add dependencies**

```bash
npm install google-auth-library @googleapis/drive
```

- [ ] **Step 2: Add `.env.example` entries**

```
GOOGLE_DRIVE_CLIENT_ID=""
GOOGLE_DRIVE_CLIENT_SECRET=""
```

- [ ] **Step 3: Add new `Setting` keys to `DEFAULTS` in `settingsQueries.ts`**

Add these lines inside the existing `DEFAULTS` object (near the other `backup.*` keys):

```typescript
  'backup.driveAccountEmail': '',
  'backup.driveFolderId': '',
  'backup.driveRefreshTokenEnc': '',
  'backup.driveAutoBackupEnabled': 'false',
  'backup.driveIntervalHours': '24',
```

- [ ] **Step 4: Write the failing retention test**

```typescript
// src/__tests__/googleDriveRetention.test.ts
import { describe, it, expect } from 'vitest'
import { pickBackupsToDelete } from '../main/backup/googleDrive'

describe('pickBackupsToDelete', () => {
  const now = new Date('2026-08-19T00:00:00Z')

  it('selects folders older than 30 days', () => {
    const folders = [
      { name: 'PHARMACY_POS_BACKUP_old', createdTime: '2026-07-01T00:00:00Z' }, // 49 days old
      { name: 'PHARMACY_POS_BACKUP_recent', createdTime: '2026-08-15T00:00:00Z' } // 4 days old
    ]
    expect(pickBackupsToDelete(folders, now)).toEqual(['PHARMACY_POS_BACKUP_old'])
  })

  it('never selects a folder with an unparseable createdTime', () => {
    const folders = [{ name: 'PHARMACY_POS_BACKUP_weird', createdTime: 'not-a-date' }]
    expect(pickBackupsToDelete(folders, now)).toEqual([])
  })

  it('returns nothing when all folders are recent', () => {
    const folders = [{ name: 'PHARMACY_POS_BACKUP_new', createdTime: '2026-08-18T00:00:00Z' }]
    expect(pickBackupsToDelete(folders, now)).toEqual([])
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/__tests__/googleDriveRetention.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 6: Implement `src/main/backup/googleDrive.ts`**

```typescript
import { BrowserWindow, shell } from 'electron'
import { createServer } from 'http'
import { OAuth2Client } from 'google-auth-library'
import { drive_v3, drive } from '@googleapis/drive'
import { PrismaClient } from '@prisma/client'
import { createReadStream, existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { encryptSecret, decryptSecret } from '../payment/credentialStore'
import type { BackupLogSummary, DriveBackupStatus } from '../../shared/types'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const DRIVE_ROOT_FOLDER_NAME = 'Pharmacy POS Backups'
const RETENTION_DAYS = 30

function oauthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID ?? ''
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Drive is not configured — GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET are missing.'
    )
  }
  return new OAuth2Client({ clientId, clientSecret })
}

async function getSetting(db: PrismaClient, key: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? ''
}
async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

async function getAuthorizedClient(db: PrismaClient): Promise<OAuth2Client> {
  const encToken = await getSetting(db, 'backup.driveRefreshTokenEnc')
  if (!encToken) throw new Error('Google Drive is not connected.')
  const client = oauthClient()
  client.setCredentials({ refresh_token: decryptSecret(encToken) })
  return client
}

/** Runs the loopback OAuth flow: opens the system browser, waits on a local HTTP
 * server for Google's redirect, exchanges the code for tokens, stores the refresh
 * token encrypted, and caches the connected account's email. */
export async function connectGoogleDrive(db: PrismaClient): Promise<{ email: string }> {
  const client = oauthClient()

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://127.0.0.1')
      const authCode = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.end(
        error
          ? 'Google Drive connection failed — you can close this tab.'
          : 'Google Drive connected — you can close this tab.'
      )
      server.close()
      if (error) reject(new Error(`Google denied access: ${error}`))
      else if (authCode) resolve(authCode)
      else reject(new Error('Google redirect had no authorization code.'))
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      client.redirectUri = `http://127.0.0.1:${port}/callback`
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
      })
      shell.openExternal(authUrl)
    })
    server.on('error', reject)
  })

  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Disconnect any prior grant for this app at myaccount.google.com/permissions and try again.'
    )
  }
  client.setCredentials(tokens)

  const driveClient = drive({ version: 'v3', auth: client })
  const about = await driveClient.about.get({ fields: 'user' })
  const email = about.data.user?.emailAddress ?? 'unknown'

  await setSetting(db, 'backup.driveRefreshTokenEnc', encryptSecret(tokens.refresh_token))
  await setSetting(db, 'backup.driveAccountEmail', email)
  await setSetting(db, 'backup.driveAutoBackupEnabled', 'true')

  return { email }
}

export async function disconnectGoogleDrive(db: PrismaClient): Promise<void> {
  await setSetting(db, 'backup.driveRefreshTokenEnc', '')
  await setSetting(db, 'backup.driveAccountEmail', '')
  await setSetting(db, 'backup.driveFolderId', '')
  await setSetting(db, 'backup.driveAutoBackupEnabled', 'false')
}

export async function saveDriveBackupSettings(
  db: PrismaClient,
  args: { autoBackupEnabled: boolean; intervalHours: number }
): Promise<void> {
  await setSetting(db, 'backup.driveAutoBackupEnabled', String(args.autoBackupEnabled))
  await setSetting(db, 'backup.driveIntervalHours', String(args.intervalHours))
}

export async function getDriveStatus(db: PrismaClient): Promise<DriveBackupStatus> {
  const [email, autoStr, intervalStr, lastLog] = await Promise.all([
    getSetting(db, 'backup.driveAccountEmail'),
    getSetting(db, 'backup.driveAutoBackupEnabled'),
    getSetting(db, 'backup.driveIntervalHours'),
    db.backupLog.findFirst({ where: { driveName: 'Google Drive' }, orderBy: { timestamp: 'desc' } })
  ])
  return {
    connected: email !== '',
    email: email || undefined,
    autoBackupEnabled: autoStr === 'true',
    intervalHours: parseInt(intervalStr, 10) || 24,
    lastBackup: lastLog
      ? ({
          id: lastLog.id,
          timestamp: lastLog.timestamp.toISOString(),
          backupPath: lastLog.backupPath,
          driveName: lastLog.driveName,
          drivePath: lastLog.drivePath,
          backupSizeBytes: lastLog.backupSizeBytes,
          status: lastLog.status as BackupLogSummary['status'],
          errorMessage: lastLog.errorMessage
        } as BackupLogSummary)
      : undefined
  }
}

async function findOrCreateRootFolder(client: drive_v3.Drive, db: PrismaClient): Promise<string> {
  const cachedId = await getSetting(db, 'backup.driveFolderId')
  if (cachedId) {
    try {
      const check = await client.files.get({ fileId: cachedId, fields: 'id, trashed' })
      if (!check.data.trashed) return cachedId
    } catch {
      // cached id is stale/deleted — fall through and recreate
    }
  }
  const found = await client.files.list({
    q: `name = '${DRIVE_ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)'
  })
  const existing = found.data.files?.[0]?.id
  const folderId =
    existing ??
    (
      await client.files.create({
        requestBody: { name: DRIVE_ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      })
    ).data.id
  if (!folderId) throw new Error('Could not create the Google Drive backup folder.')
  await setSetting(db, 'backup.driveFolderId', folderId)
  return folderId
}

/** Pure retention logic, split out from the API-calling sweep below so it's unit-testable
 * without mocking the Drive client. Mirrors cleanupExpiredBackups' best-effort behavior in
 * backupService.ts: an unparseable timestamp is left alone, never deleted. */
export function pickBackupsToDelete(
  folders: Array<{ name: string; createdTime: string }>,
  now: Date
): string[] {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  return folders
    .filter((f) => {
      const parsed = Date.parse(f.createdTime)
      return !Number.isNaN(parsed) && parsed < cutoff
    })
    .map((f) => f.name)
}

async function cleanupExpiredDriveBackups(
  client: drive_v3.Drive,
  rootFolderId: string
): Promise<void> {
  const list = await client.files.list({
    q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, createdTime)'
  })
  const folders = (list.data.files ?? []).filter(
    (f): f is { id: string; name: string; createdTime: string } =>
      !!f.id && !!f.name && !!f.createdTime && f.name.startsWith('PHARMACY_POS_BACKUP_')
  )
  const toDeleteNames = new Set(pickBackupsToDelete(folders, new Date()))
  for (const folder of folders) {
    if (!toDeleteNames.has(folder.name)) continue
    try {
      await client.files.delete({ fileId: folder.id })
    } catch {
      // best-effort — leave it for the next sweep
    }
  }
}

/** Uploads every file already written to `localBackupDir` (by performBackup) into a
 * timestamped Drive folder, logs a BackupLog row, then sweeps for expired Drive folders. */
export async function uploadBackupToDrive(
  db: PrismaClient,
  localBackupDir: string,
  args: { initiatedByUserId: number }
): Promise<void> {
  const startedAt = new Date()
  try {
    const authClient = await getAuthorizedClient(db)
    const client = drive({ version: 'v3', auth: authClient })
    const rootFolderId = await findOrCreateRootFolder(client, db)

    const folderName = basename(localBackupDir)
    const folder = await client.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId]
      },
      fields: 'id, webViewLink'
    })
    const folderId = folder.data.id
    if (!folderId) throw new Error('Could not create the Drive backup folder for this run.')

    const metadataPath = join(localBackupDir, 'backup-metadata.json')
    const metadata = existsSync(metadataPath)
      ? JSON.parse(readFileSync(metadataPath, 'utf-8'))
      : {}
    const files: string[] = metadata.filesIncluded ?? []
    let totalBytes = 0
    for (const fileName of files) {
      const filePath = join(localBackupDir, fileName)
      if (!existsSync(filePath)) continue
      const uploaded = await client.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { body: createReadStream(filePath) },
        fields: 'size'
      })
      totalBytes += Number(uploaded.data.size ?? 0)
    }

    await db.backupLog.create({
      data: {
        backupPath: folder.data.webViewLink ?? folderId,
        driveName: 'Google Drive',
        drivePath: folder.data.webViewLink ?? folderId,
        backupSizeBytes: totalBytes,
        dataSnapshot: JSON.stringify(metadata.dataSnapshot ?? {}),
        initiatedByUserId: args.initiatedByUserId,
        status: 'SUCCESS'
      }
    })

    await cleanupExpiredDriveBackups(client, rootFolderId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A revoked/expired grant surfaces as an auth error from Google — treat it as
    // disconnected so Settings prompts a manager to reconnect instead of retrying forever.
    if (message.includes('invalid_grant')) {
      await disconnectGoogleDrive(db)
    }
    await db.backupLog.create({
      data: {
        backupPath: localBackupDir,
        driveName: 'Google Drive',
        drivePath: '',
        backupSizeBytes: 0,
        dataSnapshot: '{}',
        initiatedByUserId: args.initiatedByUserId,
        status: 'FAILED',
        errorMessage: message
      }
    })
    throw new Error(message)
  }
}
```

Note: `BrowserWindow` import above is unused — remove it (leftover from drafting). Double check `@googleapis/drive`'s actual export shape (`drive()` factory vs `google.drive()`) against its installed `node_modules/@googleapis/drive` types before finalizing — API surface here is written from the standard `googleapis` pattern and must be confirmed against the actual installed version.

- [ ] **Step 7: Add `DriveBackupStatus` type**

In `src/shared/types.ts`, near `BackupLogSummary`:

```typescript
export interface DriveBackupStatus {
  connected: boolean
  email?: string
  autoBackupEnabled: boolean
  intervalHours: number
  lastBackup?: BackupLogSummary
}
```

- [ ] **Step 8: Run retention test to verify it passes**

Run: `npx vitest run src/__tests__/googleDriveRetention.test.ts`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck:node`
Expected: no errors. Fix any type mismatches against the actual `@googleapis/drive` types before moving on.

- [ ] **Step 10: Commit**

```bash
git add src/main/backup/googleDrive.ts src/main/db/queries/settingsQueries.ts src/shared/types.ts src/__tests__/googleDriveRetention.test.ts package.json package-lock.json .env.example
git commit -m "Add Google Drive OAuth connect/disconnect, upload, and retention"
```

---

### Task 3: IPC surface + preload wiring

**Files:**
- Modify: `src/shared/channels.ts`
- Modify: `src/main/ipc/backupHandlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: everything exported from Task 2's `googleDrive.ts`
- Produces: `window.api.backup.drive.{connect, disconnect, getStatus, saveSettings, runNow}` for the renderer

- [ ] **Step 1: Add channel constants**

In `src/shared/channels.ts`, next to the existing `BACKUP_*` constants:

```typescript
  BACKUP_DRIVE_CONNECT: 'backup:drive:connect',
  BACKUP_DRIVE_DISCONNECT: 'backup:drive:disconnect',
  BACKUP_DRIVE_GET_STATUS: 'backup:drive:getStatus',
  BACKUP_DRIVE_SAVE_SETTINGS: 'backup:drive:saveSettings',
  BACKUP_DRIVE_RUN_NOW: 'backup:drive:runNow',
```

- [ ] **Step 2: Register handlers**

In `src/main/ipc/backupHandlers.ts`, import `connectGoogleDrive, disconnectGoogleDrive, getDriveStatus, saveDriveBackupSettings, uploadBackupToDrive` from `../backup/googleDrive`, and `mkdtempSync, rmSync` from `fs` / `os.tmpdir` for the manual-run staging dir. Add inside `registerBackupHandlers`:

```typescript
  ipcMain.handle(
    IPC.BACKUP_DRIVE_CONNECT,
    guard('Connect Google Drive', async () => {
      requireManager()
      return connectGoogleDrive(db)
    })
  )

  ipcMain.handle(
    IPC.BACKUP_DRIVE_DISCONNECT,
    guard('Disconnect Google Drive', async () => {
      requireManager()
      await disconnectGoogleDrive(db)
    })
  )

  ipcMain.handle(
    IPC.BACKUP_DRIVE_GET_STATUS,
    guard('Get Google Drive backup status', async () => getDriveStatus(db))
  )

  ipcMain.handle(
    IPC.BACKUP_DRIVE_SAVE_SETTINGS,
    guard(
      'Save Google Drive backup settings',
      async (_e: Electron.IpcMainInvokeEvent, args: { autoBackupEnabled: boolean; intervalHours: number }) => {
        requireManager()
        await saveDriveBackupSettings(db, args)
      }
    )
  )

  ipcMain.handle(
    IPC.BACKUP_DRIVE_RUN_NOW,
    guard(
      'Back up to Google Drive now',
      async (_e: Electron.IpcMainInvokeEvent, args: { initiatedByUserId: number }) => {
        const stagingDir = mkdtempSync(join(os.tmpdir(), 'pharmacy-pos-backup-'))
        try {
          const result = await performBackup(
            db,
            { drivePath: stagingDir, driveName: 'Google Drive staging', initiatedByUserId: args.initiatedByUserId },
            buildBackupEnv()
          )
          await uploadBackupToDrive(db, result.backupDir, { initiatedByUserId: args.initiatedByUserId })
        } finally {
          rmSync(stagingDir, { recursive: true, force: true })
        }
      }
    )
  )
```

Add `import os from 'os'` and `import { mkdtempSync, rmSync } from 'fs'` to the top of the file alongside existing imports (note: `hostname` is already imported from `'os'` — use `import { hostname, tmpdir } from 'os'` and call `tmpdir()` directly instead of `os.tmpdir()`).

- [ ] **Step 3: Expose in preload**

In `src/preload/index.ts`, find the existing `backup: { ... }` object under `window.api` and add a `drive` sub-object:

```typescript
    drive: {
      connect: () => ipcRenderer.invoke(IPC.BACKUP_DRIVE_CONNECT),
      disconnect: () => ipcRenderer.invoke(IPC.BACKUP_DRIVE_DISCONNECT),
      getStatus: () => ipcRenderer.invoke(IPC.BACKUP_DRIVE_GET_STATUS),
      saveSettings: (args: { autoBackupEnabled: boolean; intervalHours: number }) =>
        ipcRenderer.invoke(IPC.BACKUP_DRIVE_SAVE_SETTINGS, args),
      runNow: (args: { initiatedByUserId: number }) =>
        ipcRenderer.invoke(IPC.BACKUP_DRIVE_RUN_NOW, args)
    }
```

Read the existing `backup` block first to match its exact surrounding structure/typing (there's likely a matching `interface` or type block elsewhere in the same file or in `src/preload/index.d.ts` — update that too if present).

- [ ] **Step 4: Typecheck both contexts**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/channels.ts src/main/ipc/backupHandlers.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "Add IPC surface for Google Drive backup connect/status/settings/run"
```

---

### Task 4: Settings UI card

**Files:**
- Create: `src/renderer/src/components/GoogleDriveBackupCard.tsx`
- Modify: `src/renderer/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `window.api.backup.drive.*` from Task 3, `useCurrentUser()` from `src/renderer/src/context/CurrentUserContext`

- [ ] **Step 1: Locate the existing backup settings section**

Read `src/renderer/src/screens/SettingsScreen.tsx` to find where the local/USB backup settings card is rendered (search for `backup.getPromptOnLogout` or similar) — the new card goes immediately after it, same manager-only gating.

- [ ] **Step 2: Implement the card**

```typescript
// src/renderer/src/components/GoogleDriveBackupCard.tsx
import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Switch } from './ui/Switch'
import { useCurrentUser } from '../context/CurrentUserContext'
import type { DriveBackupStatus } from '../../../shared/types'

const INTERVAL_OPTIONS = [6, 12, 24, 48]

export function GoogleDriveBackupCard(): React.JSX.Element {
  const { user } = useCurrentUser()
  const [status, setStatus] = React.useState<DriveBackupStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setStatus(await window.api.backup.drive.getStatus())
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleConnect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.backup.drive.connect()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.backup.drive.disconnect()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleToggleAuto = async (enabled: boolean): Promise<void> => {
    if (!status) return
    await window.api.backup.drive.saveSettings({
      autoBackupEnabled: enabled,
      intervalHours: status.intervalHours
    })
    await refresh()
  }

  const handleIntervalChange = async (hours: number): Promise<void> => {
    if (!status) return
    await window.api.backup.drive.saveSettings({ autoBackupEnabled: status.autoBackupEnabled, intervalHours: hours })
    await refresh()
  }

  const handleBackupNow = async (): Promise<void> => {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await window.api.backup.drive.runNow({ initiatedByUserId: user.id })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <Card className="p-6">Loading Google Drive backup settings…</Card>

  return (
    <Card className="p-6 space-y-4">
      <div>
        <CardTitle>Google Drive Backup</CardTitle>
        <CardDescription>
          Connect a Google account once — backups then upload to Drive automatically on logout
          and on a schedule, no further action needed.
        </CardDescription>
      </div>

      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

      {!status.connected ? (
        <button
          onClick={() => void handleConnect()}
          disabled={busy}
          className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          Connect Google Drive
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--foreground)]">Connected as {status.email}</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--foreground)]">Auto-backup to Google Drive</span>
            <Switch checked={status.autoBackupEnabled} onCheckedChange={(v) => void handleToggleAuto(v)} />
          </div>
          {status.autoBackupEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--foreground)]">Every</span>
              <select
                value={status.intervalHours}
                onChange={(e) => void handleIntervalChange(Number(e.target.value))}
                className="input"
              >
                {INTERVAL_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}h
                  </option>
                ))}
              </select>
            </div>
          )}
          {status.lastBackup && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Last backup: {new Date(status.lastBackup.timestamp).toLocaleString()} —{' '}
              {status.lastBackup.status}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => void handleBackupNow()}
              disabled={busy}
              className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50"
            >
              Back Up Now
            </button>
            <button
              onClick={() => void handleDisconnect()}
              disabled={busy}
              className="min-h-11 rounded-[var(--radius)] px-3 text-sm text-[var(--destructive)] disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
```

Check `src/renderer/src/components/ui/Switch.tsx` for its actual prop name (`onCheckedChange` vs `onChange`) before finalizing, and match whatever `input` utility class or select styling the rest of Settings already uses.

- [ ] **Step 3: Mount it in SettingsScreen**

Add `<GoogleDriveBackupCard />` right after the existing local backup settings card, inside the same manager-only conditional block.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, log in as a manager, open Settings, confirm the card renders without errors (OAuth itself can't complete without real `GOOGLE_DRIVE_CLIENT_ID`/`SECRET` env vars — confirm the "Connect" button at least calls the IPC handler and surfaces the "not configured" error cleanly).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GoogleDriveBackupCard.tsx src/renderer/src/screens/SettingsScreen.tsx
git commit -m "Add Google Drive backup card to Settings"
```

---

### Task 5: Trigger integration — logout + scheduler

**Files:**
- Modify: `src/renderer/src/components/LogoutConfirmModal.tsx`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `window.api.backup.drive.{getStatus, runNow}` (renderer side, logout), `getDriveStatus`/`uploadBackupToDrive`/`performBackup` (main side, scheduler)

- [ ] **Step 1: Silent Drive backup on logout**

In `LogoutConfirmModal.tsx`, wrap both `logout()` call sites (the "No, Just Logout" button and `BackupModal`'s `onClose`) so a Drive backup fires in the background first if connected+enabled, without blocking the UI:

```typescript
const maybeBackupToDrive = React.useCallback(async (): Promise<void> => {
  if (!user) return
  try {
    const status = await window.api.backup.drive.getStatus()
    if (status.connected && status.autoBackupEnabled) {
      void window.api.backup.drive.runNow({ initiatedByUserId: user.id })
    }
  } catch {
    // best-effort — never block logout on a Drive backup failure
  }
}, [user])
```

Call `void maybeBackupToDrive()` immediately before each `logout()` call (fire-and-forget — logout should not wait on the upload). Do not await it; the upload continues in the main process after the renderer navigates away since it's driven by `ipcMain.handle`, not tied to the window.

- [ ] **Step 2: Scheduler in main process**

In `src/main/index.ts`, inside the `app.whenReady().then(...)` block, after `registerAllHandlers(db)`:

```typescript
  const driveBackupTimer = setInterval(
    async () => {
      try {
        const { getDriveStatus, uploadBackupToDrive } = await import('./backup/googleDrive')
        const status = await getDriveStatus(db)
        if (!status.connected || !status.autoBackupEnabled) return
        const { performBackup } = await import('./backup/backupService')
        const { mkdtempSync, rmSync } = await import('fs')
        const { tmpdir } = await import('os')
        const { join: joinPath } = await import('path')
        const stagingDir = mkdtempSync(joinPath(tmpdir(), 'pharmacy-pos-backup-'))
        try {
          const result = await performBackup(
            db,
            { drivePath: stagingDir, driveName: 'Google Drive staging', initiatedByUserId: 0 },
            buildBackupEnv()
          )
          await uploadBackupToDrive(db, result.backupDir, { initiatedByUserId: 0 })
        } finally {
          rmSync(stagingDir, { recursive: true, force: true })
        }
      } catch (error) {
        log('BACKUP_DRIVE_SCHEDULED_FAILED', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    },
    60 * 60 * 1000 // check hourly; getDriveStatus's own lastBackup timestamp governs actual cadence
  )
  app.on('before-quit', () => clearInterval(driveBackupTimer))
```

This is a simplified hourly-check scheduler — it doesn't yet respect `intervalHours` precisely (it uploads every hour rather than every N hours). Fix by comparing `status.lastBackup?.timestamp` against `status.intervalHours` before calling `performBackup`:

```typescript
        if (status.lastBackup) {
          const hoursSinceLast = (Date.now() - new Date(status.lastBackup.timestamp).getTime()) / 3_600_000
          if (hoursSinceLast < status.intervalHours) return
        }
```

Insert that check right after the `if (!status.connected...) return` line, before creating the staging dir. `buildBackupEnv` is already defined in `backupHandlers.ts`, not `main/index.ts` — either export it from there and import it, or inline the same three-field object directly in this scheduler (simpler: export `buildBackupEnv` from `backupHandlers.ts` and import it here).

- [ ] **Step 2b: Export `buildBackupEnv`**

In `src/main/ipc/backupHandlers.ts`, change `function buildBackupEnv()` to `export function buildBackupEnv()`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Without real Google credentials this can't complete an actual OAuth+upload, so verify instead that: (a) logging out with Drive disconnected doesn't throw or hang, (b) the scheduler's hourly check doesn't crash the app on startup (watch the log file for `BACKUP_DRIVE_SCHEDULED_FAILED` — a clean "not connected" no-op, not an unhandled exception).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/LogoutConfirmModal.tsx src/main/index.ts src/main/ipc/backupHandlers.ts
git commit -m "Wire Google Drive backup into logout flow and a background scheduler"
```

---

### Task 6: Full verification pass

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS (aside from the 3 pre-existing `reportQueries.test.ts` date-range failures, which are known-broken on clean HEAD per project memory — not a regression).

- [ ] **Step 2: Run full typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit any final fixups, then stop** — this plan does not include pushing; report the branch/worktree state back for review.
