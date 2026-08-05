import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import type { RestorableBackup } from '@shared/types'

type Step = 'pick' | 'listing' | 'select' | 'confirm' | 'restoring' | 'done' | 'error'

interface RestoreBackupModalProps {
  onClose: () => void
}

/**
 * A9 — minimal in-app restore flow: browse to a backup folder, list the
 * `PHARMACY_POS_BACKUP_*` subfolders found there, confirm, and stage the
 * restore. The actual database swap happens on the next app start (see
 * applyPendingRestoreIfStaged), so this always ends in a required restart.
 */
export function RestoreBackupModal({ onClose }: RestoreBackupModalProps): React.JSX.Element {
  const [step, setStep] = React.useState<Step>('pick')
  const [drivePath, setDrivePath] = React.useState<string | null>(null)
  const [backups, setBackups] = React.useState<RestorableBackup[]>([])
  const [selected, setSelected] = React.useState<RestorableBackup | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const browse = async (): Promise<void> => {
    try {
      const path = await window.api.backup.pickFolder()
      if (!path) return
      setDrivePath(path)
      setStep('listing')
      const found = await window.api.backup.listRestorable(path)
      setBackups(found)
      setStep('select')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan that folder for backups.')
      setStep('error')
    }
  }

  const confirmRestore = async (): Promise<void> => {
    if (!selected) return
    setStep('restoring')
    setError(null)
    try {
      await window.api.backup.restore(selected.backupDir)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed for an unknown reason.')
      setStep('error')
    }
  }

  const restartNow = async (): Promise<void> => {
    await window.api.backup.relaunch()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[560px] border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
        {step === 'pick' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Restore from Backup</CardTitle>
            <Alert variant="pending">
              This replaces the current database with a backup. Anything entered since that backup
              was taken will be lost. Choose the drive or folder holding the backup to restore from.
            </Alert>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void browse()}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
              >
                Browse for Backup…
              </button>
            </div>
          </>
        )}

        {step === 'listing' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Restore from Backup</CardTitle>
            <Alert variant="pending">Scanning {drivePath} for backups…</Alert>
          </>
        )}

        {step === 'select' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Restore from Backup</CardTitle>
            {backups.length === 0 ? (
              <CardDescription>No valid backups found in {drivePath}.</CardDescription>
            ) : (
              <CardDescription>
                Found {backups.length} backup(s) — most recent first:
              </CardDescription>
            )}
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {backups.map((b) => (
                <label
                  key={b.backupDir}
                  className="flex min-h-11 cursor-pointer flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] px-3 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="restore-backup"
                      checked={selected?.backupDir === b.backupDir}
                      onChange={() => setSelected(b)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="flex-1 font-medium">
                      {new Date(b.timestamp).toLocaleString()}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">v{b.posVersion}</span>
                  </div>
                  <span className="pl-7 text-xs text-[var(--muted-foreground)]">
                    {b.dataSnapshot.salesCount ?? 0} sales · {b.dataSnapshot.customersCount ?? 0}{' '}
                    customers
                  </span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!selected}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && selected && (
          <>
            <CardTitle className="text-[var(--foreground)]">Confirm Restore</CardTitle>
            <Alert variant="error">
              This will permanently replace all current data — sales, customers, credit balances,
              everything — with the backup from {new Date(selected.timestamp).toLocaleString()}.
              This cannot be undone from within the app. The application will restart.
            </Alert>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setStep('select')}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
              >
                Go Back
              </button>
              <button
                onClick={() => void confirmRestore()}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--error)] px-3 text-sm font-semibold text-white"
              >
                Restore & Restart
              </button>
            </div>
          </>
        )}

        {step === 'restoring' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Restoring…</CardTitle>
            <Alert variant="pending">Verifying and staging the backup. Do not close the app.</Alert>
          </>
        )}

        {step === 'done' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Backup Staged</CardTitle>
            <Alert variant="success">
              The backup has been verified and staged. Restart the application now to complete the
              restore.
            </Alert>
            <button
              onClick={() => void restartNow()}
              className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
            >
              Restart Now
            </button>
          </>
        )}

        {step === 'error' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Restore Failed</CardTitle>
            <Alert variant="error">{error}</Alert>
            <button
              onClick={onClose}
              className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
            >
              Close
            </button>
          </>
        )}
      </Card>
    </div>
  )
}
