import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import type { UpdateStatus } from '../../../shared/types'
import { useUpdateStatus } from '../hooks/useUpdateStatus'

const stateLabel: Record<UpdateStatus['state'], string> = {
  idle: 'Up to date',
  checking: 'Checking for updates…',
  available: 'Update found — downloading…',
  downloading: 'Downloading update…',
  ready: 'Update downloaded — will install on next restart',
  error: 'Last check failed — will retry automatically'
}

/** Manual "Check for Updates" control (spec §3.4) for a client who wants to force a check. */
export function UpdateSettingsCard(): React.JSX.Element {
  const status = useUpdateStatus()
  const [checking, setChecking] = React.useState(false)

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await window.api.update.checkNow()
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Updates</CardTitle>
        <CardDescription>
          Updates are checked automatically in the background and install the next time the app
          restarts — never mid-sale.
        </CardDescription>
      </CardHeader>
      <div className="mt-4 flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
        <div>
          <p className="font-semibold text-[var(--foreground)]">{stateLabel[status.state]}</p>
          {status.version && (
            <p className="text-[var(--muted-foreground)]">Version {status.version}</p>
          )}
        </div>
        <button
          onClick={() => void handleCheck()}
          disabled={checking}
          className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--border)] disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Check for Updates'}
        </button>
      </div>
    </Card>
  )
}
