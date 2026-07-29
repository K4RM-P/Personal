# McKesson WEBCAT — File Format Reference

Reverse-engineered from a real 26 MB `WEBCAT` file (July 2026). This is the authoritative field map
for building the importer. **Confidence levels are marked honestly** — some fields are proven by
check-digit validation or cross-referencing real drug data, others are inferred from patterns. Do not
treat "Low" confidence fields as reliable.

---

## 1. File-level characteristics (all verified)

| Property | Value |
|---|---|
| Encoding | ASCII / latin-1 (no UTF-8 multibyte found) |
| Line endings | **CRLF** (`\r\n`) |
| Record length | **Exactly 396 characters** — 65,402 / 65,402 lines conform, zero exceptions |
| Format | Fixed-width, positional. **Not delimited.** No header row, no footer |
| Total records | 65,402 |
| `P` records (products) | **52,741** |
| `S` records (deals/promotions) | **12,661** |
| Record type | Character at position 1 (`P` or `S`) |

**Critical:** parse by byte position, never by splitting on whitespace. Descriptions contain spaces,
and blank fields are space-filled, so any delimiter-based parse will corrupt the data.

---

## 2. `P` record — Product master (52,741 rows)

Positions are **1-based, inclusive**.

| Pos | Len | Field | Type | Confidence | Notes / evidence |
|---|---|---|---|---|---|
| 1 | 1 | Record type | char | Certain | Always `P` |
| 2–7 | 6 | **McKesson item number** | numeric str | **Certain** | 52,741 values, **100% unique** — safe as primary key |
| 8–57 | 50 | **Description** | text | **Certain** | ALL-CAPS, abbreviated. 0 blanks |
| 58–65 | 8 | Effective / last-change date | `YYYYMMDD` | High | 38 distinct values, all plausible dates |
| 66–89 | 24 | Reserved date block (3 × 8) | numeric | Medium | All zeros in this file |
| 90–94 | 5 | Category / class code | code | High | **311 distinct**. Lookup table NOT in file |
| 95–103 | 9 | Unknown | text | Low | Almost always blank |
| 104–126 | 23 | Unknown numeric block | numeric | **Low** | Tested — **not** a valid GTIN. Possibly vendor/order refs |
| 127–134 | 8 | **DIN** (Drug Identification Number) | numeric | **Certain** | 14,879 populated. Verified: Toctino 30 mg = `02337649`, Cipro 250 mg = `02353318`, Clobetasol = `02216213` |
| 135–142 | 8 | Pack size (text form) | text | Medium | Left-justified duplicate of pack size |
| 143 | 1 | Filler | — | — | Always blank |
| 144–149 | 6 | **Pack size** | numeric | **Certain** | Matches description (198 g → `000198`, 30 caps → `000030`, 60 mL → `000060`) |
| 150–152 | 3 | **Province** | code | **Certain** | `ONT` = 49,152 · `QUE` = 3,589 |
| 153–162 | 10 | **Strength** | text | **Certain** | `30MG`, `250MG`, `0.05%` |
| 163–177 | 15 | **Dosage form** | text | **Certain** | 99 distinct: `TABLET` (7,687), `CAPSULE` (2,483), `SOLUTION` (2,184), `POWDER`, `LIQUID`, `CREAM`… blank for 29,666 non-drug items |
| 178–183 | 6 | Generic / therapeutic code | code | High | Pairs with generic name |
| 184–213 | 30 | **Generic name** | text | **Certain** | e.g. `ALITRETINOIN CAPSULE 30 MG ORA` |
| 214–228 | 15 | Manufacturer part number | alphanumeric | High | e.g. `84920010006`, `840600400522063` |
| 229 | 1 | Filler | — | — | Blank |
| 230 | 1 | Flag A | `Y`/`N` | Medium | With 231: `YY` 37,569 · `NN` 14,844 · `YN` 326 · `NY` 2 |
| 231 | 1 | Flag B | `Y`/`N` | Medium | Semantics unconfirmed |
| 232–234 | 3 | Department code | code | High | `320` = 36,473 · `360` = 12,679 · `620` = 3,589. **`620` count exactly equals the QUE count** → `620` is the Quebec department |
| 235–237 | 3 | **Vendor / manufacturer code** | code | **Certain** | 713 distinct (`PGA`, `CSM`, `JJC`, `REV`, `TEV`…). Lookup table NOT in file |
| 238 | 1 | Filler | — | — | Blank |
| 239–245 | 7 | Base cost (cents) | numeric | High | Equals the cost field at 339–345 in **52,713 / 52,741** records |
| 246 | 1 | Flag | `Y`/`N` | Medium | |
| 247–253 | 7 | Secondary / contract cost (cents) | numeric | Medium | Non-zero in 35,296 records |
| 254 | 1 | Flag | `Y`/`N` | Medium | |
| 255–331 | 77 | Mixed numeric / flags | — | **Low** | Mostly zeros. Contains promo-date references around 300–321 |
| 332–338 | 7 | **List / suggested retail price (cents)** | numeric | **Certain** | Non-zero in 52,331. Validated: retail > cost on front-store items (Colgate $8.99 vs $5.34), retail == cost on Rx (Toctino $716.85) |
| 339–345 | 7 | **Cost price (cents)** | numeric | **Certain** | Non-zero in 52,554 |
| 346–351 | 6 | Filler | constant | Certain | **Always** `750000` — carries no information |
| 352 | 1 | UOM group | code | High | `A` / `D` / `T` |
| 353 | 1 | UOM type | code | High | `U` / `C` / `P` / `D`. Combined 12 values: `AU` 22,075 · `DU` 7,138 · `AC` 5,341 · `AP` 4,113 · `TU` 3,237 … |
| 354 | 1 | Filler | — | — | Blank |
| 355–368 | 14 | **Primary GTIN (unit barcode)** | GTIN-14 | **Certain** | **100% check-digit valid.** 46,052 populated |
| 369–382 | 14 | Unknown numeric | numeric | Low | Mostly zeros |
| 383–396 | 14 | **Case / shipper GTIN** | GTIN-14 | **Certain** | **100% check-digit valid.** 43,770 populated |

### How the GTIN fields were proven
Every 12/13/14-digit window between positions 100–396 was tested against the standard GTIN mod-10
check-digit algorithm. Only two windows scored **1.000 validity** — positions 355–368 and 383–396.
This is not a guess; a false window cannot produce 100% valid check digits across thousands of rows.

A GTIN-14 with a leading `0` is just an EAN-13; with two leading zeros it's a UPC-A. **Store all 14
digits and match on the normalized (zero-stripped) form**, because a scanner will emit 12 or 13
digits for the same product the file stores as 14.

---

## 3. `S` record — Deal / promotion (12,661 rows)

Links to a `P` record by item number. **5,761 distinct products have deals** (avg 2.2 deals each).
Verified: every `S` item number exists as a `P` record — no orphans.

| Pos | Len | Field | Type | Confidence |
|---|---|---|---|---|
| 1 | 1 | Record type (`S`) | char | Certain |
| 2–7 | 6 | **Item number (FK → P record)** | numeric str | **Certain** |
| 8–10 | 3 | Deal type | code | Certain — `PCH` 8,934 · `PNC` 3,388 · `PVO` 147 · `PSI` 100 · `GRO` 66 · `PCX` 26 |
| 11–15 | 5 | Deal / promo number | numeric | Certain — 84 distinct |
| 16–23 | 8 | Date 1 (order start?) | `YYYYMMDD` | High — 12,629/12,661 valid |
| 24–31 | 8 | Date 2 (order end?) | `YYYYMMDD` | High |
| 32–39 | 8 | Date 3 (ship start?) | `YYYYMMDD` | High |
| 40–47 | 8 | Date 4 (ship end?) | `YYYYMMDD` | High |
| 48–60 | 13 | Blank | — | Certain |
| 69–75 | 7 | Allowance / discount (cents) | numeric | Medium — non-zero in ~60% |
| 76–82 | 7 | Deal price (cents) | numeric | High — non-zero in 99.9% |
| 95 | 1 | Tier flag | `Y`/`N` | Medium |
| ~104–110 | 7 | Reference cost (cents) | numeric | Medium — matches the `P` record's cost |

**Honest caveat:** which of the four dates is order-window vs. ship-window is inferred, not
confirmed. The deal *price* field is reliable; the exact discount mechanics are not. Treat `S`
records as **informational** ("this item is on deal until X") rather than wiring them into automatic
cost calculations until McKesson confirms the semantics.

---

## 4. What is NOT in this file (real gaps — plan around them)

- **Vendor code → manufacturer name.** 713 codes like `PGA`, `TEV`, `MYL`. The lookup table is not
  included. Until obtained, display the raw code.
- **Category code → category name.** 311 codes like `08640`, `06530`. Same problem.
- **Dosage-form and UOM code expansions.** `AU`/`DU`/`TC` etc. are undocumented here.
- **On-hand / availability / stocking status.** This is a *catalogue*, not an inventory feed — it
  says what McKesson sells, not what's in stock or what the pharmacy carries.
- **Retail pricing intelligence beyond the list price.** No competitor pricing, no margin guidance.

Ask the McKesson rep for the companion code/reference tables. They exist; they're just distributed
separately from `WEBCAT`.

---

## 5. Parsing rules (non-negotiable)

1. **Read as latin-1, not UTF-8.** A stray high byte will throw on strict UTF-8 decode and abort the import.
2. **Strip `\r\n`, then assert `len(line) == 396`.** Route non-conforming lines to an error report;
   never silently skip and never attempt to parse them.
3. **Never trim before slicing.** Positions are absolute. Trim only the extracted field value.
4. **Money is integer cents already** — the file stores `0000359` = $3.59. This matches the project's
   locked integer-cents convention exactly. **Never convert to float at any point.**
5. **Treat all-zero numeric fields as null**, not as `0` — an all-zero DIN means "no DIN", not "DIN zero".
6. **Validate GTIN check digits on import.** 6,689 products have no valid primary GTIN — that's
   expected (they're unbarcoded or case-only), not a parse failure.
