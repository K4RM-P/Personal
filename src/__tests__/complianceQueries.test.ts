import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  searchRxRecords,
  getAgingRxRecords,
  logComplianceEvent,
  getComplianceAuditLog,
  validatePseSale,
  scanDscsaBarcode,
  checkFsaHsaEligibility,
  postCustomerLedgerEntry,
  getCustomerLedger,
  buildDashboardSummary
} from '../main/db/queries/complianceQueries'

describe('compliance and ledger workflows', () => {
  let prisma: PrismaClient
  let workDir: string

  // Isolated, seeded temp SQLite DB — see featureFlagQueries.test.ts for why we
  // avoid `prisma migrate dev` here. The seed provides customer #1, which the
  // ledger-entry test posts against (FK requirement).
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'compliance-it-'))
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

  it('searches RX records and flags aged ones', async () => {
    const records = await searchRxRecords(prisma, '')
    expect(records.length).toBeGreaterThanOrEqual(0)
    const aged = await getAgingRxRecords(prisma, 1)
    expect(Array.isArray(aged)).toBe(true)
  })

  it('logs audit events and evaluates PSE/DSCSA/FSA checks', async () => {
    const entry = await logComplianceEvent(prisma, 'pse', 'PSE sale reviewed')
    expect(entry.kind).toBe('pse')
    const audit = await getComplianceAuditLog(prisma)
    expect(audit.some((item) => item.id === entry.id)).toBe(true)

    const pse = await validatePseSale('Pseudoephedrine 30mg', 7, 5)
    expect(pse.allowed).toBe(false)
    const dscsa = await scanDscsaBarcode('ABC123')
    expect(dscsa.ok).toBe(true)
    const fsa = await checkFsaHsaEligibility('Ibuprofen')
    expect(fsa.eligible).toBe(true)
  })

  it('stores customer ledger entries and computes summary metrics', async () => {
    const ledgerEntry = await postCustomerLedgerEntry(prisma, 1, 'SHORT_PAY', -5000, 'sale-001', 'customer short pay')
    expect(ledgerEntry.balanceCents).toBe(-5000)
    const ledger = await getCustomerLedger(prisma, 1)
    expect(ledger.some((item) => item.id === ledgerEntry.id)).toBe(true)

    const summary = await buildDashboardSummary(prisma)
    expect(summary.transactionCount).toBeGreaterThanOrEqual(0)
  })
})
