import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { getAllFeatureFlags, upsertFeatureFlag } from '../main/db/queries/featureFlagQueries'

describe('Feature Flag Pure Queries (Bypass Electron)', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    // Run migration on SQLite dev DB for testing query functions
    execSync('npx prisma migrate dev --name init', { stdio: 'ignore' })
    prisma = new PrismaClient()
  })

  afterAll(async () => {
    await prisma.$disconnect()
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
