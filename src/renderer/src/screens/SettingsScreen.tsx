import * as React from 'react'
import { BackupLogSummary, FeatureFlag, PrinterConfig, StoreInfo } from '@shared/types'
import { FeatureFlagCard } from '../components/FeatureFlagCard'
import { PaymentSettingsCard } from '../components/PaymentSettingsCard'
import { BackupModal } from '../components/BackupModal'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Switch } from '../components/ui/Switch'
import { useCurrentUser } from '../context/CurrentUserContext'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function SettingsScreen() {
  const { user } = useCurrentUser()
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
  const [creditSettings, setCreditSettings] = React.useState({ loyaltyPointsPerDollar: 1 })
  const [lastBackup, setLastBackup] = React.useState<BackupLogSummary | null>(null)
  const [promptOnLogout, setPromptOnLogout] = React.useState(true)
  const [showBackupModal, setShowBackupModal] = React.useState(false)

  const loadBackupSettings = async () => {
    try {
      const [last, prompt] = await Promise.all([window.api.backup.getLast(), window.api.backup.getPromptOnLogout()])
      setLastBackup(last)
      setPromptOnLogout(prompt)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load backup settings.'
      setError(msg)
    }
  }

  const handleTogglePromptOnLogout = async (enabled: boolean) => {
    setPromptOnLogout(enabled)
    try {
      await window.api.backup.savePromptOnLogout(enabled)
    } catch (err: unknown) {
      setPromptOnLogout(!enabled)
      setError(err instanceof Error ? err.message : 'Failed to save backup setting.')
    }
  }

  const handleBrowsePreviousBackups = async () => {
    if (!lastBackup) return
    try {
      await window.api.backup.openFolder(lastBackup.drivePath)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open backup folder.')
    }
  }

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
    loadBackupSettings()
    window.api.customer.getCreditSettings().then(setCreditSettings).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load customer settings.'))
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
  const rewardFlag = flags.find((f) => f.key === 'rewardPoints')
  const lotteryFlag = flags.find((f) => f.key === 'lotteryTickets')
  const chargeFlag = flags.find((f) => f.key === 'chargeAccounts')
  const tabFlag = flags.find((f) => f.key === 'customerTabs')

  const saveCreditSettings = async () => {
    try {
      await window.api.customer.saveCreditSettings(creditSettings)
      setSettingsSaved('Customer credit and loyalty settings saved successfully.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save customer settings.') }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">Settings</h1>
        <p className="text-[var(--muted-foreground)]">Configure system preferences, hardware, and feature modules.</p>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] p-4 text-sm text-[var(--error)]">
          <div>
            <span className="font-semibold">Error: </span>
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-xs underline hover:text-[var(--foreground)]">
            Dismiss
          </button>
        </div>
      )}

      {settingsSaved && (
        <div className="rounded-[var(--radius)] border border-[var(--success)]/30 bg-[var(--success-bg)] p-4 text-sm text-[var(--success)]">
          {settingsSaved}
        </div>
      )}

      {/* Store Info for Receipt Header */}
      <Card>
        <CardHeader>
          <CardTitle>Store Information</CardTitle>
          <CardDescription>Printed on every receipt header and used for the till summary.</CardDescription>
        </CardHeader>
        <div className="grid gap-3 mt-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Store Name</label>
            <input
              type="text"
              value={storeInfo.name}
              onChange={(e) => setStoreInfo((s) => ({ ...s, name: e.target.value }))}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Address</label>
            <input
              type="text"
              value={storeInfo.address}
              onChange={(e) => setStoreInfo((s) => ({ ...s, address: e.target.value }))}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Phone</label>
            <input
              type="text"
              value={storeInfo.phone}
              onChange={(e) => setStoreInfo((s) => ({ ...s, phone: e.target.value }))}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
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
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Printer Type</label>
            <select
              value={printerConfig.type}
              onChange={(e) =>
                setPrinterConfig((c) => ({
                  ...c,
                  type: e.target.value as PrinterConfig['type']
                }))
              }
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="NETWORK">Network Thermal (ESC/POS, port 9100)</option>
              <option value="SYSTEM">System / USB Print Queue</option>
              <option value="PDF">PDF Fallback Only</option>
            </select>
          </div>

          {printerConfig.type === 'NETWORK' && (
            <>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Printer IP Address</label>
                <input
                  type="text"
                  placeholder="192.168.1.100"
                  value={printerConfig.ipAddress ?? ''}
                  onChange={(e) =>
                    setPrinterConfig((c) => ({ ...c, ipAddress: e.target.value }))
                  }
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Port</label>
                <input
                  type="number"
                  value={printerConfig.port ?? 9100}
                  onChange={(e) =>
                    setPrinterConfig((c) => ({ ...c, port: parseInt(e.target.value, 10) || 9100 }))
                  }
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestNetworkPrinter}
                  disabled={testing}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
                >
                  {testing ? 'Testing…' : 'Test Network Printer'}
                </button>
                {testResult && (
                  <span className={`text-xs ${testResult.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                    {testResult.message}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleSaveHardwareSettings}
          className="mt-4 rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
        >
          Save Hardware Settings
        </button>
      </Card>

      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Payments</div>
        <PaymentSettingsCard />
      </div>

      <Card>
        <CardHeader><CardTitle>Customer Credit & Loyalty</CardTitle><CardDescription>Tab shortfalls are allowed for an attached customer. Set the loyalty earn rate here.</CardDescription></CardHeader>
        <div className="grid gap-3 mt-2">
          <div><label className="mb-1 block text-xs text-[var(--muted-foreground)]">Loyalty points earned per dollar spent</label><input type="number" min="0" step="0.1" value={creditSettings.loyaltyPointsPerDollar} onChange={e => setCreditSettings(s => ({ ...s, loyaltyPointsPerDollar: Number(e.target.value) }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"/></div>
          <button onClick={() => void saveCreditSettings()} className="w-fit rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]">Save customer settings</button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance & Operations</CardTitle>
          <CardDescription>Rx lookup, aging reports, signature capture, PSE checks, DSCSA scan, and FSA/HSA eligibility are available from the tills.</CardDescription>
        </CardHeader>
        <div className="grid gap-3 mt-2 text-sm text-[#cbd5e1]">
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
            <p className="font-semibold text-[var(--foreground)]">Rx lookup / pickup status</p>
            <p className="text-[var(--muted-foreground)]">Search by patient, Rx number, or drug name from the register to confirm pickup state and outstanding balance.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
            <p className="font-semibold text-[var(--foreground)]">Compliance export & audit trail</p>
            <p className="text-[var(--muted-foreground)]">Every override, PSE event, and ledger adjustment is logged with user/station metadata and exportable for review.</p>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
            <p className="font-semibold text-[var(--foreground)]">Backup & restore</p>
            <p className="text-[var(--muted-foreground)]">Prompted on logout and available on demand — see Data Backup below.</p>
          </div>
        </div>
      </Card>

      {/* Data Backup — docs/data-backup-system-spec.md */}
      <Card>
        <CardHeader>
          <CardTitle>Data Backup</CardTitle>
          <CardDescription>
            Copies sales, customers, users, discounts, refunds, and inventory to an external drive. The McKesson
            catalogue is never included — it can be re-imported.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-3 mt-2 text-sm">
          {lastBackup ? (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <p className="text-[var(--foreground)]">
                Last backup:{' '}
                <span className={lastBackup.status === 'SUCCESS' ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
                  {new Date(lastBackup.timestamp).toLocaleString()} ({lastBackup.status.toLowerCase()})
                </span>
              </p>
              <p className="text-[var(--muted-foreground)]">
                Location: {lastBackup.backupPath} · {formatBytes(lastBackup.backupSizeBytes)}
              </p>
              {lastBackup.errorMessage && <p className="text-[var(--error)]">{lastBackup.errorMessage}</p>}
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-[var(--muted-foreground)]">
              No backups have been run yet.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowBackupModal(true)}
              className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
            >
              Manual Backup Now
            </button>
            <button
              onClick={() => void handleBrowsePreviousBackups()}
              disabled={!lastBackup}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50"
            >
              Browse Previous Backups
            </button>
          </div>

          <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
            <div>
              <p className="font-semibold text-[var(--foreground)]">Prompt to back up on logout</p>
              <p className="text-[var(--muted-foreground)]">Recommended — asks before every logout.</p>
            </div>
            <Switch checked={promptOnLogout} onCheckedChange={(v) => void handleTogglePromptOnLogout(v)} />
          </div>
          <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 opacity-60">
            <div>
              <p className="font-semibold text-[var(--foreground)]">Auto-backup daily at 18:00</p>
              <p className="text-[var(--muted-foreground)]">Phase 2 — not yet available.</p>
            </div>
            <Switch checked={false} onCheckedChange={() => undefined} disabled />
          </div>
        </div>
      </Card>

      {showBackupModal && user && (
        <BackupModal
          userId={user.id}
          standalone
          onClose={() => {
            setShowBackupModal(false)
            void loadBackupSettings()
          }}
        />
      )}

      {/* Force Reject Testing Utility */}
      <Card className="border-[var(--warning)]/30 bg-[var(--warning-bg)]">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-[var(--warning)]">
              IPC Error-Bubble Path Test Mode
            </CardTitle>
            <CardDescription className="text-xs text-[var(--warning)]/80">
              Enable this to force IPC handler to reject with an error when toggling flags.
            </CardDescription>
          </div>
          <Switch checked={forceReject} onCheckedChange={setForceReject} />
        </div>
      </Card>

      <div className="space-y-4">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Feature Flags</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Payments, compliance, and optional modules are grouped to keep setup plain-language and predictable.</p>
        </div>
        <div className="grid gap-4">
          {flags.map((flag) => (
            <FeatureFlagCard key={flag.key} flag={flag} onToggle={handleToggle} />
          ))}
        </div>
      </div>

      {otcFlag?.enabled && (
        <Card className="border-[var(--primary)]/30 bg-[var(--muted)] text-[var(--foreground)]">
          <CardHeader>
            <CardTitle className="text-[var(--primary)]">OTC-Only Mode Preview Active</CardTitle>
            <CardDescription className="text-[var(--muted-foreground)]">
              This placeholder card is rendered conditionally because the <strong>OTC-Only Mode</strong> feature flag is enabled.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Optional Modules</CardTitle>
            <CardDescription>Each module defaults to off until a pharmacy opts in.</CardDescription>
          </CardHeader>
          <div className="space-y-3 text-sm text-[#cbd5e1]">
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">Reward points</p>
                <p className="text-[var(--muted-foreground)]">Enable dollar- or product-based loyalty.</p>
              </div>
              <span className={`text-xs ${rewardFlag?.enabled ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>{rewardFlag?.enabled ? 'On' : 'Off'}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">Ontario lottery</p>
                <p className="text-[var(--muted-foreground)]">Turn on ticket sales and win tracking when installed.</p>
              </div>
              <span className={`text-xs ${lotteryFlag?.enabled ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>{lotteryFlag?.enabled ? 'On' : 'Off'}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">Charge accounts</p>
                <p className="text-[var(--muted-foreground)]">Support invoice and statement billing.</p>
              </div>
              <span className={`text-xs ${chargeFlag?.enabled ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>{chargeFlag?.enabled ? 'On' : 'Off'}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">Customer tab / store credit</p>
                <p className="text-[var(--muted-foreground)]">Allow short-pay, advance-fill, and credit-ledger flows.</p>
              </div>
              <span className={`text-xs ${tabFlag?.enabled ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>{tabFlag?.enabled ? 'On' : 'Off'}</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reporting Snapshot</CardTitle>
            <CardDescription>A simple owner dashboard and export-ready analytics are now wired to the shared reporting layer.</CardDescription>
          </CardHeader>
          <div className="space-y-3 text-sm text-[#cbd5e1]">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <p className="font-semibold text-[var(--foreground)]">Daily sales summary</p>
              <p className="text-[var(--muted-foreground)]">Track transaction counts, revenue, top movers, and low-stock counts from one dashboard.</p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
              <p className="font-semibold text-[var(--foreground)]">CSV/XLSX exports</p>
              <p className="text-[var(--muted-foreground)]">Export report data for accountants without a proprietary format lock-in.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
