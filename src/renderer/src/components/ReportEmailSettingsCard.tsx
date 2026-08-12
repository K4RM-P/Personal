import * as React from 'react'
import { CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { Switch } from './ui/Switch'
import type { ReportEmailInterval, ReportEmailSettingsDTO } from '@shared/reportEmail'

const INTERVAL_OPTIONS: { value: ReportEmailInterval; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' }
]

const EMPTY_SETTINGS: ReportEmailSettingsDTO = {
  enabled: false,
  recipientEmail: '',
  interval: 'DAILY',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: '',
  smtpFromAddress: '',
  hasSmtpPassword: false,
  lastSentAt: null
}

/**
 * Settings → Reporting → scheduled digest emails. All reports (sales summary,
 * daily breakdown, tender split, top/slow items, cashier totals, inventory
 * valuation, alerts/credit health) are bundled into one formatted HTML email
 * sent on the configured interval — see main/reports/reportEmailTemplate.ts.
 */
export function ReportEmailSettingsCard(): React.JSX.Element {
  const [settings, setSettings] = React.useState<ReportEmailSettingsDTO>(EMPTY_SETTINGS)
  const [recipientInput, setRecipientInput] = React.useState('')
  const [intervalInput, setIntervalInput] = React.useState<ReportEmailInterval>('DAILY')
  const [smtpHostInput, setSmtpHostInput] = React.useState('')
  const [smtpPortInput, setSmtpPortInput] = React.useState('587')
  const [smtpSecureInput, setSmtpSecureInput] = React.useState(false)
  const [smtpUsernameInput, setSmtpUsernameInput] = React.useState('')
  const [smtpFromInput, setSmtpFromInput] = React.useState('')
  const [smtpPasswordInput, setSmtpPasswordInput] = React.useState('')

  const [saved, setSaved] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [sendingTest, setSendingTest] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const applySettings = (next: ReportEmailSettingsDTO): void => {
    setSettings(next)
    setRecipientInput(next.recipientEmail)
    setIntervalInput(next.interval)
    setSmtpHostInput(next.smtpHost)
    setSmtpPortInput(String(next.smtpPort))
    setSmtpSecureInput(next.smtpSecure)
    setSmtpUsernameInput(next.smtpUsername)
    setSmtpFromInput(next.smtpFromAddress)
    setSmtpPasswordInput('')
  }

  const load = async (): Promise<void> => {
    try {
      if (!window.api?.reportEmail) return
      const loaded = await window.api.reportEmail.getSettings()
      applySettings(loaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report email settings')
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = async (next: {
    enabled: boolean
    recipientEmail: string
    interval: ReportEmailInterval
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    smtpUsername: string
    smtpFromAddress: string
    smtpPassword?: string
  }): Promise<void> => {
    setError(null)
    setSaved(null)
    setTestResult(null)
    try {
      const result = await window.api.reportEmail.saveSettings(next)
      applySettings(result)
      setSaved('Report email settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report email settings')
    }
  }

  const handleToggleEnabled = (enabled: boolean): void => {
    void persist({
      enabled,
      recipientEmail: recipientInput,
      interval: intervalInput,
      smtpHost: smtpHostInput,
      smtpPort: Number(smtpPortInput) || 587,
      smtpSecure: smtpSecureInput,
      smtpUsername: smtpUsernameInput,
      smtpFromAddress: smtpFromInput,
      smtpPassword: smtpPasswordInput || undefined
    })
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    await persist({
      enabled: settings.enabled,
      recipientEmail: recipientInput,
      interval: intervalInput,
      smtpHost: smtpHostInput,
      smtpPort: Number(smtpPortInput) || 587,
      smtpSecure: smtpSecureInput,
      smtpUsername: smtpUsernameInput,
      smtpFromAddress: smtpFromInput,
      smtpPassword: smtpPasswordInput || undefined
    })
    setSaving(false)
  }

  const handleSendTest = async (): Promise<void> => {
    setSendingTest(true)
    setTestResult(null)
    try {
      const result = await window.api.reportEmail.sendTest()
      setTestResult(result)
      if (result.ok) void load()
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to send test email'
      })
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Scheduled Report Emails</CardTitle>
        <CardDescription>
          Automatically email a formatted digest of all reports — sales summary, daily breakdown,
          tender split, top &amp; slow items, cashier totals, inventory valuation, and alerts/credit
          health — to one address on a recurring interval.
        </CardDescription>
      </CardHeader>

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Enable scheduled emails</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {settings.lastSentAt
                ? `Last sent ${new Date(settings.lastSentAt).toLocaleString()}`
                : 'Not sent yet.'}
            </p>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={handleToggleEnabled} />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
            Recipient email
          </label>
          <input
            type="email"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
            placeholder="owner@yourpharmacy.com"
            className="input"
          />
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
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
          <p className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">
            Outgoing SMTP server
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Host</label>
              <input
                type="text"
                value={smtpHostInput}
                onChange={(e) => setSmtpHostInput(e.target.value)}
                placeholder="smtp.yourprovider.com"
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Port</label>
              <input
                type="number"
                value={smtpPortInput}
                onChange={(e) => setSmtpPortInput(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex items-end justify-between pb-1">
              <label className="text-xs text-[var(--muted-foreground)]">Use TLS</label>
              <Switch checked={smtpSecureInput} onCheckedChange={setSmtpSecureInput} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Username</label>
              <input
                type="text"
                value={smtpUsernameInput}
                onChange={(e) => setSmtpUsernameInput(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                Password{settings.hasSmtpPassword ? ' (•••• set)' : ''}
              </label>
              <input
                type="password"
                value={smtpPasswordInput}
                onChange={(e) => setSmtpPasswordInput(e.target.value)}
                placeholder={settings.hasSmtpPassword ? 'Leave blank to keep current' : ''}
                className="input"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                From address (optional — defaults to username)
              </label>
              <input
                type="email"
                value={smtpFromInput}
                onChange={(e) => setSmtpFromInput(e.target.value)}
                placeholder="reports@yourpharmacy.com"
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-h-11 flex-1 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Report Email Settings'}
          </button>
          <button
            onClick={() => void handleSendTest()}
            disabled={sendingTest}
            className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--primary)]/30 px-4 text-sm text-[var(--primary)] hover:bg-[var(--muted)] disabled:opacity-50"
          >
            {sendingTest ? 'Sending…' : 'Send Test Email Now'}
          </button>
        </div>

        {saved && <Alert variant="success">{saved}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        {testResult && (
          <Alert variant={testResult.ok ? 'success' : 'error'}>{testResult.message}</Alert>
        )}
      </div>
    </>
  )
}
