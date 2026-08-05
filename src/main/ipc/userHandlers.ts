import { ipcMain } from 'electron'
import { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type { AuthUser, LoginResult, UserRole, VerifyManagerResult } from '../../shared/types'
import {
  countUsers,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  verifyLogin,
  verifyManagerCredentials
} from '../db/queries/userQueries'
import { clearSession, getSession, requireManager, setSession } from '../auth/session'
import { log } from '../logging/logger'

/** Wrap a handler so thrown errors come back to the renderer as { error }. */
async function guard<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Operation failed' }
  }
}

export function registerUserHandlers(db: PrismaClient): void {
  ipcMain.handle(
    IPC.AUTH_CHECK_FIRST_BOOT,
    async (): Promise<boolean> => (await countUsers(db)) === 0
  )

  ipcMain.handle(IPC.AUTH_GET_CURRENT_USER, (): AuthUser | null => {
    const s = getSession()
    return s
      ? { id: s.userId, fullName: s.fullName, role: s.role, lastLogin: null, createdAt: '' }
      : null
  })

  ipcMain.handle(
    IPC.AUTH_LOGIN,
    async (
      _e,
      { fullName, password }: { fullName: string; password: string }
    ): Promise<LoginResult> => {
      const user = await verifyLogin(db, fullName, password)
      if (!user) {
        log('LOGIN_FAILED', { fullName })
        return { error: 'Invalid full name or password.' }
      }
      setSession({ userId: user.id, fullName: user.fullName, role: user.role })
      log('LOGIN', { userId: user.id, fullName: user.fullName, role: user.role })
      return { user }
    }
  )

  ipcMain.handle(IPC.AUTH_LOGOUT, (): void => clearSession())

  // Re-authenticate a manager for a privileged in-checkout action (refunds) —
  // intentionally does NOT call setSession, so the signed-in cashier's session
  // is untouched. See verifyManagerCredentials for the role enforcement.
  ipcMain.handle(
    IPC.AUTH_VERIFY_MANAGER,
    async (
      _e,
      { fullName, password }: { fullName: string; password: string }
    ): Promise<VerifyManagerResult> => {
      const user = await verifyManagerCredentials(db, fullName, password)
      if (!user) return { error: 'Invalid name or password, or the account is not a Manager.' }
      return { user }
    }
  )

  // First-boot setup: only allowed when zero users exist. Always creates a MANAGER.
  ipcMain.handle(
    IPC.AUTH_SETUP_FIRST_MANAGER,
    async (
      _e,
      { fullName, password }: { fullName: string; password: string }
    ): Promise<LoginResult> => {
      return guard(async () => {
        if ((await countUsers(db)) !== 0) throw new Error('Setup has already been completed.')
        const user = await createUser(db, { fullName, password, role: 'MANAGER' })
        setSession({ userId: user.id, fullName: user.fullName, role: user.role })
        return { user }
      }) as Promise<LoginResult>
    }
  )

  // --- Manager-only user management (enforced server-side) ---
  ipcMain.handle(IPC.USER_LIST, async () =>
    guard(async () => {
      requireManager()
      return listUsers(db)
    })
  )

  ipcMain.handle(
    IPC.USER_CREATE,
    async (_e, input: { fullName: string; password: string; role: UserRole }) =>
      guard(async () => {
        requireManager()
        return createUser(db, input)
      })
  )

  ipcMain.handle(
    IPC.USER_UPDATE,
    async (
      _e,
      { userId, role, password }: { userId: number; role?: UserRole; password?: string }
    ) =>
      guard(async () => {
        const session = requireManager()
        return updateUser(db, userId, { role, password }, session.userId)
      })
  )

  ipcMain.handle(IPC.USER_DELETE, async (_e, userId: number) =>
    guard(async () => {
      const session = requireManager()
      await deleteUser(db, userId, session.userId)
      return { ok: true }
    })
  )
}
