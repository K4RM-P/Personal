import * as React from 'react'
import type { AuthUser, UserRole } from '@shared/types'

interface CurrentUserContextValue {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  login: (fullName: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
}

const CurrentUserContext = React.createContext<CurrentUserContextValue | undefined>(undefined)

export function CurrentUserProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Session lives in context only — never localStorage — so closing the app
  // requires a fresh login (MVP, per spec non-negotiables).
  const [user, setUser] = React.useState<AuthUser | null>(null)

  const login = React.useCallback(async (fullName: string, password: string): Promise<string | null> => {
    const result = await window.api.auth.login(fullName, password)
    if ('error' in result) return result.error
    setUser(result.user)
    return null
  }, [])

  const logout = React.useCallback(async (): Promise<void> => {
    await window.api.auth.logout()
    setUser(null)
  }, [])

  const value = React.useMemo(() => ({ user, setUser, login, logout }), [user, login, logout])
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): CurrentUserContextValue {
  const ctx = React.useContext(CurrentUserContext)
  if (!ctx) throw new Error('useCurrentUser must be used within a CurrentUserProvider')
  return ctx
}

/** True when the logged-in user has the given role. */
export function useHasRole(role: UserRole): boolean {
  const { user } = useCurrentUser()
  return user?.role === role
}
