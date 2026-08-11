import React from 'react'
import type {
  CustomerDisplayState,
  CustomerDisplaySettingsDTO,
  CustomerDisplaySlideDTO
} from '../../../shared/customerDisplay'
import { IdleScreen } from './screens/IdleScreen'
import { CartScreen } from './screens/CartScreen'
import { PaymentCashScreen } from './screens/PaymentCashScreen'
import { PaymentCardScreen } from './screens/PaymentCardScreen'
import { PaymentETransferScreen } from './screens/PaymentETransferScreen'
import { PaymentTabScreen } from './screens/PaymentTabScreen'

const DEFAULT_SETTINGS: CustomerDisplaySettingsDTO = {
  enabled: true,
  slideDurationSeconds: 8,
  eTransferEmail: '',
  pharmacyName: ''
}

export function CustomerDisplayApp(): React.JSX.Element {
  const [state, setState] = React.useState<CustomerDisplayState>({ mode: 'idle' })
  const [slides, setSlides] = React.useState<CustomerDisplaySlideDTO[]>([])
  const [settings, setSettings] = React.useState<CustomerDisplaySettingsDTO>(DEFAULT_SETTINGS)

  React.useEffect(() => {
    const api = window.customerDisplayApi
    if (!api) return
    const unsubscribers = [
      api.onUpdate(setState),
      api.onSlides(setSlides),
      api.onSettings(setSettings)
    ]
    void api
      .getSlides()
      .then(setSlides)
      .catch(() => undefined)
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => undefined)
    return () => unsubscribers.forEach((off) => off())
  }, [])

  if (state.mode === 'idle') {
    return (
      <IdleScreen
        slides={slides}
        pharmacyName={settings.pharmacyName}
        durationSeconds={settings.slideDurationSeconds}
      />
    )
  }

  switch (state.mode) {
    case 'cart':
      return <CartScreen state={state} />
    case 'payment-cash':
      return <PaymentCashScreen state={state} />
    case 'payment-card':
      return <PaymentCardScreen totalCents={state.totalCents} />
    case 'payment-etransfer':
      return (
        <PaymentETransferScreen
          totalCents={state.totalCents}
          pharmacyEmail={state.pharmacyEmail || settings.eTransferEmail}
        />
      )
    case 'payment-tab':
      return <PaymentTabScreen state={state} />
    default:
      // Unreachable: 'idle' is handled above and every other mode has a screen.
      return (
        <IdleScreen
          slides={slides}
          pharmacyName={settings.pharmacyName}
          durationSeconds={settings.slideDurationSeconds}
        />
      )
  }
}
