# Feature Spec — McKesson Catalogue Import

Companion to `mckesson-webcat-format.md` (the field map) and the existing project docs
(`pharmacy-pos-feature-spec.md`, `BUILD_STAGES.md`, `pharmacy-pos-ui-ux-guide.md`).

**Goal:** the pharmacist uploads the raw 26 MB `WEBCAT` file; all 52,741 products land in the
database as clean, searchable entries — including the ~90% they don't stock — and any of them can be
found instantly by scanning a barcode.

---

## 1. The central design decision: catalogue ≠ inventory

The requirement "keep ALL of those items **even though we don't sell all of them**" cannot be met by
dumping 52,741 rows into the existing `Product` table. Doing that would break things that already
work:

- The **tiered markup pricing engine** would reprice 52,741 items instead of the few hundred actually
  stocked
- **Inventory reports, low-stock alerts, and top-seller reports** would be polluted with tens of
  thousands of phantom items the pharmacy has never bought
- The **owner dashboard's "low-stock count"** would read ~52,000
- Every product-picker in the checkout UI becomes unusable

**Therefore: two tables.**

### `CatalogProduct` — reference data (all 52,741 rows)
Everything McKesson sells. Read-only from the pharmacy's perspective; replaced/refreshed on re-import.
Never appears in inventory counts, sales reports, tier repricing, or stock valuation.

### `Product` — what this pharmacy actually sells (existing table, unchanged in purpose)
The existing table from Stage 0/2. Gains two optional columns:
- `catalogProductId` (nullable FK → `CatalogProduct`)
- `sourceItemNumber` (nullable, the McKesson 6-digit item number)

Both nullable, because a pharmacy can still create a `Product` by hand or via the existing
spreadsheet import — catalogue linkage is optional enrichment, not a requirement.

**Rule of thumb for the implementing agent:** if a query answers "what do we sell / stock / owe money
on", it hits `Product`. If it answers "does this thing exist in the world", it hits `CatalogProduct`.

### Provenance — every product knows where it came from

The catalogue is re-uploaded periodically (roughly quarterly, but treat the cadence as arbitrary — it
is whenever the owner gets a new file). On every refresh, catalogue-sourced data is fully replaced
while hand-entered products are left completely alone. That requires every `Product` row to record
its origin:

- `origin = CATALOG` — created by promoting a McKesson catalogue item. Catalogue-owned fields are
  refreshed on every import.
- `origin = MANUAL` — typed in by hand or created via the spreadsheet importer. **Never touched by a
  catalogue import**, under any circumstance, even if its barcode coincidentally matches a catalogue
  item.

See §10 for the full refresh and reconciliation behaviour.

---

## 2. Prisma schema additions

Two structural points that make the quarterly refresh safe:

1. **`Product` links to the catalogue by `itemNumber` (the stable McKesson key), not by an
   autoincrement id.** The catalogue table is wiped and rebuilt on every import, so autoincrement ids
   are not stable across refreshes — linking by them would silently re-point products at the wrong
   items. `itemNumber` is verified 100% unique and stable across files.
2. **The catalogue is batch-scoped with an active-batch pointer**, so a refresh is a pointer flip
   rather than a destructive in-place delete. See §10.

```prisma
model CatalogProduct {
  id              Int      @id @default(autoincrement())
  itemNumber      String                     // pos 2-7, verified 100% unique within a batch
  description     String                    // pos 8-57, raw ALL-CAPS
  displayName     String                    // polished — see §4
  effectiveDate   String?                   // pos 58-65, YYYYMMDD
  categoryCode    String?                   // pos 90-94
  din             String?                   // pos 127-134, null when all-zero
  packSize        Int?                      // pos 144-149
  province        String                    // pos 150-152: ONT | QUE
  strength        String?                   // pos 153-162
  dosageForm      String?                   // pos 163-177
  genericCode     String?                   // pos 178-183
  genericName     String?                   // pos 184-213
  mfrPartNumber   String?                   // pos 214-228
  deptCode        String?                   // pos 232-234
  vendorCode      String?                   // pos 235-237
  listPriceCents  Int      @default(0)      // pos 332-338
  costPriceCents  Int      @default(0)      // pos 339-345
  uomGroup        String?                   // pos 352
  uomType         String?                   // pos 353
  gtinPrimary     String?                   // pos 355-368, check-digit validated
  gtinPrimaryNorm String?                   // leading zeros stripped — the scan-match key
  gtinCase        String?                   // pos 383-396
  gtinCaseNorm    String?
  importBatchId   Int
  importBatch     CatalogImportBatch @relation(fields: [importBatchId], references: [id])
  deals           CatalogDeal[]
  products        Product[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([importBatchId, itemNumber])   // unique within a batch, not globally
  @@index([itemNumber])
  @@index([gtinPrimaryNorm])
  @@index([gtinCaseNorm])
  @@index([din])
  @@index([province])
  @@index([vendorCode])
}

model CatalogDeal {
  id               Int      @id @default(autoincrement())
  catalogProductId Int
  catalogProduct   CatalogProduct @relation(fields: [catalogProductId], references: [id], onDelete: Cascade)
  dealType         String                   // pos 8-10: PCH | PNC | PVO | PSI | GRO | PCX
  dealNumber       String                   // pos 11-15
  date1            String?                  // pos 16-23
  date2            String?                  // pos 24-31
  date3            String?                  // pos 32-39
  date4            String?                  // pos 40-47
  allowanceCents   Int      @default(0)     // pos 69-75
  dealPriceCents   Int      @default(0)     // pos 76-82
  tierFlag         String?                  // pos 95

  @@index([catalogProductId])
}

model CatalogImportBatch {
  id              Int      @id @default(autoincrement())
  filename        String
  fileSizeBytes   Int
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  status          String                    // pending | previewing | committed | failed | rolledBack
  totalLines      Int      @default(0)
  productsNew     Int      @default(0)
  productsUpdated Int      @default(0)
  productsUnchanged Int    @default(0)
  dealsImported   Int      @default(0)
  linesRejected   Int      @default(0)
  errorReport     String?                   // JSON: line numbers + reasons
  repricedCount   Int      @default(0)      // stocked Products repriced as a result
  discontinuedCount Int    @default(0)      // stocked Products no longer in catalogue
  isActive        Boolean  @default(false)  // exactly one batch is active at a time
  supersededAt    DateTime?                 // when a newer batch replaced this one
  products        CatalogProduct[]

  @@index([isActive])
}
```

Add to the existing `Product` model:
```prisma
enum ProductOrigin {
  MANUAL
  CATALOG
}

// on Product:
  origin            ProductOrigin @default(MANUAL)
  sourceItemNumber  String?       // McKesson item number — the stable link key
  lastCatalogSyncAt DateTime?
  lastSeenBatchId   Int?          // last import batch this item appeared in

  // lifecycle — an item dropped from the catalogue is flagged, never deleted
  discontinued      Boolean  @default(false)
  discontinuedAt    DateTime?

  // field-level ownership: true means the pharmacist edited it by hand,
  // so a catalogue refresh must NOT overwrite it
  nameOverridden    Boolean @default(false)
  costOverridden    Boolean @default(false)
  barcodeOverridden Boolean @default(false)
  // pricePinned already exists from the tiered-pricing work

  @@index([origin])
  @@index([sourceItemNumber])
  @@index([discontinued])
```

**Why the per-field override flags matter:** without them, a refresh either stomps every manual edit
the pharmacist has made to a promoted item, or it refuses to update anything. Neither is acceptable.
Tracking ownership per field lets the catalogue own the fields nobody has touched while manual edits
survive indefinitely. Set the flag at the moment the pharmacist edits the field, not by diffing.

---

## 3. Import pipeline (main process only)

Parsing 26 MB / 65,402 records **must not run in the renderer**. It runs in the Electron main
process, streaming, per the IPC architecture already established in Stage 0.

### Steps
1. **File picked** → main process opens a **line-by-line read stream** (`readline` over a
   `createReadStream` with `latin1` encoding). Never `readFileSync` the whole 26 MB into a string.
2. **Per line:** strip `\r\n`, assert length 396, dispatch on char 1 (`P` or `S`).
3. **Malformed lines** (wrong length, unknown record type) → push to an error collection with line
   number and reason. **Do not abort the import**; a handful of bad lines shouldn't cost the
   pharmacist the other 52,000.
4. **Batch writes:** accumulate parsed rows and write in transactions of ~1,000. Row-at-a-time inserts
   across 52,741 records will take minutes; batched transactions take seconds. This is the single
   biggest performance lever.
5. **Deals second:** `S` records reference `P` records, so import all products first, then deals
   (resolving `itemNumber` → `catalogProductId` from an in-memory map built during pass 1).
6. **Progress → renderer** via IPC every ~500 records: `{ phase, linesRead, totalLines, percent }`.
   The UI shows a real progress bar, not a spinner — a 26 MB import is long enough that an
   indeterminate spinner reads as a hang.

### Load into a new batch, never in place
Each import writes into a **new** `CatalogImportBatch` with `isActive = false`. The existing
catalogue stays live and untouched throughout. Nothing the pharmacist sees changes until commit.

This is what makes the quarterly refresh safe: if the import fails halfway, or the file turns out to
be wrong, the current catalogue was never modified. There is no half-replaced state to recover from,
and no window where the POS has an empty or partial catalogue. Commit is a pointer flip (§10).

### Preview before commit
Matching the validate-then-commit pattern already locked in for the spreadsheet importer: parse the
whole file, compute counts (**new / updated / unchanged / rejected**, plus a sample of the changes),
show them, and only write on explicit confirmation. Show the **price-change summary** here too — see §6.

---

## 4. "Polished" product entries — and the drug-safety limit on polishing

Raw descriptions are ALL-CAPS and abbreviated: `JOLLY RANCHER ASTD CELLO 198G`.

**Always store the raw `description` unmodified.** Polishing produces a *separate* `displayName`
field. Source data is never overwritten — if a polish rule turns out to be wrong, it can be re-run
without a re-import.

### For non-drug items (`din == null`, ~37,900 records)
- Title Case with small-word exceptions (`and`, `with`, `for`, `of`)
- Expand abbreviations from a **reviewable dictionary** (`ASTD` → Assorted, `TB` → Tablet,
  `CAPS` → Capsules, `SOL` → Solution, `SUPP` → Suppository, `OINT` → Ointment…)
- Normalize units: `198G` → `198 g`, `15ML` → `15 mL`
- Preserve brand capitalization where known

### For drug items (`din != null`, 14,879 records) — **restricted polishing**
Apply **title-casing and unit spacing only. Do not expand abbreviations in drug names.**

This is a safety rule, not a style preference. Abbreviation expansion on drug names risks producing a
wrong or misleading name (a mangled strength, a wrong salt form, a look-alike/sound-alike drug), and
a pharmacy POS is exactly the wrong place for a plausible-looking guess. The structured fields the
file already provides — `strength`, `dosageForm`, `genericName`, `din` — are authoritative and
should be displayed alongside the name rather than folded into it.

The abbreviation dictionary must live in a config/seed file the pharmacist can review and edit — not
hardcoded in the parser. Ship it with a conservative starter set and let it grow.

---

## 5. Scan-to-find and the "promote to product" flow

This is the requirement "the pharmacist should be able to scan and find the item from the database."

### Lookup order on a barcode scan
1. **`Product`** (stocked) → normal checkout behaviour, add to cart
2. **`CatalogProduct`** (catalogue only) → show a distinct "**Not stocked — in catalogue**" state
3. **Neither** → the existing not-found state

### Normalized GTIN matching (important)
A scanner emits 12 or 13 digits; the file stores 14. Match on the **zero-stripped normalized form**
(`gtinPrimaryNorm` / `gtinCaseNorm`), and check **both** the unit and case GTIN — a pharmacist
scanning a shipping carton should still resolve the item.

### Promote flow
From the catalogue-only state, one clear action: **"Start selling this item."** It creates a `Product`
with:
- `costCents` ← `CatalogProduct.costPriceCents`
- `priceCents` ← **calculated by the existing tiered markup engine** (not the McKesson list price —
  the pharmacy's own tier table is the source of truth for retail; show the McKesson list price
  alongside as a reference figure only)
- `barcode` ← normalized primary GTIN
- `name` ← `displayName`
- `catalogProductId` / `sourceItemNumber` ← linkage

Per the UI guide, this must be reachable in the three-tap budget and must not interrupt an in-progress
sale — if a cashier scans an unstocked item mid-transaction, the primary action is to get past it, not
to force a catalogue-management decision at the register.

### Search
Catalogue search needs to be fast across 52,741 rows. Use **SQLite FTS5** over
`description + displayName + genericName + din + itemNumber`. A `LIKE '%term%'` scan will feel
sluggish and get worse with each import. Searchable by: description, generic name, DIN, item number,
and both GTINs.

---

## 6. Interaction with the tiered markup pricing engine (flag this before building)

There is a locked project decision: **a supplier cost change reprices the item automatically and
immediately, with no approval step.** A catalogue re-import is a *bulk* cost change — potentially
repricing hundreds of stocked items at once.

Honour the locked decision (auto-reprice, no approval gate), with two guardrails:

1. **Only `Product` rows are repriced** — never `CatalogProduct`. Catalogue rows carry McKesson's
   cost and list price and nothing else.
2. **Manually-pinned prices are skipped**, per the existing per-item override rule.
3. **A price-change report is mandatory, not optional** — shown in the pre-commit preview *and*
   persisted on the `CatalogImportBatch` (`repricedCount` + detail). Every change also lands in the
   existing audit log. Auto-repricing without a visible summary is how a pharmacy discovers a shelf
   full of wrong prices a week later.

Worth surfacing to the owner in the preview as a plain sentence: *"Committing this import will
reprice 1,247 stocked items."*

---

## 7. Province handling

The file carries **both** Ontario (49,152) and Quebec (3,589) items, and item numbers are unique
across both — they are distinct items, not duplicates of each other.

**Import everything; filter at query time** using the existing per-install settings layer (a
`pharmacyProvince` setting). This is simpler than filtering at import, and lets a pharmacy change or
clear the filter without a re-import. Default the filter to the pharmacy's province, with an
"include all provinces" escape hatch in catalogue search.

---

## 8. Deals (`S` records) — informational only, for now

Import them into `CatalogDeal` and surface them read-only on the catalogue product view
("On deal until [date] — deal price $X"). **Do not wire deal prices into automatic cost
calculations.** Per the format doc, the exact discount mechanics and which date bounds the order vs.
ship window are inferred rather than confirmed, and quietly mispricing 5,761 products on a guess is a
worse outcome than showing the deal as information the pharmacist acts on manually.

Revisit once McKesson confirms the field semantics.

---

## 9. Edge cases the implementation must handle

| Case | Count | Required behaviour |
|---|---|---|
| No valid primary GTIN | 6,689 | Import normally; item is searchable but not scannable. Not an error |
| No DIN (non-drug) | ~37,900 | Normal — `din` is null, full polishing applies |
| Zero cost price | 187 | Import; flag in preview. Do **not** let a zero cost reach the tier engine and produce a $0.00 retail price |
| `listPrice < costPrice` | 4 | Import; flag as a data anomaly in the report |
| Deals referencing a product | 12,661 | All 5,761 referenced items exist — but still handle orphans defensively on future files |
| Malformed / wrong-length line | 0 in this file | Collect to error report, continue import |
| Re-import of identical file | — | Zero duplicates, zero spurious "updated" rows, zero reprices |
| Promoted product dropped from new catalogue | varies | Mark `discontinued`, keep sellable, report it. **Never delete** |
| Discontinued item reappears in a later catalogue | varies | Clear `discontinued`, resume normal refresh |
| New catalogue >20% smaller than active one | — | Hard warning + typed confirmation before commit (§10) |
| Manual product whose barcode matches a catalogue item | varies | Leave untouched. Optionally offer linking in the report — never auto-merge |
| Import fails or is cancelled mid-parse | — | Active catalogue unchanged; discard the partial batch |

---

## 10. Catalogue refresh — replace vs. reconcile

The owner re-uploads a new catalogue periodically (roughly quarterly; treat the interval as
arbitrary). Product counts change, items are added and discontinued, and McKesson reprices. The
refresh has to fully reflect the new file — but "fully replace" means two different things for the
two tables, and conflating them destroys data.

### Reference catalogue → literal full replace

`CatalogProduct` and `CatalogDeal` are pure reference data. Nothing depends on their row ids and they
hold no pharmacy-authored state, so they are replaced outright:

1. Stream the new file into a new batch (`isActive = false`) — old catalogue still live
2. On commit, inside one transaction: set the old batch `isActive = false, supersededAt = now`, set
   the new batch `isActive = true`
3. Purge superseded batches older than the retention window (default: keep the **previous one batch**
   for rollback, delete anything older)

An item that vanished from the new file is simply gone from the catalogue. That's correct and
expected — it's a reference table.

### Promoted products → reconcile, do not delete

Products with `origin = CATALOG` are a different thing entirely. They have on-hand stock counts,
sale-history line items pointing at them, possibly a manual price pin, reorder points, and returns
against them. Deleting and re-inserting them would either orphan their sales history or reset their
stock to zero — silently, during a routine upload.

Reconcile on `sourceItemNumber` instead. This produces the identical end state (every catalogue-sourced
product reflects the new file) without touching anything the catalogue doesn't own.

For each `Product` where `origin = CATALOG`:

**Item still present in the new catalogue** → update in place:
| Field | Action |
|---|---|
| `costCents` | Update from new catalogue **unless** `costOverridden` |
| retail price | Recalculate via tier engine **unless** `pricePinned` (see §6) |
| `name` / `displayName` | Update **unless** `nameOverridden` |
| `barcode` | Update **unless** `barcodeOverridden`. A changed GTIN is notable — list it in the report |
| DIN, pack size, strength, dosage form, vendor, category | Always update (pure reference attributes) |
| stock on hand, reorder points, sales history, tab references | **Never touched** |
| `discontinued` | Cleared if previously set — the item came back |
| `lastSeenBatchId`, `lastCatalogSyncAt` | Set to this batch / now |

**Item absent from the new catalogue** → flag, don't delete:
- Set `discontinued = true`, `discontinuedAt = now`
- **Keep it sellable.** There is very likely still stock on the shelf, and refusing to ring it up
  because McKesson stopped listing it would block real sales
- Show it in the import report: *"23 products you stock are no longer in the catalogue"*
- Offer a post-import bulk action: *"Archive discontinued items with zero stock"* — opt-in, never
  automatic

**Products with `origin = MANUAL`** → skipped entirely. Not read, not updated, not flagged. The
import report states the count purely as reassurance: *"412 manually-added products were not
affected."*

### Preview must show all of this before commit

The pre-commit preview is the only place the owner can catch a bad file. It shows:

```
Catalogue refresh preview — WEBCAT_2026Q4.txt

Reference catalogue
  Current catalogue      52,741 products
  New catalogue          53,208 products      (+467)
  Added                     892
  Removed                   425
  Price changed           3,104

Your inventory
  Catalogue-sourced products      438
    · will be repriced             127   ← view detail
    · cost changed, price pinned     6   (unchanged)
    · manual overrides preserved    14
    · no longer in catalogue        23   ← will be marked discontinued, kept sellable
  Manually-added products         412    (not affected)

Rejected lines                      0
```

The repricing detail must be openable, not just a count — per §6, a bulk reprice the owner can't
inspect is how a shelf ends up mispriced for a week.

### Guard against a bad or partial file

Full replacement makes a wrong file expensive. Before commit, compare the new catalogue to the active
one and **hard-warn** on:

- **Large shrink** — new catalogue has >20% fewer products than the active one. Almost always a
  truncated download, a single-province export, or the wrong file. Requires explicit typed
  confirmation, not a normal "Continue" click.
- **Province mismatch** — active catalogue is majority `ONT` and the new one is majority `QUE`, or
  the pharmacy's configured province is largely absent from the new file.
- **Wholesale price movement** — median cost change >25% across the catalogue. Sometimes real, but
  worth a second look before it propagates to shelf prices.
- **Zero valid records** — refuse the commit outright.

### Rollback

Keep the previous batch until the next successful import. "Undo this catalogue update" flips the
active pointer back, and re-runs reconciliation against the restored batch. This can't restore
manually-edited-since values, so the confirmation must say so plainly. Cheap insurance for a
destructive-by-design operation.

### Refresh reminder

Show catalogue age wherever the catalogue is managed: *"Catalogue last updated 97 days ago."* Nudge
past a configurable threshold (default 90 days), dismissible, never blocking. Do not hardcode a
quarterly schedule or enforce a cadence — some pharmacies will refresh monthly, some yearly, and a
POS that nags or degrades on a schedule it invented is worse than one that just reports the facts.

---

## 11. Where this fits in the build

This is an extension of **Stage 2** (Inventory, Cost & Tiered Markup Pricing Engine) — it shares the
cost/pricing machinery and the validate-then-commit import pattern already built there for
spreadsheets. It depends on Stage 0's IPC bridge and Stage 3's barcode scanning, both complete.

Suggested implementation order:
1. Prisma schema + migration (§2)
2. Parser module in main process, ported from the validated reference parser, with unit tests against
   known records (§3) — **test first**, since every downstream feature depends on correct offsets
3. Streaming import + batching + progress IPC (§3)
4. Preview/commit UI with the price-change report (§3, §6)
5. Name polishing + the reviewable abbreviation dictionary (§4)
6. FTS5 search index + catalogue browse screen (§5)
7. Scan lookup fallback + promote-to-product flow (§5)
8. Deals import + read-only display (§8)
9. **Refresh + reconciliation** (§10) — batch pointer flip, `origin`/override flags, discontinued
   handling, bad-file guards, rollback. Build this only once promote-to-product works, since
   reconciliation operates on the products that flow creates

**Test the refresh path explicitly.** It is the one operation that can destroy real pharmacy data,
and it only runs a few times a year — meaning bugs in it will not surface during normal use. At
minimum, cover: re-importing the identical file (must be a no-op), a file with an item removed (must
mark discontinued, must not delete), a file with a changed cost on a pinned-price item (must not
reprice), and a manually-added product (must be byte-identical before and after).
