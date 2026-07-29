import { describe, it, expect } from 'vitest'
import {
  RECORD_LEN,
  gtinIsValid,
  gtinNorm,
  parseDeal,
  parseLine,
  parseProduct
} from '../main/catalog/webcatParser'

/**
 * Records here are built from the **1-based positions in
 * mckesson-webcat-format.md**, deliberately expressed independently of the
 * parser's own 0-based slices. If an offset in webcatParser.ts drifts by even
 * one byte, these fail — which is the point: every downstream feature depends
 * on these offsets being exactly right.
 */
function buildRecord(fields: [number, string][]): string {
  const buf = new Array<string>(RECORD_LEN).fill(' ')
  for (const [pos1, value] of fields) {
    for (let i = 0; i < value.length; i++) {
      buf[pos1 - 1 + i] = value[i]
    }
  }
  return buf.join('')
}

/** Right-aligned zero-filled numeric field, as the file stores money and counts. */
function zeroPad(value: string, width: number): string {
  return value.padStart(width, '0')
}

// A real, verified drug record: Toctino 30 mg, DIN 02337649 (format doc §2).
const TOCTINO = buildRecord([
  [1, 'P'],
  [2, '123456'],
  [8, 'TOCTINO 30MG CAP'],
  [58, '20260715'],
  [66, zeroPad('', 24)],
  [90, '08640'],
  [127, '02337649'],
  [135, '30 CAPS'],
  [144, zeroPad('30', 6)],
  [150, 'ONT'],
  [153, '30MG'],
  [163, 'CAPSULE'],
  [178, '123456'],
  [184, 'ALITRETINOIN CAPSULE 30 MG ORA'],
  [214, '84920010006'],
  [230, 'YY'],
  [232, '320'],
  [235, 'PGA'],
  [239, zeroPad('71685', 7)],
  [332, zeroPad('71685', 7)],
  [339, zeroPad('71685', 7)],
  [346, '750000'],
  [352, 'AU'],
  [355, '00062600000019'],
  [369, zeroPad('', 14)],
  [383, '10035000764123']
])

// A front-store record: no DIN, retail above cost, no case GTIN.
const CANDY = buildRecord([
  [1, 'P'],
  [2, '000042'],
  [8, 'JOLLY RANCHER ASTD CELLO 198G'],
  [58, '20260101'],
  [90, '06530'],
  [127, zeroPad('', 8)], // all-zero DIN == no DIN
  [144, zeroPad('198', 6)],
  [150, 'QUE'],
  [178, zeroPad('', 6)],
  [230, 'NN'],
  [232, '620'],
  [235, 'HER'],
  [332, zeroPad('899', 7)],
  [339, zeroPad('534', 7)],
  [346, '750000'],
  [352, 'DU'],
  [355, '00035000764126'],
  [383, zeroPad('', 14)]
])

const DEAL = buildRecord([
  [1, 'S'],
  [2, '123456'],
  [8, 'PCH'],
  [11, '00071'],
  [16, '20260701'],
  [24, '20260930'],
  [32, '20260705'],
  [40, '20261005'],
  [69, zeroPad('500', 7)],
  [76, zeroPad('69900', 7)],
  [95, 'Y']
])

describe('gtinIsValid', () => {
  it('accepts check-digit-valid GTINs', () => {
    expect(gtinIsValid('00035000764126')).toBe(true)
    expect(gtinIsValid('00062600000019')).toBe(true)
    expect(gtinIsValid('10035000764123')).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(gtinIsValid('00035000764127')).toBe(false)
  })

  it('rejects all-zero fields — an empty field is not a barcode', () => {
    expect(gtinIsValid('00000000000000')).toBe(false)
  })

  it('rejects blanks, non-digits and wrong lengths', () => {
    expect(gtinIsValid('              ')).toBe(false)
    expect(gtinIsValid('0003500076412X')).toBe(false)
    expect(gtinIsValid('123456789')).toBe(false)
    expect(gtinIsValid(null)).toBe(false)
  })
})

describe('gtinNorm', () => {
  it('strips leading zeros so a 12/13-digit scan matches the stored 14', () => {
    expect(gtinNorm('00035000764126')).toBe('35000764126')
    expect(gtinNorm('10035000764123')).toBe('10035000764123')
  })

  it('returns null for an empty or all-zero value', () => {
    expect(gtinNorm('00000000000000')).toBeNull()
    expect(gtinNorm(null)).toBeNull()
  })
})

describe('parseProduct', () => {
  it('extracts every field of a drug record at the documented positions', () => {
    const p = parseProduct(TOCTINO)

    expect(p.itemNumber).toBe('123456')
    expect(p.description).toBe('TOCTINO 30MG CAP')
    expect(p.effectiveDate).toBe('20260715')
    expect(p.categoryCode).toBe('08640')
    expect(p.din).toBe('02337649')
    expect(p.packSize).toBe(30)
    expect(p.province).toBe('ONT')
    expect(p.strength).toBe('30MG')
    expect(p.dosageForm).toBe('CAPSULE')
    expect(p.genericCode).toBe('123456')
    expect(p.genericName).toBe('ALITRETINOIN CAPSULE 30 MG ORA')
    expect(p.mfrPartNumber).toBe('84920010006')
    expect(p.flagA).toBe('Y')
    expect(p.flagB).toBe('Y')
    expect(p.deptCode).toBe('320')
    expect(p.vendorCode).toBe('PGA')
    expect(p.uomGroup).toBe('A')
    expect(p.uomType).toBe('U')
  })

  it('reads money as integer cents, never floats', () => {
    const p = parseProduct(TOCTINO)
    // $716.85 — retail == cost on Rx items, per the format doc.
    expect(p.listPriceCents).toBe(71685)
    expect(p.costPriceCents).toBe(71685)
    expect(Number.isInteger(p.listPriceCents)).toBe(true)

    const c = parseProduct(CANDY)
    expect(c.listPriceCents).toBe(899) // $8.99
    expect(c.costPriceCents).toBe(534) // $5.34
  })

  it('validates both GTIN windows and stores the normalized form', () => {
    const p = parseProduct(TOCTINO)
    expect(p.gtinPrimary).toBe('00062600000019')
    expect(p.gtinPrimaryNorm).toBe('62600000019')
    expect(p.gtinCase).toBe('10035000764123')
    expect(p.gtinCaseNorm).toBe('10035000764123')
  })

  it('treats all-zero numeric fields as null, not zero', () => {
    const c = parseProduct(CANDY)
    expect(c.din).toBeNull() // an all-zero DIN means "no DIN", not "DIN zero"
    expect(c.genericCode).toBeNull()
    expect(c.gtinCase).toBeNull() // 6,689 items legitimately have no case GTIN
    expect(c.gtinCaseNorm).toBeNull()
  })

  it('leaves blank optional text fields null', () => {
    const c = parseProduct(CANDY)
    expect(c.strength).toBeNull()
    expect(c.dosageForm).toBeNull()
    expect(c.genericName).toBeNull()
    expect(c.province).toBe('QUE')
  })

  it('does not trim before slicing — a description with spaces stays intact', () => {
    const p = parseProduct(CANDY)
    expect(p.description).toBe('JOLLY RANCHER ASTD CELLO 198G')
    // Positional integrity: fields after the spaced description are still correct.
    expect(p.deptCode).toBe('620')
    expect(p.vendorCode).toBe('HER')
  })
})

describe('parseDeal', () => {
  it('extracts deal fields at the documented positions', () => {
    const d = parseDeal(DEAL)
    expect(d.itemNumber).toBe('123456')
    expect(d.dealType).toBe('PCH')
    expect(d.dealNumber).toBe('00071')
    expect(d.date1).toBe('20260701')
    expect(d.date2).toBe('20260930')
    expect(d.date3).toBe('20260705')
    expect(d.date4).toBe('20261005')
    expect(d.allowanceCents).toBe(500)
    expect(d.dealPriceCents).toBe(69900)
    expect(d.tierFlag).toBe('Y')
  })
})

describe('parseLine', () => {
  it('dispatches on record type', () => {
    expect(parseLine(TOCTINO).kind).toBe('product')
    expect(parseLine(DEAL).kind).toBe('deal')
  })

  it('rejects a wrong-length line without throwing', () => {
    const result = parseLine('P123')
    expect(result.kind).toBe('reject')
    expect(result.kind === 'reject' && result.reason).toContain('bad length 4')
  })

  it('rejects an unknown record type without throwing', () => {
    const bogus = 'X' + TOCTINO.slice(1)
    const result = parseLine(bogus)
    expect(result.kind).toBe('reject')
    expect(result.kind === 'reject' && result.reason).toContain('unknown record type')
  })

  it('holds every fixture at exactly 396 characters', () => {
    expect(TOCTINO).toHaveLength(396)
    expect(CANDY).toHaveLength(396)
    expect(DEAL).toHaveLength(396)
  })
})
