import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { useCurrentUser } from '../context/CurrentUserContext'

export function SetupWizard(): React.JSX.Element {
  const { setUser } = useCurrentUser()
  const [fullName, setFullName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!fullName.trim()) return setError('Full name is required.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setBusy(true)
    try {
      const result = await window.api.auth.setupFirstManager(fullName.trim(), password)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setUser(result.user)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--background)]">
      <Card className="w-[420px] space-y-4 p-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-[var(--foreground)]">Welcome to PharmaPOS</h1>
          <p className="text-xs text-[var(--muted-foreground)]">Create the first Manager account to get started.</p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Full name</label>
            <input
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Password (min 8 characters)</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-10 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {showPassword ? <EyeOff className="icon-4" /> : <Eye className="icon-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Confirm password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create Manager & Continue'}
          </button>
        </form>
      </Card>
    </div>
  )
}
