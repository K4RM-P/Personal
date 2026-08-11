# Design — Customer-Facing Display (Second Screen)

Status: approved for planning. Full functional spec lives at the end of this doc's source
material — see `.claude/worktrees/perf-catalog/customer-facing-display-spec.md` (copied here for
reference; that file will be removed from the unrelated worktree once this lands).

## Summary

A second `BrowserWindow`, kiosk/fullscreen on a second physical monitor, that mirrors checkout
state read-only for the customer. One-way IPC: checkout renderer → main process →
`customer-display:update` broadcast → dedicated minimal customer-display renderer. Seven states:
Idle/Slideshow, Cart, four payment states (Cash/Card/E-Transfer/Pharmacy Credit), Thank You.

## Architecture decisions

- **Separate renderer entry**, not a route inside the main app's router — new Vite entry point
  (`customer-display.html` + its own `main.tsx`), added to `electron.vite.config.ts` renderer
  `build.rollupOptions.input` alongside the existing `index.html` entry. Keeps bundle minimal, no
  auth/navigation/state deps.
- **State ownership**: main process holds the single current `CustomerDisplayState`. Checkout
  renderer pushes state-change events via a new IPC channel (`customer-display:push`, renderer →
  main); main process validates/transforms minimally and rebroadcasts as `customer-display:update`
  (main → customer-display renderer only). This matches the existing app pattern of thin IPC
  handlers wrapping business logic that already lives in `db/queries/*Queries.ts` — no new business
  logic is introduced, the checkout renderer already computes cart totals/discounts for its own
  display, we just also ship that computed shape over IPC.
- **E-Transfer email**: this app has an `E_TRANSFER` payment method in checkout already but *no*
  existing settings field for a receiving email (verified: no matches for "e-transfer" outside
  checkout UI). Per explicit user request, add a new `Customer Display` Settings section that
  includes this email field — not a reuse of a nonexistent field. Persisted via the existing
  generic `Setting` key-value store (`settingsQueries.ts`), same pattern as other device-level
  settings, consistent with CLAUDE.md guidance not to add new schema for simple settings.
- **Slides**: new `CustomerDisplaySlide` Prisma model (id, text, sortOrder, timestamps) — a real
  list needing CRUD, unlike the single email/duration/enabled values which go in `Setting`.
- **Window lifecycle**: created in `src/main/index.ts` after main window creation; polling
  fallback every 30s in addition to `display-added`/`display-removed` listeners, per spec §8.2.
  All second-window operations wrapped in try/catch that logs via the existing `log()` helper and
  never rethrows into the main app's startup/runtime path.

## Non-negotiables (carried from spec, restated for the plan)

- Card total shown must exactly equal surcharge-inclusive terminal charge.
- Font sizing computed at render time (measure-and-shrink), never a lookup table.
- Any customer-display failure is caught and logged, never crashes/blocks the main window.
- Settings changes to slides/duration/pharmacy name/e-transfer email apply live, no restart.
- Read-only: no click handlers, no navigation, no cursor if avoidable.

## Build order

Unchanged from spec §12 (window lifecycle → IPC plumbing → Idle/slideshow → Settings CRUD → Cart
mirror → payment states → Thank You → edge cases → full e2e). This matches the KICKOFF prompt's
own build order.

## Out of scope (per spec §11/non-negotiables and user confirmation)

No slide images, no per-slide custom durations, no touch interaction on the second screen, no
additional display states beyond the seven listed.

## Open implementation questions for the plan (not design-level)

- Exact React measure-and-shrink implementation for font sizing (canvas `measureText` vs DOM
  ref-based binary search) — an implementation detail, decide in the plan/code.
- Whether split-tender sequencing needs any new checkout-side event beyond what already fires per
  tender leg — verify against actual split-tender code path while planning step 6.
