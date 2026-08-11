import * as React from 'react'
import { Lock } from 'lucide-react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import type { AuthUser } from '@shared/types'

interface ManagerAuthModalProps {
  description?: string
  onCancel: () => void
  onSuccess: (manager: AuthUser) => void
}

/**
 * Re-authentication gate for privileged in-checkout actions. Deliberately
 * separate from the signed-in session: a manager confirming here does not log
 * anyone in or out, so the cashier's till session is untouched either way.
 */
export function ManagerAuthModal({ description, onCancel, onSuccess }: ManagerAuthModalProps): React.JSX.Element {
  const [fullName, setFullName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const submit = async (): Promise<void> => {
    if (!fullName.trim() || !password) {
      setError('Enter both a full name and password.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.api.auth.verifyManager(fullName.trim(), password)
      if ('error' in result) {
        setError(result.error)
        return
      }
      onSuccess(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setSubmitting(false)
    }
  }

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitting, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-start gap-2">
          <Lock className="icon-5 mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          <div>
            <CardTitle className="text-[var(--foreground)]">Manager Authentication Required</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            className="input"
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Authenticate'}
          </button>
        </div>
      </Card>
    </div>
  )
}
