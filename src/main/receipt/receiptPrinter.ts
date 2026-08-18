import { app, BrowserWindow } from 'electron'
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import * as net from 'net'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { formatCurrency } from '../../shared/formatCurrency'
import { PrintReceiptOptions, PrintReceiptResult, PrinterConfig, SystemPrinterInfo } from '../../shared/types'
import { buildReceiptHtml, DEFAULT_STORE_INFO } from './receiptTemplate'

/** Zebra 203dpi label printers (ZD421 included) address content in dots at ~8 dots/mm. */
const ZPL_DOTS_PER_MM = 8
const ZPL_DEFAULT_LABEL_WIDTH_MM = 85
const ZPL_DEFAULT_LABEL_HEIGHT_MM = 105
const ZPL_DEFAULT_TOP_MARGIN_MM = 10
const ZPL_SIDE_MARGIN_MM = 4
const ZPL_BOTTOM_MARGIN_MM = 6

function zplEscape(text: string): string {
  // ZPL uses ^ ~ and \ as control characters inside ^FD field data.
  return text.replace(/\\/g, '\\\\').replace(/\^/g, '\\5E').replace(/~/g, '\\7E')
}

interface ZplLabelConfig {
  widthMm: number
  heightMm: number
  topMarginMm: number
}

/**
 * Accumulates ZPL across one or more physical labels, starting a new label
 * (`^XA` ... `^XZ`) whenever the next line would overflow the usable height —
 * used for die-cut label stock where a variable-length receipt must span
 * multiple fixed-size labels rather than one continuous strip.
 */
class ZplLabelWriter {
  private readonly widthDots: number
  private readonly heightDots: number
  private readonly topMarginDots: number
  private readonly bottomMarginDots: number
  private readonly leftDots: number
  private readonly contentWidthDots: number
  private pages: string[] = []
  private current = ''
  private y = 0
  private pageCount = 0
  private onNewPage: (() => void) | null = null

  constructor(config: ZplLabelConfig) {
    this.widthDots = Math.round(config.widthMm * ZPL_DOTS_PER_MM)
    this.heightDots = Math.round(config.heightMm * ZPL_DOTS_PER_MM)
    this.topMarginDots = Math.round(config.topMarginMm * ZPL_DOTS_PER_MM)
    this.bottomMarginDots = Math.round(ZPL_BOTTOM_MARGIN_MM * ZPL_DOTS_PER_MM)
    this.leftDots = Math.round(ZPL_SIDE_MARGIN_MM * ZPL_DOTS_PER_MM)
    this.contentWidthDots = this.widthDots - this.leftDots * 2
    this.startPage()
  }

  private startPage(): void {
    this.pageCount += 1
    this.current = `^XA\n^PW${this.widthDots}\n^LL${this.heightDots}\n`
    this.y = this.topMarginDots
  }

  private get usableBottom(): number {
    return this.heightDots - this.bottomMarginDots
  }

  /**
   * Registers the callback that writes a continuation-label header (store name,
   * receipt #) — invoked automatically every time content overflows onto a new
   * physical label, regardless of which helper triggered the overflow.
   */
  setOnNewPage(fn: () => void): void {
    this.onNewPage = fn
  }

  /** Ensures `heightNeeded` more dots are available on the current label, starting a new one if not. */
  ensureSpace(heightNeeded: number): void {
    if (this.y + heightNeeded > this.usableBottom) {
      this.current += '^XZ\n'
      this.pages.push(this.current)
      this.startPage()
      if (this.onNewPage) this.onNewPage()
    }
  }

  /** Left-aligned text field at the current y, then advances y by lineHeight. */
  text(value: string, opts: { fontHeight?: number; fontWidth?: number; bold?: boolean } = {}): void {
    const h = opts.fontHeight ?? 22
    const w = opts.fontWidth ?? h
    this.ensureSpace(h + 6)
    this.current += `^FO${this.leftDots},${this.y}^A0N,${h},${w}^FD${zplEscape(value)}^FS\n`
    this.y += h + 6
  }

  /** A row of left name / right-justified value (item lines, totals) sharing one y position. */
  row(left: string, right: string, opts: { fontHeight?: number; bold?: boolean } = {}): void {
    const h = opts.fontHeight ?? 22
    this.ensureSpace(h + 6)
    const rightWidth = Math.round(this.contentWidthDots * 0.35)
    const leftWidth = this.contentWidthDots - rightWidth
    this.current += `^FO${this.leftDots},${this.y}^A0N,${h},${h}^FB${leftWidth},1,0,L,0^FD${zplEscape(left)}^FS\n`
    this.current += `^FO${this.leftDots + leftWidth},${this.y}^A0N,${h},${h}^FB${rightWidth},1,0,R,0^FD${zplEscape(right)}^FS\n`
    this.y += h + 6
  }

  /** A horizontal rule across the content width. */
  divider(): void {
    this.ensureSpace(14)
    this.current += `^FO${this.leftDots},${this.y}^GB${this.contentWidthDots},1,2^FS\n`
    this.y += 14
  }

  gap(dots = 10): void {
    this.y += dots
  }

  finish(): Uint8Array {
    this.current += '^XZ\n'
    this.pages.push(this.current)
    return new TextEncoder().encode(this.pages.join(''))
  }

  get labelCount(): number {
    return this.pageCount
  }
}

/**
 * Builds ZPL for a receipt printed on fixed-size die-cut labels (e.g. a Zebra ZD421),
 * as opposed to continuous ESC/POS roll paper. Content starts `topMarginMm` down on
 * every label to clear pre-printed stock (a logo, etc.), and a receipt that doesn't
 * fit on one label continues onto additional labels with a short "(cont'd)" header.
 */
export function buildZplReceiptBuffer(options: PrintReceiptOptions): Uint8Array {
  const { transaction } = options
  const store = options.storeInfo || DEFAULT_STORE_INFO
  const config = options.printerConfig

  const labelConfig: ZplLabelConfig = {
    widthMm: config?.labelWidthMm || ZPL_DEFAULT_LABEL_WIDTH_MM,
    heightMm: config?.labelHeightMm || ZPL_DEFAULT_LABEL_HEIGHT_MM,
    topMarginMm: config?.topMarginMm ?? ZPL_DEFAULT_TOP_MARGIN_MM
  }

  const writer = new ZplLabelWriter(labelConfig)

  const writeHeader = (continuation: boolean): void => {
    writer.text(continuation ? `${store.name} (cont'd)` : store.name, { fontHeight: 26 })
    if (!continuation) {
      writer.text(store.address, { fontHeight: 18 })
      writer.text(store.phone, { fontHeight: 18 })
    }
    writer.divider()
    writer.text(`Receipt: #${transaction.receiptNumber}`, { fontHeight: 18 })
    if (!continuation) {
      writer.text(`Date: ${new Date(transaction.createdAt).toLocaleString()}`, { fontHeight: 18 })
      writer.text(`Type: ${transaction.tenderType}`, { fontHeight: 18 })
    }
    writer.divider()
  }

  writer.setOnNewPage(() => writeHeader(true))
  writeHeader(false)

  transaction.items.forEach((item) => {
    const displayName = item.lineType === 'DEBT_SETTLEMENT' ? 'Previous Balance' : (item.product?.name ?? '(item)')
    writer.ensureSpace(28)
    writer.row(displayName, `x${item.quantity}  ${formatCurrency(item.totalCents)}`, { fontHeight: 20 })
  })

  writer.divider()
  writer.row('Subtotal', formatCurrency(transaction.subtotalCents), { fontHeight: 20 })
  writer.row('Tax', formatCurrency(transaction.taxCents), { fontHeight: 20 })
  writer.row('TOTAL', formatCurrency(transaction.totalCents), { fontHeight: 26, bold: true })
  writer.row('Tendered', formatCurrency(transaction.tenderedCents), { fontHeight: 18 })
  writer.row('Change Due', formatCurrency(transaction.changeCents), { fontHeight: 18 })
  writer.divider()
  writer.text('Thank you for choosing VantisPOS!', { fontHeight: 18 })

  if (options.rxFooter) {
    writer.divider()
    writer.text(options.rxFooter, { fontHeight: 18 })
  }

  return writer.finish()
}

/** Picks the byte-encoder for a NETWORK printer based on its configured command language. */
export function buildNetworkReceiptBuffer(options: PrintReceiptOptions): Uint8Array {
  return options.printerConfig?.language === 'zpl' ? buildZplReceiptBuffer(options) : buildEscPosReceiptBuffer(options)
}

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
  const buffer = buildNetworkReceiptBuffer(options)
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
export async function testNetworkPrinter(
  ipAddress: string,
  port = 9100,
  config?: Pick<PrinterConfig, 'language' | 'labelWidthMm' | 'labelHeightMm' | 'topMarginMm'>
): Promise<{ ok: boolean; message: string }> {
  let testBuffer: Uint8Array
  if (config?.language === 'zpl') {
    const writer = new ZplLabelWriter({
      widthMm: config.labelWidthMm || ZPL_DEFAULT_LABEL_WIDTH_MM,
      heightMm: config.labelHeightMm || ZPL_DEFAULT_LABEL_HEIGHT_MM,
      topMarginMm: config.topMarginMm ?? ZPL_DEFAULT_TOP_MARGIN_MM
    })
    writer.text('VantisPOS Printer Test OK', { fontHeight: 24 })
    testBuffer = writer.finish()
  } else {
    const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', width: 32 })
    testBuffer = encoder.initialize().line('VantisPOS Printer Test OK').newline().cut().encode()
  }

  try {
    await printToNetworkSocket(testBuffer, ipAddress, port, 3000)
    return { ok: true, message: `Printer at ${ipAddress}:${port} responded successfully.` }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: msg }
  }
}
