import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RunReportCsvExportResult } from '../../shared/reportCsvExport'
import { buildCompleteProductSalesCsv } from '../../shared/completeProductSalesCsv'
import {
  getReportCsvExportSettings,
  recordReportCsvExportSent
} from '../db/queries/settingsQueries'
import { getCompleteProductSales } from '../db/queries/reportQueries'
import { resolvePeriod } from './reportPeriod'

/** Runs one export using whatever settings are currently saved — shared by the
 *  scheduler and the manual "Export Now" button so they never drift apart. */
export async function runReportCsvExportNow(db: PrismaClient): Promise<RunReportCsvExportResult> {
  const settings = await getReportCsvExportSettings(db)
  if (!settings.folderPath.trim()) {
    return { ok: false, message: 'No destination folder is configured.' }
  }

  const now = new Date()
  const { fromDate, toDate } = resolvePeriod(settings.interval, now)

  try {
    const rows = await getCompleteProductSales(db, fromDate, toDate)
    const csv = buildCompleteProductSalesCsv(rows, { fromDate, toDate, generatedAt: now })

    mkdirSync(settings.folderPath, { recursive: true })
    const fileName = `complete-products-sales-${fromDate}-to-${toDate}.csv`
    const filePath = join(settings.folderPath, fileName)
    writeFileSync(filePath, csv, 'utf-8')

    await recordReportCsvExportSent(db, now)
    return { ok: true, message: `Exported ${rows.length} row(s) to ${filePath}.`, filePath }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to export report CSV.'
    }
  }
}
