import { formatCurrency } from '../../shared/formatCurrency'
import type { StoreInfo, TransactionWithItems, DBTransactionTender } from '../../shared/types'

export const DEFAULT_STORE_INFO: StoreInfo = {
  name: 'VantisPOS Rx Pharmacy',
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

function buildLineItemsHtml(transaction: TransactionWithItems): string {
  return transaction.items
    .map((item) => {
      const lineRawCents = item.unitPriceCents * item.quantity
      const discountCents = item.discountCents ?? 0
      const discountRow =
        discountCents > 0
          ? `
      <tr class="discount-row">
        <td colspan="2">Discount</td>
        <td class="price">-${formatCurrency(discountCents)}</td>
      </tr>`
          : ''
      const hstLabel = item.hstApplied === false ? ' (HST exempt)' : ''
      const displayName =
        item.lineType === 'DEBT_SETTLEMENT' ? 'Previous Balance' : (item.product?.name ?? '(item)')
      return `
      <tr>
        <td>${escapeHtml(displayName)}${hstLabel}</td>
        <td class="qty">x${item.quantity}</td>
        <td class="price">${formatCurrency(lineRawCents)}</td>
      </tr>${discountRow}`
    })
    .join('')
}

/** Human label for one TransactionTender row, e.g. "Card (Credit) •••• 4242". */
function tenderLineLabel(tender: DBTransactionTender): string {
  switch (tender.method) {
    case 'CASH':
      return 'Cash'
    case 'CARD':
      return `Card${tender.cardType ? ` (${tender.cardType === 'CREDIT' ? 'Credit' : 'Debit'})` : ''}${tender.cardLastFour ? ` •••• ${tender.cardLastFour}` : ''}`
    case 'E_TRANSFER':
      return 'E-Transfer'
    case 'PHARMACY_CREDIT':
      return 'Pharmacy Credit'
    default:
      return tender.method
  }
}

/**
 * Itemizes every tender line on the sale (§6: "the receipt must now show every
 * tender line, not just one payment method") instead of a single collapsed
 * `Tender: X` row. Falls back to the legacy single-line summary for historical
 * transactions with no `tenders` relation loaded/populated.
 */
function buildTenderLinesHtml(transaction: TransactionWithItems): string {
  const tenders = transaction.tenders
  if (transaction.tenderType === 'NONE') return '<div>No Payment Required</div>'
  if (!tenders || tenders.length === 0) {
    return `<div>Tender: ${escapeHtml(transaction.tenderType)}</div>`
  }
  const rows = tenders
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((t) => `<div>${escapeHtml(tenderLineLabel(t))}: ${formatCurrency(t.amountCents)}</div>`)
    .join('')
  return rows
}

/** Plain-text (no HTML) version of the same itemization, for the `{{tenders}}` custom-template token. */
function buildTenderLinesText(transaction: TransactionWithItems): string {
  const tenders = transaction.tenders
  if (transaction.tenderType === 'NONE') return 'No Payment Required'
  if (!tenders || tenders.length === 0) {
    return `Tender: ${escapeHtml(transaction.tenderType)}`
  }
  return tenders
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((t) => `${escapeHtml(tenderLineLabel(t))}: ${formatCurrency(t.amountCents)}`)
    .join(', ')
}

function buildLogoHtml(store: StoreInfo): string {
  if (!store.logoDataUrl) return ''
  return `<div class="center"><img src="${store.logoDataUrl}" alt="${escapeHtml(store.name)} logo" class="logo" /></div>`
}

/**
 * Renders a structured transaction into HTML suitable for PDF or system printing. Uses the
 * manager-uploaded custom template (if enabled) instead of the built-in layout.
 */
export function buildReceiptHtml(options: ReceiptTemplateOptions): string {
  const { transaction } = options
  const store = options.storeInfo ?? DEFAULT_STORE_INFO

  if (store.useCustomReceiptTemplate && store.customReceiptTemplateHtml) {
    return buildCustomReceiptHtml(transaction, store, options.rxFooter)
  }

  return buildDefaultReceiptHtml(transaction, store, options.rxFooter)
}

function buildDefaultReceiptHtml(
  transaction: TransactionWithItems,
  store: StoreInfo,
  rxFooterText?: string
): string {
  const dateStr = new Date(transaction.createdAt).toLocaleString()
  const lineItems = buildLineItemsHtml(transaction)
  const logo = buildLogoHtml(store)
  const licenseLine = store.licenseNumber
    ? `<div class="center">License #${escapeHtml(store.licenseNumber)}</div>`
    : ''
  const faxLine = store.fax ? `<div class="center">Fax: ${escapeHtml(store.fax)}</div>` : ''
  const emailLine = store.email ? `<div class="footer">Email: ${escapeHtml(store.email)}</div>` : ''
  const rxFooter = rxFooterText ? `<div class="footer rx">${escapeHtml(rxFooterText)}</div>` : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Courier New', monospace; font-size: 12px; width: 280px; margin: 0 auto; color: #111; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #333; margin: 8px 0; }
    .logo img { max-width: 200px; max-height: 100px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; vertical-align: top; }
    td.qty { text-align: center; width: 30px; }
    td.price { text-align: right; width: 70px; }
    .discount-row td { font-size: 10px; color: #444; padding-left: 8px; }
    .totals td { padding: 2px 0; }
    .totals .label { text-align: right; padding-right: 8px; }
    .totals .value { text-align: right; width: 70px; }
    .grand-total { font-size: 14px; font-weight: bold; }
    .footer { margin-top: 12px; font-size: 11px; text-align: center; }
    .rx { font-size: 10px; color: #444; margin-top: 8px; }
  </style>
</head>
<body>
  ${logo}
  <div class="center bold">${escapeHtml(store.name)}</div>
  <div class="center">${escapeHtml(store.address)}</div>
  <div class="center">Phone: ${escapeHtml(store.phone)}</div>
  ${faxLine}
  ${licenseLine}
  <div class="divider"></div>
  <div>Receipt: #${escapeHtml(transaction.receiptNumber)}</div>
  <div>Date: ${escapeHtml(dateStr)}</div>
  ${buildTenderLinesHtml(transaction)}
  <div class="divider"></div>
  <table>
    ${lineItems}
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td class="label">Subtotal:</td><td class="value">${formatCurrency(transaction.subtotalCents)}</td></tr>
    ${transaction.billDiscountCents ? `<tr><td class="label">Bill Discount:</td><td class="value">-${formatCurrency(transaction.billDiscountCents)}</td></tr>` : ''}
    <tr><td class="label">Tax:</td><td class="value">${formatCurrency(transaction.taxCents)}</td></tr>
    <tr class="grand-total"><td class="label">TOTAL:</td><td class="value">${formatCurrency(transaction.totalCents)}</td></tr>
    <tr><td class="label">Tendered:</td><td class="value">${formatCurrency(transaction.tenderedCents)}</td></tr>
    <tr><td class="label">Change Due:</td><td class="value">${formatCurrency(transaction.changeCents)}</td></tr>
  </table>
  <div class="divider"></div>
  <div class="footer">Thank you for choosing ${escapeHtml(store.name)}!</div>
  ${emailLine}
  ${rxFooter}
</body>
</html>`
}

/** Tokens available to manager-uploaded custom receipt templates, as `{{token}}`. */
export const RECEIPT_TEMPLATE_TOKENS = [
  'storeName',
  'storeAddress',
  'storePhone',
  'storeFax',
  'storeLicense',
  'storeEmail',
  'logo',
  'receiptNumber',
  'date',
  'tenderType',
  'tenders',
  'items',
  'subtotal',
  'billDiscount',
  'tax',
  'total',
  'tendered',
  'change',
  'footer'
] as const

function buildCustomReceiptHtml(
  transaction: TransactionWithItems,
  store: StoreInfo,
  rxFooterText?: string
): string {
  const dateStr = new Date(transaction.createdAt).toLocaleString()
  const tokens: Record<(typeof RECEIPT_TEMPLATE_TOKENS)[number], string> = {
    storeName: escapeHtml(store.name),
    storeAddress: escapeHtml(store.address),
    storePhone: escapeHtml(store.phone),
    storeFax: store.fax ? escapeHtml(store.fax) : '',
    storeLicense: store.licenseNumber ? escapeHtml(store.licenseNumber) : '',
    storeEmail: store.email ? escapeHtml(store.email) : '',
    logo: buildLogoHtml(store),
    receiptNumber: escapeHtml(transaction.receiptNumber),
    date: escapeHtml(dateStr),
    tenderType: escapeHtml(transaction.tenderType),
    tenders: buildTenderLinesText(transaction),
    items: buildLineItemsHtml(transaction),
    subtotal: formatCurrency(transaction.subtotalCents),
    billDiscount: transaction.billDiscountCents
      ? formatCurrency(transaction.billDiscountCents)
      : '',
    tax: formatCurrency(transaction.taxCents),
    total: formatCurrency(transaction.totalCents),
    tendered: formatCurrency(transaction.tenderedCents),
    change: formatCurrency(transaction.changeCents),
    footer: rxFooterText ? escapeHtml(rxFooterText) : ''
  }

  return (store.customReceiptTemplateHtml ?? '').replace(
    /{{\s*(\w+)\s*}}/g,
    (match, key: string) =>
      Object.prototype.hasOwnProperty.call(tokens, key)
        ? tokens[key as (typeof RECEIPT_TEMPLATE_TOKENS)[number]]
        : match
  )
}
