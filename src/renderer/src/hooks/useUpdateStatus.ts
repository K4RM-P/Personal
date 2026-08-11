import * as React from 'react'
import type { UpdateStatus } from '../../../shared/types'

/**
 * Subscribes to live update-status events *before* fetching the current snapshot, and
 * ignores the snapshot if a live event has already arrived by the time it resolves.
 * Getting this order backwards (fetch-then-subscribe) is a real race: an event pushed
 * while the initial getStatus() call is still in flight would get silently overwritten
 * by that call's late-resolving (now stale) result.
 */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = React.useState<UpdateStatus>({ state: 'idle' })

  React.useEffect(() => {
    let liveEventReceived = false

    const unsubscribe = window.api.update.onStatusChanged((next) => {
      liveEventReceived = true
      setStatus(next)
    })

    window.api.update
      .getStatus()
      .then((initial) => {
        if (!liveEventReceived) setStatus(initial)
      })
      .catch(() => undefined)

    return unsubscribe
  }, [])

  return status
}
