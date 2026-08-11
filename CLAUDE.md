# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pharmacy point-of-sale desktop app: Electron main process + React/TypeScript renderer, SQLite via Prisma. See `pharmacy-pos-feature-spec.md`, `hardware-integration-architecture.md`, `docs/data-backup-system-spec.md`, and `docs/superpowers/pharmacy-pos-ui-ux-guide.md` for domain/UX specs when working on those areas.

## Commands

```bash
npm run dev              # electron-vite dev server
npm run build             # typecheck (node+web) then electron-vite build
npm run typecheck         # both tsconfig.node.json and tsconfig.web.json, --composite false
npm run typecheck:node    # main/preload process only
npm run typecheck:web     # renderer only
npm run lint               # eslint --cache .
npm run format              # prettier --write .
npm test                    # vitest run (all tests, src/__tests__/*.test.ts)
npm run test:watch          # vitest watch mode
npx vitest run src/__tests__/pricingEngine.test.ts   # single test file
npm run build:mac / build:win / build:linux           # electron-builder packaged app
```

Prisma: schema at `prisma/schema.prisma`, seed via `tsx prisma/seed.ts` (`npm run postinstall` also runs `electron-builder install-app-deps`). Migrations run automatically at app startup (`src/main/db/migrate.ts`), not via a separate CLI step in dev.

Known pre-existing failure: 3 date-range tests in `reportQueries.test.ts` fail on a clean checkout — not a regression from your changes.

## Architecture

**Three TS compilation contexts**, each with its own tsconfig and IPC boundary:
- `src/main/` — Electron main process (Node). Owns the DB (`src/main/db/`, Prisma via `getDb()`), all business logic in `db/queries/*Queries.ts`, and IPC handlers in `ipc/*Handlers.ts` registered centrally via `registerAllHandlers()` in `src/main/ipc/index.ts`.
- `src/preload/index.ts` — contextBridge bridge; every renderer-callable function is explicitly wrapped here and exposed as `window.api.*`. Adding a new IPC call means touching three places: `src/shared/channels.ts` (channel name constant), a handler in `src/main/ipc/`, and a wrapper in `src/preload/index.ts`.
- `src/renderer/src/` — React app. Screens in `screens/`, shared UI in `components/` (`components/ui/` = base primitives like `Card`, `Switch`), cross-cutting state in `context/` (e.g. `DensityContext`), hooks in `hooks/`, pure helpers in `lib/`.

`src/shared/` holds code imported by both main and renderer (IPC channel constants, shared types, `pricingEngine.ts`, `formatCurrency.ts`, `barcodeScanner.ts`) — keep it framework-agnostic (no Electron or DOM APIs).

Domain modules under `src/main/` each pair a `db/queries/*Queries.ts` (data access + business rules) with an `ipc/*Handlers.ts` (thin IPC wrapper): featureFlag, customer (incl. credit ledger/loyalty points), pricingTier, product/catalog, transaction/POS, refund, compliance (prescription audit), backup, payment, report, user, settings.

Payment providers live in `src/main/payment/providers/` (Stripe, Clover, Moneris, Global Payments, Square Terminal, plus Manual/Mock adapters for dev/testing) behind a common adapter interface — check `paymentRegistry`/`gatewayAdapters` tests for the shared contract before adding a new provider.

Settings persistence is generic: a single `Setting` Prisma model + `settingsQueries.ts` + IPC, not per-feature tables — new device-level preferences (like display density) should reuse this rather than adding new schema.

## Styling / theming system

Tailwind CSS v4 via `@import "tailwindcss"` in `src/renderer/src/index.css` (no separate `tailwind.config`; theme tokens live in `@theme` and `@layer base :root` in that file).

**Display density** is a deliberate dual CSS-variable system — do not conflate the two:
- `--pos-density-scale` (0.68–1.30, 8 discrete levels defined in `src/renderer/src/lib/density.ts`, applied via `DensityContext`): scales ONLY font-size (`text-*` tokens are redefined in `@theme` to multiply by it), icon size (`.icon-*` utility classes), and control sizing (`.min-h-*`, `.h-*`, `.w-*`, `.input` — redefined outside any `@layer` so they win over Tailwind's layered utilities by cascade-layer rules, no `!important` needed).
- Fixed 8px `--pos-spacing-unit` / Tailwind's default spacing scale (`gap-*`, `space-y-*`, `m-*`, `p-*`): NEVER scales with density, at any level.
- Every interactive control has a hard 36×36px accessibility floor via `max(36px, calc(base * var(--pos-density-scale)))`, even at maximum density (level 8).

When adding new control sizing, follow the existing pattern (redefine the Tailwind utility class outside `@layer` with the `max(36px, calc(...))` floor) rather than hardcoding pixel values in components.

## Git workflow used in this repo recently

`gh` CLI has not been consistently available in agent sandboxes here — recent rounds of work merged feature branches directly to `main` with `git merge --no-ff` and `git push origin main` per explicit user instruction, rather than opening PRs. Confirm with the user before pushing directly to `main` if `gh` is available and PR flow is preferred.
