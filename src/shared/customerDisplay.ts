/**
 * Shared types for the customer-facing display (second screen).
 * Imported by both the main process and the two renderers — keep framework-agnostic.
 */

export interface CustomerDisplayLineItem {
  name: string
  qty: number
  lineTotalCents: number
  discountCents?: number
}

export type CustomerDisplayState =
  | { mode: 'idle' }
  | {
      mode: 'cart'
      lineItems: CustomerDisplayLineItem[]
      subtotalCents: number
      billDiscountCents?: number
      taxCents: number
      totalCents: number
    }
  | {
      mode: 'payment-cash'
      totalCents: number
      cashGivenCents: number
      changeCents: number
      depositedToCreditCents?: number
    }
  | { mode: 'payment-card'; totalCents: number }
  | { mode: 'payment-etransfer'; totalCents: number; pharmacyEmail: string }
  | {
      mode: 'payment-tab'
      totalCents: number
      chargedToTabCents: number
      balanceAfterCents: number
    }
  | { mode: 'thank-you'; pharmacyName: string }

export interface CustomerDisplaySlideDTO {
  id: number
  text: string
  sortOrder: number
}

export interface CustomerDisplaySettingsDTO {
  enabled: boolean
  slideDurationSeconds: number
  eTransferEmail: string
  pharmacyName: string
}

export const CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH = 60
