import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[520px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        {step === 'scanning' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Backing Up Data…</CardTitle>
            <CardDescription>Scanning for external drives…</CardDescription>
          </>
        )}

        {step === 'select' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Backing Up Data…</CardTitle>
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
              {drives.map((drive) => (
                <label
                  key={drive.path}
                  className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  <input
                    type="radio"
                    name="backup-drive"
                    checked={selected?.path === drive.path}
                    onChange={() => setSelected({ path: drive.path, name: drive.name })}
                  />
                  <span className="flex-1">{drive.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}
                  </span>
                </label>
              ))}
              {selected && !drives.some((d) => d.path === selected.path) && (
                <label className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--primary)] px-3 py-2 text-sm text-[var(--foreground)]">
                  <input type="radio" checked readOnly />
                  <span className="flex-1">{selected.path}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">Custom location</span>
                </label>
              )}
            </div>

            <button
              onClick={() => void browse()}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              Browse…
            </button>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void runBackup()}
                disabled={!selected}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                Back Up to Selected
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Backing Up Data…</CardTitle>
            <CardDescription>
              Copying sales, customers, users, discounts, refunds, and inventory to {selected?.name}. This may take a
              moment.
            </CardDescription>
          </>
        )}

        {step === 'success' && result && (
          <>
            <CardTitle className="text-[var(--foreground)]">Backup Complete</CardTitle>
            <CardDescription>✓ Data backed up successfully</CardDescription>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--foreground)]">
              {result.backupDir}
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto text-sm text-[var(--foreground)]">
              {result.files.map((file) => (
                <div key={file.name} className="flex justify-between">
                  <span>• {file.name}</span>
                  <span className="text-[var(--muted-foreground)]">{formatBytes(file.sizeBytes)}</span>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
            >
              {standalone ? 'Close' : 'Logout'}
            </button>
          </>
        )}

        {step === 'error' && (
          <>
            <CardTitle className="text-[var(--foreground)]">Backup Failed</CardTitle>
            <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-sm text-[var(--error)]">
              Error: {error}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => void runBackup()}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                Retry
              </button>
              <button
                onClick={() => {
                  setStep('scanning')
                  void scanDrives()
                }}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                Choose Different Drive
              </button>
              <button
                onClick={onClose}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)]"
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
