import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Switch } from './ui/Switch'
import { useCurrentUser } from '../context/CurrentUserContext'
import type { DriveBackupStatus } from '../../../shared/types'

const INTERVAL_OPTIONS = [6, 12, 24, 48]

/** Manager-only card: connect a Google account once, then Drive backups run
 * automatically on logout and on a schedule — see docs/superpowers/specs/
 * 2026-08-19-google-drive-backup-design.md. */
export function GoogleDriveBackupCard(): React.JSX.Element {
  const { user } = useCurrentUser()
  const [status, setStatus] = React.useState<DriveBackupStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    setStatus(await window.api.backup.drive.getStatus())
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleConnect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.backup.drive.connect()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.backup.drive.disconnect()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleToggleAuto = async (enabled: boolean): Promise<void> => {
    if (!status) return
    await window.api.backup.drive.saveSettings({
      autoBackupEnabled: enabled,
      intervalHours: status.intervalHours
    })
    await refresh()
  }

  const handleIntervalChange = async (hours: number): Promise<void> => {
    if (!status) return
    await window.api.backup.drive.saveSettings({
      autoBackupEnabled: status.autoBackupEnabled,
      intervalHours: hours
    })
    await refresh()
  }

  const handleBackupNow = async (): Promise<void> => {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await window.api.backup.drive.runNow({ initiatedByUserId: user.id })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Drive Backup</CardTitle>
        <CardDescription>
          Connect a Google account once — backups then upload to Drive automatically on logout and
          on a schedule, no further action needed.
        </CardDescription>
      </CardHeader>

      <div className="space-y-3 mt-4 text-sm">
        {error && (
          <div className="rounded-[var(--radius)] border border-[var(--error)] bg-[var(--error-bg)] p-3 text-[var(--error)]">
            {error}
          </div>
        )}

        {!status ? (
          <p className="text-[var(--muted-foreground)]">Loading…</p>
        ) : !status.connected ? (
          <button
            onClick={() => void handleConnect()}
            disabled={busy}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            Connect Google Drive
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-[var(--foreground)]">
              Connected as <span className="font-medium">{status.email}</span>
            </p>

            <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">
                  Auto-backup to Google Drive
                </p>
                <p className="text-[var(--muted-foreground)]">
                  Runs silently on logout and on the schedule below.
                </p>
              </div>
              <Switch
                checked={status.autoBackupEnabled}
                onCheckedChange={(v) => void handleToggleAuto(v)}
              />
            </div>

            {status.autoBackupEnabled && (
              <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                <span className="text-[var(--foreground)]">Back up every</span>
                <select
                  value={status.intervalHours}
                  onChange={(e) => void handleIntervalChange(Number(e.target.value))}
                  className="input"
                >
                  {INTERVAL_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {h} hours
                    </option>
                  ))}
                </select>
              </div>
            )}

            {status.lastBackup && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Last Drive backup: {new Date(status.lastBackup.timestamp).toLocaleString()} (
                {status.lastBackup.status === 'SUCCESS' ? 'succeeded' : 'failed'})
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleBackupNow()}
                disabled={busy}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50"
              >
                Back Up Now
              </button>
              <button
                onClick={() => void handleDisconnect()}
                disabled={busy}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--error)] px-4 text-sm text-[var(--error)] hover:bg-[var(--error-bg)] disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
