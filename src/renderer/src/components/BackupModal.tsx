import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import type { BackupRunResult, ExternalDrive } from '@shared/types'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

type Step = 'scanning' | 'select' | 'running' | 'success' | 'error'

interface BackupModalProps {
  userId: number
  /** true when launched from Settings' "Manual Backup Now" — shows "Close" instead of "Logout" on success. */
  standalone?: boolean
  /** The manager's configured backup destination (Settings). When set, skips drive selection and backs up immediately. */
  presetDrive?: { path: string; name: string }
  onClose: () => void
}

export function BackupModal({ userId, standalone = false, presetDrive, onClose }: BackupModalProps): React.JSX.Element {
  const [step, setStep] = React.useState<Step>(presetDrive ? 'running' : 'scanning')
  const [drives, setDrives] = React.useState<ExternalDrive[]>([])
  const [selected, setSelected] = React.useState<{ path: string; name: string } | null>(presetDrive ?? null)
  const [result, setResult] = React.useState<BackupRunResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const scanDrives = React.useCallback(async () => {
    try {
      const found = await window.api.backup.getExternalDrives()
      setDrives(found)
      if (found.length === 1) setSelected({ path: found[0].path, name: found[0].name })
      setStep('select')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan for external drives.')
      setStep('error')
    }
  }, [])

  const browse = async (): Promise<void> => {
    try {
      const path = await window.api.backup.pickFolder()
      if (path) setSelected({ path, name: path.split('/').pop() || path })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker.')
      setStep('error')
    }
  }

  const runBackup = React.useCallback(
    async (destination?: { path: string; name: string }): Promise<void> => {
      const target = destination ?? selected
      if (!target) return
      setStep('running')
      setError(null)
      try {
        const backupResult = await window.api.backup.run(target.path, target.name, userId)
        setResult(backupResult)
        setStep('success')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Backup failed for an unknown reason.')
        setStep('error')
      }
    },
    [selected, userId]
  )

  React.useEffect(() => {
    if (presetDrive) {
      void runBackup(presetDrive)
    } else {
      void scanDrives()
    }
    // Only run once on mount — presetDrive/scanDrives/runBackup are stable for the modal's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only Escape-dismissable while a copy isn't actively in flight — closing mid-copy
  // could leave the destination in an inconsistent state.
  const closable = step === 'select' || step === 'error'
  React.useEffect(() => {
    if (!closable) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closable, onClose])

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card role="dialog" aria-modal="true" aria-labelledby="backup-modal-title" className="w-[520px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4 shadow-lg">
        {step === 'scanning' && (
          <>
            <CardTitle id="backup-modal-title" className="text-[var(--foreground)]">Backing Up Data…</CardTitle>
            <Alert variant="pending">Step 1 of 2 — Scanning for external drives…</Alert>
          </>
        )}

        {step === 'select' && (
          <>
            <CardTitle id="backup-modal-title" className="text-[var(--foreground)]">Backing Up Data…</CardTitle>
            {drives.length === 0 ? (
              <CardDescription>
                No external drives found. Use &quot;Browse…&quot; to choose a backup location manually.
              </CardDescription>
            ) : (
              <CardDescription>
                Found {drives.length} drive{drives.length > 1 ? 's' : ''}:
              </CardDescription>
            )}

            <div className="space-y-2">
              {drives.map((drive) => {
                const freePercent = drive.totalBytes > 0 ? Math.round((drive.freeBytes / drive.totalBytes) * 100) : 0
                return (
                  <label
                    key={drive.path}
                    className="flex min-h-11 cursor-pointer flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="backup-drive"
                        checked={selected?.path === drive.path}
                        onChange={() => setSelected({ path: drive.path, name: drive.name })}
                        className="icon-4 shrink-0"
                      />
                      <span className="flex-1 font-medium">{drive.name}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]" role="progressbar" aria-valuenow={freePercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${drive.name} free space`}>
                      <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-150" style={{ width: `${Math.min(100, Math.max(0, freePercent))}%` }} />
                    </div>
                  </label>
                )
              })}
              {selected && !drives.some((d) => d.path === selected.path) && (
                <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--primary)] px-3 py-3 text-sm text-[var(--foreground)]">
                  <input type="radio" checked readOnly className="icon-4 shrink-0" />
                  <span className="flex-1">{selected.path}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">Custom location</span>
                </label>
              )}
            </div>

            <button
              onClick={() => void browse()}
              className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              Browse…
            </button>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void runBackup()}
                disabled={!selected}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Back Up to Selected
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <>
            <CardTitle id="backup-modal-title" className="text-[var(--foreground)]">Backing Up Data…</CardTitle>
            <Alert variant="pending">
              Step 2 of 2 — Copying sales, customers, users, discounts, refunds, and inventory to {selected?.name}. This
              may take a moment.
            </Alert>
          </>
        )}

        {step === 'success' && result && (
          <>
            <CardTitle id="backup-modal-title" className="text-[var(--foreground)]">Backup Complete</CardTitle>
            <Alert variant="success">Data backed up successfully.</Alert>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--foreground)]">
              {result.backupDir}
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto text-sm text-[var(--foreground)]">
              {result.files.map((file) => (
                <div key={file.name} className="flex justify-between">
                  <span>• {file.name}</span>
                  <span className="text-[var(--muted-foreground)]">{formatBytes(file.sizeBytes)}</span>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              {standalone ? 'Close' : 'Logout'}
            </button>
          </>
        )}

        {step === 'error' && (
          <>
            <CardTitle id="backup-modal-title" className="text-[var(--foreground)]">Backup Failed</CardTitle>
            <Alert variant="error">{error}</Alert>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => void runBackup()}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Retry
              </button>
              <button
                onClick={() => {
                  setStep('scanning')
                  void scanDrives()
                }}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Different Drive
              </button>
              <button
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Skip Backup
              </button>
            </div>
            {!standalone && (
              <p className="text-center text-xs text-[var(--muted-foreground)]">
                You can manually back up data later from Settings.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
