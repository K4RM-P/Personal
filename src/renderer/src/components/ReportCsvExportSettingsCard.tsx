import * as React from 'react'
import { CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { Switch } from './ui/Switch'
import type { ReportCsvExportSettingsDTO, RunReportCsvExportResult } from '@shared/reportCsvExport'
import type { ReportEmailInterval } from '@shared/reportEmail'

const INTERVAL_OPTIONS: { value: ReportEmailInterval; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' }
]

const EMPTY_SETTINGS: ReportCsvExportSettingsDTO = {
  enabled: false,
  folderPath: '',
  interval: 'DAILY',
  lastExportedAt: null
}

/**
 * Settings → Reporting → scheduled CSV auto-export of the Complete Products
 * Sales Report to a folder on disk — see main/reports/reportCsvExportScheduler.ts.
 * Mirrors ReportEmailSettingsCard's enable/interval/last-run shape, with a
 * destination folder in place of a recipient/SMTP block.
 */
export function ReportCsvExportSettingsCard(): React.JSX.Element {
  const [settings, setSettings] = React.useState<ReportCsvExportSettingsDTO>(EMPTY_SETTINGS)
  const [folderInput, setFolderInput] = React.useState('')
  const [intervalInput, setIntervalInput] = React.useState<ReportEmailInterval>('DAILY')

  const [saved, setSaved] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [runResult, setRunResult] = React.useState<RunReportCsvExportResult | null>(null)
  const [running, setRunning] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [picking, setPicking] = React.useState(false)

  const applySettings = (next: ReportCsvExportSettingsDTO): void => {
    setSettings(next)
    setFolderInput(next.folderPath)
    setIntervalInput(next.interval)
  }

  const load = async (): Promise<void> => {
    try {
      if (!window.api?.reportCsvExport) return
      const loaded = await window.api.reportCsvExport.getSettings()
      applySettings(loaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report CSV export settings')
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = async (next: {
    enabled: boolean
    folderPath: string
    interval: ReportEmailInterval
  }): Promise<void> => {
    setError(null)
    setSaved(null)
    setRunResult(null)
    try {
      const result = await window.api.reportCsvExport.saveSettings(next)
      applySettings(result)
      setSaved('CSV export settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report CSV export settings')
    }
  }

  const handleToggleEnabled = (enabled: boolean): void => {
    void persist({ enabled, folderPath: folderInput, interval: intervalInput })
  }

  const handlePickFolder = async (): Promise<void> => {
    setPicking(true)
    try {
      const picked = await window.api.reportCsvExport.pickFolder()
      if (picked) setFolderInput(picked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to choose a folder')
    } finally {
      setPicking(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    await persist({ enabled: settings.enabled, folderPath: folderInput, interval: intervalInput })
    setSaving(false)
  }

  const handleRunNow = async (): Promise<void> => {
    setRunning(true)
    setRunResult(null)
    try {
      const result = await window.api.reportCsvExport.runNow()
      setRunResult(result)
      if (result.ok) void load()
    } catch (err) {
      setRunResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to export report CSV'
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Scheduled Sales Report CSV Export</CardTitle>
        <CardDescription>
          Automatically write the Complete Products Sales Report as a CSV file into a folder on this
          computer on a recurring interval — useful for handing off to an accountant or archiving
          without a manual export every time.
        </CardDescription>
      </CardHeader>

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Enable scheduled export</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {settings.lastExportedAt
                ? `Last exported ${new Date(settings.lastExportedAt).toLocaleString()}`
                : 'Not exported yet.'}
            </p>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={handleToggleEnabled} />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
            Destination folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="No folder chosen"
              className="input flex-1"
              readOnly
            />
            <button
              onClick={() => void handlePickFolder()}
              disabled={picking}
              className="min-h-11 shrink-0 rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50"
            >
              {picking ? 'Choosing…' : 'Choose Folder'}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Interval</label>
          <div className="flex gap-2">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setIntervalInput(opt.value)}
                className={
                  intervalInput === opt.value
                    ? 'min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)]'
                    : 'min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]'
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            Each export covers the most recently completed full period — e.g. Daily exports
            yesterday, Weekly exports the last 7 days, Monthly exports the full previous calendar
            month.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Export Settings'}
          </button>
          <button
            onClick={() => void handleRunNow()}
            disabled={running}
            className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--primary)]/30 px-4 text-sm text-[var(--primary)] hover:bg-[var(--muted)] disabled:opacity-50"
          >
            {running ? 'Exporting…' : 'Export Now'}
          </button>
        </div>

        {saved && <Alert variant="success">{saved}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        {runResult && (
          <Alert variant={runResult.ok ? 'success' : 'error'}>{runResult.message}</Alert>
        )}
      </div>
    </>
  )
}
