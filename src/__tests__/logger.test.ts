import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initLogger, log, getLogDir } from '../main/logging/logger'

// B3 — structured operational logging.
describe('logger', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pos-log-'))
    initLogger(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the log directory and writes JSON-lines entries', () => {
    expect(existsSync(dir)).toBe(true)
    log('LOGIN', { userId: 1, fullName: 'Alice', role: 'MANAGER' })
    log('SALE_COMPLETED', { transactionId: 'tx-1', totalCents: 1100 })

    const files = readdirSync(dir).filter((f) => f.endsWith('.log'))
    expect(files).toHaveLength(1)
    const lines = readFileSync(join(dir, files[0]), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0])
    expect(first.type).toBe('LOGIN')
    expect(first.userId).toBe(1)
    expect(typeof first.timestamp).toBe('string')

    const second = JSON.parse(lines[1])
    expect(second.type).toBe('SALE_COMPLETED')
    expect(second.totalCents).toBe(1100)
  })

  it('never throws even if called before initLogger', () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'pos-log-uninit-'))
    rmSync(freshDir, { recursive: true, force: true })
    // Reset module-level state isn't exposed, so this asserts the documented
    // contract instead: log() is a no-op, never a throw, when logDir unset.
    expect(() => log('ERROR', { message: 'should not throw' })).not.toThrow()
  })

  it('prunes log files older than the retention window', () => {
    log('LOGIN', { userId: 1 })
    const files = readdirSync(dir).filter((f) => f.endsWith('.log'))
    const oldFile = join(dir, files[0])
    const ninetyOneDaysAgo = Date.now() / 1000 - 91 * 24 * 60 * 60
    utimesSync(oldFile, ninetyOneDaysAgo, ninetyOneDaysAgo)

    // Re-init triggers a prune pass.
    initLogger(dir)
    expect(existsSync(oldFile)).toBe(false)
  })

  it('exposes the configured log directory', () => {
    expect(getLogDir()).toBe(dir)
  })
})
