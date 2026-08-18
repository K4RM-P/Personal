import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// customerDisplayQueries.ts pulls in slideMediaStore.ts (video file storage),
// which reads `app.getPath('userData')` — stub it to an isolated temp dir so
// tests never touch a real Electron userData path.
let mediaUserDataDir: string
vi.mock('electron', () => ({
  app: { getPath: () => mediaUserDataDir },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} }
}))

import {
  getCustomerDisplaySlides,
  saveCustomerDisplaySlides,
  deleteCustomerDisplaySlide,
  getCustomerDisplaySettings,
  saveCustomerDisplaySettings
} from '../main/db/queries/customerDisplayQueries'
import { storeSlideVideo } from '../main/customerDisplay/slideMediaStore'

// Customer-facing display: slide CRUD + settings persistence.
describe('customerDisplayQueries', () => {
  let db: PrismaClient
  let workDir: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'custdisp-it-'))
    mediaUserDataDir = workDir
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

  describe('video slides', () => {
    it('saves a video slide with its file path and a per-slide duration', async () => {
      const videoFilePath = await storeSlideVideo(Buffer.from('fake mp4 bytes'), '.mp4')
      const [saved] = await saveCustomerDisplaySlides(db, [
        { type: 'VIDEO', text: '', videoFilePath, durationSeconds: 15 }
      ])
      expect(saved.type).toBe('VIDEO')
      expect(saved.videoFilePath).toBe(videoFilePath)
      expect(saved.durationSeconds).toBe(15)
    })

    it('rejects a video slide with no uploaded video', async () => {
      await expect(
        saveCustomerDisplaySlides(db, [{ type: 'VIDEO', text: '', videoFilePath: null }])
      ).rejects.toThrow()
    })

    it('rejects a duration outside 1-300 seconds for any slide type', async () => {
      await expect(
        saveCustomerDisplaySlides(db, [{ text: 'HI', durationSeconds: 0 }])
      ).rejects.toThrow()
      await expect(
        saveCustomerDisplaySlides(db, [{ text: 'HI', durationSeconds: 301 }])
      ).rejects.toThrow()
    })

    it('allows a null per-slide duration (falls back to the global default)', async () => {
      const [saved] = await saveCustomerDisplaySlides(db, [{ text: 'HI', durationSeconds: null }])
      expect(saved.durationSeconds).toBeNull()
    })

    it('deletes the video file from disk when its slide is deleted', async () => {
      const videoFilePath = await storeSlideVideo(Buffer.from('fake mp4 bytes'), '.mp4')
      const filePath = join(mediaUserDataDir, 'customerDisplayMedia', videoFilePath)
      expect(existsSync(filePath)).toBe(true)

      const [saved] = await saveCustomerDisplaySlides(db, [
        { type: 'VIDEO', text: '', videoFilePath, durationSeconds: 10 }
      ])
      await deleteCustomerDisplaySlide(db, saved.id)

      expect(existsSync(filePath)).toBe(false)
    })

    it('deletes an orphaned video file when a slide save no longer references it, but keeps files still in use', async () => {
      const keptPath = await storeSlideVideo(Buffer.from('kept'), '.mp4')
      const droppedPath = await storeSlideVideo(Buffer.from('dropped'), '.mp4')
      const dir = join(mediaUserDataDir, 'customerDisplayMedia')

      await saveCustomerDisplaySlides(db, [
        { type: 'VIDEO', text: '', videoFilePath: keptPath, durationSeconds: 5 },
        { type: 'VIDEO', text: '', videoFilePath: droppedPath, durationSeconds: 5 }
      ])
      expect(existsSync(join(dir, keptPath))).toBe(true)
      expect(existsSync(join(dir, droppedPath))).toBe(true)

      // Re-save with only the first slide kept — the second's video is now orphaned.
      await saveCustomerDisplaySlides(db, [
        { type: 'VIDEO', text: '', videoFilePath: keptPath, durationSeconds: 5 }
      ])

      expect(existsSync(join(dir, keptPath))).toBe(true)
      expect(existsSync(join(dir, droppedPath))).toBe(false)
    })
  })
})
