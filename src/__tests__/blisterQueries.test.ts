import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCustomer } from '../main/db/queries/customerQueries'
import {
  createBlisterPack,
  dispenseBlisterPack,
  getPendingBlisterPackForCustomer,
  listBlisterPacks
} from '../main/db/queries/blisterQueries'

describe('blisterQueries', () => {
  let prisma: PrismaClient
  let workDir: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'blister-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })
    prisma = new PrismaClient({ datasources: { db: { url } } })
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  async function makeCustomer(suffix: string) {
    return createCustomer(prisma, {
      firstName: 'Patient',
      lastName: suffix,
      phone: '5550000000',
      address: '1 Main St'
    })
  }

  it('computes prepDate as dueDate - 7 days on create', async () => {
    const customer = await makeCustomer('Prep')
    const pack = await createBlisterPack(prisma, {
      customerId: customer.id,
      frequency: 'WEEKLY',
      dueDate: new Date('2026-09-10T00:00:00Z'),
      numPrescriptions: 3,
      preparedBy: 'KP'
    })
    expect(pack.dueDate.toISOString().slice(0, 10)).toBe('2026-09-10')
    expect(pack.prepDate.toISOString().slice(0, 10)).toBe('2026-09-03')
    expect(pack.pickupDate).toBeNull()
  })

  it('picks the pending record with the soonest due date for a customer', async () => {
    const customer = await makeCustomer('Soonest')
    await createBlisterPack(prisma, {
      customerId: customer.id,
      frequency: 'MONTHLY',
      dueDate: new Date('2026-10-01T00:00:00Z'),
      numPrescriptions: 1,
      preparedBy: 'AB'
    })
    const soon = await createBlisterPack(prisma, {
      customerId: customer.id,
      frequency: 'WEEKLY',
      dueDate: new Date('2026-09-15T00:00:00Z'),
      numPrescriptions: 2,
      preparedBy: 'CD'
    })
    const found = await getPendingBlisterPackForCustomer(prisma, customer.id)
    expect(found?.id).toBe(soon.id)
  })

  it.each([
    ['WEEKLY', 7],
    ['BIWEEKLY', 14],
    ['MONTHLY', 28]
  ] as const)(
    'dispense: %s frequency schedules next due date +%d days, prep = due - 7',
    async (frequency, days) => {
      const customer = await makeCustomer(`Dispense-${frequency}`)
      const pack = await createBlisterPack(prisma, {
        customerId: customer.id,
        frequency,
        dueDate: new Date('2026-09-01T00:00:00Z'),
        numPrescriptions: 5,
        preparedBy: ''
      })

      const { dispensed, next } = await dispenseBlisterPack(prisma, pack.id, 'ZZ')

      expect(dispensed.pickupDate).not.toBeNull()
      expect(dispensed.preparedBy).toBe('ZZ')

      const expectedDue = new Date(dispensed.pickupDate!)
      expectedDue.setDate(expectedDue.getDate() + days)
      const expectedPrep = new Date(expectedDue)
      expectedPrep.setDate(expectedPrep.getDate() - 7)

      expect(next.dueDate.toISOString().slice(0, 10)).toBe(
        expectedDue.toISOString().slice(0, 10)
      )
      expect(next.prepDate.toISOString().slice(0, 10)).toBe(
        expectedPrep.toISOString().slice(0, 10)
      )
      expect(next.pickupDate).toBeNull()
      expect(next.numPrescriptions).toBe(5)
      expect(next.preparedBy).toBe('')
    }
  )

  it('rejects dispensing an already-picked-up record', async () => {
    const customer = await makeCustomer('AlreadyPicked')
    const pack = await createBlisterPack(prisma, {
      customerId: customer.id,
      frequency: 'WEEKLY',
      dueDate: new Date('2026-09-05T00:00:00Z'),
      numPrescriptions: 1,
      preparedBy: ''
    })
    await dispenseBlisterPack(prisma, pack.id, 'AA')
    await expect(dispenseBlisterPack(prisma, pack.id, 'BB')).rejects.toThrow(
      /already been picked up/
    )
  })

  it('filters by each date field via listBlisterPacks', async () => {
    const customer = await makeCustomer('DateFilter')
    await createBlisterPack(prisma, {
      customerId: customer.id,
      frequency: 'WEEKLY',
      dueDate: new Date('2026-11-01T00:00:00Z'),
      numPrescriptions: 1,
      preparedBy: 'KP'
    })

    const byDue = await listBlisterPacks(prisma, {
      dateField: 'due',
      fromDate: new Date('2026-10-30T00:00:00Z'),
      toDate: new Date('2026-11-02T00:00:00Z')
    })
    expect(byDue.some((p) => p.customerId === customer.id)).toBe(true)

    const byPrep = await listBlisterPacks(prisma, {
      dateField: 'prep',
      fromDate: new Date('2026-10-24T00:00:00Z'),
      toDate: new Date('2026-10-26T00:00:00Z')
    })
    expect(byPrep.some((p) => p.customerId === customer.id)).toBe(true)

    const outOfRange = await listBlisterPacks(prisma, {
      dateField: 'due',
      fromDate: new Date('2027-01-01T00:00:00Z'),
      toDate: new Date('2027-01-31T00:00:00Z')
    })
    expect(outOfRange.some((p) => p.customerId === customer.id)).toBe(false)
  })
})
