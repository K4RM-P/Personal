import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Alert } from '../components/ui/Alert'
import { useCurrentUser } from '../context/CurrentUserContext'

export function LoginScreen(): React.JSX.Element {
  const { login } = useCurrentUser()
  const [fullName, setFullName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
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
      <Card className="w-[380px] space-y-4 p-8 shadow-lg">
        <div className="text-center">
          <div className="mx-auto mb-3 flex icon-9 items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] text-lg font-bold text-[var(--primary-foreground)]">
            Rx
          </div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">PharmaPOS</h1>
          <p className="text-xs text-[var(--muted-foreground)]">Sign in to continue</p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
              Full name
            </label>
            <input
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--foreground)]">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-inset"
              >
                {showPassword ? <EyeOff className="icon-4" /> : <Eye className="icon-4" />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={busy || !fullName.trim() || !password}
            className="btn-primary w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </Card>
    </div>
  )
}
