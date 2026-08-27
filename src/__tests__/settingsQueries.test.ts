import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getIdleTimeoutMinutes, saveIdleTimeoutMinutes } from '../main/db/queries/settingsQueries'

// A15 — auto-logout idle timeout setting.
describe('settingsQueries — idle timeout (A15)', () => {
  let prisma: PrismaClient
  let workDir: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'settings-it-'))
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

  it('defaults to 0 (disabled) when never configured', async () => {
    expect(await getIdleTimeoutMinutes(prisma)).toBe(0)
  })

  it('saves and reads back a configured value', async () => {
    await saveIdleTimeoutMinutes(prisma, 30)
    expect(await getIdleTimeoutMinutes(prisma)).toBe(30)
  })

  it('accepts 0 to disable idle logout', async () => {
    await saveIdleTimeoutMinutes(prisma, 0)
    expect(await getIdleTimeoutMinutes(prisma)).toBe(0)
  })

  it('rejects an out-of-range value', async () => {
    await expect(saveIdleTimeoutMinutes(prisma, -1)).rejects.toThrow(
      /0 \(disabled\) or between 1 and 240/
    )
    await expect(saveIdleTimeoutMinutes(prisma, 241)).rejects.toThrow(
      /0 \(disabled\) or between 1 and 240/
    )
    await expect(saveIdleTimeoutMinutes(prisma, Number.NaN)).rejects.toThrow(
      /0 \(disabled\) or between 1 and 240/
    )
  })
})
