import { formatCurrency } from '../../shared/formatCurrency'
import type { StoreInfo, TransactionWithItems } from '../../shared/types'

export const DEFAULT_STORE_INFO: StoreInfo = {
  name: 'PharmaPOS Rx Pharmacy',
  address: '123 Health Ave, Suite 100, Cityville',
  phone: '(555) 019-2831'
}

export interface ReceiptTemplateOptions {
  transaction: TransactionWithItems
  storeInfo?: StoreInfo
  rxFooter?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Renders a structured transaction into HTML suitable for PDF or system printing.
 */
export function buildReceiptHtml(options: ReceiptTemplateOptions): string {
  const { transaction } = options
  const store = options.storeInfo ?? DEFAULT_STORE_INFO
  const dateStr = new Date(transaction.createdAt).toLocaleString()

  const lineItems = transaction.items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.product.name)}</td>
        <td class="qty">x${item.quantity}</td>
        <td class="price">${formatCurrency(item.totalCents)}</td>
      </tr>`
    )
    .join('')

  const rxFooter = options.rxFooter
    ? `<div class="footer rx">${escapeHtml(options.rxFooter)}</div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Courier New', monospace; font-size: 12px; width: 280px; margin: 0 auto; color: #111; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #333; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; vertical-align: top; }
    td.qty { text-align: center; width: 30px; }
    td.price { text-align: right; width: 70px; }
    .totals td { padding: 2px 0; }
    .totals .label { text-align: right; padding-right: 8px; }
    .totals .value { text-align: right; width: 70px; }
    .grand-total { font-size: 14px; font-weight: bold; }
    .footer { margin-top: 12px; font-size: 11px; text-align: center; }
    .rx { font-size: 10px; color: #444; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="center bold">${escapeHtml(store.name)}</div>
  <div class="center">${escapeHtml(store.address)}</div>
  <div class="center">${escapeHtml(store.phone)}</div>
  <div class="divider"></div>
  <div>Receipt: #${escapeHtml(transaction.receiptNumber)}</div>
  <div>Date: ${escapeHtml(dateStr)}</div>
  <div>Tender: ${escapeHtml(transaction.tenderType)}</div>
  <div class="divider"></div>
  <table>
    ${lineItems}
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td class="label">Subtotal:</td><td class="value">${formatCurrency(transaction.subtotalCents)}</td></tr>
    <tr><td class="label">Tax:</td><td class="value">${formatCurrency(transaction.taxCents)}</td></tr>
    <tr class="grand-total"><td class="label">TOTAL:</td><td class="value">${formatCurrency(transaction.totalCents)}</td></tr>
    <tr><td class="label">Tendered:</td><td class="value">${formatCurrency(transaction.tenderedCents)}</td></tr>
    <tr><td class="label">Change Due:</td><td class="value">${formatCurrency(transaction.changeCents)}</td></tr>
  </table>
  <div class="divider"></div>
  <div class="footer">Thank you for choosing ${escapeHtml(store.name)}!</div>
  <div class="footer">Please retain receipt for returns.</div>
  ${rxFooter}
</body>
</html>`
}
