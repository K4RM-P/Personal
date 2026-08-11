import * as React from 'react'
import { UploadCloud, CheckCircle2, PackageCheck } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { EmptyState } from './ui/EmptyState'
import { formatCurrency } from '@shared/formatCurrency'
import type { AutoImportResult, CatalogImportProgress } from '@shared/catalogTypes'

type Phase = 'idle' | 'importing' | 'done' | 'failed'

const STEP_LABELS = ['Upload file', 'Import progress', 'Review results']

function stepForPhase(phase: Phase): number {
  if (phase === 'importing') return 2
  if (phase === 'done' || phase === 'failed') return 3
  return 1
}

function StepIndicator({ phase }: { phase: Phase }): React.JSX.Element {
  const current = stepForPhase(phase)
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
      {STEP_LABELS.map((label, idx) => {
        const step = idx + 1
        const active = step === current
        const complete = step < current
        return (
          <React.Fragment key={label}>
            {idx > 0 && <div className="h-px w-6 shrink-0 bg-[var(--border)]" aria-hidden="true" />}
            <div className="flex items-center gap-1.5">
              <span
                className={`flex icon-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  active || complete
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}
              >
                {step}
              </span>
              <span className={active ? 'text-[var(--foreground)]' : ''}>{label}</span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

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
      <StepIndicator phase={phase} />

      <Card>
        <CardHeader>
          <CardTitle>McKesson Catalogue Upload</CardTitle>
          <CardDescription>
            Upload a WEBCAT file to import the latest McKesson catalogue. All items are
            automatically added to your catalogue. Existing products are updated with the latest
            pricing and availability.
          </CardDescription>
        </CardHeader>
        <button
          onClick={handleUpload}
          disabled={phase === 'importing'}
          className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed border-[var(--border)] bg-[var(--muted)] px-4 py-6 text-center transition-colors hover:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UploadCloud className="icon-6 text-[var(--muted-foreground)]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--foreground)]">
            {phase === 'importing' ? 'Importing…' : 'Click to choose a WEBCAT file'}
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            Existing products are updated automatically
          </span>
        </button>
      </Card>

      {/* Progress */}
      {progress && phase === 'importing' && (
        <Card>
          <CardHeader>
            <CardTitle>Import Progress</CardTitle>
          </CardHeader>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--foreground)]">
                {phaseLabel(progress.phase)}
              </span>
              <span className="tabular-nums text-[var(--muted-foreground)]">
                {progress.linesRead.toLocaleString()} / {progress.totalLines.toLocaleString()} lines
                ({progress.percent}%)
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
      {error && <Alert variant="error">{error}</Alert>}

      {/* Success result */}
      {result && phase === 'done' && (
        <Card className="border-[var(--success)]/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="icon-5 shrink-0 text-[var(--success)]" aria-hidden="true" />
              <CardTitle className="text-[var(--success)]">
                Catalogue imported successfully
              </CardTitle>
            </div>
            <CardDescription>
              {result.filename} &mdash; {result.catalogProductsTotal.toLocaleString()} products in
              catalogue
              {result.repricedCount > 0 && ` • ${result.repricedCount} repriced`}
              {result.discontinuedCount > 0 && ` • ${result.discontinuedCount} discontinued`}
              {result.errors > 0 && ` • ${result.errors} errors`}
            </CardDescription>
          </CardHeader>

          {result.newItems.length > 0 ? (
            <div>
              <h4 className="mb-3 text-xs font-semibold text-[var(--foreground)]">
                New items added to catalogue ({result.newItems.length.toLocaleString()})
              </h4>
              <div className="max-h-96 overflow-y-auto pr-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--card)]">
                    <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                      <th className="py-2 pr-2 font-medium">Product Code</th>
                      <th className="py-2 pr-2 font-medium">Description</th>
                      <th className="py-2 pr-2 text-right font-medium">Unit Cost</th>
                      <th className="py-2 pr-2 text-right font-medium">Retail Price</th>
                      <th className="py-2 text-right font-medium">UPC / Barcode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.newItems.map((item) => (
                      <tr
                        key={item.productId}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                      >
                        <td className="py-2 pr-2 font-mono text-[var(--muted-foreground)]">
                          {item.itemNumber}
                        </td>
                        <td className="py-2 pr-2 font-medium text-[var(--foreground)]">
                          {item.name}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-[var(--foreground)]">
                          {formatCurrency(item.costCents)}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums font-semibold text-[var(--primary)]">
                          {formatCurrency(item.priceCents)}
                        </td>
                        <td className="py-2 text-right font-mono text-[var(--muted-foreground)]">
                          {item.barcode || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={PackageCheck}
              title="No new items in this catalogue"
              description="Every product in this file was already present from a previous import."
            />
          )}
        </Card>
      )}
    </div>
  )
}
