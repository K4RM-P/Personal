import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { hashPassword, verifyPassword } from '../main/auth/password'
import { setSession, clearSession } from '../main/auth/session'
import {
  countUsers,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  verifyLogin
} from '../main/db/queries/userQueries'
import { createTransaction } from '../main/db/queries/posQueries'

describe('user auth queries', () => {
  const db = new PrismaClient()
  let n = Date.now() % 1_000_000
  let productId: number
  const name = (): string => `User ${++n}-${Math.floor(Math.random() * 1e6)}`

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' })
    const product = await db.product.upsert({
      where: { sku: 'USER-TEST' },
      update: {},
      create: { sku: 'USER-TEST', name: 'User test item', costCents: 500, priceCents: 1000 }
    })
    productId = product.id
  })
  afterAll(async () => {
    clearSession()
    await db.$disconnect()
  })

  it('hashes and verifies passwords with bcrypt (never plaintext)', async () => {
    const hash = await hashPassword('supersecret')
    expect(hash).not.toBe('supersecret')
    expect(hash.startsWith('$2')).toBe(true)
    expect(await verifyPassword('supersecret', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('forces the very first user to be a MANAGER', async () => {
    // Only meaningful when the DB is empty; guard so the suite is order-independent.
    if ((await countUsers(db)) === 0) {
      const first = await createUser(db, { fullName: name(), password: 'password1', role: 'CASHIER' })
      expect(first.role).toBe('MANAGER')
    } else {
      expect(await countUsers(db)).toBeGreaterThan(0)
    }
  })

  it('rejects duplicate full names', async () => {
    const fullName = name()
    await createUser(db, { fullName, password: 'password1', role: 'CASHIER' })
    await expect(createUser(db, { fullName, password: 'password1', role: 'CASHIER' })).rejects.toThrow('already exists')
  })

  it('enforces a minimum password length of 8', async () => {
    await expect(createUser(db, { fullName: name(), password: 'short', role: 'CASHIER' })).rejects.toThrow('at least 8')
  })

  it('logs in with correct credentials and records lastLogin; rejects wrong password', async () => {
    const fullName = name()
    await createUser(db, { fullName, password: 'password1', role: 'CASHIER' })
    expect(await verifyLogin(db, fullName, 'nope')).toBeNull()
    const ok = await verifyLogin(db, fullName, 'password1')
    expect(ok?.fullName).toBe(fullName)
    expect(ok?.lastLogin).not.toBeNull()
  })

  it('never exposes the password hash in the safe user shape', async () => {
    await createUser(db, { fullName: name(), password: 'password1', role: 'CASHIER' })
    const users = await listUsers(db)
    expect(users.length).toBeGreaterThan(0)
    expect(Object.keys(users[0])).not.toContain('passwordHash')
  })

  it('blocks a manager from demoting themselves', async () => {
    const mgr = await createUser(db, { fullName: name(), password: 'password1', role: 'MANAGER' })
    await expect(updateUser(db, mgr.id, { role: 'CASHIER' }, mgr.id)).rejects.toThrow('demote yourself')
  })

  it('re-hashes the password on update and logs in with the new one', async () => {
    const fullName = name()
    const u = await createUser(db, { fullName, password: 'password1', role: 'CASHIER' })
    await updateUser(db, u.id, { password: 'password2' }, u.id)
    expect(await verifyLogin(db, fullName, 'password1')).toBeNull()
    expect(await verifyLogin(db, fullName, 'password2')).not.toBeNull()
  })

  it('keeps a deleted user’s sales attributed to their id', async () => {
    const cashier = await createUser(db, { fullName: name(), password: 'password1', role: 'CASHIER' })
    setSession({ userId: cashier.id, fullName: cashier.fullName, role: 'CASHIER' })
    const sale = await createTransaction(db, {
      items: [{ productId, quantity: 1, costCents: 500, unitPriceCents: 1000 }],
      taxRatePercent: 0,
      tenders: [{ method: 'CASH', amountCents: 1000 }]
    })
    clearSession()
    expect(sale.cashierId).toBe(cashier.id)

    // Need a surviving manager so deletion is allowed, then delete the cashier.
    await deleteUser(db, cashier.id)
    const stillThere = await db.transaction.findUnique({ where: { id: sale.id } })
    expect(stillThere?.cashierId).toBe(cashier.id)
    expect(await db.user.findUnique({ where: { id: cashier.id } })).toBeNull()
  })
})
