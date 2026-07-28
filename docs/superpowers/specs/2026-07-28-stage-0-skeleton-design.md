# Stage 0 — Project Skeleton & Feature-Flag Layer (Design)

**Date:** 2026-07-28
**Stage:** 0 of 9 (see `BUILD_STAGES.md`)
**Status:** Approved — ready for implementation planning

Companion to `KICKOFF_MASTER_PROMPT.md`, `pharmacy-pos-feature-spec.md`,
`hardware-integration-architecture.md`, `BUILD_STAGES.md`. Those define *what* the product is
and lock in the architecture; this document designs *how* Stage 0's skeleton is built.

---

## Goal & acceptance criteria

Stage 0 delivers a project skeleton that **runs**, with the feature-flag layer that every later
optional module (feature-spec Section 10) depends on. It builds no feature screens — only the
shape everything else attaches to.

**Done when (verified by launching the app):**
1. `npm run dev` launches a **styled** shadcn shell — distinct design tokens, not Electron/shadcn
   default gray.
2. Sidebar navigates between placeholder Checkout / Products / Customers / Settings screens.
3. Settings → Feature Flags lists seeded flags; toggling one round-trips
   renderer → preload → main → SQLite and drives a conditional placeholder render.
4. A rejected handler makes the toggle visibly revert and surface an error (error-bubble path works).
5. Restarting the app shows a toggled flag still in its new state (real persistence).

## Locked-in stack (from the kickoff — not reconsidered here)

Electron (main/renderer split) · React + Tailwind CSS + shadcn/ui (customized, not stock theme) +
lucide-react · SQLite via Prisma · TypeScript · **electron-vite** toolchain · **Vitest** tests.

---

## 1. Repo structure & process split

```
pharmacy-pos/
├─ electron.vite.config.ts
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ main/                 # Node.js main process
│  │  ├─ index.ts               # app lifecycle, window creation, IPC registration
│  │  ├─ db/
│  │  │  └─ index.ts            # Prisma client singleton (HMR-guarded) + queries
│  │  └─ ipc/                   # one file per channel group; ONLY place that imports Prisma
│  ├─ preload/
│  │  └─ index.ts               # contextBridge — the only renderer↔main door
│  ├─ shared/                   # imported by main, preload, AND renderer
│  │  ├─ types.ts               # Product, Customer, Setting, FeatureFlag, User, Role, Api
│  │  ├─ ipc-channels.ts        # channel-name string constants (single source of truth)
│  │  └─ lib/
│  │     └─ format.ts           # formatCurrency(cents) and other cross-process pure helpers
│  └─ renderer/
│     ├─ src/
│     │  ├─ components/ui/       # shadcn components, restyled via tokens
│     │  ├─ lib/                 # cn() + renderer-only utils
│     │  ├─ pages/               # placeholder screens
│     │  ├─ global.d.ts          # declare Window { api: Api }
│     │  ├─ index.css            # Tailwind + shadcn design tokens
│     │  └─ App.tsx
│     └─ index.html
```

**Core rule (from `hardware-integration-architecture.md`):** the renderer never touches the DB or
hardware directly. It calls typed functions on `window.api` (exposed by preload), which forward to
`ipcMain` handlers, which do the real Prisma/OS work. Established now, with no hardware present,
because it is the same seam that later lets payment adapters and printers swap without UI changes.

**`src/shared/`** exists so both sides of the bridge import the *same* type and channel definitions —
this is what makes the IPC boundary genuinely type-safe rather than typed-looking. The
`PaymentProvider` interface (hardware doc) will also live here in a later stage.

**Prisma singleton (`src/main/db/index.ts`):** guard against Vite HMR re-evaluating the main module
graph and spawning duplicate `PrismaClient` instances (which exhausts SQLite connections / throws
warnings). Use a `global`-scoped guard — `global.__prisma ?? new PrismaClient()` — from day one, not
after hitting the bug.

---

## 2. Data model (Prisma schema)

Deliberately minimal — "the shape, not the data." Only the tables later stages read/write plus the
flag/settings layer. Transactions, the tab/store-credit ledger, pricing tiers, and Rx models are
explicitly **not** here; each arrives in its own stage.

**Money is stored as integer cents everywhere** (`Int`), never `Float` or `Decimal`. The pricing
formula is exact/no-rounding, binary floats are disqualified, and integers also avoid a
Decimal-over-IPC serialization problem.

```prisma
// Per-install config — key/value so new settings never require a migration.
model Setting {
  key       String   @id
  value     String                    // JSON-encoded; typed via shared/types.ts
  updatedAt DateTime @updatedAt
}

// Feature-flag layer (feature-spec Section 10). Per-install, NOT per-user.
model FeatureFlag {
  key         String  @id             // "rewardPoints", "lottery", "customerTab"…
  enabled     Boolean @default(false) // fresh install = everything off
  label       String                  // human label for the settings screen
  description String?
}

model Role {
  id    Int    @id @default(autoincrement())
  name  String @unique                // "cashier", "pharmacist", "manager"
  users User[]
}

model User {
  id        Int      @id @default(autoincrement())
  name      String
  pin       String                    // placeholder; real auth is a later stage
  roleId    Int
  role      Role     @relation(fields: [roleId], references: [id])
  createdAt DateTime @default(now())
}

model Product {
  id         Int      @id @default(autoincrement())
  sku        String   @unique
  name       String
  costCents  Int                      // e.g. $1.00 = 100; pricing engine (Stage 2) reads this
  priceCents Int                      // e.g. $3.00 = 300; Stage 2 derives it, Stage 0 stores it
  barcode    String?  @unique
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Customer {
  id        Int      @id @default(autoincrement())
  name      String
  phone     String?
  email     String?
  createdAt DateTime @default(now())
}
```

**Deliberate choices:**
- `Setting` is key/value (not column-per-setting) so new settings never need a migration.
- `FeatureFlag` is its own table (not Setting rows) because Section 10's UI enumerates flags to
  render the toggle list; `label`/`description` make that a clean query.
- `pin` is a bare placeholder — real role-based auth is a later stage. Seed creates the three roles
  and one manager user so later stages have something to attach records to.

**Note deferred to Stage 2:** `cost × (1 + markup%)` in integer cents can produce sub-cent results at
odd markups. How to handle the fractional cent is a Stage 2 decision; Stage 0 only *stores* prices.

**Seed (`prisma/seed.ts`) — MUST be idempotent.** Use `upsert` keyed on the unique field
(`key` for flags, `sku` for products, `name` for roles), never bare `create`, so a repeated
`prisma db seed` or a `prisma migrate reset` re-seed does not throw on unique-constraint collisions.
Seed contents:
- 3 roles: `cashier`, `pharmacist`, `manager`
- 1 manager user
- ~5 demo products (with `costCents`/`priceCents`)
- 1–2 customers
- FeatureFlag rows: `rewardPoints`, `lottery`, `customerTab` — all `enabled: false`, each with a
  label/description — so `flags.getAll()` returns a non-empty list on first run.

---

## 3. Preload / IPC bridge

Four layers, all importing the same names from `src/shared/`, so a typo or shape-drift is a compile
error rather than a runtime surprise.

**1. Channel constants — `src/shared/ipc-channels.ts`**
```ts
export const IPC = {
  settings:  { getAll: 'settings:getAll', set: 'settings:set' },
  flags:     { getAll: 'flags:getAll', setEnabled: 'flags:setEnabled' },
  products:  { list: 'products:list' },
  customers: { list: 'customers:list' },
} as const;
```
Both `preload/index.ts` and every `src/main/ipc/*.ts` import these constants directly. **No file
hardcodes a channel string literal** — a raw `'flags:...'` literal anywhere outside
`ipc-channels.ts` is a defect (self-check: grep returns nothing).

**2. API contract — `src/shared/types.ts`**
```ts
export interface Api {
  settings:  { getAll(): Promise<Setting[]>; set(key: string, value: string): Promise<void> };
  flags:     { getAll(): Promise<FeatureFlag[]>; setEnabled(key: string, enabled: boolean): Promise<FeatureFlag> };
  products:  { list(): Promise<Product[]> };
  customers: { list(): Promise<Customer[]> };
}
```

**3. Preload — `src/preload/index.ts`:** `contextBridge.exposeInMainWorld('api', …)`, each method a
thin `ipcRenderer.invoke(IPC.…, args)`. Context isolation **on**, `nodeIntegration` **off** — the
renderer receives only the typed `window.api` object. `src/renderer/src/global.d.ts` declares
`interface Window { api: Api }` for autocomplete + type-checking in React.

**4. Main handlers — `src/main/ipc/*.ts`:** one `ipcMain.handle(IPC.…, handler)` per channel, each
calling into `src/main/db/`. Registered once at startup from `src/main/index.ts`. Handlers are the
only code importing Prisma; the renderer bundle never sees it.

**Error handling across the bridge:**
- Preload does **not** wrap `ipcRenderer.invoke` in try/catch — a rejected invoke propagates to the
  calling React component, which owns the error state (disabled control, toast). Errors are never
  swallowed in preload.
- Main handlers throw a **known shape** (`AppError { code, message }`), never an opaque crash, so the
  renderer can branch on it.

**End-to-end data flow (the Stage 0 acceptance path):**
```
FeatureFlagsScreen (React)
  → window.api.flags.setEnabled('lottery', true)      [renderer]
  → ipcRenderer.invoke('flags:setEnabled', …)          [preload]
  → ipcMain.handle('flags:setEnabled', …)              [main]
  → prisma.featureFlag.update(…)                        [db → SQLite]
  ← returns updated FeatureFlag back up the same chain
  → placeholder UI element appears/disappears on the toggle
```

---

## 4. shadcn theme & app shell

The kickoff is explicit: modern/clean, **customized** — not shadcn's stock theme, and pointedly not
the dated legacy-Fillware look. Stage 0 commits a small deliberate design-token layer, not
"init and ship defaults."

**Design tokens (`src/renderer/src/index.css`, shadcn HSL CSS-variable convention):**
- A **distinct palette** — not default zinc/slate. Calm clinical cool-neutral grays with one
  confident accent for primary actions (a teal/green medical register). Defined centrally as
  `--primary`, `--background`, `--card`, `--muted`, `--border`, `--radius`, etc., so every shadcn
  component inherits it and re-theming later means editing vars, not components.
- **Touch-screen-ready defaults** (feature-spec Section 8): larger base control height/spacing,
  comfortable base font size, generous radius. Set now to avoid retrofitting styling across dozens
  of screens later.
- **Light-first.** Dark mode is not a Stage 0 requirement; the CSS-variable structure leaves the
  door open without building it now.

**App shell (`App.tsx` + `pages/`):**
- Persistent **left sidebar** (lucide-react icons + labels): Checkout, Products, Customers, Settings
  — each routing to a placeholder page.
- **Top bar:** store name + active-user placeholder.
- **Main content region** renders the selected page.
- **Routing: `MemoryRouter`** (from react-router). Not `BrowserRouter` — the HTML5 History API is
  unreliable under Electron's `file://` origin. `MemoryRouter` (routing purely in memory, no URL) is
  chosen over `HashRouter` because a POS has no deep-linking, bookmarks, or back/forward button to
  satisfy. Decided now to avoid rebuilding screens against the wrong router later.

**shadcn components in Stage 0 (only what the shell + acceptance test need):** `button`, `card`,
`switch`, `input`, `label` — dropped into `components/ui/` and restyled via the tokens.

**Feature Flags screen (Settings):** lists `flags.getAll()`; each row is a `Switch`. On toggle it
calls `window.api.flags.setEnabled(...)` and sets its local state from the **returned, persisted**
`FeatureFlag` object — never an optimistic pre-flip. If the call rejects (per Section 3), the
`Switch` reverts to its prior value and surfaces the error, so the UI and SQLite can never disagree.
A placeholder card renders only when its flag is enabled — the visible proof of the round-trip.
This screen is where Stage 0's three "done" criteria converge (styled shell, DB read/write,
flag-driven conditional render).

---

## 5. Testing & verification

Scaled to a skeleton — light but real, not skipped.

**Automated (Vitest):**
- **`formatCurrency(cents)`** — exhaustive unit tests. Positive/zero (`100 → "$1.00"`, `0 → "$0.00"`,
  large values) **and negatives**: sign goes outside the symbol — `-150 → "-$1.50"`, `-1 → "-$0.01"`,
  never `$-1.50`. Negatives are tested now because the tab/store-credit ledger (feature-spec
  Section 4, Stage 6) relies on negative balances meaning "owes the store," and everything downstream
  formats money through this one function.
- **IPC handler round-trip** — point Prisma at a throwaway SQLite file, run the seed, then call the
  `flags:getAll` / `flags:setEnabled` handler functions directly (not through Electron) and assert
  the value persisted and comes back changed. Proves the DB read/write half without a running window.

**Manual acceptance (the Stage 0 done-checklist):**
1. `npm run dev` launches a styled shadcn shell — distinct palette, not default gray.
2. Sidebar navigates the four placeholder pages.
3. Settings → Feature Flags toggle round-trips renderer→preload→main→SQLite; placeholder card
   appears/disappears.
4. Force-rejecting a handler shows the Switch revert + error.
5. Restart shows the toggled flag still in its new state (persistence, not in-memory).

**Build sanity:** `tsc --noEmit` clean across all four layers (shared types agree — this is the
cross-layer contract check), and `npm run build` produces a packaged app.

---

## Out of scope for Stage 0 (arrives in later stages)

Checkout/transaction logic (Stage 1) · pricing tiers & bulk import (Stage 2) · barcode scanner
(Stage 3) · receipt printing (Stage 4) · payment adapters (Stages 5, 7) · customer/charge/tab
ledger (Stage 6) · compliance features (Stage 8) · reporting, roles/permissions enforcement,
tap-to-pay, cloud sync, reward points, lottery (Stage 9). Real auth, dark mode, and multi-tier
pricing tables are likewise deferred.
