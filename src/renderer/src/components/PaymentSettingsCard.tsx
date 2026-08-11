import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import type {
  PaymentProviderName,
  PaymentEnvironment,
  PaymentConfigView,
  ReaderStatus
} from '@shared/types'

interface ProviderMeta {
  value: PaymentProviderName
  label: string
  category: string
  needsKey: boolean
  keyHint?: string
  terminalHint?: string
}

const PROVIDERS: ProviderMeta[] = [
  { value: 'manual', label: 'Manual / External Terminal', category: 'Standalone — no integration', needsKey: false },
  {
    value: 'stripe',
    label: 'Stripe Terminal',
    category: 'Cloud SDK reader',
    needsKey: true,
    keyHint: 'Secret key (sk_test_… / sk_live_…)',
    terminalHint: 'Reader id (optional — auto-discovers a simulated reader in sandbox)'
  },
  { value: 'square', label: 'Square Terminal', category: 'Cloud SDK reader', needsKey: true, keyHint: 'Access token', terminalHint: 'Device id' },
  { value: 'clover', label: 'Clover', category: 'Semi-integrated terminal', needsKey: true, keyHint: 'Access token', terminalHint: 'Device / merchant id' },
  { value: 'moneris', label: 'Moneris', category: 'Semi-integrated PIN pad', needsKey: true, keyHint: 'store_id:api_token', terminalHint: 'Terminal / ECR id' },
  {
    value: 'globalpayments',
    label: 'Global Payments',
    category: 'Semi-integrated PIN pad',
    needsKey: true,
    keyHint: 'app_id:app_key',
    terminalHint: 'Terminal id'
  },
  { value: 'mock', label: 'Simulated (testing only)', category: 'Offline — auto-approves', needsKey: false }
]

export function PaymentSettingsCard(): React.JSX.Element {
  const [provider, setProvider] = React.useState<PaymentProviderName>('manual')
  const [environment, setEnvironment] = React.useState<PaymentEnvironment>('sandbox')
  const [terminalId, setTerminalId] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [hasApiKey, setHasApiKey] = React.useState(false)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reader, setReader] = React.useState<ReaderStatus | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [showApiKey, setShowApiKey] = React.useState(false)

  const meta = PROVIDERS.find((p) => p.value === provider)!

  const load = async () => {
    try {
      if (!window.api?.settings?.getPayment) return
      const cfg: PaymentConfigView = await window.api.settings.getPayment()
      setProvider(cfg.provider)
      setEnvironment(cfg.environment)
      setTerminalId(cfg.terminalId ?? '')
      setHasApiKey(cfg.hasApiKey)
      setApiKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment settings')
    }
  }

  React.useEffect(() => {
    load()
  }, [])

  const handleSave = async () => {
    setSaved(null)
    setError(null)
    try {
      const view = await window.api.settings.savePayment({
        provider,
        environment,
        terminalId: terminalId.trim() || undefined,
        apiKey: apiKey.trim() || undefined
      })
      setHasApiKey(view.hasApiKey)
      setApiKey('')
      setSaved(`Saved. Active mode: ${view.interactionMode === 'manual' ? 'Manual / External' : 'Automatic'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payment settings')
    }
  }

  const handleCheckReader = async () => {
    setChecking(true)
    setReader(null)
    try {
      const status = await window.api.payment.getReaderStatus()
      setReader(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reader check failed')
    } finally {
      setChecking(false)
    }
  }

  // Guided setup routes the owner to a recommended provider; the dropdown below
  // stays the source of truth so they can always override or switch later.
  const pickFromWizard = (value: PaymentProviderName) => {
    setProvider(value)
    setWizardOpen(false)
  }

  return (
    <Card className="border-0 p-0 shadow-none">
      <CardHeader>
        <CardTitle>Payment mode</CardTitle>
        <CardDescription>
          Choose how card payments are handled without changing the checkout flow. The UI stays processor-agnostic and presents the terminal as a workflow state.
        </CardDescription>
      </CardHeader>

      <div className="mt-2">
        <button
          onClick={() => setWizardOpen((o) => !o)}
          className="rounded-[var(--radius)] border border-[var(--primary)]/30 px-3 py-1.5 text-xs text-[var(--primary)] hover:bg-[var(--muted)]"
        >
          {wizardOpen ? 'Hide setup guide' : 'Not sure? Run the setup guide'}
        </button>
      </div>

      {wizardOpen && (
        <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-4 space-y-4 text-sm">
          <div>
            <p className="font-medium text-[var(--foreground)]">1. Do you have a payment terminal already?</p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setWizardOpen(true)}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)]"
                disabled
              >
                Answer below ↓
              </button>
            </div>
          </div>
          <div>
            <p className="font-medium text-[var(--foreground)]">2. Is it connected to your network / does it support card-present API integration?</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Not sure? Check the terminal's model number, or ask your card processor whether they offer
              “integrated / semi-integrated POS support.” If it’s a plain countertop terminal that prints
              its own receipt and isn’t plugged into this computer or your network, it is <em>not</em> integrated.
            </p>
          </div>
          <div className="grid gap-2">
            <p className="font-medium text-[var(--foreground)]">Recommended for your setup:</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => pickFromWizard('manual')} className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-1.5 text-xs text-[var(--primary-foreground)]">
                No terminal / not integrated → Manual/External
              </button>
              <button onClick={() => pickFromWizard('stripe')} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)]">
                Integrated cloud reader → Stripe/Square
              </button>
              <button onClick={() => pickFromWizard('moneris')} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)]">
                Integrated PIN pad → Moneris/Global Payments
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 mt-4">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Processor</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as PaymentProviderName)} className="input">
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} — {p.category}
              </option>
            ))}
          </select>
        </div>

        {provider === 'manual' && (
          <p className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            Manual mode is a deliberate, first-class option. At checkout the cashier keys the total into
            your standalone terminal, then taps <strong>Approved</strong> or <strong>Declined</strong> here.
            No API keys needed.
          </p>
        )}

        {meta.needsKey && (
          <>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Environment</label>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value as PaymentEnvironment)} className="input">
                <option value="sandbox">Sandbox / Test</option>
                <option value="production">Production / Live</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                Terminal / Reader id {meta.terminalHint ? `— ${meta.terminalHint}` : ''}
              </label>
              <input type="text" value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className="input" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                API credentials {meta.keyHint ? `— ${meta.keyHint}` : ''}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasApiKey ? '•••••••• (stored — leave blank to keep)' : 'Enter to store securely'}
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? 'Hide API credentials' : 'Show API credentials'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  {showApiKey ? <EyeOff className="icon-4" /> : <Eye className="icon-4" />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                Stored encrypted via your OS keychain (Electron safeStorage) — never in plaintext.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleSave} className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)]">
            Save Payment Settings
          </button>
          <button
            onClick={handleCheckReader}
            disabled={checking}
            className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-sm text-[var(--foreground)] disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check Reader Status'}
          </button>
        </div>

        {saved && <Alert variant="success">{saved}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}

        {reader && (
          <Alert variant={reader.connected ? 'success' : 'warning'}>
            {reader.connected ? 'Connected' : 'Pending'} — {reader.label ?? reader.provider}
            {reader.message ? ` · ${reader.message}` : ''}
          </Alert>
        )}
      </div>
    </Card>
  )
}
