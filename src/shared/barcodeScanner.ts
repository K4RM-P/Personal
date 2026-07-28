/** Max ms between consecutive characters to qualify as a scanner (not human typing). */
export const SCAN_CHAR_INTERVAL_MS = 50

/** Minimum barcode length to accept a scan. */
export const MIN_BARCODE_LENGTH = 3

export type BarcodeKeyResult =
  | { type: 'char' }
  | { type: 'reset' }
  | { type: 'scan'; barcode: string }

/**
 * Stateful buffer for keyboard-wedge barcode detection.
 * Scanners emit characters rapidly (<50ms apart) followed by Enter.
 */
export class BarcodeScanBuffer {
  private buffer = ''
  private lastCharTime = 0

  processKey(key: string, timestamp = Date.now()): BarcodeKeyResult {
    if (key === 'Enter') {
      const barcode = this.buffer.trim()
      this.reset()
      if (barcode.length >= MIN_BARCODE_LENGTH) {
        return { type: 'scan', barcode }
      }
      return { type: 'reset' }
    }

    if (key.length !== 1) {
      return { type: 'char' }
    }

    if (this.lastCharTime > 0 && timestamp - this.lastCharTime > SCAN_CHAR_INTERVAL_MS) {
      this.buffer = ''
    }

    this.buffer += key
    this.lastCharTime = timestamp
    return { type: 'char' }
  }

  reset(): void {
    this.buffer = ''
    this.lastCharTime = 0
  }
}
