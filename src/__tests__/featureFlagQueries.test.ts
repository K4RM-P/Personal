import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAllFeatureFlags, upsertFeatureFlag } from '../main/db/queries/featureFlagQueries'

describe('Feature Flag Pure Queries (Bypass Electron)', () => {
  let prisma: PrismaClient
  let workDir: string

  // Use an isolated temp SQLite database seeded with defaults, instead of
  // `prisma migrate dev` (which is interactive, needs a shadow DB, and mutates
  // the developer's working database). `db push` builds the schema; the seed
  // script populates the feature flags this suite asserts on.
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'ff-it-'))
    const url = `file:${join(workDir, 'test.db')}`
    const env = { ...process.env, DATABASE_URL: url }
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe'
    })
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { cwd: process.cwd(), env, stdio: 'pipe' })
    prisma = new PrismaClient({ datasources: { db: { url } } })
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('retrieves all seeded feature flags', async () => {
    const flags = await getAllFeatureFlags(prisma)
    expect(flags.length).toBeGreaterThanOrEqual(3)
    const keys = flags.map((f) => f.key)
    expect(keys).toContain('otcMode')
    expect(keys).toContain('lowStockAlerts')
    expect(keys).toContain('customerLookup')
  })

  it('toggles a feature flag and persists to database', async () => {
    const flagsBefore = await getAllFeatureFlags(prisma)
    const otcFlagBefore = flagsBefore.find((f) => f.key === 'otcMode')
    const initialStatus = otcFlagBefore?.enabled ?? false

    const updated = await upsertFeatureFlag(prisma, 'otcMode', !initialStatus)
    expect(updated.enabled).toBe(!initialStatus)

    const flagsAfter = await getAllFeatureFlags(prisma)
    const otcFlagAfter = flagsAfter.find((f) => f.key === 'otcMode')
    expect(otcFlagAfter?.enabled).toBe(!initialStatus)

    // Revert state for idempotency
    await upsertFeatureFlag(prisma, 'otcMode', initialStatus)
  })
})
