import { describe, it, expect } from 'vitest'
import { buildReceiptHtml } from '../main/receipt/receiptTemplate'
import type { TransactionWithItems } from '../shared/types'

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
    ],
    ...overrides
  }
}

describe('buildReceiptHtml', () => {
  it('includes store info, receipt number, line items, and totals', () => {
    const html = buildReceiptHtml({
      transaction: mockTransaction(),
      storeInfo: { name: 'Test Pharmacy', address: '1 Main St', phone: '555-0000' }
    })

    expect(html).toContain('Test Pharmacy')
    expect(html).toContain('1 Main St')
    expect(html).toContain('RX-123456-789')
    expect(html).toContain('Ibuprofen 200mg 50ct')
    expect(html).toContain('$3.39')
    expect(html).toContain('$5.00')
    expect(html).toContain('$1.61')
  })

  it('includes optional Rx footer when provided', () => {
    const html = buildReceiptHtml({
      transaction: mockTransaction(),
      rxFooter: 'Rx pickup: Ask pharmacist for counseling.'
    })

    expect(html).toContain('Rx pickup: Ask pharmacist for counseling.')
  })

  it('escapes HTML in store name to prevent injection', () => {
    const html = buildReceiptHtml({
      transaction: mockTransaction(),
      storeInfo: { name: '<script>alert(1)</script>', address: 'Safe', phone: '555' }
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('labels the phone number and includes fax under it when set', () => {
    const html = buildReceiptHtml({
      transaction: mockTransaction(),
      storeInfo: { name: 'Test Pharmacy', address: '1 Main St', phone: '555-0000', fax: '555-1111' }
    })

    expect(html).toContain('Phone: 555-0000')
    expect(html).toContain('Fax: 555-1111')
  })

  it('omits the fax line when no fax number is set', () => {
    const html = buildReceiptHtml({
      transaction: mockTransaction(),
      storeInfo: { name: 'Test Pharmacy', address: '1 Main St', phone: '555-0000' }
    })

    expect(html).not.toContain('Fax:')
  })

  it('places the labeled email at the very bottom, after the thank-you line', () => {
    const html = buildReceiptHtml({
      transaction: mockTransaction(),
      storeInfo: {
        name: 'Test Pharmacy',
        address: '1 Main St',
        phone: '555-0000',
        email: 'store@example.com'
      }
    })

    expect(html).toContain('Email: store@example.com')
    const thankYouIndex = html.indexOf('Thank you for choosing')
    const emailIndex = html.indexOf('Email: store@example.com')
    expect(thankYouIndex).toBeGreaterThan(-1)
    expect(emailIndex).toBeGreaterThan(thankYouIndex)
  })
})
