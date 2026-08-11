import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCustomerDisplaySlides,
  saveCustomerDisplaySlides,
  deleteCustomerDisplaySlide,
  getCustomerDisplaySettings,
  saveCustomerDisplaySettings
} from '../main/db/queries/customerDisplayQueries'

// Customer-facing display: slide CRUD + settings persistence.
describe('customerDisplayQueries', () => {
  let db: PrismaClient
  let workDir: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'custdisp-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })
    db = new PrismaClient({ datasources: { db: { url } } })
  }, 120_000)

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.customerDisplaySlide.deleteMany()
    await db.setting.deleteMany({ where: { key: { startsWith: 'customerDisplay.' } } })
  })

  it('returns empty slide list by default', async () => {
    expect(await getCustomerDisplaySlides(db)).toEqual([])
  })

  it('saves slides in array order and assigns sortOrder', async () => {
    const saved = await saveCustomerDisplaySlides(db, [
      { text: 'FREE DELIVERY' },
      { text: 'CHEAP PRICES' }
    ])
    expect(saved.map((s) => s.text)).toEqual(['FREE DELIVERY', 'CHEAP PRICES'])
    expect(saved[0].sortOrder).toBe(0)
    expect(saved[1].sortOrder).toBe(1)
    expect((await getCustomerDisplaySlides(db)).map((s) => s.text)).toEqual([
      'FREE DELIVERY',
      'CHEAP PRICES'
    ])
  })

  it('deletes a slide', async () => {
    const [a] = await saveCustomerDisplaySlides(db, [{ text: 'A' }])
    await deleteCustomerDisplaySlide(db, a.id)
    expect(await getCustomerDisplaySlides(db)).toEqual([])
  })

  it('rejects slide text over the character limit', async () => {
    await expect(saveCustomerDisplaySlides(db, [{ text: 'x'.repeat(61) }])).rejects.toThrow()
  })

  it('rejects empty slide text', async () => {
    await expect(saveCustomerDisplaySlides(db, [{ text: '' }])).rejects.toThrow()
  })

  it('leaves existing slides untouched when a save is rejected', async () => {
    await saveCustomerDisplaySlides(db, [{ text: 'KEEP ME' }])
    await expect(saveCustomerDisplaySlides(db, [{ text: 'x'.repeat(61) }])).rejects.toThrow()
    expect((await getCustomerDisplaySlides(db)).map((s) => s.text)).toEqual(['KEEP ME'])
  })

  it('returns default settings including pharmacy name from store settings', async () => {
    const settings = await getCustomerDisplaySettings(db)
    expect(settings.enabled).toBe(true)
    expect(settings.slideDurationSeconds).toBe(8)
    expect(settings.eTransferEmail).toBe('')
    expect(typeof settings.pharmacyName).toBe('string')
    expect(settings.pharmacyName.length).toBeGreaterThan(0)
  })

  it('saves settings and reads them back', async () => {
    await saveCustomerDisplaySettings(db, {
      enabled: false,
      slideDurationSeconds: 12,
      eTransferEmail: 'payments@example.com'
    })
    const settings = await getCustomerDisplaySettings(db)
    expect(settings.enabled).toBe(false)
    expect(settings.slideDurationSeconds).toBe(12)
    expect(settings.eTransferEmail).toBe('payments@example.com')
  })
})
