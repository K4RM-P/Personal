import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type {
  AutoImportResult,
  CatalogImportProgress
} from '@shared/catalogTypes'

type Phase = 'idle' | 'importing' | 'done' | 'failed'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function McKessonCatalogTab(): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>('idle')
  const [progress, setProgress] = React.useState<CatalogImportProgress | null>(null)
  const [result, setResult] = React.useState<AutoImportResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Subscribe to import progress while importing
  React.useEffect(() => {
    if (phase !== 'importing') return
    if (!window.api?.catalog) return
    const unsubscribe = window.api.catalog.onImportProgress((p) => {
      setProgress(p)
      if (p.phase === 'failed') {
        setPhase('failed')
        setError(p.message ?? 'Import failed')
      }
    })
    return unsubscribe
  }, [phase])

  const handleUpload = async (): Promise<void> => {
    if (!window.api?.catalog) return
    setError(null)
    setResult(null)
    setProgress(null)
    try {
      const filePath = await window.api.catalog.pickFile()
      if (!filePath) return

      setPhase('importing')
      setProgress({ batchId: null, phase: 'reading', linesRead: 0, totalLines: 0, percent: 0 })

      const autoResult = await window.api.catalog.autoImport(filePath)
      setResult(autoResult)
      setPhase('done')
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, 'Import failed'))
    }
  }

  const phaseLabel = (p: CatalogImportProgress['phase']): string => {
    const map: Record<string, string> = {
      idle: 'Idle',
      reading: 'Reading file…',
      writingProducts: 'Writing products…',
      writingDeals: 'Writing deals…',
      analyzing: 'Analyzing…',
      committing: 'Committing…',
      ready: 'Ready',
      done: 'Done',
      failed: 'Failed'
    }
    return map[p] ?? p
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>McKesson Catalogue Upload</CardTitle>
          <CardDescription>
            Upload a WEBCAT file to import the latest McKesson catalogue. All items are
            automatically added to your catalogue. Existing products are updated
            with the latest pricing and availability.
          </CardDescription>
        </CardHeader>
        <div className="space-y-3 text-xs">
          <button
            onClick={handleUpload}
            disabled={phase === 'importing'}
            className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {phase === 'importing' ? 'Importing…' : 'Upload WEBCAT file'}
          </button>
        </div>
      </Card>

      {/* Progress */}
      {progress && phase === 'importing' && (
        <Card>
          <CardHeader>
            <CardTitle>Import Progress</CardTitle>
          </CardHeader>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--foreground)]">{phaseLabel(progress.phase)}</span>
              <span className="text-[var(--muted-foreground)]">
                {progress.linesRead.toLocaleString()} / {progress.totalLines.toLocaleString()} lines ({progress.percent}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full bg-[var(--primary)] transition-all"
                style={{ width: `${Math.max(2, progress.percent)}%` }}
              />
            </div>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] p-3 text-xs text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Success result */}
      {result && phase === 'done' && (
        <Card className="border-[var(--success)]/30 bg-[var(--success-bg)]">
          <CardHeader>
            <CardTitle className="text-[var(--success)]">Catalogue imported successfully</CardTitle>
            <CardDescription>
              {result.filename} &mdash; {result.catalogProductsTotal.toLocaleString()} products in catalogue
              {result.repricedCount > 0 && ` • ${result.repricedCount} repriced`}
              {result.discontinuedCount > 0 && ` • ${result.discontinuedCount} discontinued`}
              {result.errors > 0 && ` • ${result.errors} errors`}
            </CardDescription>
          </CardHeader>

          {result.newItems.length > 0 && (
            <div>
              <h4 className="mb-2 px-6 text-xs font-semibold text-[var(--foreground)]">
                New items added to catalogue ({result.newItems.length.toLocaleString()})
              </h4>
              <div className="max-h-96 space-y-1 overflow-y-auto px-6 pb-6">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--muted-foreground)]">
                      <th className="pb-1 pr-2 font-medium">UPC</th>
                      <th className="pb-1 pr-2 font-medium">Name</th>
                      <th className="pb-1 pr-2 font-medium">SKU</th>
                      <th className="pb-1 pr-2 text-right font-medium">Cost</th>
                      <th className="pb-1 text-right font-medium">Retail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.newItems.map((item) => (
                      <tr key={item.productId} className="border-t border-[var(--border)]/50">
                        <td className="py-1 pr-2 text-[var(--muted-foreground)]">{item.barcode || 'N/A'}</td>
                        <td className="py-1 pr-2 font-medium text-[var(--foreground)]">{item.name}</td>
                        <td className="py-1 pr-2 text-[var(--muted-foreground)]">{item.sku}</td>
                        <td className="py-1 pr-2 text-right text-[var(--foreground)]">{formatCurrency(item.costCents)}</td>
                        <td className="py-1 text-right text-[var(--foreground)]">{formatCurrency(item.priceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.newItems.length === 0 && (
            <div className="px-6 pb-6 text-xs text-[var(--muted-foreground)]">
              No new items were found — all products in this catalogue were already present in the previous one.
            </div>
          )}
        </Card>
      )}
    </div>
  )
}