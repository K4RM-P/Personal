import { describe, it, expect } from 'vitest'
import { polishName, sanitizeDictionary } from '../main/catalog/namePolish'
import dictionaryJson from '../../resources/catalogAbbreviations.json'

const dictionary = sanitizeDictionary(dictionaryJson as Record<string, unknown>)

describe('sanitizeDictionary', () => {
  it('drops the documentation key so it can never be matched as an abbreviation', () => {
    expect(dictionary['_COMMENT']).toBeUndefined()
    expect(dictionary['ASTD']).toBe('Assorted')
  })
})

describe('polishName — non-drug items', () => {
  it('title-cases, expands abbreviations, and spaces units', () => {
    expect(
      polishName('JOLLY RANCHER ASTD CELLO 198G', { isDrug: false, dictionary })
    ).toBe('Jolly Rancher Assorted Cellophane 198 g')
  })

  it('normalizes mL casing', () => {
    expect(polishName('SALINE SOL 15ML', { isDrug: false, dictionary })).toBe(
      'Saline Solution 15 mL'
    )
  })

  it('keeps small words lowercase unless they lead', () => {
    expect(polishName('SOAP FOR SENS SKIN', { isDrug: false, dictionary })).toBe(
      'Soap for Sensitive Skin'
    )
    expect(polishName('OF MICE', { isDrug: false, dictionary })).toBe('Of Mice')
  })

  it('leaves tokens containing digits untouched apart from unit spacing', () => {
    expect(polishName('MODEL X200 CUFF', { isDrug: false, dictionary })).toBe('Model X200 Cuff')
  })
})

describe('polishName — drug items (safety rule)', () => {
  it('does NOT expand abbreviations on drug names', () => {
    // `CAP` must stay `Cap`, never become `Capsule`: expanding abbreviations on
    // a drug name risks a wrong salt form or a look-alike/sound-alike error.
    expect(polishName('TOCTINO 30MG CAP', { isDrug: true, dictionary })).toBe('Toctino 30 mg Cap')
  })

  it('still title-cases and spaces units on drug names', () => {
    expect(polishName('CIPRO 250MG TB', { isDrug: true, dictionary })).toBe('Cipro 250 mg Tb')
    expect(polishName('CLOBETASOL 0.05% CRM', { isDrug: true, dictionary })).toBe(
      'Clobetasol 0.05% Crm'
    )
  })

  it('applies the same abbreviation to a non-drug that it withholds from a drug', () => {
    const raw = 'ACME 30MG CAP'
    expect(polishName(raw, { isDrug: false, dictionary })).toBe('Acme 30 mg Capsule')
    expect(polishName(raw, { isDrug: true, dictionary })).toBe('Acme 30 mg Cap')
  })
})

describe('polishName — edge cases', () => {
  it('handles an empty description', () => {
    expect(polishName('   ', { isDrug: false, dictionary })).toBe('')
  })

  it('works with no dictionary configured', () => {
    expect(polishName('JOLLY RANCHER ASTD', { isDrug: false })).toBe('Jolly Rancher Astd')
  })
})
