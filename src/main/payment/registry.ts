import type { PaymentProviderName, PaymentInteractionMode } from '../../shared/types'
import type { PaymentProvider } from './PaymentProvider'
import { ManualTerminalAdapter } from './providers/ManualTerminalAdapter'
import { MockAdapter } from './providers/MockAdapter'
import { StripeTerminalAdapter } from './providers/StripeTerminalAdapter'
import { SquareTerminalAdapter } from './providers/SquareTerminalAdapter'
import { CloverAdapter } from './providers/CloverAdapter'
import { MonerisAdapter } from './providers/MonerisAdapter'
import { GlobalPaymentsAdapter } from './providers/GlobalPaymentsAdapter'

/**
 * The provider registry/factory — the literal mechanism behind "just pick a
 * processor and go". It maps a settings value to a concrete adapter. Checkout
 * never calls this directly; it only ever sees the generic PaymentProvider.
 */
export function createPaymentProvider(name: PaymentProviderName): PaymentProvider {
  switch (name) {
    case 'manual':
      return new ManualTerminalAdapter()
    case 'mock':
      return new MockAdapter()
    case 'stripe':
      return new StripeTerminalAdapter()
    case 'square':
      return new SquareTerminalAdapter()
    case 'clover':
      return new CloverAdapter()
    case 'moneris':
      return new MonerisAdapter()
    case 'globalpayments':
      return new GlobalPaymentsAdapter()
    default: {
      // Exhaustiveness guard — a new provider name must add a case above.
      const unreachable: never = name
      throw new Error(`Unknown payment provider: ${String(unreachable)}`)
    }
  }
}

/**
 * The drive-mode for a provider, without instantiating it. Kept here (single
 * source of truth) so the renderer never hardcodes "which providers are manual".
 */
export function providerInteractionMode(name: PaymentProviderName): PaymentInteractionMode {
  return name === 'manual' ? 'manual' : 'automatic'
}

/** Providers that are fully implemented and selectable in the setup wizard. */
export const IMPLEMENTED_PROVIDERS: PaymentProviderName[] = [
  'manual',
  'stripe',
  'square',
  'clover',
  'moneris',
  'globalpayments',
  'mock'
]
