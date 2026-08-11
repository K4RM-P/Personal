# Rename to VantisPOS + Demo Mode — Design

## 1. Rename: PharmaPOS → VantisPOS

Pure text/config rename, no behavior change. Touches:

- `package.json`: `name` → `vantispos`, `description` updated.
- `electron-builder.yml`: `productName: VantisPOS`, `win.executableName: VantisPOS`, `win.signtoolOptions.publisherName: 'VantisPOS'`.
- `src/renderer/index.html`: `<title>VantisPOS</title>`.
- Brand text strings (`"PharmaPOS"` → `"VantisPOS"`) in:
  - `src/renderer/src/screens/SetupWizard.tsx` ("Welcome to PharmaPOS")
  - `src/renderer/src/screens/LoginScreen.tsx`
  - `src/renderer/src/components/AppShell.tsx`
  - `src/main/receipt/receiptPrinter.ts` (thank-you line, printer test line)
  - `src/main/receipt/receiptTemplate.ts` (default store name: "VantisPOS Rx Pharmacy")
  - `src/main/db/queries/settingsQueries.ts` (`DEFAULTS['store.name']`: "VantisPOS Rx Pharmacy")
- `appId` (`com.electron.app`) left as-is — changing it would break auto-update/identity for any existing install; out of scope unless requested separately.
- `docs/` and code comments mentioning PharmaPOS are not user-facing; left alone.

## 2. UI polish cleanup

Remove the dev-leftover **"OTC-Only Mode Preview"** placeholder card in `SettingsScreen.tsx` (~line 1182) — its own description says `"This placeholder card is rendered conditionally..."`. Full repo search for "coming soon" / "stage 2" / "placeholder" / "not yet implemented" turned up nothing else user-facing (remaining hits are code comments and `docs/FUTURE_WORK.md`, never rendered).

## 3. Demo Mode

### Goal
A one-click, fully-isolated demo environment for client presentations: separate login, separate fake data, zero risk to real production data, persists across sign-out/app close, off switch lives in Settings.

### Data isolation
- Second SQLite file, `pharmapos-demo.db`, alongside the real `pharmapos.db` in `app.getPath('userData')` (dev equivalent: `prisma/dev-demo.db`).
- A small flag file `app-state.json` (also in userData, outside either DB) stores `{ "demoMode": boolean }`. This is the only thing that must survive both a DB swap and app relaunch, so it can't live inside a swappable database.
- `src/main/index.ts` reads `app-state.json` before setting `DATABASE_URL` (same place it currently resolves `pharmapos.db`) and points at the demo file instead when `demoMode: true`.

### Toggling
- New Settings card: "Demo Mode" with an Apple-style switch, visible/actionable only for the Manager role (same gating pattern as other sensitive settings).
- Toggling shows a confirmation dialog (it logs you out and relaunches the app), then:
  1. Writes `demoMode` in `app-state.json`.
  2. Calls `app.relaunch()` + `app.exit()`.
- On relaunch with `demoMode: true`: if `pharmapos-demo.db` doesn't exist yet, run Prisma migrations against it, then run the demo seed (below). If it already exists, reuse it as-is (so re-entering demo mode after a previous session keeps whatever state was left, e.g. demo transactions you ran during a client walkthrough). Skips the Setup Wizard, goes straight to the demo login screen.
- On relaunch with `demoMode: false`: reconnects to the real `pharmapos.db`, shows the normal login screen, real data untouched.
- While demo mode is active, a small persistent "DEMO MODE" badge shows in the app shell top bar, so it's never ambiguous which environment is live.

### New IPC surface
- `settings:getDemoMode` / `settings:setDemoMode(enabled: boolean)` — main-process handlers per existing channel/handler/preload-wrapper pattern (`src/shared/channels.ts`, `src/main/ipc/settingsHandlers.ts`, `src/preload/index.ts`).

### Demo seed content (`prisma/seedDemo.ts`, run only against the demo DB)
- **Users**: `Cashier` / `Manager`, both password `12345678` (hashed via the same bcrypt path as `userQueries.ts`).
- **14 customers**: realistic full names, phone, email, address — reusing `customerQueries` shape.
- **15-20 MANUAL-origin products**: clearly non-McKesson snack/retail items (KitKat, ice cream, Crush soda, etc.) — `origin: 'MANUAL'`, so a later McKesson catalogue import never touches them and they stay visually distinct.
- **~60 transactions over the last 30 days**: mix of demo products, demo customers, both demo users, and payment methods, so Reports/Sales History charts look populated rather than empty.
- **Payment settings** in the demo DB default to `payment.provider: 'manual'`, `payment.environment: 'sandbox'` (already the global default in `settingsQueries.ts`, but seed explicitly sets it so a future default change can't accidentally put demo mode on a live processor).

### What does NOT change
Every other screen (Checkout, Products, Customers, Refunds, Reports, Sales History, Settings sections other than the new Demo Mode card) runs unmodified — demo mode is purely "which database file is Prisma connected to," not a code branch through feature logic.

## 4. Testing
- `npm run typecheck`, `npm run lint`, `npm test` after changes.
- Manual verification (per CLAUDE.md UI guidance): toggle demo mode on, confirm relaunch to demo login, confirm 2 preset accounts work, confirm seeded customers/products/transactions appear, toggle off, confirm relaunch back to real login with real data intact.
