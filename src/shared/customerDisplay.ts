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

export type CustomerDisplaySlideType = 'TEXT' | 'IMAGE' | 'VIDEO'

export interface CustomerDisplaySlideDTO {
  id: number
  type: CustomerDisplaySlideType
  text: string
  imageDataUrl: string | null
  /** Relative path under userData/customerDisplayMedia — resolve to a playable URL with `mediaUrl()`. */
  videoFilePath: string | null
  /** Seconds this slide shows before advancing. Null = use the display's global default. */
  durationSeconds: number | null
  sortOrder: number
}

export interface CustomerDisplaySettingsDTO {
  enabled: boolean
  slideDurationSeconds: number
  eTransferEmail: string
  pharmacyName: string
}

export const CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH = 60

/** Custom protocol scheme the customer-display window uses to load slide video files from disk. */
export const CUSTOMER_DISPLAY_MEDIA_PROTOCOL = 'pos-media'

/** Builds the URL a `<video>` element loads to play a slide's video file. */
export function customerDisplayMediaUrl(videoFilePath: string): string {
  return `${CUSTOMER_DISPLAY_MEDIA_PROTOCOL}://slide/${encodeURIComponent(videoFilePath)}`
}
