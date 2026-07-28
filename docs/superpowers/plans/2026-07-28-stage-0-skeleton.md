# Stage 0 — Project Skeleton & Feature-Flag Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a running Electron + React/Tailwind/shadcn + SQLite/Prisma skeleton with a per-install feature-flag layer that round-trips renderer → preload → main → SQLite and drives conditional rendering.

**Architecture:** Electron main/renderer split with a `contextBridge` preload as the only door between them. The renderer calls typed functions on `window.api`; preload forwards them via `ipcRenderer.invoke`; main-process `ipcMain` handlers call pure query functions against a singleton Prisma client backed by a local SQLite file. All cross-process types and channel names live in `src/shared/` so both sides of the bridge agree at compile time.

**Tech Stack:** electron-vite · Electron · React 18 · TypeScript · Tailwind CSS · shadcn/ui · lucide-react · react-router-dom (MemoryRouter) · Prisma · SQLite · Vitest.

## Global Constraints

- **Toolchain:** electron-vite (Vite-based). Not Electron Forge, not manual wiring.
- **Language:** TypeScript throughout. `tsc --noEmit` must stay clean across main, preload, shared, and renderer.
- **Money is integer cents everywhere** — Prisma `Int`, TS `number`. Never `Float`/`Decimal`/floating dollars. `$1.00` is `100`.
- **`formatCurrency` sign convention:** the sign goes OUTSIDE the currency symbol — `-150 → "-$1.50"`, never `"$-1.50"`.
- **Feature flags are per-install, not per-user**, and default to `enabled: false` on a fresh install.
- **No hardcoded IPC channel string literals** anywhere except `src/shared/ipc-channels.ts`. Every other file imports the `IPC` constant. A raw `'flags:...'`-style literal elsewhere is a defect.
- **Renderer never imports Prisma or touches hardware/DB directly** — only `window.api`. Prisma is imported solely by `src/main/db/**` and, transitively, `src/main/ipc/**`.
- **Errors bubble, never swallowed** — preload does not try/catch `invoke`; main handlers throw a known `AppError { code, message }` shape.
- **Prisma client is a global-guarded singleton** to survive Vite HMR re-evaluating the main module graph.
- **Seed is idempotent** — `upsert` keyed on the unique field, never bare `create`.
- **Routing is `MemoryRouter`** — not `BrowserRouter` (unreliable under `file://`), not `HashRouter`.
- **shadcn is customized via design tokens**, not shipped as the stock zinc/slate theme.

---

## File Structure

```
electron.vite.config.ts        # electron-vite build config (from scaffold, adjusted)
tsconfig*.json                 # from scaffold
package.json                   # from scaffold, deps added per task
prisma/
  schema.prisma                # Task 2 — data model
  seed.ts                      # Task 2 — idempotent seed
src/
  main/
    index.ts                   # scaffold entry; Task 5 registers IPC handlers here
    db/
      index.ts                 # Task 2 — HMR-guarded PrismaClient singleton
      queries.ts               # Task 4 — pure functions (prisma) => data; unit-testable
    ipc/
      register.ts              # Task 5 — wires IPC channels to queries
  preload/
    index.ts                   # Task 5 — contextBridge exposeInMainWorld('api', …)
    index.d.ts                 # Task 5 — Window.api type (or in renderer global.d.ts)
  shared/
    types.ts                   # Task 3 — Setting, FeatureFlag, Role, User, Product, Customer, Api, AppError
    ipc-channels.ts            # Task 3 — IPC channel-name constants
    lib/
      format.ts                # Task 3 — formatCurrency(cents)
  renderer/
    index.html                 # from scaffold
    src/
      main.tsx                 # scaffold entry; Task 6 mounts MemoryRouter
      App.tsx                  # Task 6 — shell (sidebar + topbar + routed pages)
      index.css                # Task 6 — Tailwind + shadcn design tokens
      global.d.ts              # Task 5 — declare Window { api: Api }
      lib/utils.ts             # Task 6 — cn() helper
      components/ui/           # Task 6 — shadcn: button, card, switch, input, label
      pages/
        Checkout.tsx           # Task 6 — placeholder
        Products.tsx           # Task 6 — placeholder
        Customers.tsx          # Task 6 — placeholder
        Settings.tsx           # Task 6 — Feature Flags screen (the acceptance surface)
tests/
  format.test.ts               # Task 3
  ipc-queries.test.ts          # Task 4
```

---

### Task 1: Scaffold a running electron-vite + React + TS app at the repo root

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/**` (all from the official scaffolder)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm run dev` that opens an Electron window rendering the scaffold's default React page. Later tasks replace/extend these files.

- [ ] **Step 1: Scaffold into a temp dir** (the CLI refuses to target a non-empty dir, so build in `.scaffold-tmp` then relocate)

```bash
cd "/Users/karmpatel/Desktop/POS System"
npm create @quick-start/electron@latest .scaffold-tmp -- --template react-ts
```
When prompted, decline extra add-ons (ESLint/Prettier optional — accept if offered, they're harmless).

- [ ] **Step 2: Move scaffold contents into the repo root** (including dotfiles, excluding its git/node_modules and its `.gitignore` so ours is kept)

```bash
cd "/Users/karmpatel/Desktop/POS System/.scaffold-tmp"
rm -rf .git node_modules .gitignore
shopt -s dotglob
mv * "/Users/karmpatel/Desktop/POS System/"
cd "/Users/karmpatel/Desktop/POS System"
rmdir .scaffold-tmp
```

- [ ] **Step 3: Install dependencies**

```bash
cd "/Users/karmpatel/Desktop/POS System"
npm install
```

- [ ] **Step 4: Run the app to verify the skeleton launches**

Run: `npm run dev`
Expected: an Electron window opens showing the scaffold's default React/Electron page (not a gray blank window). Close it (Ctrl-C) once confirmed.

- [ ] **Step 5: Add Vitest for later tasks**

```bash
npm install -D vitest
```
Add to `package.json` `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(stage0): scaffold electron-vite react-ts skeleton"
```

---

### Task 2: Prisma + SQLite schema, singleton client, and idempotent seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/main/db/index.ts`
- Modify: `package.json` (prisma scripts + seed config), `.env`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `prisma` singleton export from `src/main/db/index.ts` typed as `PrismaClient`; a migrated SQLite DB at `prisma/dev.db`; seeded rows (3 roles, 1 manager user, ~5 products, 2 customers, 3 flags). Prisma-generated model types (`Product`, `FeatureFlag`, etc.) become available to `src/shared/types.ts` in Task 3.

- [ ] **Step 1: Install Prisma**

```bash
npm install -D prisma
npm install @prisma/client
```

- [ ] **Step 2: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}

model FeatureFlag {
  key         String  @id
  enabled     Boolean @default(false)
  label       String
  description String?
}

model Role {
  id    Int    @id @default(autoincrement())
  name  String @unique
  users User[]
}

model User {
  id        Int      @id @default(autoincrement())
  name      String
  pin       String
  roleId    Int
  role      Role     @relation(fields: [roleId], references: [id])
  createdAt DateTime @default(now())
}

model Product {
  id         Int      @id @default(autoincrement())
  sku        String   @unique
  name       String
  costCents  Int
  priceCents Int
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

- [ ] **Step 3: Point `DATABASE_URL` at a local SQLite file**

Create/append `.env`:
```
DATABASE_URL="file:./dev.db"
```
(`.env` is already git-ignored is NOT true yet — confirm `.env` is added to `.gitignore`; if absent, add a line `.env`.)

- [ ] **Step 4: Create the initial migration**

```bash
npx prisma migrate dev --name init
```
Expected: creates `prisma/migrations/**`, `prisma/dev.db`, and generates the client. `prisma/dev.db*` is already git-ignored; `prisma/migrations/` is NOT — it must be committed.

- [ ] **Step 5: Write the HMR-guarded singleton `src/main/db/index.ts`**

```ts
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export const prisma: PrismaClient = global.__prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma
}
```

- [ ] **Step 6: Write the idempotent seed `prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const roles = ['cashier', 'pharmacist', 'manager']
  for (const name of roles) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } })
  }

  const manager = await prisma.role.findUniqueOrThrow({ where: { name: 'manager' } })
  await prisma.user.upsert({
    where: { id: 1 },
    update: { name: 'Owner', pin: '0000', roleId: manager.id },
    create: { name: 'Owner', pin: '0000', roleId: manager.id },
  })

  const products = [
    { sku: 'OTC-001', name: 'Ibuprofen 200mg 50ct', costCents: 100, priceCents: 300 },
    { sku: 'OTC-002', name: 'Acetaminophen 500mg 100ct', costCents: 250, priceCents: 500 },
    { sku: 'OTC-003', name: 'Bandages 30ct', costCents: 150, priceCents: 450 },
    { sku: 'OTC-004', name: 'Vitamin D 1000IU 90ct', costCents: 400, priceCents: 800 },
    { sku: 'OTC-005', name: 'Hand Sanitizer 250ml', costCents: 120, priceCents: 360 },
  ]
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: p, create: p })
  }

  const customers = [
    { id: 1, name: 'Jane Doe', phone: '555-0100', email: 'jane@example.com' },
    { id: 2, name: 'John Smith', phone: '555-0101', email: null },
  ]
  for (const c of customers) {
    await prisma.customer.upsert({ where: { id: c.id }, update: c, create: c })
  }

  const flags = [
    { key: 'rewardPoints', label: 'Reward Points', description: 'Dollar/product-based loyalty points.' },
    { key: 'lottery', label: 'Lottery Sales', description: 'Ontario lottery ticket sales & win tracking.' },
    { key: 'customerTab', label: 'Customer Tab / Store Credit', description: 'Short-pay tab and pre-loaded store credit ledger.' },
  ]
  for (const f of flags) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { label: f.label, description: f.description },
      create: { ...f, enabled: false },
    })
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
```

- [ ] **Step 7: Wire the seed command**

Add to `package.json`:
```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```
Install the runner: `npm install -D tsx`. Then run the seed:
```bash
npx prisma db seed
```
Expected: completes without error.

- [ ] **Step 8: Verify idempotency — run the seed a second time**

Run: `npx prisma db seed`
Expected: completes again with NO unique-constraint error (proves `upsert`, not `create`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(stage0): prisma schema, sqlite migration, singleton client, idempotent seed"
```

---

### Task 3: Shared types, IPC channel constants, and `formatCurrency` (TDD)

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ipc-channels.ts`, `src/shared/lib/format.ts`, `tests/format.test.ts`

**Interfaces:**
- Consumes: Prisma model types from `@prisma/client` (Task 2).
- Produces:
  - `formatCurrency(cents: number): string`
  - `IPC` const object with `settings`, `flags`, `products`, `customers` channel names
  - `Api` interface, `AppError` type, and re-exported row types (`Setting`, `FeatureFlag`, `Role`, `User`, `Product`, `Customer`) — consumed by preload (Task 5), handlers (Task 5), and the renderer (Task 6).

- [ ] **Step 1: Write the failing test `tests/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { formatCurrency } from '../src/shared/lib/format'

describe('formatCurrency', () => {
  it('formats positive cents', () => {
    expect(formatCurrency(100)).toBe('$1.00')
    expect(formatCurrency(300)).toBe('$3.00')
    expect(formatCurrency(1)).toBe('$0.01')
    expect(formatCurrency(123456)).toBe('$1234.56')
  })
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })
  it('puts the sign OUTSIDE the currency symbol for negatives', () => {
    expect(formatCurrency(-150)).toBe('-$1.50')
    expect(formatCurrency(-1)).toBe('-$0.01')
    expect(formatCurrency(-123456)).toBe('-$1234.56')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — cannot resolve `../src/shared/lib/format` / `formatCurrency` not defined.

- [ ] **Step 3: Write `src/shared/lib/format.ts`**

```ts
export function formatCurrency(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = (abs % 100).toString().padStart(2, '0')
  return `${negative ? '-' : ''}$${dollars}.${remainder}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Write `src/shared/ipc-channels.ts`**

```ts
export const IPC = {
  settings:  { getAll: 'settings:getAll', set: 'settings:set' },
  flags:     { getAll: 'flags:getAll', setEnabled: 'flags:setEnabled' },
  products:  { list: 'products:list' },
  customers: { list: 'customers:list' },
} as const
```

- [ ] **Step 6: Write `src/shared/types.ts`**

```ts
import type { Setting, FeatureFlag, Role, User, Product, Customer } from '@prisma/client'

export type { Setting, FeatureFlag, Role, User, Product, Customer }

export interface AppError {
  code: string
  message: string
}

export interface Api {
  settings: {
    getAll(): Promise<Setting[]>
    set(key: string, value: string): Promise<void>
  }
  flags: {
    getAll(): Promise<FeatureFlag[]>
    setEnabled(key: string, enabled: boolean): Promise<FeatureFlag>
  }
  products:  { list(): Promise<Product[]> }
  customers: { list(): Promise<Customer[]> }
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(stage0): shared types, ipc channel constants, formatCurrency with tests"
```

---

### Task 4: Pure DB query functions with a round-trip test (TDD)

**Files:**
- Create: `src/main/db/queries.ts`, `tests/ipc-queries.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 2), row types (Task 3).
- Produces (all take a `PrismaClient` as first arg, so they're testable without Electron):
  - `getAllSettings(db): Promise<Setting[]>`
  - `setSetting(db, key: string, value: string): Promise<void>`
  - `getAllFlags(db): Promise<FeatureFlag[]>`
  - `setFlagEnabled(db, key: string, enabled: boolean): Promise<FeatureFlag>`
  - `listProducts(db): Promise<Product[]>`
  - `listCustomers(db): Promise<Customer[]>`
  These are what Task 5's IPC handlers wrap.

- [ ] **Step 1: Write the failing test `tests/ipc-queries.test.ts`** (uses a throwaway SQLite file, bypasses Electron entirely)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAllFlags, setFlagEnabled } from '../src/main/db/queries'

let db: PrismaClient
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pos-test-'))
  const url = `file:${join(dir, 'test.db')}`
  // Build the schema in the throwaway db, then seed the flag rows.
  execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' })
  db = new PrismaClient({ datasources: { db: { url } } })
})

afterAll(async () => {
  await db.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

describe('flag queries round-trip', () => {
  it('persists an enable and reads it back', async () => {
    await db.featureFlag.create({ data: { key: 'lottery', label: 'Lottery', enabled: false } })

    const before = await getAllFlags(db)
    expect(before.find((f) => f.key === 'lottery')?.enabled).toBe(false)

    const updated = await setFlagEnabled(db, 'lottery', true)
    expect(updated.enabled).toBe(true)

    const after = await getAllFlags(db)
    expect(after.find((f) => f.key === 'lottery')?.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipc-queries.test.ts`
Expected: FAIL — cannot resolve `../src/main/db/queries` / functions not defined.

- [ ] **Step 3: Write `src/main/db/queries.ts`**

```ts
import type { PrismaClient } from '@prisma/client'
import type { Setting, FeatureFlag, Product, Customer } from '../../shared/types'

export function getAllSettings(db: PrismaClient): Promise<Setting[]> {
  return db.setting.findMany()
}

export async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export function getAllFlags(db: PrismaClient): Promise<FeatureFlag[]> {
  return db.featureFlag.findMany({ orderBy: { key: 'asc' } })
}

export function setFlagEnabled(db: PrismaClient, key: string, enabled: boolean): Promise<FeatureFlag> {
  return db.featureFlag.update({ where: { key }, data: { enabled } })
}

export function listProducts(db: PrismaClient): Promise<Product[]> {
  return db.product.findMany({ orderBy: { name: 'asc' } })
}

export function listCustomers(db: PrismaClient): Promise<Customer[]> {
  return db.customer.findMany({ orderBy: { name: 'asc' } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipc-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(stage0): pure db query functions with bypass-electron round-trip test"
```

---

### Task 5: IPC bridge — main handler registration + preload contextBridge

**Files:**
- Create: `src/main/ipc/register.ts`, `src/renderer/src/global.d.ts`
- Modify: `src/main/index.ts` (call the registration once at startup), `src/preload/index.ts` (expose `window.api`)

**Interfaces:**
- Consumes: `IPC` + `Api` + `AppError` (Task 3), query functions (Task 4), `prisma` singleton (Task 2).
- Produces: `registerIpcHandlers(): void` (main), and a `window.api` object matching `Api` (renderer). Task 6's Settings screen consumes `window.api.flags.*`.

- [ ] **Step 1: Write `src/main/ipc/register.ts`** (handlers import channel names from shared; throw `AppError` shapes, never opaque crashes)

```ts
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { AppError } from '../../shared/types'
import { prisma } from '../db'
import {
  getAllSettings, setSetting, getAllFlags, setFlagEnabled, listProducts, listCustomers,
} from '../db/queries'

function fail(code: string, message: string): never {
  const err: AppError = { code, message }
  throw err
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.settings.getAll, () => getAllSettings(prisma))
  ipcMain.handle(IPC.settings.set, (_e, key: string, value: string) => setSetting(prisma, key, value))

  ipcMain.handle(IPC.flags.getAll, () => getAllFlags(prisma))
  ipcMain.handle(IPC.flags.setEnabled, async (_e, key: string, enabled: boolean) => {
    try {
      return await setFlagEnabled(prisma, key, enabled)
    } catch {
      fail('FLAG_UPDATE_FAILED', `Could not update flag "${key}".`)
    }
  })

  ipcMain.handle(IPC.products.list, () => listProducts(prisma))
  ipcMain.handle(IPC.customers.list, () => listCustomers(prisma))
}
```

- [ ] **Step 2: Register handlers at startup in `src/main/index.ts`**

Add the import at the top:
```ts
import { registerIpcHandlers } from './ipc/register'
```
Then, inside the existing `app.whenReady().then(() => { ... })` block, BEFORE the window is created, add:
```ts
registerIpcHandlers()
```

- [ ] **Step 3: Expose the typed API in `src/preload/index.ts`** (thin `invoke` wrappers; NO try/catch — rejections bubble to the renderer)

Replace the file body with:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { Api } from '../shared/types'

const api: Api = {
  settings: {
    getAll: () => ipcRenderer.invoke(IPC.settings.getAll),
    set: (key, value) => ipcRenderer.invoke(IPC.settings.set, key, value),
  },
  flags: {
    getAll: () => ipcRenderer.invoke(IPC.flags.getAll),
    setEnabled: (key, enabled) => ipcRenderer.invoke(IPC.flags.setEnabled, key, enabled),
  },
  products: { list: () => ipcRenderer.invoke(IPC.products.list) },
  customers: { list: () => ipcRenderer.invoke(IPC.customers.list) },
}

contextBridge.exposeInMainWorld('api', api)
```
Confirm the renderer `webPreferences` in `src/main/index.ts` has `contextIsolation: true` and `nodeIntegration: false` (electron-vite's scaffold default — verify, don't assume). Keep the scaffold's existing `preload` path wiring intact.

- [ ] **Step 4: Type `window.api` in `src/renderer/src/global.d.ts`**

```ts
import type { Api } from '../../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export {}
```

- [ ] **Step 5: Verify the whole surface type-checks**

Run: `npx tsc --noEmit`
Expected: no errors across main, preload, shared, renderer (the cross-layer contract check).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(stage0): ipc handler registration + typed contextBridge preload"
```

---

### Task 6: Tailwind + shadcn theme, app shell, and the Feature Flags acceptance screen

**Files:**
- Create: `src/renderer/src/lib/utils.ts`, `src/renderer/src/components/ui/{button,card,switch,input,label}.tsx`, `src/renderer/src/pages/{Checkout,Products,Customers,Settings}.tsx`, `tailwind.config.js`, `postcss.config.js`, `components.json`
- Modify: `src/renderer/src/index.css` (Tailwind directives + design tokens), `src/renderer/src/App.tsx` (shell + routes), `src/renderer/src/main.tsx` (wrap in `MemoryRouter`)

**Interfaces:**
- Consumes: `window.api.flags.*` (Task 5), `formatCurrency` (Task 3, used by placeholder pages if they show any money).
- Produces: the running styled app that satisfies the Stage 0 acceptance checklist. Terminal deliverable — nothing consumes this.

- [ ] **Step 1: Install UI dependencies**

```bash
npm install react-router-dom lucide-react class-variance-authority clsx tailwind-merge tailwindcss-animate
npm install -D tailwindcss postcss autoprefixer
```

- [ ] **Step 2: Initialize Tailwind and shadcn against the renderer**

```bash
npx tailwindcss init -p
npx shadcn@latest init
```
When shadcn prompts: style = Default, base color = Slate (we override tokens next), CSS file = `src/renderer/src/index.css`, tailwind config = `tailwind.config.js`, components alias = `src/renderer/src/components`, utils alias = `src/renderer/src/lib/utils`. Set `tailwind.config.js` `content` to `['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}']`.

- [ ] **Step 3: Add the shadcn components Stage 0 needs**

```bash
npx shadcn@latest add button card switch input label
```
Expected: files appear under `src/renderer/src/components/ui/`.

- [ ] **Step 4: Replace the design tokens in `src/renderer/src/index.css`** (customized palette — clinical neutrals + a teal primary — plus touch-ready radius; NOT stock slate)

Ensure the file starts with the Tailwind directives, then set the token block:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 210 20% 98%;
    --foreground: 215 25% 15%;
    --card: 0 0% 100%;
    --card-foreground: 215 25% 15%;
    --popover: 0 0% 100%;
    --popover-foreground: 215 25% 15%;
    --primary: 174 62% 38%;          /* teal medical accent */
    --primary-foreground: 0 0% 100%;
    --secondary: 210 16% 93%;
    --secondary-foreground: 215 25% 20%;
    --muted: 210 16% 93%;
    --muted-foreground: 215 15% 45%;
    --accent: 174 40% 92%;
    --accent-foreground: 174 62% 25%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 214 18% 88%;
    --input: 214 18% 88%;
    --ring: 174 62% 38%;
    --radius: 0.75rem;               /* generous, touch-friendly */
  }
  * { @apply border-border; }
  body { @apply bg-background text-foreground; font-size: 16px; }
}
```
(If shadcn's init wrote a `.dark {}` block, leave it — Stage 0 is light-first and won't toggle it.)

- [ ] **Step 5: Write the four placeholder pages**

`src/renderer/src/pages/Checkout.tsx`, `Products.tsx`, `Customers.tsx` — each the same minimal shape (repeated here so they can be written in any order):

```tsx
// Checkout.tsx  (repeat for Products.tsx and Customers.tsx, changing the title text)
import { Card } from '@/components/ui/card'

export default function Checkout() {
  return (
    <Card className="p-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <p className="text-muted-foreground mt-2">Coming in a later stage.</p>
    </Card>
  )
}
```

- [ ] **Step 6: Write the Feature Flags screen `src/renderer/src/pages/Settings.tsx`** (drives state from the PERSISTED result; reverts + shows error on reject; conditional placeholder card)

```tsx
import { useEffect, useState } from 'react'
import type { FeatureFlag } from '../../../shared/types'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

export default function Settings() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.flags.getAll().then(setFlags).catch((e) => setError(String(e?.message ?? e)))
  }, [])

  async function toggle(key: string, next: boolean) {
    setError(null)
    // optimistic-free: reflect only what the DB confirms
    try {
      const updated = await window.api.flags.setEnabled(key, next)
      setFlags((prev) => prev.map((f) => (f.key === key ? updated : f)))
    } catch (e: any) {
      setError(e?.message ?? 'Update failed')
      // force the Switch back to the last known-good value from state (no silent success)
      setFlags((prev) => [...prev])
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings — Feature Flags</h1>
      {error && <p className="text-destructive">{error}</p>}
      <Card className="p-6 space-y-4">
        {flags.map((f) => (
          <div key={f.key} className="flex items-center justify-between">
            <div>
              <Label htmlFor={f.key} className="text-base">{f.label}</Label>
              {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
            </div>
            <Switch id={f.key} checked={f.enabled} onCheckedChange={(v) => toggle(f.key, v)} />
          </div>
        ))}
      </Card>

      {flags.find((f) => f.key === 'lottery')?.enabled && (
        <Card className="p-6 border-primary">
          <p className="text-primary font-medium">Lottery module placeholder — visible because the flag is ON.</p>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Write the shell `src/renderer/src/App.tsx`** (sidebar + topbar + routed content)

```tsx
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { ShoppingCart, Package, Users, Settings as SettingsIcon } from 'lucide-react'
import Checkout from './pages/Checkout'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Settings from './pages/Settings'

const nav = [
  { to: '/checkout', label: 'Checkout', icon: ShoppingCart },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function App() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-60 border-r bg-card p-4 space-y-1">
        <div className="px-2 pb-4 text-lg font-bold">Pharmacy POS</div>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-6">
          <span className="font-medium">Demo Pharmacy</span>
          <span className="text-sm text-muted-foreground">Owner (manager)</span>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/checkout" replace />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/products" element={<Products />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Wrap the app in `MemoryRouter` in `src/renderer/src/main.tsx`**

Wrap the existing `<App />` render:
```tsx
import { MemoryRouter } from 'react-router-dom'
// ...existing imports and ReactDOM.createRoot(...).render(
  <React.StrictMode>
    <MemoryRouter>
      <App />
    </MemoryRouter>
  </React.StrictMode>
// )
```

- [ ] **Step 9: Type-check, then run the full acceptance pass**

Run: `npx tsc --noEmit` → expected clean.
Run: `npm run dev` and verify each item:
  1. Window shows the styled shell (teal primary, neutral surfaces) — NOT default gray.
  2. Sidebar navigates Checkout / Products / Customers / Settings.
  3. On Settings, toggling **Lottery** ON makes the placeholder card appear; OFF removes it.
  4. **Restart** `npm run dev` — the toggled flag keeps its state (persistence, not memory).
  5. Error path: temporarily edit `setFlagEnabled` in `src/main/db/queries.ts` to `throw new Error('boom')`, re-run, toggle a flag → the Switch does not stay flipped and the error text shows. **Revert the edit afterward.**

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(stage0): tailwind+shadcn theme, app shell, feature-flags acceptance screen"
```

---

## Self-Review

**Spec coverage** (against the Stage 0 design doc):
- Repo structure & process split → Tasks 1, 5 (main/preload/renderer/shared). ✓
- `src/shared/` cross-process types + channel constants → Task 3. ✓
- Prisma singleton (HMR guard) → Task 2 Step 5. ✓
- Data model (all six models, integer cents) → Task 2 Step 2. ✓
- Idempotent seed with real flag rows → Task 2 Steps 6–8. ✓
- IPC bridge four layers, no literals, error-bubble, AppError → Tasks 3, 5. ✓
- shadcn customized tokens (not stock), touch-ready → Task 6 Step 4. ✓
- App shell + MemoryRouter + placeholder pages → Task 6 Steps 5–8. ✓
- Feature Flags screen: persisted-result state, revert-on-reject, conditional render → Task 6 Step 6. ✓
- Testing: `formatCurrency` incl. negatives; bypass-Electron IPC round-trip; `tsc --noEmit`; 5-item manual checklist incl. restart-persistence + error path → Tasks 3, 4, 5, 6. ✓

**Placeholder scan:** no TBD/TODO; every code step has real code; the three identical placeholder pages are shown in full (Task 6 Step 5) rather than "similar to". ✓

**Type consistency:** `formatCurrency(cents: number)`, `IPC.flags.setEnabled`, `Api.flags.setEnabled(key, enabled)`, `setFlagEnabled(db, key, enabled)`, and `window.api.flags.setEnabled` line up across Tasks 3→4→5→6. `FeatureFlag` type is the same Prisma-derived type everywhere. ✓

---

## Notes / small risks the implementer should watch

- **electron-vite scaffold variance:** the scaffolder's exact file names (`main/index.ts`, `preload/index.ts`, `renderer/src/main.tsx`) and the `webPreferences` block are as of current templates — verify actual generated paths in Task 1 and adjust Tasks 5–6 references if they differ.
- **shadcn + non-standard renderer root:** because the renderer lives under `src/renderer/src`, double-check `components.json` aliases and `tailwind.config.js` `content` globs actually point there (Task 6 Steps 2). If `@/` doesn't resolve, add the path alias to the renderer `tsconfig` and `electron.vite.config.ts` `resolve.alias`.
- **`tsx` for the seed** is added in Task 2 Step 7; keep it as a dev dependency.
```
