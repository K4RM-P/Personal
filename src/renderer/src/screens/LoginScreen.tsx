import * as React from 'react'
import { Card } from '../components/ui/Card'
import { useCurrentUser } from '../context/CurrentUserContext'

export function LoginScreen(): React.JSX.Element {
  const { login } = useCurrentUser()
  const [fullName, setFullName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const err = await login(fullName, password)
      if (err) setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--background)]">
      <Card className="w-[380px] space-y-4 p-8">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] text-lg font-bold text-[var(--primary-foreground)]">Rx</div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">PharmaPOS</h1>
          <p className="text-xs text-[var(--muted-foreground)]">Sign in to continue</p>
        </div>

        {error && (
          <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error)]">{error}</div>
        )}

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
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !fullName.trim() || !password}
            className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </Card>
    </div>
  )
}
