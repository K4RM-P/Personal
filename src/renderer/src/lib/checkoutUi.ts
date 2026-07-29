export interface ImportPreviewRow {
  sku: string
  name: string
  costCents: number
  barcode?: string
}

export function parseImportPreviewCsv(csvText: string): ImportPreviewRow[] {
  return csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim())
      const [sku, name, costStr, barcode] = parts
      const costCents = Math.round(parseFloat(costStr || '0') * 100)
      return {
        sku,
        name,
        costCents,
        barcode: barcode || undefined
      }
    })
    .filter((row) => Boolean(row.sku) && Boolean(row.name) && Number.isFinite(row.costCents))
}
