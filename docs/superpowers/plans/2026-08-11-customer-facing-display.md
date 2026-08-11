# Customer-Facing Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, read-only, kiosk-mode Electron window on a second physical monitor that mirrors checkout state in real time for the customer (idle slideshow, live cart, 4 payment states, thank-you), fully spec'd in `docs/superpowers/specs/2026-08-11-customer-facing-display-spec.md` and `docs/superpowers/specs/2026-08-11-customer-facing-display-design.md`.

**Architecture:** New Vite renderer entry (`customer-display.html`) loaded into a second `BrowserWindow` created in `src/main/index.ts`. Checkout renderer pushes state via a new `customer-display:push` IPC channel (renderer→main); main process holds current state and rebroadcasts `customer-display:update` to the customer-display window only. Slides are a new `CustomerDisplaySlide` Prisma model with CRUD IPC; pharmacy name / e-transfer email / duration / enabled toggle live in the existing generic `Setting` table via `settingsQueries.ts`.

**Tech Stack:** Electron `BrowserWindow`/`screen`, electron-vite multi-entry build, React 18 renderer, Prisma/SQLite, existing `IPC`/`registerAllHandlers`/`contextBridge` patterns.

## Global Constraints

- Card total shown on the customer display must exactly equal the surcharge-inclusive amount the terminal charges (`payment.allowCreditCardSurcharge` / `payment.cardSurchargePercent` settings, already read by checkout).
- Font sizing on the Idle/Slideshow screen is computed at render time via measure-and-shrink; never a hardcoded per-length lookup table.
- Every second-window operation (create, send, close) is wrapped in try/catch and logged via `log()` from `src/main/logging/logger.ts`; failures never throw into the main window's code path.
- Settings changes to slides, duration, pharmacy name, and e-transfer email apply live to a running customer display — no restart.
- Customer display window: no click handlers, no visible cursor if avoidable, `kiosk: true`, `frame: false`, dev tools disabled outside `is.dev`.
- Follow existing repo conventions: IPC channel constants in `src/shared/channels.ts`, handler files in `src/main/ipc/*Handlers.ts` registered via `registerAllHandlers`, preload wrappers in `src/preload/index.ts`, shared types in `src/shared/types.ts` (or new `src/shared/customerDisplay.ts` re-exported there), settings CRUD pattern matching `settingsQueries.ts`.
- Character limit for a slide's text is 60, enforced at the form level (live counter) and again in the main-process handler.
- `npm run typecheck` and `npm test` must pass before any commit that isn't itself a WIP checkpoint; final commit must have both green.

---

## File Map

- `src/shared/customerDisplay.ts` — new. `CustomerDisplayState` union, `CustomerDisplaySlideDTO`, `CustomerDisplaySettingsDTO` types shared by main+renderer.
- `src/shared/channels.ts` — modify. Add customer-display channel constants.
- `prisma/schema.prisma` — modify. Add `CustomerDisplaySlide` model.
- `src/main/db/queries/customerDisplayQueries.ts` — new. Slide CRUD + settings get/save (pharmacy name is read from existing `store.name`, not duplicated).
- `src/main/ipc/customerDisplayHandlers.ts` — new. IPC handlers: slide CRUD, settings get/save, and the `customer-display:push` handler that updates in-memory state and rebroadcasts.
- `src/main/ipc/index.ts` — modify. Register new handlers.
- `src/main/customerDisplayWindow.ts` — new. Window lifecycle: create/destroy, display-added/removed listeners, 30s poll fallback, broadcast helper, enabled-toggle gating.
- `src/main/index.ts` — modify. Call `initCustomerDisplayWindow()` after main window creation; call teardown on app quit.
- `src/preload/index.ts` — modify. Expose `window.api.customerDisplay.*` wrappers.
- `src/preload/customer-display.ts` — new. Minimal separate preload for the customer-display window (only needs to receive `customer-display:update`/`customer-display:slides`/`customer-display:settings`, nothing else).
- `electron.vite.config.ts` — modify. Add `customer-display.html` as a second renderer entry.
- `src/renderer/customer-display.html` — new. Minimal HTML entry.
- `src/renderer/src/customerDisplay/main.tsx` — new. React root for the customer-display renderer.
- `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx` — new. State machine switching between the 7 screens.
- `src/renderer/src/customerDisplay/screens/IdleScreen.tsx` — new. Slideshow + dynamic font sizing.
- `src/renderer/src/customerDisplay/screens/CartScreen.tsx` — new.
- `src/renderer/src/customerDisplay/screens/PaymentCashScreen.tsx`, `PaymentCardScreen.tsx`, `PaymentETransferScreen.tsx`, `PaymentTabScreen.tsx` — new.
- `src/renderer/src/customerDisplay/screens/ThankYouScreen.tsx` — new.
- `src/renderer/src/customerDisplay/useFitText.ts` — new. Measure-and-shrink hook.
- `src/renderer/src/components/CustomerDisplaySettingsCard.tsx` — new. Settings UI: enabled toggle, e-transfer email, slide CRUD/reorder, duration.
- `src/renderer/src/screens/SettingsScreen.tsx` — modify. Mount `CustomerDisplaySettingsCard`.
- `src/renderer/src/screens/CheckoutScreen.tsx` — modify. Push state at cart-change/payment-method-select/sale-complete/void transitions.
- `src/__tests__/customerDisplayState.test.ts` — new. Pure-function tests for state-shape builders (cart totals→`CustomerDisplayState`, payment states) and the fit-text shrink algorithm.

---

## Task 1: Shared types + IPC channels + Prisma model

**Files:**
- Create: `src/shared/customerDisplay.ts`
- Modify: `src/shared/channels.ts`
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `CustomerDisplayState` (exact union below), `CustomerDisplaySlideDTO { id: number; text: string; sortOrder: number }`, `CustomerDisplaySettingsDTO { enabled: boolean; slideDurationSeconds: number; eTransferEmail: string; pharmacyName: string }`.

```typescript
// src/shared/customerDisplay.ts
export interface CustomerDisplayLineItem {
  name: string
  qty: number
  lineTotalCents: number
  discountCents?: number
}

export type CustomerDisplayState =
  | { mode: 'idle' }
  | {
      mode: 'cart'
      lineItems: CustomerDisplayLineItem[]
      subtotalCents: number
      billDiscountCents?: number
      taxCents: number
      totalCents: number
    }
  | {
      mode: 'payment-cash'
      totalCents: number
      cashGivenCents: number
      changeCents: number
      depositedToCreditCents?: number
    }
  | { mode: 'payment-card'; totalCents: number }
  | { mode: 'payment-etransfer'; totalCents: number; pharmacyEmail: string }
  | { mode: 'payment-tab'; totalCents: number; chargedToTabCents: number; balanceAfterCents: number }
  | { mode: 'thank-you'; pharmacyName: string }

export interface CustomerDisplaySlideDTO {
  id: number
  text: string
  sortOrder: number
}

export interface CustomerDisplaySettingsDTO {
  enabled: boolean
  slideDurationSeconds: number
  eTransferEmail: string
  pharmacyName: string
}

export const CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH = 60
```

- [ ] **Step 1:** Create `src/shared/customerDisplay.ts` with the exact content above.

- [ ] **Step 2:** In `src/shared/channels.ts`, add before the closing `} as const`:

```typescript
  // Customer-facing display (second screen)
  CUSTOMER_DISPLAY_PUSH: 'customer-display:push',
  CUSTOMER_DISPLAY_UPDATE: 'customer-display:update',
  CUSTOMER_DISPLAY_SLIDES: 'customer-display:slides',
  CUSTOMER_DISPLAY_SETTINGS: 'customer-display:settings',
  CUSTOMER_DISPLAY_GET_SLIDES: 'customerDisplay:getSlides',
  CUSTOMER_DISPLAY_SAVE_SLIDES: 'customerDisplay:saveSlides',
  CUSTOMER_DISPLAY_GET_SETTINGS: 'customerDisplay:getSettings',
  CUSTOMER_DISPLAY_SAVE_SETTINGS: 'customerDisplay:saveSettings',
```

- [ ] **Step 3:** In `prisma/schema.prisma`, add at the end of the file:

```prisma
model CustomerDisplaySlide {
  id        Int      @id @default(autoincrement())
  text      String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sortOrder])
}
```

- [ ] **Step 4:** Run `npx prisma migrate dev --name add_customer_display_slide` (creates migration + regenerates client). If the dev DB prompts for destructive changes, this is an additive migration and should apply cleanly.

- [ ] **Step 5:** Run `npm run typecheck` — expect it to still pass (new file isn't imported anywhere yet, so no errors).

- [ ] **Step 6: Commit**

```bash
git add src/shared/customerDisplay.ts src/shared/channels.ts prisma/schema.prisma prisma/migrations
git commit -m "Add customer-display shared types, IPC channels, and slide model"
```

---

## Task 2: Settings + slide CRUD queries and defaults

**Files:**
- Modify: `src/main/db/queries/settingsQueries.ts`
- Test: `src/__tests__/customerDisplayQueries.test.ts`
- Create: `src/main/db/queries/customerDisplayQueries.ts`

**Interfaces:**
- Consumes: `CustomerDisplaySlideDTO`, `CustomerDisplaySettingsDTO`, `CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH` from `../../../shared/customerDisplay` (Task 1). `getStoreInfo(db)` already exists in `settingsQueries.ts` and returns `{ name: string, ... }` — reuse for `pharmacyName`.
- Produces: `getCustomerDisplaySlides(db): Promise<CustomerDisplaySlideDTO[]>`, `saveCustomerDisplaySlides(db, slides: {id?: number; text: string}[]): Promise<CustomerDisplaySlideDTO[]>` (replaces the full ordered list — id omitted = new row, sortOrder assigned by array position), `deleteCustomerDisplaySlide(db, id: number): Promise<void>`, `getCustomerDisplaySettings(db): Promise<CustomerDisplaySettingsDTO>`, `saveCustomerDisplaySettings(db, input: { enabled: boolean; slideDurationSeconds: number; eTransferEmail: string }): Promise<CustomerDisplaySettingsDTO>`.

- [ ] **Step 1:** In `src/main/db/queries/settingsQueries.ts`, add three new keys to the `DEFAULTS` object (alongside `'display.densityLevel'`):

```typescript
  'customerDisplay.enabled': 'true',
  'customerDisplay.slideDurationSeconds': '8',
  'customerDisplay.eTransferEmail': ''
```

- [ ] **Step 2:** Write the failing test first, `src/__tests__/customerDisplayQueries.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  getCustomerDisplaySlides,
  saveCustomerDisplaySlides,
  deleteCustomerDisplaySlide,
  getCustomerDisplaySettings,
  saveCustomerDisplaySettings
} from '../main/db/queries/customerDisplayQueries'

// Assumes the same in-memory/test DB bootstrap pattern used by sibling
// query test files in this directory — reuse whatever helper they import
// (e.g. a shared `getTestDb()` from src/__tests__/testDb.ts) instead of
// constructing PrismaClient directly if such a helper exists.
const db = new PrismaClient()

describe('customerDisplayQueries', () => {
  beforeEach(async () => {
    await db.customerDisplaySlide.deleteMany()
  })

  it('returns empty slide list by default', async () => {
    expect(await getCustomerDisplaySlides(db)).toEqual([])
  })

  it('saves slides in array order and assigns sortOrder', async () => {
    const saved = await saveCustomerDisplaySlides(db, [
      { text: 'FREE DELIVERY' },
      { text: 'CHEAP PRICES' }
    ])
    expect(saved.map((s) => s.text)).toEqual(['FREE DELIVERY', 'CHEAP PRICES'])
    expect(saved[0].sortOrder).toBe(0)
    expect(saved[1].sortOrder).toBe(1)
  })

  it('deletes a slide', async () => {
    const [a] = await saveCustomerDisplaySlides(db, [{ text: 'A' }])
    await deleteCustomerDisplaySlide(db, a.id)
    expect(await getCustomerDisplaySlides(db)).toEqual([])
  })

  it('rejects slide text over the character limit', async () => {
    await expect(saveCustomerDisplaySlides(db, [{ text: 'x'.repeat(61) }])).rejects.toThrow()
  })

  it('returns default settings including pharmacy name from store settings', async () => {
    const settings = await getCustomerDisplaySettings(db)
    expect(settings.enabled).toBe(true)
    expect(settings.slideDurationSeconds).toBe(8)
    expect(settings.eTransferEmail).toBe('')
    expect(typeof settings.pharmacyName).toBe('string')
  })

  it('saves settings and reads them back', async () => {
    await saveCustomerDisplaySettings(db, {
      enabled: false,
      slideDurationSeconds: 12,
      eTransferEmail: 'payments@example.com'
    })
    const settings = await getCustomerDisplaySettings(db)
    expect(settings.enabled).toBe(false)
    expect(settings.slideDurationSeconds).toBe(12)
    expect(settings.eTransferEmail).toBe('payments@example.com')
  })
})
```

- [ ] **Step 2b:** Before writing this test file, run `ls src/__tests__ | head -5` and open one sibling `*Queries.test.ts` to copy its exact DB-bootstrap/teardown pattern (in-memory sqlite vs shared dev.db, any `beforeAll`/`afterAll`) — replace the `const db = new PrismaClient()` placeholder above with whatever that pattern actually is so this test is consistent with the rest of the suite.

- [ ] **Step 3:** Run `npx vitest run src/__tests__/customerDisplayQueries.test.ts` — expect FAIL (module doesn't exist).

- [ ] **Step 4:** Create `src/main/db/queries/customerDisplayQueries.ts`:

```typescript
import { PrismaClient } from '@prisma/client'
import {
  CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH,
  type CustomerDisplaySettingsDTO,
  type CustomerDisplaySlideDTO
} from '../../../shared/customerDisplay'
import { getStoreInfo } from './settingsQueries'

async function getSetting(db: PrismaClient, key: string, fallback: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? fallback
}

async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export async function getCustomerDisplaySlides(db: PrismaClient): Promise<CustomerDisplaySlideDTO[]> {
  const rows = await db.customerDisplaySlide.findMany({ orderBy: { sortOrder: 'asc' } })
  return rows.map((r) => ({ id: r.id, text: r.text, sortOrder: r.sortOrder }))
}

export async function saveCustomerDisplaySlides(
  db: PrismaClient,
  slides: Array<{ id?: number; text: string }>
): Promise<CustomerDisplaySlideDTO[]> {
  for (const s of slides) {
    if (s.text.length === 0 || s.text.length > CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH) {
      throw new Error(`Slide text must be 1-${CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH} characters`)
    }
  }
  return db.$transaction(async (tx) => {
    await tx.customerDisplaySlide.deleteMany()
    const created: CustomerDisplaySlideDTO[] = []
    for (let i = 0; i < slides.length; i++) {
      const row = await tx.customerDisplaySlide.create({
        data: { text: slides[i].text, sortOrder: i }
      })
      created.push({ id: row.id, text: row.text, sortOrder: row.sortOrder })
    }
    return created
  })
}

export async function deleteCustomerDisplaySlide(db: PrismaClient, id: number): Promise<void> {
  await db.customerDisplaySlide.delete({ where: { id } })
}

export async function getCustomerDisplaySettings(
  db: PrismaClient
): Promise<CustomerDisplaySettingsDTO> {
  const [enabled, duration, email, store] = await Promise.all([
    getSetting(db, 'customerDisplay.enabled', 'true'),
    getSetting(db, 'customerDisplay.slideDurationSeconds', '8'),
    getSetting(db, 'customerDisplay.eTransferEmail', ''),
    getStoreInfo(db)
  ])
  return {
    enabled: enabled === 'true',
    slideDurationSeconds: Number(duration) || 8,
    eTransferEmail: email,
    pharmacyName: store.name
  }
}

export async function saveCustomerDisplaySettings(
  db: PrismaClient,
  input: { enabled: boolean; slideDurationSeconds: number; eTransferEmail: string }
): Promise<CustomerDisplaySettingsDTO> {
  await Promise.all([
    setSetting(db, 'customerDisplay.enabled', String(input.enabled)),
    setSetting(db, 'customerDisplay.slideDurationSeconds', String(input.slideDurationSeconds)),
    setSetting(db, 'customerDisplay.eTransferEmail', input.eTransferEmail)
  ])
  return getCustomerDisplaySettings(db)
}
```

- [ ] **Step 5:** Run `npx vitest run src/__tests__/customerDisplayQueries.test.ts` — expect PASS. Fix the DB bootstrap in the test file (per Step 2b) if it fails on setup rather than assertions.

- [ ] **Step 6:** Run `npm run typecheck:node` — expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/db/queries/settingsQueries.ts src/main/db/queries/customerDisplayQueries.ts src/__tests__/customerDisplayQueries.test.ts
git commit -m "Add customer-display slide CRUD and settings queries"
```

---

## Task 3: Window lifecycle (main process)

**Files:**
- Create: `src/main/customerDisplayWindow.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `log()` from `../main/logging/logger` (already exists — verify exact export name/path before use), `getDb()` from `./db/prisma`, `getCustomerDisplaySettings` (Task 2).
- Produces: `initCustomerDisplayWindow(db: PrismaClient): void`, `broadcastCustomerDisplayState(state: CustomerDisplayState): void`, `broadcastCustomerDisplaySlides(slides: CustomerDisplaySlideDTO[]): void`, `broadcastCustomerDisplaySettings(settings: CustomerDisplaySettingsDTO): void`, `teardownCustomerDisplayWindow(): void` — all consumed by Task 4's IPC handlers and Task 6's Settings handlers.

- [ ] **Step 1:** Before writing, read `src/main/logging/logger.ts` to confirm the exact exported `log` signature (e.g. `log.error(...)` vs `log(level, msg)`), and read `src/main/index.ts` in full to find where `createWindow()` is called and where app-quit/window-all-closed handlers live, so the wiring in Step 3 matches exactly.

- [ ] **Step 2:** Create `src/main/customerDisplayWindow.ts`:

```typescript
import { BrowserWindow, screen, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { PrismaClient } from '@prisma/client'
import { log } from './logging/logger'
import { getCustomerDisplaySettings } from './db/queries/customerDisplayQueries'
import type {
  CustomerDisplayState,
  CustomerDisplaySettingsDTO,
  CustomerDisplaySlideDTO
} from '../shared/customerDisplay'

let customerWindow: BrowserWindow | null = null
let pollTimer: NodeJS.Timeout | null = null
let dbRef: PrismaClient | null = null

function safelyCall(label: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    log.error(`[customerDisplay] ${label} failed`, err)
  }
}

function pickSecondaryDisplay(): Electron.Display | null {
  const displays = screen.getAllDisplays()
  if (displays.length < 2) return null
  const primary = screen.getPrimaryDisplay()
  return displays.find((d) => d.id !== primary.id) ?? null
}

async function loadCustomerRenderer(win: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    await win.loadURL(`${devUrl}/customer-display.html`)
    return
  }
  const builtFile = join(__dirname, '../renderer/customer-display.html')
  if (existsSync(builtFile)) {
    await win.loadFile(builtFile)
  }
}

async function createCustomerWindow(): Promise<void> {
  if (customerWindow && !customerWindow.isDestroyed()) return
  const display = pickSecondaryDisplay()
  if (!display) return
  if (!dbRef) return
  const settings = await getCustomerDisplaySettings(dbRef)
  if (!settings.enabled) return

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: true,
    frame: false,
    kiosk: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/customer-display.js'),
      sandbox: false,
      devTools: is.dev
    }
  })
  win.setMenuBarVisibility(false)
  win.on('closed', () => {
    if (customerWindow === win) customerWindow = null
  })
  customerWindow = win
  await loadCustomerRenderer(win)
}

function destroyCustomerWindow(): void {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.close()
  }
  customerWindow = null
}

async function reconcileWindow(): Promise<void> {
  if (!dbRef) return
  const settings = await getCustomerDisplaySettings(dbRef)
  const display = pickSecondaryDisplay()
  const shouldExist = settings.enabled && display !== null
  const exists = customerWindow !== null && !customerWindow.isDestroyed()
  if (shouldExist && !exists) {
    await createCustomerWindow()
  } else if (!shouldExist && exists) {
    destroyCustomerWindow()
  }
}

export function initCustomerDisplayWindow(db: PrismaClient): void {
  dbRef = db
  safelyCall('initial reconcile', () => {
    void reconcileWindow()
  })
  screen.on('display-added', () => safelyCall('display-added handler', () => void reconcileWindow()))
  screen.on('display-removed', () =>
    safelyCall('display-removed handler', () => void reconcileWindow())
  )
  pollTimer = setInterval(() => {
    safelyCall('poll reconcile', () => void reconcileWindow())
  }, 30_000)
  app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer)
  })
}

export function teardownCustomerDisplayWindow(): void {
  if (pollTimer) clearInterval(pollTimer)
  destroyCustomerWindow()
}

/** Called by Settings when the enabled toggle changes, to apply immediately. */
export function reconcileCustomerDisplayWindowNow(): void {
  safelyCall('manual reconcile', () => void reconcileWindow())
}

function send(channel: string, payload: unknown): void {
  safelyCall(`send ${channel}`, () => {
    if (customerWindow && !customerWindow.isDestroyed()) {
      customerWindow.webContents.send(channel, payload)
    }
  })
}

export function broadcastCustomerDisplayState(state: CustomerDisplayState): void {
  send('customer-display:update', state)
}

export function broadcastCustomerDisplaySlides(slides: CustomerDisplaySlideDTO[]): void {
  send('customer-display:slides', slides)
}

export function broadcastCustomerDisplaySettings(settings: CustomerDisplaySettingsDTO): void {
  send('customer-display:settings', settings)
}
```

Adjust the `log.error(...)` call to match whatever `logger.ts` actually exports (Step 1) — if it exports a plain function instead of an object with `.error`, change every `log.error(msg, err)` call accordingly, consistently, throughout this file.

- [ ] **Step 3:** In `src/main/index.ts`, import `initCustomerDisplayWindow` and `teardownCustomerDisplayWindow` from `./customerDisplayWindow`. Call `initCustomerDisplayWindow(getDb())` right after the main window is created and shown (find the exact spot — likely inside `app.whenReady().then(...)` after `createWindow()` and after `registerAllHandlers(db)`). Call `teardownCustomerDisplayWindow()` inside the existing `window-all-closed` or `before-quit` handler, before/alongside `closeDb()`.

- [ ] **Step 4:** Run `npm run typecheck:node` — fix any type errors from Step 2/3 (e.g. `PrismaClient` import path, `Electron.Display` type availability).

- [ ] **Step 5: Commit**

```bash
git add src/main/customerDisplayWindow.ts src/main/index.ts
git commit -m "Add customer-display second-window lifecycle (create/destroy, monitor connect/disconnect, poll fallback)"
```

**Manual verification (cannot be automated in CI):** with a second monitor attached, run `npm run dev` and confirm a blank fullscreen kiosk window opens on it; unplug/replug the monitor and confirm it closes/reopens within ~30s; on a single-monitor machine confirm no window is created and no errors are logged.

---

## Task 4: IPC handlers + preload wiring (hello-world plumbing)

**Files:**
- Create: `src/main/ipc/customerDisplayHandlers.ts`
- Create: `src/preload/customer-display.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/customer-display.html`
- Create: `src/renderer/src/customerDisplay/main.tsx`
- Create: `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx` (hello-world version — logs/renders raw state; full screens come in Task 5+)

**Interfaces:**
- Consumes: `IPC` (Task 1), `broadcastCustomerDisplayState/Slides/Settings`, `reconcileCustomerDisplayWindowNow` (Task 3), `getCustomerDisplaySlides/saveCustomerDisplaySlides/deleteCustomerDisplaySlide/getCustomerDisplaySettings/saveCustomerDisplaySettings` (Task 2).
- Produces (on `window.api.customerDisplay` in the **main** checkout renderer): `push(state: CustomerDisplayState): void`, `getSlides(): Promise<CustomerDisplaySlideDTO[]>`, `saveSlides(slides): Promise<CustomerDisplaySlideDTO[]>`, `deleteSlide(id): Promise<void>`, `getSettings(): Promise<CustomerDisplaySettingsDTO>`, `saveSettings(input): Promise<CustomerDisplaySettingsDTO>`. Produces (on `window.customerDisplayApi` in the **customer-display** renderer, via the separate preload): `onUpdate(cb), onSlides(cb), onSettings(cb)` subscription functions.

- [ ] **Step 1:** Create `src/main/ipc/customerDisplayHandlers.ts`:

```typescript
import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { CustomerDisplayState } from '../../shared/customerDisplay'
import {
  getCustomerDisplaySlides,
  saveCustomerDisplaySlides,
  deleteCustomerDisplaySlide,
  getCustomerDisplaySettings,
  saveCustomerDisplaySettings
} from '../db/queries/customerDisplayQueries'
import {
  broadcastCustomerDisplayState,
  broadcastCustomerDisplaySlides,
  broadcastCustomerDisplaySettings,
  reconcileCustomerDisplayWindowNow
} from '../customerDisplayWindow'

export function registerCustomerDisplayHandlers(db: PrismaClient): void {
  ipcMain.on(IPC.CUSTOMER_DISPLAY_PUSH, (_e, state: CustomerDisplayState) => {
    broadcastCustomerDisplayState(state)
  })

  ipcMain.handle(IPC.CUSTOMER_DISPLAY_GET_SLIDES, async () => getCustomerDisplaySlides(db))

  ipcMain.handle(
    IPC.CUSTOMER_DISPLAY_SAVE_SLIDES,
    async (_e: IpcMainInvokeEvent, slides: Array<{ id?: number; text: string }>) => {
      const saved = await saveCustomerDisplaySlides(db, slides)
      broadcastCustomerDisplaySlides(saved)
      return saved
    }
  )

  ipcMain.handle(IPC.CUSTOMER_DISPLAY_SAVE_SLIDES + ':delete', async (_e, id: number) => {
    await deleteCustomerDisplaySlide(db, id)
    const slides = await getCustomerDisplaySlides(db)
    broadcastCustomerDisplaySlides(slides)
  })

  ipcMain.handle(IPC.CUSTOMER_DISPLAY_GET_SETTINGS, async () => getCustomerDisplaySettings(db))

  ipcMain.handle(
    IPC.CUSTOMER_DISPLAY_SAVE_SETTINGS,
    async (
      _e: IpcMainInvokeEvent,
      input: { enabled: boolean; slideDurationSeconds: number; eTransferEmail: string }
    ) => {
      const saved = await saveCustomerDisplaySettings(db, input)
      broadcastCustomerDisplaySettings(saved)
      reconcileCustomerDisplayWindowNow()
      return saved
    }
  )
}
```

Note: the `+ ':delete'` channel string is a placeholder pattern — instead add a proper `CUSTOMER_DISPLAY_DELETE_SLIDE: 'customerDisplay:deleteSlide'` constant to `channels.ts` in this task (amend Task 1's edit) and use that instead of string concatenation.

- [ ] **Step 2:** In `src/shared/channels.ts`, replace the placeholder by adding `CUSTOMER_DISPLAY_DELETE_SLIDE: 'customerDisplay:deleteSlide',` next to the other `CUSTOMER_DISPLAY_*` constants, and use `IPC.CUSTOMER_DISPLAY_DELETE_SLIDE` in the handler above instead of string concatenation.

- [ ] **Step 3:** In `src/main/ipc/index.ts`, import and call `registerCustomerDisplayHandlers(db)` alongside the other `register*Handlers(db)` calls.

- [ ] **Step 4:** In `src/preload/index.ts`, add near the other domain objects exposed via `contextBridge.exposeInMainWorld('api', {...})`:

```typescript
customerDisplay: {
  push: (state: CustomerDisplayState) => ipcRenderer.send(IPC.CUSTOMER_DISPLAY_PUSH, state),
  getSlides: () => ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_GET_SLIDES),
  saveSlides: (slides: Array<{ id?: number; text: string }>) =>
    ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_SAVE_SLIDES, slides),
  deleteSlide: (id: number) => ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_DELETE_SLIDE, id),
  getSettings: () => ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_GET_SETTINGS),
  saveSettings: (input: {
    enabled: boolean
    slideDurationSeconds: number
    eTransferEmail: string
  }) => ipcRenderer.invoke(IPC.CUSTOMER_DISPLAY_SAVE_SETTINGS, input)
}
```

Add `import type { CustomerDisplayState } from '../shared/customerDisplay'` at the top, and extend whatever TypeScript interface describes `window.api` (find it — likely in this same file or a `.d.ts`) with a matching `customerDisplay: {...}` block so the renderer gets types.

- [ ] **Step 5:** Create `src/preload/customer-display.ts` — a separate, minimal preload for the second window (no auth/business APIs):

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  CustomerDisplayState,
  CustomerDisplaySettingsDTO,
  CustomerDisplaySlideDTO
} from '../shared/customerDisplay'

contextBridge.exposeInMainWorld('customerDisplayApi', {
  onUpdate: (cb: (state: CustomerDisplayState) => void) => {
    ipcRenderer.on(IPC.CUSTOMER_DISPLAY_UPDATE, (_e, state) => cb(state))
  },
  onSlides: (cb: (slides: CustomerDisplaySlideDTO[]) => void) => {
    ipcRenderer.on(IPC.CUSTOMER_DISPLAY_SLIDES, (_e, slides) => cb(slides))
  },
  onSettings: (cb: (settings: CustomerDisplaySettingsDTO) => void) => {
    ipcRenderer.on(IPC.CUSTOMER_DISPLAY_SETTINGS, (_e, settings) => cb(settings))
  }
})
```

- [ ] **Step 6:** In `electron.vite.config.ts`, add a second preload entry and a second renderer entry. Read the file first to see if `preload: {}` needs an explicit `build.rollupOptions.input` (electron-vite auto-discovers `src/preload/index.ts` by convention — check electron-vite docs/existing config comments for whether multiple preload files need explicit listing) — configure `preload.build.rollupOptions.input` to include both `index` and `customer-display` if auto-discovery doesn't already pick up multiple files, and add to `renderer.build.rollupOptions.input`:

```typescript
import { resolve } from 'path'
// ...
renderer: {
  resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/renderer/index.html'),
        'customer-display': resolve('src/renderer/customer-display.html')
      }
    }
  }
}
```

Verify the existing `src/renderer/index.html` path is correct by checking where it currently lives before assuming this path.

- [ ] **Step 7:** Create `src/renderer/customer-display.html` (model it on the existing `src/renderer/index.html` but pointing at the new entry script):

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Customer Display</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/customerDisplay/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8:** Create `src/renderer/src/customerDisplay/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { CustomerDisplayApp } from './CustomerDisplayApp'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CustomerDisplayApp />
  </React.StrictMode>
)
```

- [ ] **Step 9:** Create the hello-world `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx`:

```tsx
import React from 'react'
import type { CustomerDisplayState } from '../../../shared/customerDisplay'

declare global {
  interface Window {
    customerDisplayApi: {
      onUpdate: (cb: (state: CustomerDisplayState) => void) => void
      onSlides: (cb: (slides: unknown) => void) => void
      onSettings: (cb: (settings: unknown) => void) => void
    }
  }
}

export function CustomerDisplayApp(): React.JSX.Element {
  const [state, setState] = React.useState<CustomerDisplayState>({ mode: 'idle' })

  React.useEffect(() => {
    window.customerDisplayApi.onUpdate(setState)
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(state, null, 2)}
    </div>
  )
}
```

- [ ] **Step 10:** Wire `CheckoutScreen.tsx` to call `window.api.customerDisplay.push(...)` at the four transitions (item added/removed→cart, payment method selected→corresponding payment state, sale completed→thank-you, void/empty-cart→idle). Read `src/renderer/src/screens/CheckoutScreen.tsx` in full first to find: the cart array + totals computation, the `paymentMethod` state setter call sites (already located at lines ~1031-1055 in Task-1 grep output), the sale-completion success path, and the void/reset path — then add `push()` calls at each with the exact `CustomerDisplayState` shape built from data already computed in that file (cart totals, cash-given input state, card surcharge total, e-transfer email from settings, tab charge/balance). This step's exact code depends on reading that file; do not invent field names — match what the file already computes for its own on-screen cart/total display.

- [ ] **Step 11:** Run `npm run typecheck` — fix errors.

- [ ] **Step 12:** Manual test — run `npm run dev` with a second monitor attached (or temporarily force-create the window for testing by commenting out the display-count check), ring a test sale on the main screen, confirm raw JSON state objects arrive on the customer display window promptly.

- [ ] **Step 13: Commit**

```bash
git add src/main/ipc/customerDisplayHandlers.ts src/main/ipc/index.ts src/preload/index.ts src/preload/customer-display.ts electron.vite.config.ts src/renderer/customer-display.html src/renderer/src/customerDisplay src/renderer/src/screens/CheckoutScreen.tsx src/shared/channels.ts
git commit -m "Wire customer-display IPC broadcast plumbing end-to-end (hello-world renderer)"
```

---

## Task 5: Idle/Slideshow screen with dynamic font sizing

**Files:**
- Create: `src/renderer/src/customerDisplay/useFitText.ts`
- Create: `src/renderer/src/customerDisplay/screens/IdleScreen.tsx`
- Modify: `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx`
- Test: `src/__tests__/customerDisplayState.test.ts`

**Interfaces:**
- Produces: `useFitText(text: string, containerRef: React.RefObject<HTMLElement>, opts?: { maxPx?: number; minPx?: number; maxLines?: number }): number` — returns the computed font-size in px. Consumed by `IdleScreen`.

- [ ] **Step 1:** Write `src/renderer/src/customerDisplay/useFitText.ts`:

```typescript
import { useEffect, useState } from 'react'

const MAX_PX = 220
const MIN_PX = 32
const STEP_PX = 4

/**
 * Binary-search-free iterative shrink: measure a hidden clone at decreasing
 * font sizes until it fits within maxLines and the container's box. Re-runs
 * whenever `text` or the container size changes.
 */
export function useFitText(
  text: string,
  containerRef: React.RefObject<HTMLElement>,
  opts?: { maxPx?: number; minPx?: number; maxLines?: number }
): number {
  const maxPx = opts?.maxPx ?? MAX_PX
  const minPx = opts?.minPx ?? MIN_PX
  const maxLines = opts?.maxLines ?? 2
  const [fontSize, setFontSize] = useState(maxPx)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measurer = document.createElement('div')
    measurer.style.position = 'absolute'
    measurer.style.visibility = 'hidden'
    measurer.style.whiteSpace = 'normal'
    measurer.style.wordBreak = 'break-word'
    measurer.style.fontWeight = '700'
    measurer.style.width = `${container.clientWidth}px`
    measurer.textContent = text
    document.body.appendChild(measurer)

    let size = maxPx
    const lineHeightRatio = 1.15
    while (size >= minPx) {
      measurer.style.fontSize = `${size}px`
      measurer.style.lineHeight = `${lineHeightRatio}`
      const lines = Math.round(measurer.scrollHeight / (size * lineHeightRatio))
      const fitsHeight = measurer.scrollHeight <= container.clientHeight
      const fitsLines = lines <= maxLines
      if (fitsHeight && fitsLines) break
      size -= STEP_PX
    }
    document.body.removeChild(measurer)
    setFontSize(Math.max(size, minPx))
  }, [text, containerRef, maxPx, minPx, maxLines])

  return fontSize
}
```

- [ ] **Step 2:** Write `src/renderer/src/customerDisplay/screens/IdleScreen.tsx`:

```tsx
import React from 'react'
import { useFitText } from '../useFitText'
import type { CustomerDisplaySlideDTO } from '../../../../shared/customerDisplay'

interface IdleScreenProps {
  slides: CustomerDisplaySlideDTO[]
  pharmacyName: string
  durationSeconds: number
}

export function IdleScreen({ slides, pharmacyName, durationSeconds }: IdleScreenProps): React.JSX.Element {
  const effectiveSlides = slides.length > 0 ? slides : [{ id: -1, text: pharmacyName, sortOrder: 0 }]
  const [index, setIndex] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setIndex(0)
  }, [slides.length])

  React.useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % effectiveSlides.length)
    }, Math.max(1, durationSeconds) * 1000)
    return () => clearInterval(timer)
  }, [effectiveSlides.length, durationSeconds])

  const current = effectiveSlides[index % effectiveSlides.length]
  const fontSize = useFitText(current.text, containerRef)

  return (
    <div
      ref={containerRef}
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8vh 8vw',
        boxSizing: 'border-box',
        background: '#f8fafc',
        color: '#0f172a',
        textAlign: 'center'
      }}
    >
      <div
        key={current.id + ':' + current.text}
        style={{
          fontSize,
          fontWeight: 700,
          lineHeight: 1.15,
          transition: 'opacity 400ms ease',
          maxWidth: '100%'
        }}
      >
        {current.text}
      </div>
    </div>
  )
}
```

- [ ] **Step 3:** Update `CustomerDisplayApp.tsx` to hold slides+settings state (subscribing via `onSlides`/`onSettings`, and fetching initial values — add `getSlides`/`getSettings` to the customer-display preload's exposed API too, matching Task 4 Step 5's pattern but read-only invoke wrappers), and render `<IdleScreen .../>` when `state.mode === 'idle'`, else fall back to the existing JSON dump for not-yet-built modes (removed entirely in later tasks).

- [ ] **Step 4:** Write `src/__tests__/customerDisplayState.test.ts` covering the pure shrink-decision logic — since `useFitText` is DOM-dependent, extract its core loop into a pure exported helper `computeFitFontSize(measureFn, opts)` if straightforward, or, if the hook is too DOM-coupled to unit test cheaply, instead test the simpler pure invariant: for a very short string, the returned max size should be `MAX_PX`; skip DOM-dependent assertions and note in a comment why. Prefer extracting a pure function — do not skip testing the algorithm entirely.

- [ ] **Step 5:** Run `npm run typecheck` and `npx vitest run src/__tests__/customerDisplayState.test.ts`.

- [ ] **Step 6:** Manual test — with test slides "SALE" and "ASK US ABOUT FREE PRESCRIPTION DELIVERY TODAY" configured (temporarily via direct DB insert or once Task 6 ships), confirm both render at the largest size that fits within 2 lines, and confirm zero-slides falls back to the pharmacy name.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/customerDisplay src/__tests__/customerDisplayState.test.ts
git commit -m "Add customer-display Idle/Slideshow screen with dynamic font-fit algorithm"
```

---

## Task 6: Settings — Customer Display section (slide CRUD UI + toggle + e-transfer email)

**Files:**
- Create: `src/renderer/src/components/CustomerDisplaySettingsCard.tsx`
- Modify: `src/renderer/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `window.api.customerDisplay.{getSlides,saveSlides,deleteSlide,getSettings,saveSettings}` (Task 4).

- [ ] **Step 1:** Read `src/renderer/src/components/PaymentSettingsCard.tsx` in full first — copy its exact structural pattern (manager-gate check, `Card`/`Switch` usage from `components/ui/`, save-button/dirty-state handling, toast/error display) so the new card matches established conventions rather than inventing a new one.

- [ ] **Step 2:** Build `CustomerDisplaySettingsCard.tsx` with: enabled `Switch`, e-transfer email text input, slide duration number input, an ordered slide list with per-row Edit/Delete buttons and up/down reorder buttons (per spec §6.1, arrows are an acceptable substitute for drag-and-drop), an "Add Slide" button opening a modal with a text field enforcing `CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH` (60) with a live `remaining = 60 - text.length` counter, disabling Save at 0 remaining going negative. On any slide add/edit/delete/reorder, call `saveSlides` with the full reordered array (matching the `saveCustomerDisplaySlides` replace-all-in-order contract from Task 2) or `deleteSlide` for deletion, then refetch/update local state from the response.

- [ ] **Step 3:** Mount `<CustomerDisplaySettingsCard />` in `SettingsScreen.tsx` alongside the other manager-gated sections, following that file's existing section-registration/search-indexing pattern (per the recent "Settings: reorder by importance/frequency, add search bar" commit — check how sections register their search keywords and replicate it for this one, keywords like "customer display", "second screen", "slideshow", "e-transfer email").

- [ ] **Step 4:** Run `npm run typecheck:web`.

- [ ] **Step 5:** Manual test — add/edit/reorder/delete slides while a customer display is running (or the dev-mode hello-world/Idle screen from Task 5), confirm live updates with no restart, confirm the 60-char counter and limit enforcement.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/CustomerDisplaySettingsCard.tsx src/renderer/src/screens/SettingsScreen.tsx
git commit -m "Add Customer Display settings section (slide CRUD, e-transfer email, enabled toggle)"
```

---

## Task 7: Cart-mirroring screen

**Files:**
- Create: `src/renderer/src/customerDisplay/screens/CartScreen.tsx`
- Modify: `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx`

**Interfaces:**
- Consumes: the `{ mode: 'cart', ... }` branch of `CustomerDisplayState` (Task 1), already pushed by `CheckoutScreen.tsx` (Task 4 Step 10).

- [ ] **Step 1:** Build `CartScreen.tsx`: full-height flex column, scrollable line-item list (name, qty, line price, strikethrough original + discounted price per item when `discountCents` is set — match the exact "Cough drops (2) $6.24 → $5.62" format from spec §3.2), and a non-scrolling fixed footer (`position: sticky; bottom: 0` or a flex `flex-shrink: 0` footer sibling, not `position: fixed` which would need extra viewport math) showing subtotal, whole-bill discount if present, tax, and a visually dominant total (largest font on this screen).

- [ ] **Step 2:** Wire into `CustomerDisplayApp.tsx`'s mode switch.

- [ ] **Step 3:** Run `npm run typecheck:web`.

- [ ] **Step 4:** Manual test — ring up enough items to require scrolling, apply a per-item and whole-bill discount, confirm the customer display matches the cashier's cart exactly and the footer stays visible while scrolling.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/customerDisplay
git commit -m "Add customer-display Cart-mirroring screen with scroll+fixed-footer layout"
```

---

## Task 8: Payment-state screens (Cash, Card, E-Transfer, Pharmacy Credit)

**Files:**
- Create: `src/renderer/src/customerDisplay/screens/PaymentCashScreen.tsx`, `PaymentCardScreen.tsx`, `PaymentETransferScreen.tsx`, `PaymentTabScreen.tsx`
- Modify: `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx`
- Modify: `src/renderer/src/screens/CheckoutScreen.tsx` (verify/complete the push calls from Task 4 Step 10 now that exact payload shapes exist)

**Interfaces:**
- Consumes: `payment-cash`, `payment-card`, `payment-etransfer`, `payment-tab` branches of `CustomerDisplayState`.

- [ ] **Step 1:** Build the four screens matching the ASCII layouts in spec §4.1–4.4 exactly: large centered stacked text blocks, `formatCurrency` from `src/shared/formatCurrency.ts` for all money values (reuse, don't reimplement). `PaymentCashScreen` shows "Change" or "Deposited to Pharmacy Credit" depending on whether `depositedToCreditCents` is present. `PaymentTabScreen` shows owed-vs-credit via icon+label — find and reuse the existing colorblind-safe status icon component used elsewhere in the app for owed/credit display (search `src/renderer/src/components` for the pattern used on the customer profile/ledger screen) rather than inventing new iconography.

- [ ] **Step 2:** In `CheckoutScreen.tsx`, verify the card total pushed is the surcharge-inclusive total — find the exact variable/computation already used to charge the terminal (`payment.allowCreditCardSurcharge` / `payment.cardSurchargePercent` from settings, read via whatever hook/query CheckoutScreen already uses for payment settings) and push that exact number, not a pre-surcharge subtotal. This is the one place in the whole feature where a silent copy-paste of the wrong variable creates a real trust problem — read the surrounding code carefully rather than assuming which total is which.

- [ ] **Step 3:** Wire all four into `CustomerDisplayApp.tsx`'s mode switch.

- [ ] **Step 4:** Run `npm run typecheck`.

- [ ] **Step 5:** Manual test — run one real/test transaction through each of the four payment methods, confirm correct live figures, and explicitly compare the Card screen total against whatever the surcharge setting computes for the terminal charge.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/customerDisplay src/renderer/src/screens/CheckoutScreen.tsx
git commit -m "Add customer-display payment-state screens (cash, card, e-transfer, pharmacy credit)"
```

---

## Task 9: Thank You screen + auto-return + interruption handling

**Files:**
- Create: `src/renderer/src/customerDisplay/screens/ThankYouScreen.tsx`
- Modify: `src/renderer/src/customerDisplay/CustomerDisplayApp.tsx`

**Interfaces:**
- Consumes: `{ mode: 'thank-you', pharmacyName }` branch.

- [ ] **Step 1:** Build `ThankYouScreen.tsx` — large centered text "Thank you for choosing {pharmacyName}!", visually similar weight to `IdleScreen`.

- [ ] **Step 2:** In `CustomerDisplayApp.tsx`, when `state.mode === 'thank-you'`, start a 5-second timer (`customerDisplay.slideDurationSeconds`-independent fixed constant per spec §5.2 default) that transitions local display back to idle by requesting/waiting for the next `onUpdate` — actually, since state is main-process-driven, implement the auto-return **in the main process**: after broadcasting a `thank-you` state via `broadcastCustomerDisplayState`, main process (in `customerDisplayHandlers.ts`'s push handler) schedules a `setTimeout(5000)` that re-broadcasts `{ mode: 'idle' }` *unless* a newer push (e.g. a `cart` state from the next sale) has already superseded it — track a monotonically increasing sequence number alongside the timer so a fresh push cancels the pending idle-timeout. Add this sequencing to `customerDisplayHandlers.ts`'s `IPC.CUSTOMER_DISPLAY_PUSH` handler: track `let lastPushSeq = 0` and a `let thankYouTimer: NodeJS.Timeout | null`; on every push increment the seq and clear any pending `thankYouTimer`; if the pushed state is `thank-you`, set `thankYouTimer` to broadcast idle after 5000ms.

- [ ] **Step 3:** Run `npm run typecheck`.

- [ ] **Step 4:** Manual test — complete a sale, confirm Thank You shows then auto-returns to Idle after 5s; then complete a sale and immediately start a new one (first item added) before the 5s elapses, confirm it jumps straight to Cart instead of waiting out the timer.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/customerDisplay src/main/ipc/customerDisplayHandlers.ts
git commit -m "Add customer-display Thank You screen with auto-return-to-idle and sale-interruption handling"
```

---

## Task 10: Manual toggle gating + full end-to-end pass

**Files:** none new — verification task.

- [ ] **Step 1:** Confirm (from Task 3/6) that turning the Settings "Enable customer-facing display" toggle off closes an already-open window and prevents creation; turning it on (with a second monitor present) opens it immediately without app restart.

- [ ] **Step 2:** Run the full automated suite: `npm run typecheck`, `npm run lint`, `npm test`. Fix any failures introduced by this feature (pre-existing `reportQueries.test.ts` date-range failures are expected and not a regression — see project memory).

- [ ] **Step 3:** Manual full end-to-end pass per spec's own test list: ring a complete multi-item sale on the main screen while watching the customer display, for each payment method (Cash, Card, E-Transfer, Pharmacy Credit) and once with split tender if supported, confirming Idle → Cart → payment screen → Thank You → Idle.

- [ ] **Step 4:** Record in the final report which of the 19 spec test-list items were actually exercised in this environment (e.g. no physical second monitor / no real card terminal available) versus genuinely verified — do not claim a test passed if it wasn't actually run.

- [ ] **Step 5: Final commit** (only if Step 2/3 turned up fixes not yet committed):

```bash
git add -A
git commit -m "Fix issues found in customer-display end-to-end verification pass"
```

---

## Self-Review Notes (from plan authoring)

- Spec coverage: §1 (Task 3/4), §2 (Task 5), §3 (Task 7), §4 (Task 8), §5 (Task 9), §6 (Task 6), §7 (Task 1), §8 (Task 3), §9 (Task 4), §10 edge cases (Tasks 3, 6, 9 cover all rows), §11 non-negotiables (called out per-task above), §12 build order (task order matches).
- The e-transfer email is a genuinely new setting (verified no prior field exists in this codebase), per explicit user instruction in the kickoff prompt — Task 2/6 build it fresh rather than "reusing" a nonexistent field.
- Task 4 Step 1's placeholder `+ ':delete'` channel string is explicitly flagged and corrected in Step 2 of the same task — not left as a real placeholder in the executed code.
- `logger.ts`'s exact export shape is unverified in this plan (Task 3 Step 1 requires reading it first) — flagged explicitly rather than guessed, since a wrong guess breaks the build immediately and loudly (typecheck failure), which is an acceptable/cheap failure mode here.
