import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { formatCurrency } from '@shared/formatCurrency'
import type {
  CatalogPreview,
  CatalogCommitResult,
  CatalogImportProgress,
  CatalogSearchRow,
  CatalogStatus
} from '@shared/catalogTypes'

type Phase = 'idle' | 'picking' | 'importing' | 'previewing' | 'committing' | 'done' | 'failed'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function McKessonCatalogTab(): React.JSX.Element {
  const [status, setStatus] = React.useState<CatalogStatus | null>(null)
  const [phase, setPhase] = React.useState<Phase>('idle')
  const [progress, setProgress] = React.useState<CatalogImportProgress | null>(null)
  const [preview, setPreview] = React.useState<CatalogPreview | null>(null)
  const [commitResult, setCommitResult] = React.useState<CatalogCommitResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmations, setConfirmations] = React.useState<Record<string, string>>({})

  // Search state
  const [query, setQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<CatalogSearchRow[]>([])
  const [searching, setSearching] = React.useState(false)
  const [promotingId, setPromotingId] = React.useState<number | null>(null)
  const [promoteMessage, setPromoteMessage] = React.useState<string | null>(null)

  // Province
  const [province, setProvince] = React.useState('')
  const [provinceSaved, setProvinceSaved] = React.useState(false)

  const loadStatus = React.useCallback(async (): Promise<void> => {
    try {
      if (window.api?.catalog) {
        const s = await window.api.catalog.getStatus()
        setStatus(s)
      }
    } catch (err) {
      console.error('Failed to load catalog status:', err)
    }
  }, [])

  const loadProvince = React.useCallback(async (): Promise<void> => {
    try {
      if (window.api?.catalog) {
        const p = await window.api.catalog.getProvince()
        setProvince(p)
      }
    } catch (err) {
      console.error('Failed to load province:', err)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      if (cancelled) return
      await loadStatus()
      if (cancelled) return
      await loadProvince()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [loadStatus, loadProvince])

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

  const handlePickAndImport = async (): Promise<void> => {
    if (!window.api?.catalog) return
    setError(null)
    setPreview(null)
    setCommitResult(null)
    setPhase('picking')
    try {
      const filePath = await window.api.catalog.pickFile()
      if (!filePath) {
        setPhase('idle')
        return
      }
      setPhase('importing')
      setProgress({ batchId: null, phase: 'reading', linesRead: 0, totalLines: 0, percent: 0 })
      const result = await window.api.catalog.startImport(filePath)
      setPreview(result)
      setPhase('previewing')
      // Initialize confirmations for any confirm-severity guards
      const initialConfirms: Record<string, string> = {}
      for (const g of result.guards) {
        if (g.severity === 'confirm' && g.confirmPhrase) {
          initialConfirms[g.code] = ''
        }
      }
      setConfirmations(initialConfirms)
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, 'Import failed'))
    }
  }

  const handleCommit = async (): Promise<void> => {
    if (!preview || !window.api?.catalog) return
    setError(null)
    setPhase('committing')
    try {
      const confirmList = Object.values(confirmations).filter((v) => v.trim().length > 0)
      const result = await window.api.catalog.commitImport(preview.batchId, confirmList)
      setCommitResult(result)
      setPhase('done')
      setPreview(null)
      void loadStatus()
    } catch (err) {
      setPhase('previewing')
      setError(errorMessage(err, 'Commit failed'))
    }
  }

  const handleDiscard = async (): Promise<void> => {
    if (!preview || !window.api?.catalog) return
    if (!confirm('Discard this import? The active catalogue is untouched.')) return
    try {
      await window.api.catalog.discardImport(preview.batchId)
      setPreview(null)
      setPhase('idle')
    } catch (err) {
      setError(errorMessage(err, 'Discard failed'))
    }
  }

  const handleRollback = async (): Promise<void> => {
    if (!window.api?.catalog) return
    if (!confirm('Roll back to the previous catalogue? Manual edits made since the last commit will not be restored.')) return
    setError(null)
    try {
      const result = await window.api.catalog.rollback()
      setCommitResult(result)
      void loadStatus()
    } catch (err) {
      setError(errorMessage(err, 'Rollback failed'))
    }
  }

  const handleSaveProvince = async (): Promise<void> => {
    if (!window.api?.catalog || !province.trim()) return
    try {
      await window.api.catalog.setProvince(province.trim().toUpperCase())
      setProvinceSaved(true)
      setTimeout(() => setProvinceSaved(false), 2000)
    } catch (err) {
      setError(errorMessage(err, 'Failed to save province'))
    }
  }

  const handleSearch = async (): Promise<void> => {
    if (!window.api?.catalog) return
    setSearching(true)
    try {
      const rows = await window.api.catalog.search(query)
      setSearchResults(rows)
    } catch (err) {
      setError(errorMessage(err, 'Search failed'))
    } finally {
      setSearching(false)
    }
  }

  const handlePromote = async (row: CatalogSearchRow): Promise<void> => {
    if (!window.api?.catalog) return
    setPromotingId(row.id)
    setPromoteMessage(null)
    try {
      const result = await window.api.catalog.promote(row.id)
      const msg = result.created
        ? `Added to inventory: ${formatCurrency(result.priceCents)} retail${result.pricePinnedForZeroCost ? ' (pinned — set a real price)' : ''}${result.barcodeSkipped ? ' • barcode skipped (clash)' : ''}`
        : `Already stocked (Product #${result.productId})`
      setPromoteMessage(msg)
      // Refresh search to update stockedProductId badges
      void handleSearch()
    } catch (err) {
      setPromoteMessage(`Failed: ${errorMessage(err, 'error')}`)
    } finally {
      setPromotingId(null)
    }
  }

  const phaseLabel = (p: CatalogImportProgress['phase']): string => {
    const map: Record<string, string> = {
      idle: 'Idle',
      reading: 'Reading file…',
      writingProducts: 'Writing products…',
      writingDeals: 'Writing deals…',
      analyzing: 'Analyzing & reconciling…',
      ready: 'Ready for review',
      committing: 'Committing…',
      done: 'Done',
      failed: 'Failed'
    }
    return map[p] ?? p
  }

  const isBusy = phase === 'picking' || phase === 'importing' || phase === 'committing'

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>McKesson Catalogue Status</CardTitle>
          <CardDescription>
            Streaming WEBCAT import with batch-scoped refresh, reconciliation, and rollback.
          </CardDescription>
        </CardHeader>
        <div className="space-y-3 text-xs">
          {status ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatusCell label="Active batch" value={status.activeBatchId ? `#${status.activeBatchId}` : 'None'} />
              <StatusCell label="Products" value={status.productCount.toLocaleString()} />
              <StatusCell label="Deals" value={status.dealCount.toLocaleString()} />
              <StatusCell
                label="Imported"
                value={status.importedAt ? new Date(status.importedAt).toLocaleDateString() : '—'}
              />
              <StatusCell label="Age" value={status.ageDays !== null ? `${status.ageDays} days` : '—'} />
              <StatusCell
                label="Stale?"
                value={status.isStale ? 'Yes' : 'No'}
                highlight={status.isStale ? 'warning' : undefined}
              />
              <StatusCell label="File" value={status.filename ?? '—'} />
              <StatusCell
                label="Rollback available"
                value={status.rollbackBatchId ? `#${status.rollbackBatchId}` : 'No'}
              />
            </div>
          ) : (
            <div className="text-[var(--muted-foreground)]">Loading status…</div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={handlePickAndImport}
              disabled={isBusy}
              className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {phase === 'picking' ? 'Choosing file…' : phase === 'importing' ? 'Importing…' : 'Import WEBCAT file'}
            </button>
            <button
              onClick={handleRollback}
              disabled={!status?.rollbackBatchId || isBusy}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] disabled:opacity-50"
            >
              Roll back to previous
            </button>
            <button
              onClick={loadStatus}
              disabled={isBusy}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-xs text-[var(--foreground)] disabled:opacity-50"
            >
              Refresh status
            </button>
          </div>

          {/* Province setting */}
          <div className="flex items-center gap-2 pt-1">
            <label className="text-[var(--muted-foreground)]">Pharmacy province:</label>
            <input
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              placeholder="e.g. ONT"
              className="w-24 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]"
            />
            <button
              onClick={handleSaveProvince}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-1 text-[var(--foreground)]"
            >
              Save
            </button>
            {provinceSaved && <span className="text-[var(--success)]">Saved</span>}
          </div>
        </div>
      </Card>

      {/* Progress */}
      {progress && (phase === 'importing' || phase === 'failed') && (
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
                className={`h-full transition-all ${phase === 'failed' ? 'bg-[var(--error)]' : 'bg-[var(--primary)]'}`}
                style={{ width: `${Math.max(2, progress.percent)}%` }}
              />
            </div>
            {progress.message && (
              <div className="text-[var(--error)]">{progress.message}</div>
            )}
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] p-3 text-xs text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Preview */}
      {preview && phase === 'previewing' && (
        <Card>
          <CardHeader>
            <CardTitle>Import Preview — {preview.filename}</CardTitle>
            <CardDescription>
              {preview.totalLines.toLocaleString()} lines • {preview.productsParsed.toLocaleString()} products •{' '}
              {preview.dealsParsed.toLocaleString()} deals • {preview.linesRejected} rejected
            </CardDescription>
          </CardHeader>

          <div className="space-y-4 text-xs">
            {/* Anomalies */}
            <div>
              <h4 className="mb-2 font-semibold text-[var(--foreground)]">Anomalies</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCell label="Zero cost" value={preview.anomalies.zeroCost} />
                <StatCell label="List below cost" value={preview.anomalies.listBelowCost} />
                <StatCell label="No primary GTIN" value={preview.anomalies.noPrimaryGtin} />
                <StatCell label="Orphan deals" value={preview.anomalies.orphanDeals} />
              </div>
            </div>

            {/* Province split */}
            <div>
              <h4 className="mb-2 font-semibold text-[var(--foreground)]">Province split</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(preview.provinceSplit).map(([prov, count]) => (
                  <span
                    key={prov}
                    className="rounded-full border border-[var(--border)] bg-[var(--muted)] px-3 py-1"
                  >
                    {prov}: {count.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>

            {/* Reference diff */}
            <div>
              <h4 className="mb-2 font-semibold text-[var(--foreground)]">Reference catalogue diff</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCell label="Current" value={preview.reference.currentCount} />
                <StatCell label="New" value={preview.reference.newCount} />
                <StatCell label="Added" value={preview.reference.added} />
                <StatCell label="Removed" value={preview.reference.removed} />
              </div>
            </div>

            {/* Inventory impact */}
            <div>
              <h4 className="mb-2 font-semibold text-[var(--foreground)]">Inventory impact</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCell label="Repriced" value={preview.inventory.repriced.length} />
                <StatCell label="Discontinued" value={preview.inventory.discontinued.length} />
                <StatCell label="Reappeared" value={preview.inventory.reappeared.length} />
                <StatCell label="Barcode changed" value={preview.inventory.barcodeChanged.length} />
                <StatCell label="Cost changed (pinned)" value={preview.inventory.costChangedButPinned.length} />
                <StatCell label="Overrides preserved" value={preview.inventory.manualOverridesPreserved.length} />
                <StatCell label="Zero-cost skipped" value={preview.inventory.zeroCostSkipped.length} />
                <StatCell label="Catalog-sourced" value={preview.inventory.catalogSourcedCount} />
              </div>
            </div>

            {/* Guards */}
            {preview.guards.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-[var(--foreground)]">Safety guards</h4>
                <div className="space-y-2">
                  {preview.guards.map((g) => (
                    <div
                      key={g.code}
                      className={`rounded-[var(--radius)] border p-3 ${
                        g.severity === 'block'
                          ? 'border-[var(--error)]/30 bg-[var(--error-bg)]'
                          : 'border-[var(--warning)]/30 bg-[var(--warning-bg)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[var(--foreground)]">
                          {g.severity === 'block' ? 'BLOCK' : 'CONFIRM'}: {g.title}
                        </span>
                      </div>
                      <div className="mt-1 text-[var(--muted-foreground)]">{g.detail}</div>
                      {g.severity === 'confirm' && g.confirmPhrase && (
                        <div className="mt-2">
                          <label className="text-[var(--muted-foreground)]">
                            Type &ldquo;{g.confirmPhrase}&rdquo; to override:
                          </label>
                          <input
                            value={confirmations[g.code] ?? ''}
                            onChange={(e) =>
                              setConfirmations((prev) => ({ ...prev, [g.code]: e.target.value }))
                            }
                            className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reject samples */}
            {preview.rejectSamples.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-[var(--foreground)]">
                  Rejected lines (first {preview.rejectSamples.length})
                </h4>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-2">
                  {preview.rejectSamples.map((r) => (
                    <div key={r.lineNumber} className="text-[var(--muted-foreground)]">
                      Line {r.lineNumber}: {r.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCommit}
                className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)]"
              >
                Commit & reconcile
              </button>
              <button
                onClick={handleDiscard}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-xs text-[var(--foreground)]"
              >
                Discard
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Commit result */}
      {commitResult && phase === 'done' && (
        <Card className="border-[var(--success)]/30 bg-[var(--success-bg)]">
          <CardHeader>
            <CardTitle className="text-[var(--success)]">Import committed</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <StatCell label="Repriced" value={commitResult.repricedCount} />
            <StatCell label="Discontinued" value={commitResult.discontinuedCount} />
            <StatCell label="Reappeared" value={commitResult.reappearedCount} />
            <StatCell label="Products in catalog" value={commitResult.productsInCatalog} />
          </div>
        </Card>
      )}

      {/* Catalog search & promote */}
      <Card>
        <CardHeader>
          <CardTitle>Browse & Promote</CardTitle>
          <CardDescription>
            Search the active McKesson catalogue and promote items into your sellable inventory.
          </CardDescription>
        </CardHeader>
        <div className="space-y-3 text-xs">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch()
              }}
              placeholder="Search by name, DIN, item number, generic…"
              className="flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)]"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {promoteMessage && (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-2 text-[var(--foreground)]">
              {promoteMessage}
            </div>
          )}

          {searchResults.length > 0 ? (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {searchResults.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3"
                >
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
                      <span>{row.displayName || row.description}</span>
                      {row.stockedProductId && (
                        <span className="rounded-full border border-[var(--success)]/30 bg-[var(--success-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--success)]">
                          Stocked
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[var(--muted-foreground)]">
                      Item #{row.itemNumber} • {row.province}
                      {row.din ? ` • DIN ${row.din}` : ''}
                      {row.genericName ? ` • ${row.genericName}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--muted-foreground)]">Cost</div>
                    <div className="font-semibold text-[var(--foreground)]">{formatCurrency(row.costPriceCents)}</div>
                  </div>
                  <button
                    onClick={() => void handlePromote(row)}
                    disabled={promotingId === row.id || !!row.stockedProductId}
                    className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                  >
                    {promotingId === row.id ? '…' : row.stockedProductId ? 'Stocked' : 'Promote'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-4 text-center text-[var(--muted-foreground)]">
              {status?.activeBatchId
                ? 'Search the catalogue to find items to add to your inventory.'
                : 'No active catalogue. Import a WEBCAT file first.'}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function StatusCell({
  label,
  value,
  highlight
}: {
  label: string
  value: string
  highlight?: 'warning' | 'success'
}): React.JSX.Element {
  const color =
    highlight === 'warning'
      ? 'text-[var(--warning)]'
      : highlight === 'success'
        ? 'text-[var(--success)]'
        : 'text-[var(--foreground)]'
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-2">
      <div className="text-[var(--muted-foreground)]">{label}</div>
      <div className={`font-semibold ${color}`}>{value}</div>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-2">
      <div className="text-[var(--muted-foreground)]">{label}</div>
      <div className="font-semibold text-[var(--foreground)]">{value.toLocaleString()}</div>
    </div>
  )
}