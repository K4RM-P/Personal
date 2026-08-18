import { describe, it, expect } from 'vitest'
import { buildZplReceiptBuffer, buildNetworkReceiptBuffer } from '../main/receipt/receiptPrinter'
import type { TransactionWithItems, PrintReceiptOptions } from '../shared/types'

function mockItem(
  overrides: Partial<TransactionWithItems['items'][number]> = {}
): TransactionWithItems['items'][number] {
  return {
    id: 'item-1',
    transactionId: 'tx-1',
    productId: 1,
    quantity: 1,
    costCents: 100,
    unitPriceCents: 300,
    totalCents: 300,
    isVoided: false,
    product: {
      id: 1,
      sku: 'OTC-001',
      name: 'Ibuprofen 200mg 50ct',
      costCents: 100,
      priceCents: 300,
      barcode: '012345678901',
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    ...overrides
  }
}

function mockTransaction(overrides: Partial<TransactionWithItems> = {}): TransactionWithItems {
  return {
    id: 'tx-1',
    receiptNumber: 'RX-123456-789',
    status: 'COMPLETED',
    subtotalCents: 300,
    taxCents: 39,
    totalCents: 339,
    tenderType: 'CASH',
    tenderedCents: 500,
    changeCents: 161,
    voidReason: null,
    customerId: null,
    userId: null,
    createdAt: new Date('2026-07-28T12:00:00'),
    updatedAt: new Date('2026-07-28T12:00:00'),
    customer: null,
    items: [mockItem()],
    ...overrides
  }
}

function decode(buf: Uint8Array): string {
  return new TextDecoder().decode(buf)
}

describe('buildZplReceiptBuffer', () => {
  it('produces exactly one ^XA...^XZ label for a short receipt', () => {
    const zpl = decode(buildZplReceiptBuffer({ transaction: mockTransaction() }))
    const opens = zpl.match(/\^XA/g) || []
    const closes = zpl.match(/\^XZ/g) || []
    expect(opens).toHaveLength(1)
    expect(closes).toHaveLength(1)
  })

  it('sets label width/height from mm config at 8 dots/mm', () => {
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction(),
        printerConfig: { type: 'NETWORK', labelWidthMm: 85, labelHeightMm: 105 }
      })
    )
    expect(zpl).toContain('^PW680') // 85mm * 8
    expect(zpl).toContain('^LL840') // 105mm * 8
  })

  it('reserves the configured top margin before the first field', () => {
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction(),
        printerConfig: { type: 'NETWORK', topMarginMm: 10 }
      })
    )
    const firstFieldY = zpl.match(/\^FO\d+,(\d+)/)
    expect(firstFieldY).not.toBeNull()
    expect(Number(firstFieldY![1])).toBeGreaterThanOrEqual(80) // 10mm * 8 dots/mm
  })

  it('defaults to 85x105mm with 10mm top margin (Zebra ZD421 die-cut stock) when unset', () => {
    const zpl = decode(buildZplReceiptBuffer({ transaction: mockTransaction() }))
    expect(zpl).toContain('^PW680')
    expect(zpl).toContain('^LL840')
    const firstFieldY = Number(zpl.match(/\^FO\d+,(\d+)/)![1])
    expect(firstFieldY).toBeGreaterThanOrEqual(80)
  })

  it('spans a long receipt across multiple labels, each within the small 45mm test label height', () => {
    const manyItems = Array.from({ length: 30 }, (_, i) =>
      mockItem({ id: `item-${i}`, product: { ...mockItem().product!, name: `Item number ${i}` } })
    )
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction({ items: manyItems }),
        printerConfig: { type: 'NETWORK', labelWidthMm: 85, labelHeightMm: 45, topMarginMm: 10 }
      })
    )
    const opens = zpl.match(/\^XA/g) || []
    const closes = zpl.match(/\^XZ/g) || []
    expect(opens.length).toBeGreaterThan(1)
    expect(opens.length).toBe(closes.length)
    // every item line still appears somewhere across the label pages
    expect(zpl).toContain('Item number 0')
    expect(zpl).toContain('Item number 29')
    // continuation labels carry a short header, not the full store block again
    expect(zpl.match(/cont'd/g)?.length).toBe(opens.length - 1)
  })

  it("never places a field beyond a label's own height", () => {
    const manyItems = Array.from({ length: 15 }, (_, i) => mockItem({ id: `item-${i}` }))
    const heightMm = 60
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction({ items: manyItems }),
        printerConfig: {
          type: 'NETWORK',
          labelWidthMm: 85,
          labelHeightMm: heightMm,
          topMarginMm: 10
        }
      })
    )
    const labels = zpl.split('^XA').slice(1) // drop empty leading split
    for (const label of labels) {
      const ys = [...label.matchAll(/\^FO\d+,(\d+)/g)].map((m) => Number(m[1]))
      for (const y of ys) {
        expect(y).toBeLessThan(heightMm * 8)
      }
    }
  })

  it('escapes ZPL control characters (^ ~ \\\\) in field data so item names cannot corrupt the label stream', () => {
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction({
          items: [mockItem({ product: { ...mockItem().product!, name: 'Weird^Name~With\\Chars' } })]
        })
      })
    )
    expect(zpl).not.toContain('Weird^Name~With\\Chars')
    expect(zpl).toContain('Weird\\5EName\\7EWith\\\\Chars')
  })

  it('centers the store name/address/phone header and the thank-you/rx footer lines', () => {
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction(),
        storeInfo: { name: 'Test Pharmacy', address: '1 Main St', phone: '555-0000' },
        rxFooter: 'Rx pickup: Ask pharmacist for counseling.'
      })
    )
    // Centered fields use a full-content-width ^FB with 'C' justification, unlike
    // the plain ^FO...^FD used for left-aligned lines (receipt #, date, items).
    expect(zpl).toMatch(/\^FB\d+,1,0,C,0\^FDTest Pharmacy\^FS/)
    expect(zpl).toMatch(/\^FB\d+,1,0,C,0\^FD1 Main St\^FS/)
    expect(zpl).toMatch(/\^FB\d+,1,0,C,0\^FD555-0000\^FS/)
    expect(zpl).toMatch(/\^FB\d+,1,0,C,0\^FDThank you for choosing Test Pharmacy!\^FS/)
    expect(zpl).toMatch(/\^FB\d+,1,0,C,0\^FDRx pickup/)
    // Receipt #/date/type stay left-aligned, same as the ESC/POS layout.
    expect(zpl).not.toMatch(/\^FB\d+,1,0,C,0\^FDReceipt:/)
  })

  it('centers the continuation-label header on overflow pages too', () => {
    const manyItems = Array.from({ length: 20 }, (_, i) => mockItem({ id: `item-${i}` }))
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction({ items: manyItems }),
        storeInfo: { name: 'Test Pharmacy', address: '1 Main St', phone: '555-0000' },
        printerConfig: { type: 'NETWORK', labelHeightMm: 45 }
      })
    )
    expect(zpl).toMatch(/\^FB\d+,1,0,C,0\^FDTest Pharmacy \(cont'd\)\^FS/)
  })

  it("never sends printer-level media/speed/calibration commands (^MN, ^PR) — those must match the printer's own calibration, and a mismatch causes runaway feeding", () => {
    const zpl = decode(buildZplReceiptBuffer({ transaction: mockTransaction() }))
    expect(zpl).not.toContain('^MN')
    expect(zpl).not.toContain('^PR')
  })

  it('includes receipt number, totals, and rx footer', () => {
    const zpl = decode(
      buildZplReceiptBuffer({
        transaction: mockTransaction(),
        rxFooter: 'Rx pickup: Ask pharmacist for counseling.'
      })
    )
    expect(zpl).toContain('RX-123456-789')
    expect(zpl).toContain('3.39')
    expect(zpl).toContain('Rx pickup: Ask pharmacist for counseling.')
  })
})

describe('buildNetworkReceiptBuffer', () => {
  it('routes to ZPL when printerConfig.language is zpl', () => {
    const options: PrintReceiptOptions = {
      transaction: mockTransaction(),
      printerConfig: { type: 'NETWORK', language: 'zpl' }
    }
    const buf = decode(buildNetworkReceiptBuffer(options))
    expect(buf).toContain('^XA')
  })

  it('routes to ESC/POS by default (no language set)', () => {
    const options: PrintReceiptOptions = {
      transaction: mockTransaction(),
      printerConfig: { type: 'NETWORK' }
    }
    const buf = buildNetworkReceiptBuffer(options)
    // ESC/POS output is binary and starts with an ESC (0x1b) init sequence, never ZPL's ^XA ASCII header
    expect(decode(buf)).not.toContain('^XA')
  })
})
