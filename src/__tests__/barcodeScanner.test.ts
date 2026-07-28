import { describe, it, expect } from 'vitest'
import { BarcodeScanBuffer, SCAN_CHAR_INTERVAL_MS, MIN_BARCODE_LENGTH } from '../shared/barcodeScanner'

describe('BarcodeScanBuffer', () => {
  it('detects a fast scan ending in Enter', () => {
    const buffer = new BarcodeScanBuffer()
    let t = 1000

    for (const ch of '012345678901') {
      expect(buffer.processKey(ch, t)).toEqual({ type: 'char' })
      t += 10
    }

    expect(buffer.processKey('Enter', t)).toEqual({ type: 'scan', barcode: '012345678901' })
  })

  it('rejects slow human typing followed by Enter', () => {
    const buffer = new BarcodeScanBuffer()
    buffer.processKey('0', 1000)
    buffer.processKey('1', 1000 + SCAN_CHAR_INTERVAL_MS + 1)
    buffer.processKey('2', 1000 + SCAN_CHAR_INTERVAL_MS + 2)

    expect(buffer.processKey('Enter', 2000)).toEqual({ type: 'reset' })
  })

  it('rejects Enter with barcode shorter than minimum length', () => {
    const buffer = new BarcodeScanBuffer()
    buffer.processKey('1', 1000)
    buffer.processKey('2', 1010)

    expect(buffer.processKey('Enter', 1020)).toEqual({ type: 'reset' })
    expect(MIN_BARCODE_LENGTH).toBeGreaterThan(2)
  })

  it('resets buffer after a completed scan', () => {
    const buffer = new BarcodeScanBuffer()
    buffer.processKey('1', 1000)
    buffer.processKey('2', 1010)
    buffer.processKey('3', 1020)
    buffer.processKey('Enter', 1030)

    expect(buffer.processKey('Enter', 1040)).toEqual({ type: 'reset' })
  })
})
