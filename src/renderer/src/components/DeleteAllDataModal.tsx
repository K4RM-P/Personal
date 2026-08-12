import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { ManagerAuthModal } from './ManagerAuthModal'
import type { AuthUser } from '@shared/types'

interface DeleteAllDataModalProps {
  onClose: () => void
}

type Step = 'auth' | 'code' | 'done'

/**
 * Danger-zone flow for the "DELETE ALL DATA" button at the bottom of Settings.
 * Always requires a fresh manager re-authentication (regardless of who is
 * currently signed in), then a confirmation code known only to whoever set it
 * up — the code is verified entirely server-side (see dangerZoneHandlers.ts)
 * and is never shown or hinted at anywhere in this UI.
 */
export function DeleteAllDataModal({ onClose }: DeleteAllDataModalProps): React.JSX.Element {
  const [step, setStep] = React.useState<Step>('auth')
  const [manager, setManager] = React.useState<AuthUser | null>(null)
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const handleAuthSuccess = (verifiedManager: AuthUser): void => {
    setManager(verifiedManager)
    setStep('code')
  }

  const handleConfirm = async (): Promise<void> => {
    if (!code) {
      setError('Enter the confirmation code.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.api.dangerZone.deleteAllData(code)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete data.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestart = async (): Promise<void> => {
    await window.api.backup.relaunch()
  }

  if (step === 'auth') {
    return (
      <ManagerAuthModal
        description="Re-authenticate as a manager to continue to DELETE ALL DATA."
        onCancel={onClose}
        onSuccess={handleAuthSuccess}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[440px] border-[var(--error)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-start gap-2">
          <ShieldAlert className="icon-5 mt-0.5 shrink-0 text-[var(--error)]" aria-hidden="true" />
          <div>
            <CardTitle className="text-[var(--error)]">
              {step === 'done' ? 'All Data Deleted' : 'Delete All Data'}
            </CardTitle>
            {step === 'code' && (
              <CardDescription>
                Verified as {manager?.fullName}. This permanently erases every product, customer,
                transaction, and setting — there is no undo. Enter the confirmation code to
                proceed.
              </CardDescription>
            )}
            {step === 'done' && (
              <CardDescription>
                The store has been fully reset. Restart the app to return to first-time setup.
              </CardDescription>
            )}
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {step === 'code' && (
          <>
            <Alert variant="error">
              This action is irreversible. Everything will be permanently deleted.
            </Alert>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">
                Confirmation code
              </label>
              <input
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleConfirm()
                }}
                className="input"
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={onClose}
                disabled={submitting}
                className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirm()}
                disabled={submitting}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--error)] px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? 'Deleting…' : 'DELETE ALL DATA'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <button
            onClick={() => void handleRestart()}
            className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--error)] px-3 text-sm font-semibold text-white"
          >
            Restart Now
          </button>
        )}
      </Card>
    </div>
  )
}
