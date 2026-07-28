import * as React from 'react'
import { FeatureFlag, PrinterConfig, StoreInfo } from '@shared/types'
import { FeatureFlagCard } from '../components/FeatureFlagCard'
import { PaymentSettingsCard } from '../components/PaymentSettingsCard'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Switch } from '../components/ui/Switch'

export function SettingsScreen() {
  const [flags, setFlags] = React.useState<FeatureFlag[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [forceReject, setForceReject] = React.useState(false)

  const [storeInfo, setStoreInfo] = React.useState<StoreInfo>({
    name: '',
    address: '',
    phone: ''
  })
  const [printerConfig, setPrinterConfig] = React.useState<PrinterConfig>({
    type: 'PDF',
    ipAddress: '',
    port: 9100
  })
  const [settingsSaved, setSettingsSaved] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = React.useState(false)

  const loadFlags = async () => {
    try {
      if (window.api?.featureFlag) {
        const data = await window.api.featureFlag.getAll()
        setFlags(data)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load feature flags.'
      setError(msg)
    }
  }

  const loadHardwareSettings = async () => {
    try {
      if (window.api?.settings) {
        const [store, printer] = await Promise.all([
          window.api.settings.getStore(),
          window.api.settings.getPrinter()
        ])
        setStoreInfo(store)
        setPrinterConfig(printer)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load hardware settings.'
      setError(msg)
    }
  }

  React.useEffect(() => {
    loadFlags()
    loadHardwareSettings()
  }, [])

  const handleToggle = async (key: string, enabled: boolean) => {
    setError(null)
    const previousFlags = [...flags]
    setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled } : f)))

    try {
      if (forceReject) {
        throw new Error('IPC Handler Force-Rejected: Simulation of main process error.')
      }
      if (window.api?.featureFlag) {
        const updated = await window.api.featureFlag.upsert(key, enabled)
        setFlags((prev) => prev.map((f) => (f.key === key ? updated : f)))
      }
    } catch (err: unknown) {
      setFlags(previousFlags)
      const msg = err instanceof Error ? err.message : 'Failed to update feature flag.'
      setError(msg)
    }
  }

  const handleSaveHardwareSettings = async () => {
    setError(null)
    setSettingsSaved(null)
    try {
      if (window.api?.settings) {
        await Promise.all([
          window.api.settings.saveStore(storeInfo),
          window.api.settings.savePrinter(printerConfig)
        ])
        setSettingsSaved('Hardware settings saved successfully.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save hardware settings.'
      setError(msg)
    }
  }

  const handleTestNetworkPrinter = async () => {
    if (!printerConfig.ipAddress) {
      setTestResult({ ok: false, message: 'Enter a printer IP address first.' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      if (window.api?.receipt) {
        const result = await window.api.receipt.testNetwork(
          printerConfig.ipAddress,
          printerConfig.port ?? 9100
        )
        setTestResult(result)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network test failed.'
      setTestResult({ ok: false, message: msg })
    } finally {
      setTesting(false)
    }
  }

  const otcFlag = flags.find((f) => f.key === 'otcMode')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-[#94a3b8]">Configure system preferences, hardware, and feature modules.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/50 p-4 text-red-200 text-sm flex items-center justify-between">
          <div>
            <span className="font-semibold">Error: </span>
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-xs underline hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {settingsSaved && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-950/40 p-4 text-emerald-200 text-sm">
          {settingsSaved}
        </div>
      )}

      {/* Store Info for Receipt Header */}
      <Card>
        <CardHeader>
          <CardTitle>Store Information</CardTitle>
          <CardDescription>Printed on every receipt header.</CardDescription>
        </CardHeader>
        <div className="grid gap-3 mt-2">
          <div>
            <label className="text-xs text-[#94a3b8] block mb-1">Store Name</label>
            <input
              type="text"
              value={storeInfo.name}
              onChange={(e) => setStoreInfo((s) => ({ ...s, name: e.target.value }))}
              className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[#94a3b8] block mb-1">Address</label>
            <input
              type="text"
              value={storeInfo.address}
              onChange={(e) => setStoreInfo((s) => ({ ...s, address: e.target.value }))}
              className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[#94a3b8] block mb-1">Phone</label>
            <input
              type="text"
              value={storeInfo.phone}
              onChange={(e) => setStoreInfo((s) => ({ ...s, phone: e.target.value }))}
              className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm"
            />
          </div>
        </div>
      </Card>

      {/* Receipt Printer Config */}
      <Card>
        <CardHeader>
          <CardTitle>Receipt Printer</CardTitle>
          <CardDescription>
            Network thermal (port 9100) is primary. System print queue and PDF are fallbacks.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-3 mt-2">
          <div>
            <label className="text-xs text-[#94a3b8] block mb-1">Printer Type</label>
            <select
              value={printerConfig.type}
              onChange={(e) =>
                setPrinterConfig((c) => ({
                  ...c,
                  type: e.target.value as PrinterConfig['type']
                }))
              }
              className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm"
            >
              <option value="NETWORK">Network Thermal (ESC/POS, port 9100)</option>
              <option value="SYSTEM">System / USB Print Queue</option>
              <option value="PDF">PDF Fallback Only</option>
            </select>
          </div>

          {printerConfig.type === 'NETWORK' && (
            <>
              <div>
                <label className="text-xs text-[#94a3b8] block mb-1">Printer IP Address</label>
                <input
                  type="text"
                  placeholder="192.168.1.100"
                  value={printerConfig.ipAddress ?? ''}
                  onChange={(e) =>
                    setPrinterConfig((c) => ({ ...c, ipAddress: e.target.value }))
                  }
                  className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[#94a3b8] block mb-1">Port</label>
                <input
                  type="number"
                  value={printerConfig.port ?? 9100}
                  onChange={(e) =>
                    setPrinterConfig((c) => ({ ...c, port: parseInt(e.target.value, 10) || 9100 }))
                  }
                  className="w-full bg-[#0f172a] border border-[#334155] rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestNetworkPrinter}
                  disabled={testing}
                  className="px-4 py-2 bg-[#334155] hover:bg-[#475569] text-white rounded text-sm disabled:opacity-50"
                >
                  {testing ? 'Testing…' : 'Test Network Printer'}
                </button>
                {testResult && (
                  <span className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.message}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleSaveHardwareSettings}
          className="mt-4 px-4 py-2 bg-[#0d9488] hover:bg-[#0f766e] text-white rounded text-sm font-medium"
        >
          Save Hardware Settings
        </button>
      </Card>

      {/* Payment provider setup (Stage 5) */}
      <PaymentSettingsCard />

      {/* Force Reject Testing Utility */}
      <Card className="border border-amber-500/30 bg-amber-950/20">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm text-amber-400 font-medium">
              IPC Error-Bubble Path Test Mode
            </CardTitle>
            <CardDescription className="text-xs text-amber-200/70">
              Enable this to force IPC handler to reject with an error when toggling flags.
            </CardDescription>
          </div>
          <Switch checked={forceReject} onCheckedChange={setForceReject} />
        </div>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Feature Flags</h2>
        <div className="grid gap-4">
          {flags.map((flag) => (
            <FeatureFlagCard key={flag.key} flag={flag} onToggle={handleToggle} />
          ))}
        </div>
      </div>

      {otcFlag?.enabled && (
        <Card className="border-[#0d9488] bg-[#0d9488]/10 text-white transition-all animate-in fade-in">
          <CardHeader>
            <CardTitle className="text-[#14b8a6]">OTC-Only Mode Preview Active</CardTitle>
            <CardDescription className="text-[#94a3b8]">
              This placeholder card is rendered conditionally because the <strong>OTC-Only Mode</strong> feature flag is enabled.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}
