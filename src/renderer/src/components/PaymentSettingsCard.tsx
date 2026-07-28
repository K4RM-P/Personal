import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
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

const inputCls =
  'w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#0d9488]'

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
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          Choose how card payments are handled. You can switch modes anytime without losing any data —
          this only changes which adapter runs the payment step; checkout stays the same.
        </CardDescription>
      </CardHeader>

      <div className="mt-2">
        <button
          onClick={() => setWizardOpen((o) => !o)}
          className="text-xs px-3 py-1.5 rounded border border-[#0d9488]/50 text-[#14b8a6] hover:bg-[#0d9488]/10"
        >
          {wizardOpen ? 'Hide setup guide' : 'Not sure? Run the setup guide'}
        </button>
      </div>

      {wizardOpen && (
        <div className="mt-3 rounded border border-[#334155] bg-[#0f172a] p-4 space-y-4 text-sm">
          <div>
            <p className="text-white font-medium">1. Do you have a payment terminal already?</p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setWizardOpen(true)}
                className="px-3 py-1.5 rounded bg-[#334155] text-white text-xs"
                disabled
              >
                Answer below ↓
              </button>
            </div>
          </div>
          <div>
            <p className="text-white font-medium">2. Is it connected to your network / does it support card-present API integration?</p>
            <p className="text-[#94a3b8] text-xs mt-1">
              Not sure? Check the terminal's model number, or ask your card processor whether they offer
              “integrated / semi-integrated POS support.” If it’s a plain countertop terminal that prints
              its own receipt and isn’t plugged into this computer or your network, it is <em>not</em> integrated.
            </p>
          </div>
          <div className="grid gap-2">
            <p className="text-white font-medium">Recommended for your setup:</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => pickFromWizard('manual')} className="px-3 py-1.5 rounded bg-[#0d9488] text-white text-xs">
                No terminal / not integrated → Manual/External
              </button>
              <button onClick={() => pickFromWizard('stripe')} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs">
                Integrated cloud reader → Stripe/Square
              </button>
              <button onClick={() => pickFromWizard('moneris')} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs">
                Integrated PIN pad → Moneris/Global Payments
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 mt-4">
        <div>
          <label className="text-xs text-[#94a3b8] block mb-1">Processor</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as PaymentProviderName)} className={inputCls}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} — {p.category}
              </option>
            ))}
          </select>
        </div>

        {provider === 'manual' && (
          <p className="text-xs text-[#94a3b8] rounded border border-[#334155] bg-[#0f172a] px-3 py-2">
            Manual mode is a deliberate, first-class option. At checkout the cashier keys the total into
            your standalone terminal, then taps <strong>Approved</strong> or <strong>Declined</strong> here.
            No API keys needed.
          </p>
        )}

        {meta.needsKey && (
          <>
            <div>
              <label className="text-xs text-[#94a3b8] block mb-1">Environment</label>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value as PaymentEnvironment)} className={inputCls}>
                <option value="sandbox">Sandbox / Test</option>
                <option value="production">Production / Live</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[#94a3b8] block mb-1">
                Terminal / Reader id {meta.terminalHint ? `— ${meta.terminalHint}` : ''}
              </label>
              <input type="text" value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#94a3b8] block mb-1">
                API credentials {meta.keyHint ? `— ${meta.keyHint}` : ''}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? '•••••••• (stored — leave blank to keep)' : 'Enter to store securely'}
                className={inputCls}
              />
              <p className="text-[11px] text-[#64748b] mt-1">
                Stored encrypted via your OS keychain (Electron safeStorage) — never in plaintext.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleSave} className="px-4 py-2 bg-[#0d9488] hover:bg-[#0f766e] text-white rounded text-sm font-medium">
            Save Payment Settings
          </button>
          <button
            onClick={handleCheckReader}
            disabled={checking}
            className="px-4 py-2 bg-[#334155] hover:bg-[#475569] text-white rounded text-sm disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check Reader Status'}
          </button>
          {saved && <span className="text-xs text-emerald-400">{saved}</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>

        {reader && (
          <div className={`text-xs rounded px-3 py-2 border ${reader.connected ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>
            {reader.connected ? '● Connected' : '○ Not connected'} — {reader.label ?? reader.provider}
            {reader.message ? ` · ${reader.message}` : ''}
          </div>
        )}
      </div>
    </Card>
  )
}
