import type { PrismaClient } from '@prisma/client'
import type { AuthUser, UserRole } from '../../../shared/types'
import { hashPassword, verifyPassword } from '../../auth/password'

const ROLES: UserRole[] = ['MANAGER', 'CASHIER']

function toAuthUser(row: {
  id: number
  fullName: string
  role: string
  lastLogin: Date | null
  createdAt: Date
}): AuthUser {
  return {
    id: row.id,
    fullName: row.fullName,
    role: row.role as UserRole,
    lastLogin: row.lastLogin ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt.toISOString()
  }
}

export async function countUsers(db: PrismaClient): Promise<number> {
  return db.user.count()
}

export async function countManagers(db: PrismaClient): Promise<number> {
  return db.user.count({ where: { role: 'MANAGER' } })
}

export async function listUsers(db: PrismaClient): Promise<AuthUser[]> {
  const rows = await db.user.findMany({ orderBy: [{ fullName: 'asc' }] })
  return rows.map(toAuthUser)
}

export async function createUser(
  db: PrismaClient,
  input: { fullName: string; password: string; role: UserRole }
): Promise<AuthUser> {
  const fullName = input.fullName.trim()
  if (!fullName) throw new Error('Full name is required.')
  if (!ROLES.includes(input.role)) throw new Error('A valid role must be selected.')
  if (input.password.length < 8) throw new Error('Password must be at least 8 characters.')

  // The very first user must be a manager — you cannot create a cashier-only system.
  const role: UserRole = (await countUsers(db)) === 0 ? 'MANAGER' : input.role

  const existing = await db.user.findUnique({ where: { fullName } })
  if (existing) throw new Error(`A user named "${fullName}" already exists.`)

  const passwordHash = await hashPassword(input.password)
  const row = await db.user.create({ data: { fullName, passwordHash, role } })
  return toAuthUser(row)
}

export async function updateUser(
  db: PrismaClient,
  userId: number,
  input: { role?: UserRole; password?: string },
  currentUserId?: number
): Promise<AuthUser> {
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) throw new Error('User not found.')

  const data: { role?: string; passwordHash?: string } = {}

  if (input.role && input.role !== target.role) {
    if (!ROLES.includes(input.role)) throw new Error('A valid role must be selected.')
    // Never allow the system to drop to zero managers.
    if (target.role === 'MANAGER' && input.role === 'CASHIER') {
      if (userId === currentUserId) throw new Error('You cannot demote yourself from Manager.')
      if ((await countManagers(db)) <= 1) throw new Error('At least one Manager must remain.')
    }
    data.role = input.role
  }

  if (input.password !== undefined && input.password !== '') {
    if (input.password.length < 8) throw new Error('Password must be at least 8 characters.')
    data.passwordHash = await hashPassword(input.password)
  }

  const row = await db.user.update({ where: { id: userId }, data })
  return toAuthUser(row)
}

export async function deleteUser(db: PrismaClient, userId: number, currentUserId?: number): Promise<void> {
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) throw new Error('User not found.')
  if (userId === currentUserId) throw new Error('You cannot delete the account you are signed in with.')
  if (target.role === 'MANAGER' && (await countManagers(db)) <= 1) {
    throw new Error('At least one Manager must remain.')
  }
  // Audit trail (sales, voids, customers) references users by id only, with no
  // FK cascade, so deleting a user leaves their historical records intact.
  await db.user.delete({ where: { id: userId } })
}

/**
 * Verify credentials. Returns the safe user shape on success, null on failure.
 * Updates lastLogin on success. Never returns the password hash.
 */
export async function verifyLogin(
  db: PrismaClient,
  fullName: string,
  password: string
): Promise<AuthUser | null> {
  const row = await db.user.findUnique({ where: { fullName: fullName.trim() } })
  if (!row) return null
  const ok = await verifyPassword(password, row.passwordHash)
  if (!ok) return null
  const updated = await db.user.update({ where: { id: row.id }, data: { lastLogin: new Date() } })
  return toAuthUser(updated)
}
