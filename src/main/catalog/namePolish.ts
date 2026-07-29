/**
 * Catalogue name polishing (spec §4).
 *
 * The raw `description` is NEVER modified — polishing produces a separate
 * `displayName`, so a bad rule can be re-run without re-importing.
 *
 * SAFETY RULE: for drug items (din != null) we apply title-casing and unit
 * spacing ONLY. Abbreviation expansion on a drug name risks producing a wrong
 * salt form, a mangled strength, or a look-alike/sound-alike name — a pharmacy
 * POS is exactly the wrong place for a plausible-looking guess. The structured
 * fields (strength, dosageForm, genericName, din) are authoritative and are
 * displayed alongside the name instead.
 */

/** Small words kept lowercase unless they lead the name. */
const SMALL_WORDS = new Set(['and', 'with', 'for', 'of', 'the', 'in', 'to', 'a', 'an', 'or'])

/** Units we re-space and re-case: `198G` -> `198 g`, `15ML` -> `15 mL`. */
const UNIT_CASING: Record<string, string> = {
  g: 'g',
  mg: 'mg',
  mcg: 'mcg',
  kg: 'kg',
  ml: 'mL',
  l: 'L',
  oz: 'oz',
  lb: 'lb',
  cm: 'cm',
  mm: 'mm',
  iu: 'IU',
  '%': '%'
}

const UNIT_PATTERN = /^(\d+(?:\.\d+)?)(G|MG|MCG|KG|ML|L|OZ|LB|CM|MM|IU|%)$/i

export type AbbreviationDictionary = Record<string, string>

/** Strips the `_comment` documentation key so it can never be matched as an abbreviation. */
export function sanitizeDictionary(raw: Record<string, unknown>): AbbreviationDictionary {
  const out: AbbreviationDictionary = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue
    if (typeof v === 'string' && v.trim()) out[k.toUpperCase()] = v
  }
  return out
}

function titleCaseWord(word: string): string {
  if (!word) return word
  // Preserve tokens that carry digits (strengths, sizes, model numbers) as-is.
  if (/\d/.test(word)) return word
  return word[0].toUpperCase() + word.slice(1).toLowerCase()
}

/** `198G` -> `198 g`, `15ML` -> `15 mL`. Returns null when the token isn't a unit. */
function spaceUnit(token: string): string | null {
  const m = UNIT_PATTERN.exec(token)
  if (!m) return null
  const unit = UNIT_CASING[m[2].toLowerCase()] ?? m[2].toLowerCase()
  // Percent stays attached to the number — `0.05%`, not `0.05 %`.
  return unit === '%' ? `${m[1]}%` : `${m[1]} ${unit}`
}

export interface PolishOptions {
  /** When true (din != null), abbreviations are NOT expanded. */
  isDrug: boolean
  dictionary?: AbbreviationDictionary
}

export function polishName(description: string, options: PolishOptions): string {
  const { isDrug, dictionary = {} } = options
  const source = description.trim()
  if (!source) return ''

  const tokens = source.split(/\s+/)
  const out: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // 1. Unit normalization — applies to drugs and non-drugs alike.
    const spaced = spaceUnit(token)
    if (spaced) {
      out.push(spaced)
      continue
    }

    // 2. Abbreviation expansion — NON-DRUG ONLY (safety rule).
    if (!isDrug) {
      const expansion = dictionary[token.toUpperCase()]
      if (expansion) {
        out.push(expansion)
        continue
      }
    }

    // 3. Title casing with small-word exceptions.
    const lower = token.toLowerCase()
    if (i > 0 && SMALL_WORDS.has(lower)) {
      out.push(lower)
    } else {
      out.push(titleCaseWord(token))
    }
  }

  return out.join(' ')
}
