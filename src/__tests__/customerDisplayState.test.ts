import { describe, it, expect } from 'vitest'
import {
  computeFitFontSize,
  FIT_MAX_PX,
  FIT_MIN_PX
} from '../renderer/src/customerDisplay/useFitText'
import {
  buildCustomerDisplayState,
  type CheckoutDisplayInput
} from '../renderer/src/lib/customerDisplayState'

/**
 * A stand-in for DOM text measurement: assumes a fixed container width and a
 * fixed average glyph aspect ratio, so `computeFitFontSize` can be exercised
 * as the pure algorithm it is (spec §2.4 — sizing must be computed, never a
 * per-length lookup table).
 */
function fakeMeasurer(text: string, containerWidthPx: number) {
  const AVG_GLYPH_WIDTH_RATIO = 0.55
  return (fontSizePx: number): { heightPx: number } => {
    const textWidth = text.length * fontSizePx * AVG_GLYPH_WIDTH_RATIO
    const lines = Math.max(1, Math.ceil(textWidth / containerWidthPx))
    return { heightPx: lines * fontSizePx * 1.15 }
  }
}

/**
 * A word-aware stand-in, unlike `fakeMeasurer` above: wraps only at spaces —
 * exactly like the real measurer with word-breaking disabled — and reports
 * the widest line's width via widthPx so a word wider than the container is
 * visible to computeFitFontSize instead of silently accepted.
 */
function wordWrapMeasurer(text: string, containerWidthPx: number) {
  const AVG_GLYPH_WIDTH_RATIO = 0.55
  const words = text.split(' ')
  return (fontSizePx: number): { heightPx: number; widthPx: number } => {
    const wordWidth = (w: string): number => w.length * fontSizePx * AVG_GLYPH_WIDTH_RATIO
    let lineWidth = 0
    let lines = 1
    let widestLine = 0
    for (const word of words) {
      const w = wordWidth(word)
      const withSpace = lineWidth > 0 ? w + fontSizePx * AVG_GLYPH_WIDTH_RATIO : w
      if (lineWidth > 0 && lineWidth + withSpace > containerWidthPx) {
        widestLine = Math.max(widestLine, lineWidth)
        lines += 1
        lineWidth = w
      } else {
        lineWidth += withSpace
      }
      widestLine = Math.max(widestLine, lineWidth, w)
    }
    return { heightPx: lines * fontSizePx * 1.15, widthPx: widestLine }
  }
}

describe('computeFitFontSize', () => {
  it('uses the maximum size for text that already fits', () => {
    const size = computeFitFontSize(fakeMeasurer('HI', 1600), 800)
    expect(size).toBe(FIT_MAX_PX)
  })

  it('shrinks longer text below the maximum', () => {
    const short = computeFitFontSize(fakeMeasurer('SALE!', 1600), 800)
    const long = computeFitFontSize(
      fakeMeasurer('ASK US ABOUT FREE PRESCRIPTION DELIVERY TODAY', 1600),
      800
    )
    expect(long).toBeLessThan(short)
    expect(long).toBeGreaterThanOrEqual(FIT_MIN_PX)
  })

  it('never returns a size below the floor, even for the longest allowed slide', () => {
    const size = computeFitFontSize(fakeMeasurer('X'.repeat(60), 600), 200)
    expect(size).toBeGreaterThanOrEqual(FIT_MIN_PX)
  })

  it('respects the two-line cap', () => {
    const measure = fakeMeasurer('FREE DELIVERY ON EVERY PRESCRIPTION ORDER', 1600)
    const size = computeFitFontSize(measure, 100_000) // height is never the constraint
    const { heightPx } = measure(size)
    const lines = Math.round(heightPx / (size * 1.15))
    expect(lines).toBeLessThanOrEqual(2)
  })

  it('is genuinely computed, not bucketed: a wider container allows a larger size', () => {
    const text = 'ASK US ABOUT FREE PRESCRIPTION DELIVERY'
    const narrow = computeFitFontSize(fakeMeasurer(text, 800), 800)
    const wide = computeFitFontSize(fakeMeasurer(text, 2400), 800)
    expect(wide).toBeGreaterThan(narrow)
  })

  it('never chooses a size that leaves a word wider than the container (no word-breaking)', () => {
    // Regression: a naive height/line-count check alone can pick a size where
    // "PERSONALIZED" doesn't fit on its own line, which — with word-breaking
    // disabled — would render as a horizontal overflow instead of a clean
    // two-line wrap. The measurer here never breaks a word, so any accepted
    // size must leave every word within the container width.
    const measure = wordWrapMeasurer('PERSONALIZED SERVICE', 900)
    const size = computeFitFontSize(measure, 100_000, { availableWidthPx: 900 })
    const { widthPx } = measure(size)
    expect(widthPx).toBeLessThanOrEqual(900)
  })
})

const baseInput: CheckoutDisplayInput = {
  saleCompleted: false,
  pharmacyName: 'Main Street Pharmacy',
  pharmacyEmail: 'payments@mainstreet.example',
  paymentMethod: null,
  payModalOpen: false,
  lineItems: [{ name: 'Cough drops', qty: 2, lineTotalCents: 562, discountCents: 62 }],
  subtotalCents: 562,
  billDiscountCents: 0,
  taxCents: 73,
  totalCents: 635,
  tenderedCents: 0,
  changeCents: 0,
  customerBalanceCents: 0
}

describe('buildCustomerDisplayState', () => {
  it('is idle with an empty cart', () => {
    expect(buildCustomerDisplayState({ ...baseInput, lineItems: [] })).toEqual({ mode: 'idle' })
  })

  it('mirrors the cart once items are present', () => {
    const state = buildCustomerDisplayState(baseInput)
    expect(state).toEqual({
      mode: 'cart',
      lineItems: baseInput.lineItems,
      subtotalCents: 562,
      billDiscountCents: undefined,
      taxCents: 73,
      totalCents: 635
    })
  })

  it('includes a whole-bill discount only when one is applied', () => {
    const state = buildCustomerDisplayState({ ...baseInput, billDiscountCents: 100 })
    expect(state).toMatchObject({ mode: 'cart', billDiscountCents: 100 })
  })

  it('stays on the cart while the pay modal is closed even if a method lingers', () => {
    const state = buildCustomerDisplayState({ ...baseInput, paymentMethod: 'CASH' })
    expect(state.mode).toBe('cart')
  })

  it('shows live cash given and change', () => {
    const state = buildCustomerDisplayState({
      ...baseInput,
      payModalOpen: true,
      paymentMethod: 'CASH',
      tenderedCents: 1000,
      changeCents: 365
    })
    expect(state).toEqual({
      mode: 'payment-cash',
      totalCents: 635,
      cashGivenCents: 1000,
      changeCents: 365
    })
  })

  it('shows the surcharge-inclusive total on the card screen', () => {
    // totalCents is CheckoutScreen's `effectiveTotal`, which already includes
    // surchargeCents — the display must match what the terminal charges.
    const preSurchargeTotal = 635
    const surcharge = 12
    const state = buildCustomerDisplayState({
      ...baseInput,
      payModalOpen: true,
      paymentMethod: 'CARD',
      totalCents: preSurchargeTotal + surcharge
    })
    expect(state).toEqual({ mode: 'payment-card', totalCents: 647 })
  })

  it('shows the pharmacy receiving address on the e-transfer screen', () => {
    const state = buildCustomerDisplayState({
      ...baseInput,
      payModalOpen: true,
      paymentMethod: 'E_TRANSFER'
    })
    expect(state).toEqual({
      mode: 'payment-etransfer',
      totalCents: 635,
      pharmacyEmail: 'payments@mainstreet.example'
    })
  })

  it('computes the resulting tab balance, positive for remaining credit', () => {
    const state = buildCustomerDisplayState({
      ...baseInput,
      payModalOpen: true,
      paymentMethod: 'PHARMACY_CREDIT',
      customerBalanceCents: 1885
    })
    expect(state).toEqual({
      mode: 'payment-tab',
      totalCents: 635,
      chargedToTabCents: 635,
      balanceAfterCents: 1250
    })
  })

  it('computes a negative balance when the tab goes into what is owed', () => {
    const state = buildCustomerDisplayState({
      ...baseInput,
      payModalOpen: true,
      paymentMethod: 'PHARMACY_CREDIT',
      customerBalanceCents: -165
    })
    expect(state).toMatchObject({ balanceAfterCents: -800 })
  })

  it('shows thank-you as soon as the sale completes, overriding everything else', () => {
    const state = buildCustomerDisplayState({
      ...baseInput,
      saleCompleted: true,
      payModalOpen: true,
      paymentMethod: 'CASH'
    })
    expect(state).toEqual({ mode: 'thank-you', pharmacyName: 'Main Street Pharmacy' })
  })
})
