import React from 'react'
import type {
  CustomerDisplayState,
  CustomerDisplaySettingsDTO,
  CustomerDisplaySlideDTO
} from '../../../shared/customerDisplay'
import { IdleScreen } from './screens/IdleScreen'
import { CartScreen } from './screens/CartScreen'

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

  if (state.mode === 'cart') {
    return <CartScreen state={state} />
  }

  // Remaining modes are built in later tasks.
  return (
    <div style={{ fontFamily: 'monospace', padding: 24, whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(state, null, 2)}
    </div>
  )
}
