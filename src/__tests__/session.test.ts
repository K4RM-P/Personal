import { describe, expect, it, afterEach } from 'vitest'
import { clearSession, getSession, requireManager, setSession } from '../main/auth/session'

describe('session RBAC guard', () => {
  afterEach(() => clearSession())

  it('throws when no session is active', () => {
    expect(getSession()).toBeNull()
    expect(() => requireManager()).toThrow("You don't have permission to access this feature")
  })

  it('throws when the active session is a cashier', () => {
    setSession({ userId: 1, fullName: 'Cashier One', role: 'CASHIER' })
    expect(() => requireManager()).toThrow("You don't have permission to access this feature")
  })

  it('returns the session when the active session is a manager', () => {
    setSession({ userId: 2, fullName: 'Manager One', role: 'MANAGER' })
    expect(requireManager().role).toBe('MANAGER')
  })
})
