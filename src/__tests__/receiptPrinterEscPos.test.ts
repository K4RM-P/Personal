import { describe, it, expect } from 'vitest'
import { buildEscPosReceiptBuffer } from '../main/receipt/receiptPrinter'
import type { TransactionWithItems } from '../shared/types'

function mockTransaction(): TransactionWithItems {
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
    items: [
      {
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
        }
      }
    ]
  }
}

function decode(buf: Uint8Array): string {
  return new TextDecoder().decode(buf)
}

describe('buildEscPosReceiptBuffer', () => {
  it('labels the phone number and includes fax under it when set', () => {
    const text = decode(
      buildEscPosReceiptBuffer({
        transaction: mockTransaction(),
        storeInfo: {
          name: 'Test Pharmacy',
          address: '1 Main St',
          phone: '555-0000',
          fax: '555-1111'
        }
      })
    )
    expect(text).toContain('Phone: 555-0000')
    expect(text).toContain('Fax: 555-1111')
  })

  it('omits the fax line when no fax number is set', () => {
    const text = decode(buildEscPosReceiptBuffer({ transaction: mockTransaction() }))
    expect(text).not.toContain('Fax:')
  })

  it('includes a labeled email line after the thank-you line', () => {
    const text = decode(
      buildEscPosReceiptBuffer({
        transaction: mockTransaction(),
        storeInfo: {
          name: 'Test Pharmacy',
          address: '1 Main St',
          phone: '555-0000',
          email: 'store@example.com'
        }
      })
    )
    expect(text).toContain('Email: store@example.com')
    const thankYouIndex = text.indexOf('Thank you for choosing')
    const emailIndex = text.indexOf('Email: store@example.com')
    expect(emailIndex).toBeGreaterThan(thankYouIndex)
  })

  it('uses the store name from settings in the thank-you line', () => {
    const text = decode(
      buildEscPosReceiptBuffer({
        transaction: mockTransaction(),
        storeInfo: { name: 'My Pharmacy', address: '1 Main St', phone: '555-0000' }
      })
    )
    // The 32-char ESC/POS line width can word-wrap a long store name, so check
    // for the substring on either side of the wrap rather than the full line.
    expect(text).toContain('Thank you for choosing My')
    expect(text).toContain('Pharmacy!')
  })
})
