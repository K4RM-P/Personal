import React from 'react'
import type { CustomerDisplayState } from '../../../shared/customerDisplay'

export function CustomerDisplayApp(): React.JSX.Element {
  const [state, setState] = React.useState<CustomerDisplayState>({ mode: 'idle' })

  React.useEffect(() => {
    return window.customerDisplayApi.onUpdate(setState)
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(state, null, 2)}
    </div>
  )
}
