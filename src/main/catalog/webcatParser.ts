/**
 * McKesson WEBCAT fixed-width parser.
 *
 * Ported 1:1 from docs/superpowers/webcat_parser_reference.py — the validated
 * reference implementation (52,741 products / 12,661 deals / 0 rejects on the
 * real 26 MB file). Every offset here matches that file exactly; do NOT
 * re-derive them from the prose format doc.
 *
 * Python r[a:b] === spec 1-based positions (a+1)..b, and JS String.slice(a, b)
 * is the same half-open range, so the slice arguments are carried over verbatim.
 *
 * Money is integer cents throughout. Never floats.
 */

export const RECORD_LEN = 396

export interface ParsedProduct {
  itemNumber: string
  description: string
  effectiveDate: string | null
  categoryCode: string | null
  din: string | null
  packSize: number | null
  province: string
  strength: string | null
  dosageForm: string | null
  genericCode: string | null
  genericName: string | null
  mfrPartNumber: string | null
  flagA: string
  flagB: string
  deptCode: string | null
  vendorCode: string | null
  listPriceCents: number
  costPriceCents: number
  uomGroup: string | null
  uomType: string | null
  gtinPrimary: string | null
  gtinPrimaryNorm: string | null
  gtinCase: string | null
  gtinCaseNorm: string | null
}

export interface ParsedDeal {
  itemNumber: string
  dealType: string
  dealNumber: string
  date1: string | null
  date2: string | null
  date3: string | null
  date4: string | null
  allowanceCents: number
  dealPriceCents: number
  tierFlag: string | null
}

export interface RejectedLine {
  lineNumber: number
  reason: string
}

// ------------------------------------------------------------------ helpers

/** Standard GTIN mod-10 check digit. Works for GTIN-8/12/13/14. */
export function gtinIsValid(s: string | null | undefined): boolean {
  if (!s) return false
  if (!/^\d+$/.test(s)) return false
  if (![8, 12, 13, 14].includes(s.length)) return false
  if (stripZeros(s) === '') return false // all zeros == empty field, not a barcode

  const digits = [...s].map((c) => c.charCodeAt(0) - 48)
  const check = digits[digits.length - 1]
  const body = digits.slice(0, -1).reverse()
  let total = 0
  for (let i = 0; i < body.length; i++) {
    total += body[i] * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (total % 10)) % 10 === check
}

/** Scanners emit 12-13 digits; the file stores 14. Normalize for matching. */
export function gtinNorm(s: string | null | undefined): string | null {
  if (!s) return null
  const n = s.replace(/^0+/, '')
  return n || null
}

/** Python's str.strip("0") — strips zeros from BOTH ends. */
function stripZeros(s: string): string {
  return s.replace(/^0+/, '').replace(/0+$/, '')
}

function num(s: string): number {
  const t = s.trim()
  return /^\d+$/.test(t) ? parseInt(t, 10) : 0
}

/** Trimmed string, or null if blank. */
function opt(s: string): string | null {
  const t = s.trim()
  return t || null
}

/** Trimmed string, or null if blank OR all zeros (e.g. an absent DIN). */
function optZero(s: string): string | null {
  const t = s.trim()
  return t && stripZeros(t) ? t : null
}

// ------------------------------------------------------------------ records

export function parseProduct(r: string): ParsedProduct {
  const rawPrimary = r.slice(354, 368)
  const rawCase = r.slice(382, 396)
  const gp = gtinIsValid(rawPrimary) ? rawPrimary : null
  const gc = gtinIsValid(rawCase) ? rawCase : null

  return {
    itemNumber: r.slice(1, 7), // pos 2-7    unique key
    description: r.slice(7, 57).trim(), // pos 8-57   raw ALL-CAPS
    effectiveDate: optZero(r.slice(57, 65)), // pos 58-65  YYYYMMDD
    categoryCode: optZero(r.slice(89, 94)), // pos 90-94
    din: optZero(r.slice(126, 134)), // pos 127-134
    packSize: num(r.slice(143, 149)) || null, // pos 144-149
    province: r.slice(149, 152).trim(), // pos 150-152 ONT|QUE
    strength: opt(r.slice(152, 162)), // pos 153-162
    dosageForm: opt(r.slice(162, 177)), // pos 163-177
    genericCode: optZero(r.slice(177, 183)), // pos 178-183
    genericName: opt(r.slice(183, 213)), // pos 184-213
    mfrPartNumber: optZero(r.slice(213, 228)), // pos 214-228
    flagA: r[229], // pos 230
    flagB: r[230], // pos 231
    deptCode: opt(r.slice(231, 234)), // pos 232-234
    vendorCode: opt(r.slice(234, 237)), // pos 235-237
    listPriceCents: num(r.slice(331, 338)), // pos 332-338  INTEGER CENTS
    costPriceCents: num(r.slice(338, 345)), // pos 339-345  INTEGER CENTS
    uomGroup: opt(r[351]), // pos 352
    uomType: opt(r[352]), // pos 353
    gtinPrimary: gp, // pos 355-368
    gtinPrimaryNorm: gtinNorm(gp),
    gtinCase: gc, // pos 383-396
    gtinCaseNorm: gtinNorm(gc)
  }
}

export function parseDeal(r: string): ParsedDeal {
  return {
    itemNumber: r.slice(1, 7), // pos 2-7   FK -> product
    dealType: r.slice(7, 10).trim(), // pos 8-10
    dealNumber: r.slice(10, 15).trim(), // pos 11-15
    date1: optZero(r.slice(15, 23)), // pos 16-23
    date2: optZero(r.slice(23, 31)), // pos 24-31
    date3: optZero(r.slice(31, 39)), // pos 32-39
    date4: optZero(r.slice(39, 47)), // pos 40-47
    allowanceCents: num(r.slice(68, 75)), // pos 69-75
    dealPriceCents: num(r.slice(75, 82)), // pos 76-82
    tierFlag: r.length > 94 ? r[94] : null // pos 95
  }
}

export type ParsedLine =
  | { kind: 'product'; product: ParsedProduct }
  | { kind: 'deal'; deal: ParsedDeal }
  | { kind: 'reject'; reason: string }

/**
 * Classify and parse a single already-newline-stripped line.
 * Malformed lines are reported, never thrown on — a handful of bad lines
 * must not cost the pharmacist the other 52,000.
 */
export function parseLine(line: string): ParsedLine {
  if (line.length !== RECORD_LEN) {
    return { kind: 'reject', reason: `bad length ${line.length}, expected ${RECORD_LEN}` }
  }
  const kind = line[0]
  if (kind === 'P') return { kind: 'product', product: parseProduct(line) }
  if (kind === 'S') return { kind: 'deal', deal: parseDeal(line) }
  return { kind: 'reject', reason: `unknown record type '${kind}'` }
}
