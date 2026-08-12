import { app, BrowserWindow } from 'electron'
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import * as net from 'net'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { formatCurrency } from '../../shared/formatCurrency'
import { PrintReceiptOptions, PrintReceiptResult, SystemPrinterInfo } from '../../shared/types'
import { buildReceiptHtml, DEFAULT_STORE_INFO } from './receiptTemplate'

/**
 * Builds ESC/POS binary data array using receipt-printer-encoder
 */
export function buildEscPosReceiptBuffer(options: PrintReceiptOptions): Uint8Array {
  const { transaction } = options
  const store = options.storeInfo || DEFAULT_STORE_INFO

  const encoder = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    width: 32
  })

  encoder
    .initialize()
    .align('center')
    .bold(true)
    .line(store.name)
    .bold(false)
    .line(store.address)
    .line(store.phone)
    .line('--------------------------------')
    .align('left')
    .line(`Receipt: #${transaction.receiptNumber}`)
    .line(`Date: ${new Date(transaction.createdAt).toLocaleString()}`)
    .line(`Type: ${transaction.tenderType}`)
    .line('--------------------------------')

  transaction.items.forEach((item) => {
    const displayName = item.lineType === 'DEBT_SETTLEMENT' ? 'Previous Balance' : (item.product?.name ?? '(item)')
    const itemName = displayName.slice(0, 20).padEnd(20)
    const qtyStr = `x${item.quantity}`.padStart(3)
    const priceStr = formatCurrency(item.totalCents).padStart(8)
    encoder.line(`${itemName}${qtyStr}${priceStr}`)
  })

  encoder
    .line('--------------------------------')
    .align('right')
    .line(`Subtotal: ${formatCurrency(transaction.subtotalCents)}`)
    .line(`Tax: ${formatCurrency(transaction.taxCents)}`)
    .bold(true)
    .line(`TOTAL: ${formatCurrency(transaction.totalCents)}`)
    .bold(false)
    .line(`Tendered: ${formatCurrency(transaction.tenderedCents)}`)
    .line(`Change Due: ${formatCurrency(transaction.changeCents)}`)
    .line('--------------------------------')
    .align('center')
    .line('Thank you for choosing VantisPOS!')
    .line('Please retain receipt for returns.')

  if (options.rxFooter) {
    encoder.line('--------------------------------').line(options.rxFooter)
  }

  encoder.newline().newline().cut()

  return encoder.encode()
}

/**
 * Sends binary ESC/POS buffer to Network Socket printer (Port 9100)
 */
export function printToNetworkSocket(
  buffer: Uint8Array,
  ipAddress: string,
  port = 9100,
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket()
    let handled = false

    client.setTimeout(timeoutMs)

    client.connect(port, ipAddress, () => {
      client.write(Buffer.from(buffer), () => {
        handled = true
        client.end()
        resolve()
      })
    })

    client.on('timeout', () => {
      if (!handled) {
        handled = true
        client.destroy()
        reject(new Error(`Network receipt printer socket timeout connecting to ${ipAddress}:${port}`))
      }
    })

    client.on('error', (err) => {
      if (!handled) {
        handled = true
        client.destroy()
        reject(err)
      }
    })
  })
}

async function loadHtmlInHiddenWindow(html: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return win
}

/**
 * Generates a PDF receipt file and returns its path + data URL for on-screen preview.
 */
export async function printToPdf(html: string, receiptNumber: string): Promise<{ pdfPath: string; pdfDataUrl: string }> {
  const win = await loadHtmlInHiddenWindow(html)
  try {
    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true })
    const pdfPath = join(app.getPath('temp'), `receipt-${receiptNumber}-${Date.now()}.pdf`)
    await writeFile(pdfPath, pdfBuffer)
    const pdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
    return { pdfPath, pdfDataUrl }
  } finally {
    win.close()
  }
}

/**
 * Lists installed OS printers so Settings can offer a picker instead of relying on the
 * system default.
 */
export async function listSystemPrinters(): Promise<SystemPrinterInfo[]> {
  const win = await loadHtmlInHiddenWindow('<html><body></body></html>')
  try {
    const printers = await win.webContents.getPrintersAsync()
    return printers.map((p) => ({ name: p.name, displayName: p.displayName }))
  } finally {
    win.close()
  }
}

/**
 * Sends receipt HTML to the configured OS printer (USB / Windows print queue). Always
 * silent — printing must never pop the native OS print dialog. When `deviceName` is set
 * (from Settings), it targets that specific printer; otherwise it falls back to the OS
 * default printer, still silently.
 */
export async function printToSystemPrinter(html: string, deviceName?: string): Promise<void> {
  const win = await loadHtmlInHiddenWindow(html)
  return new Promise((resolve, reject) => {
    win.webContents.print({ silent: true, ...(deviceName ? { deviceName } : {}) }, (success, failureReason) => {
      win.close()
      if (success) resolve()
      else reject(new Error(failureReason || 'System print failed'))
    })
  })
}

/**
 * High-level printer dispatcher: network thermal → system print queue → PDF fallback.
 */
export async function printReceipt(options: PrintReceiptOptions): Promise<PrintReceiptResult> {
  const html = buildReceiptHtml({
    transaction: options.transaction,
    storeInfo: options.storeInfo,
    rxFooter: options.rxFooter
  })
  const buffer = buildEscPosReceiptBuffer(options)
  const config = options.printerConfig
  const receiptNumber = options.transaction.receiptNumber

  if (config?.type === 'NETWORK' && config.ipAddress) {
    try {
      await printToNetworkSocket(buffer, config.ipAddress, config.port || 9100)
      return {
        success: true,
        message: `Receipt printed to network thermal printer at ${config.ipAddress}:${config.port || 9100}`
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('Network thermal print failed, falling back:', msg)
    }
  }

  if (config?.type === 'SYSTEM') {
    try {
      await printToSystemPrinter(html, config.deviceName)
      return {
        success: true,
        message: config.deviceName ? `Receipt printed to ${config.deviceName}.` : 'Receipt sent to system printer.'
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('System print failed, falling back to PDF:', msg)
    }
  }

  const { pdfPath, pdfDataUrl } = await printToPdf(html, receiptNumber)
  return {
    success: true,
    message: `Receipt saved as PDF (${pdfPath}). No thermal printer configured or reachable.`,
    pdfDataUrl,
    pdfPath
  }
}

/**
 * Test network printer connectivity by sending a minimal ESC/POS init + cut command.
 */
export async function testNetworkPrinter(ipAddress: string, port = 9100): Promise<{ ok: boolean; message: string }> {
  const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', width: 32 })
  const testBuffer = encoder.initialize().line('VantisPOS Printer Test OK').newline().cut().encode()

  try {
    await printToNetworkSocket(testBuffer, ipAddress, port, 3000)
    return { ok: true, message: `Printer at ${ipAddress}:${port} responded successfully.` }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: msg }
  }
}
