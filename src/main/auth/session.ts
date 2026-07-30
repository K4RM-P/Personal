/**
 * Server-side session state for the single active user.
 *
 * The renderer holds the user in React context for UI gating, but the main
 * process keeps its own copy so sensitive IPC handlers can enforce role checks
 * that cannot be spoofed from the renderer. One user, one active session (MVP).
 */
export interface Session {
  userId: number
  fullName: string
  role: 'MANAGER' | 'CASHIER'
}

let current: Session | null = null

export function setSession(session: Session): void {
  current = session
}

export function clearSession(): void {
  current = null
}

export function getSession(): Session | null {
  return current
}

/** Throw unless a session exists with the MANAGER role. */
export function requireManager(): Session {
  if (!current) throw new Error("You don't have permission to access this feature")
  if (current.role !== 'MANAGER') throw new Error("You don't have permission to access this feature")
  return current
}
