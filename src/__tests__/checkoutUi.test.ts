import { describe, expect, it } from 'vitest'
import { parseImportPreviewCsv } from '../renderer/src/lib/checkoutUi'

describe('parseImportPreviewCsv', () => {
  it('parses CSV rows into preview items and handles optional barcode', () => {
    const result = parseImportPreviewCsv('OTC-100,Allergy Relief,2.50,123\nOTC-101,Cough Syrup,4.00')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      sku: 'OTC-100',
      name: 'Allergy Relief',
      costCents: 250,
      barcode: '123'
    })
    expect(result[1]).toEqual({
      sku: 'OTC-101',
      name: 'Cough Syrup',
      costCents: 400,
      barcode: undefined
    })
  })
})
