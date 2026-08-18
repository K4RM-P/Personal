import * as React from 'react'
import {
  BackupDestination,
  BackupLogSummary,
  ExternalDrive,
  FeatureFlag,
  PrinterConfig,
  StoreInfo,
  SystemPrinterInfo
} from '@shared/types'
import { CheckCircle2, Circle, Search, X } from 'lucide-react'
import { FeatureFlagCard } from '../components/FeatureFlagCard'
import { PaymentSettingsCard } from '../components/PaymentSettingsCard'
import { CustomerDisplaySettingsCard } from '../components/CustomerDisplaySettingsCard'
import { ReportEmailSettingsCard } from '../components/ReportEmailSettingsCard'
import { ReportCsvExportSettingsCard } from '../components/ReportCsvExportSettingsCard'
import { UpdateSettingsCard } from '../components/UpdateSettingsCard'
import { BackupModal } from '../components/BackupModal'
import { RestoreBackupModal } from '../components/RestoreBackupModal'
import { DeleteAllDataModal } from '../components/DeleteAllDataModal'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Switch } from '../components/ui/Switch'
import { Alert } from '../components/ui/Alert'
import { useCurrentUser } from '../context/CurrentUserContext'
import { DisplayDensityCard } from '../components/DisplayDensityCard'

function ModuleStatusBadge({ enabled }: { enabled?: boolean }): React.JSX.Element {
  const Icon = enabled ? CheckCircle2 : Circle
  return (
    <span
      className={`flex items-center gap-1 text-xs font-medium ${enabled ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}
    >
      <Icon className="icon-3_5" aria-hidden="true" />
      {enabled ? 'On' : 'Off'}
    </span>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

// Sections are ordered top-to-bottom by how important and how often a
// pharmacy manager actually touches them day-to-day — not by when they were
// built. Each id also carries the search keywords the top search bar filters
// against (title + plain-language synonyms a manager might type).
type SettingsTier = 'daily' | 'setup' | 'compliance' | 'system'

const SECTION_KEYWORDS: Record<string, string[]> = {
  payment: [
    'payment mode',
    'payment',
    'card',
    'terminal',
    'stripe',
    'square',
    'clover',
    'moneris',
    'global payments',
    'processor',
    'pin pad',
    'reader',
    'credit card fee',
    'surcharge'
  ],
  printer: [
    'receipt printer',
    'printer',
    'network printer',
    'thermal',
    'esc/pos',
    'escpos',
    'port 9100',
    'system printer',
    'print queue',
    'pdf'
  ],
  backup: [
    'data backup',
    'backup',
    'restore',
    'external drive',
    'usb drive',
    'logout backup',
    'auto-backup'
  ],
  storeInfo: [
    'store information',
    'store name',
    'address',
    'phone',
    'license',
    'pharmacy license',
    'email',
    'logo',
    'receipt header'
  ],
  receiptTemplate: [
    'receipt template',
    'custom template',
    'html template',
    'preview receipt',
    'export receipt'
  ],
  credit: [
    'customer credit',
    'loyalty',
    'loyalty points',
    'points per dollar',
    'tab',
    'pharmacy credit'
  ],
  density: [
    'display density',
    'font size',
    'text size',
    'zoom',
    'spacing',
    'touch target size',
    'screen density'
  ],
  compliance: [
    'compliance',
    'operations',
    'rx lookup',
    'pickup status',
    'audit trail',
    'pse',
    'dscsa',
    'fsa',
    'hsa'
  ],
  customerDisplay: [
    'customer display',
    'customer facing display',
    'second screen',
    'second monitor',
    'slideshow',
    'slides',
    'kiosk',
    'e-transfer email',
    'etransfer email'
  ],
  featureFlags: ['feature flags', 'modules', 'toggle'],
  optionalModules: [
    'optional modules',
    'reward points',
    'lottery',
    'ontario lottery',
    'charge accounts',
    'customer tab',
    'store credit'
  ],
  reportingSnapshot: ['reporting', 'reports', 'dashboard', 'csv', 'xlsx', 'export'],
  reportEmail: [
    'report email',
    'scheduled reports',
    'email reports',
    'digest',
    'auto email',
    'smtp',
    'recipient email'
  ],
  reportCsvExport: [
    'csv export',
    'scheduled csv',
    'auto export',
    'sales report csv',
    'complete products sales',
    'export folder'
  ],
  updates: ['software update', 'update', 'auto update', 'version', 'install update'],
  testMode: ['test mode', 'ipc error', 'force reject', 'debug', 'simulate error']
}

const TIER_LABELS: Record<SettingsTier, { title: string; description: string }> = {
  daily: {
    title: 'Daily operations',
    description: 'Checked or used every shift — payments, printing, and backups.'
  },
  setup: {
    title: 'Store setup',
    description: 'Configured occasionally, but important — receipt details and pricing.'
  },
  compliance: {
    title: 'Compliance & modules',
    description: 'Reference information and one-time module toggles.'
  },
  system: {
    title: 'System',
    description: 'Updates and diagnostic tools — rarely needed.'
  }
}

const TIER_SECTIONS: Record<SettingsTier, string[]> = {
  daily: ['payment', 'printer', 'backup'],
  setup: ['storeInfo', 'receiptTemplate', 'credit', 'density', 'customerDisplay'],
  compliance: [
    'compliance',
    'featureFlags',
    'optionalModules',
    'reportingSnapshot',
    'reportEmail',
    'reportCsvExport'
  ],
  system: ['updates', 'testMode']
}

export function SettingsScreen() {
  const { user } = useCurrentUser()
  const [flags, setFlags] = React.useState<FeatureFlag[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [forceReject, setForceReject] = React.useState(false)
  const [settingsSearch, setSettingsSearch] = React.useState('')

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
  const [systemPrinters, setSystemPrinters] = React.useState<SystemPrinterInfo[]>([])
  const [creditSettings, setCreditSettings] = React.useState({
    loyaltyPointsPerDollar: 1,
    debtWarningThresholdDays: 30
  })
  const [lastBackup, setLastBackup] = React.useState<BackupLogSummary | null>(null)
  const [promptOnLogout, setPromptOnLogout] = React.useState(true)
  const [showBackupModal, setShowBackupModal] = React.useState(false)
  const [showRestoreModal, setShowRestoreModal] = React.useState(false)
  const [showDeleteAllDataModal, setShowDeleteAllDataModal] = React.useState(false)
  const [backupDestination, setBackupDestination] = React.useState<BackupDestination | null>(null)
  const [availableDrives, setAvailableDrives] = React.useState<ExternalDrive[]>([])
  const [savingDestination, setSavingDestination] = React.useState(false)

  const loadBackupSettings = async () => {
    try {
      const [last, prompt, destination, drives] = await Promise.all([
        window.api.backup.getLast(),
        window.api.backup.getPromptOnLogout(),
        window.api.backup.getDrivePath(),
        window.api.backup.getExternalDrives()
      ])
      setLastBackup(last)
      setPromptOnLogout(prompt)
      setBackupDestination(destination)
      setAvailableDrives(drives)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load backup settings.'
      setError(msg)
    }
  }

  const handleSelectBackupDestination = async (
    drivePath: string,
    driveName: string
  ): Promise<void> => {
    setSavingDestination(true)
    setError(null)
    try {
      await window.api.backup.saveDrivePath(drivePath, driveName)
      setBackupDestination({ drivePath, driveName })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save backup destination.')
    } finally {
      setSavingDestination(false)
    }
  }

  const handleBrowseBackupDestination = async (): Promise<void> => {
    try {
      const path = await window.api.backup.pickFolder()
      if (path) await handleSelectBackupDestination(path, path.split('/').pop() || path)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker.')
    }
  }

  const handleRescanDrives = async (): Promise<void> => {
    try {
      setAvailableDrives(await window.api.backup.getExternalDrives())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to scan for external drives.')
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

  const loadSystemPrinters = async (): Promise<void> => {
    try {
      setSystemPrinters(await window.api.receipt.listPrinters())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to list system printers.')
    }
  }

  React.useEffect(() => {
    loadFlags()
    loadHardwareSettings()
    loadBackupSettings()
    loadSystemPrinters()
    window.api.customer
      .getCreditSettings()
      .then(setCreditSettings)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load customer settings.')
      )
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

  const handleUploadLogo = async () => {
    setError(null)
    setSettingsSaved(null)
    try {
      const result = await window.api.settings.uploadLogo()
      if (result) {
        setStoreInfo((s) => ({ ...s, logoDataUrl: result.logoDataUrl }))
        setSettingsSaved('Logo uploaded and saved.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload logo.')
    }
  }

  const handleRemoveLogo = async () => {
    setError(null)
    try {
      await window.api.settings.removeLogo()
      setStoreInfo((s) => ({ ...s, logoDataUrl: undefined }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove logo.')
    }
  }

  const handleUploadReceiptTemplate = async () => {
    setError(null)
    setSettingsSaved(null)
    try {
      const result = await window.api.settings.uploadReceiptTemplate()
      if (result) {
        setStoreInfo((s) => ({
          ...s,
          customReceiptTemplateHtml: result.customReceiptTemplateHtml,
          useCustomReceiptTemplate: result.useCustomReceiptTemplate
        }))
        setSettingsSaved('Custom receipt template uploaded and enabled.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload receipt template.')
    }
  }

  const handleClearReceiptTemplate = async () => {
    setError(null)
    try {
      await window.api.settings.clearReceiptTemplate()
      setStoreInfo((s) => ({
        ...s,
        customReceiptTemplateHtml: undefined,
        useCustomReceiptTemplate: false
      }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to clear receipt template.')
    }
  }

  const handleToggleCustomTemplate = async (enabled: boolean) => {
    setError(null)
    const previous = storeInfo.useCustomReceiptTemplate
    setStoreInfo((s) => ({ ...s, useCustomReceiptTemplate: enabled }))
    try {
      await window.api.settings.setUseCustomReceiptTemplate(enabled)
    } catch (err: unknown) {
      setStoreInfo((s) => ({ ...s, useCustomReceiptTemplate: previous }))
      setError(err instanceof Error ? err.message : 'Failed to update receipt template setting.')
    }
  }

  const handleViewReceipt = async () => {
    setError(null)
    try {
      await window.api.receipt.preview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open receipt preview.')
    }
  }

  const handleExportReceipt = async () => {
    setError(null)
    setSettingsSaved(null)
    try {
      const result = await window.api.receipt.export()
      if (result) setSettingsSaved(`Receipt exported to ${result.path}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to export receipt.')
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

  const rewardFlag = flags.find((f) => f.key === 'rewardPoints')
  const lotteryFlag = flags.find((f) => f.key === 'lotteryTickets')
  const chargeFlag = flags.find((f) => f.key === 'chargeAccounts')
  const tabFlag = flags.find((f) => f.key === 'customerTabs')

  const saveCreditSettings = async () => {
    try {
      await window.api.customer.saveCreditSettings(creditSettings)
      setSettingsSaved('Customer credit and loyalty settings saved successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer settings.')
    }
  }

  const trimmedQuery = settingsSearch.trim().toLowerCase()
  const sectionVisible = (id: string): boolean => {
    if (!trimmedQuery) return true
    const keywords = SECTION_KEYWORDS[id]
    if (!keywords) return true
    return keywords.some((k) => k.includes(trimmedQuery))
  }
  const tierVisible = (tier: SettingsTier): boolean =>
    TIER_SECTIONS[tier].some((id) => sectionVisible(id))
  const anySectionVisible = (Object.keys(TIER_SECTIONS) as SettingsTier[]).some(tierVisible)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">Settings</h1>
        <p className="text-[var(--muted-foreground)]">
          Configure system preferences, hardware, and feature modules.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3">
          <Alert variant="error" className="flex-1">
            {error}
          </Alert>
          <button
            onClick={() => setError(null)}
            className="min-h-11 shrink-0 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {settingsSaved && <Alert variant="success">{settingsSaved}</Alert>}

      <div className="relative">
        <Search
          className="icon-4 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden="true"
        />
        <input
          type="text"
          value={settingsSearch}
          onChange={(e) => setSettingsSearch(e.target.value)}
          placeholder="Search settings — e.g. printer, backup, loyalty, payment"
          aria-label="Search settings"
          className="input pl-10 pr-10"
        />
        {settingsSearch && (
          <button
            type="button"
            onClick={() => setSettingsSearch('')}
            aria-label="Clear settings search"
            className="absolute right-0 top-0 flex h-full w-11 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-inset"
          >
            <X className="icon-4" />
          </button>
        )}
      </div>

      {!anySectionVisible && (
        <Alert variant="info">
          No settings match &quot;{settingsSearch}&quot;. Try a different word, or{' '}
          <button
            type="button"
            onClick={() => setSettingsSearch('')}
            className="font-semibold underline"
          >
            clear the search
          </button>
          .
        </Alert>
      )}

      {/* Daily operations — payments, printing, backups: checked/used every shift. */}
      {tierVisible('daily') && (
        <div className="space-y-4">
          <div className="border-b border-[var(--border)] pb-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {TIER_LABELS.daily.title}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {TIER_LABELS.daily.description}
            </p>
          </div>

          {sectionVisible('payment') && (
            <Card>
              <PaymentSettingsCard />
            </Card>
          )}

          {sectionVisible('printer') && (
            <Card>
              <CardHeader>
                <CardTitle>Receipt Printer</CardTitle>
                <CardDescription>
                  Network thermal (port 9100) is primary. System print queue and PDF are fallbacks.
                </CardDescription>
              </CardHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Printer Type
                  </label>
                  <select
                    value={printerConfig.type}
                    onChange={(e) =>
                      setPrinterConfig((c) => ({
                        ...c,
                        type: e.target.value as PrinterConfig['type']
                      }))
                    }
                    className="input"
                  >
                    <option value="NETWORK">Network Thermal (ESC/POS, port 9100)</option>
                    <option value="SYSTEM">System / USB Print Queue</option>
                    <option value="PDF">PDF Fallback Only</option>
                  </select>
                </div>

                {printerConfig.type === 'NETWORK' && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                        Printer IP Address
                      </label>
                      <input
                        type="text"
                        placeholder="192.168.1.100"
                        value={printerConfig.ipAddress ?? ''}
                        onChange={(e) =>
                          setPrinterConfig((c) => ({ ...c, ipAddress: e.target.value }))
                        }
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                        Port
                      </label>
                      <input
                        type="number"
                        value={printerConfig.port ?? 9100}
                        onChange={(e) =>
                          setPrinterConfig((c) => ({
                            ...c,
                            port: parseInt(e.target.value, 10) || 9100
                          }))
                        }
                        className="input w-28"
                      />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={handleTestNetworkPrinter}
                        disabled={testing}
                        className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-sm text-[var(--foreground)] disabled:opacity-50"
                      >
                        {testing ? 'Testing…' : 'Test Network Printer'}
                      </button>
                      {testResult && (
                        <Alert
                          variant={testResult.ok ? 'success' : 'error'}
                          className="flex-1 min-w-[200px]"
                        >
                          {testResult.message}
                        </Alert>
                      )}
                    </div>
                  </>
                )}

                {printerConfig.type === 'SYSTEM' && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                        System Printer
                      </label>
                      {systemPrinters.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          No printers detected. Make sure a printer is installed on this computer,
                          then rescan.
                        </p>
                      ) : (
                        <select
                          value={printerConfig.deviceName ?? ''}
                          onChange={(e) =>
                            setPrinterConfig((c) => ({
                              ...c,
                              deviceName: e.target.value || undefined
                            }))
                          }
                          className="input"
                        >
                          <option value="">Use OS default printer</option>
                          {systemPrinters.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.displayName}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        Receipts print straight to this printer — no print dialog will appear.
                      </p>
                    </div>
                    <button
                      onClick={() => void loadSystemPrinters()}
                      className="min-h-11 w-fit rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-4 text-sm text-[var(--foreground)]"
                    >
                      Rescan Printers
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={handleSaveHardwareSettings}
                className="min-h-11 mt-4 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
              >
                Save Hardware Settings
              </button>
            </Card>
          )}

          {sectionVisible('backup') && (
            <Card>
              <CardHeader>
                <CardTitle>Data Backup</CardTitle>
                <CardDescription>
                  Copies sales, customers, users, discounts, refunds, and inventory to an external
                  drive. The McKesson catalogue is never included — it can be re-imported.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3 mt-4 text-sm">
                {lastBackup ? (
                  <Alert variant={lastBackup.status === 'SUCCESS' ? 'success' : 'error'}>
                    <span className="text-[var(--foreground)]">
                      Last backup: {new Date(lastBackup.timestamp).toLocaleString()} (
                      {lastBackup.status === 'SUCCESS' ? 'succeeded' : 'failed'})
                    </span>
                    <br />
                    <span className="text-[var(--muted-foreground)]">
                      Location: {lastBackup.backupPath} · {formatBytes(lastBackup.backupSizeBytes)}
                    </span>
                    {lastBackup.errorMessage && (
                      <>
                        <br />
                        <span>{lastBackup.errorMessage}</span>
                      </>
                    )}
                  </Alert>
                ) : (
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-[var(--muted-foreground)]">
                    No backups have been run yet.
                  </div>
                )}

                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 space-y-2">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      Backup destination (USB drive)
                    </p>
                    <p className="text-[var(--muted-foreground)]">
                      Manual Backup Now writes straight here. When a new backup finishes, the
                      previous one on this drive is deleted automatically.
                    </p>
                  </div>

                  {backupDestination ? (
                    <p className="text-[var(--foreground)]">
                      Currently: <span className="font-medium">{backupDestination.driveName}</span>{' '}
                      <span className="text-[var(--muted-foreground)]">
                        ({backupDestination.drivePath})
                      </span>
                    </p>
                  ) : (
                    <p className="text-[var(--muted-foreground)]">
                      No destination configured yet — choose one below.
                    </p>
                  )}

                  {availableDrives.length > 0 && (
                    <div className="space-y-1">
                      {availableDrives.map((drive) => (
                        <label
                          key={drive.path}
                          className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                        >
                          <input
                            type="radio"
                            name="settings-backup-drive"
                            checked={backupDestination?.drivePath === drive.path}
                            disabled={savingDestination}
                            onChange={() =>
                              void handleSelectBackupDestination(drive.path, drive.name)
                            }
                          />
                          <span className="flex-1">{drive.name}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleRescanDrives()}
                      className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs text-[var(--foreground)] hover:bg-[var(--card)]"
                    >
                      Rescan Drives
                    </button>
                    <button
                      onClick={() => void handleBrowseBackupDestination()}
                      disabled={savingDestination}
                      className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-50"
                    >
                      Browse…
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowBackupModal(true)}
                    className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
                  >
                    Manual Backup Now
                  </button>
                  <button
                    onClick={() => void handleBrowsePreviousBackups()}
                    disabled={!lastBackup}
                    className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-4 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50"
                  >
                    Browse Previous Backups
                  </button>
                  <button
                    onClick={() => setShowRestoreModal(true)}
                    className="min-h-11 rounded-[var(--radius)] border border-[var(--error)] px-4 text-sm text-[var(--error)] hover:bg-[var(--error-bg)]"
                  >
                    Restore from Backup…
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      Prompt to back up on logout
                    </p>
                    <p className="text-[var(--muted-foreground)]">
                      Recommended — asks before every logout.
                    </p>
                  </div>
                  <Switch
                    checked={promptOnLogout}
                    onCheckedChange={(v) => void handleTogglePromptOnLogout(v)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 opacity-60">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      Auto-backup daily at 18:00
                    </p>
                    <p className="text-[var(--muted-foreground)]">Phase 2 — not yet available.</p>
                  </div>
                  <Switch checked={false} onCheckedChange={() => undefined} disabled />
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Store setup — occasional but important: receipt details, pricing, device display. */}
      {tierVisible('setup') && (
        <div className="space-y-4">
          <div className="border-b border-[var(--border)] pb-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {TIER_LABELS.setup.title}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {TIER_LABELS.setup.description}
            </p>
          </div>

          {sectionVisible('storeInfo') && (
            <Card>
              <CardHeader>
                <CardTitle>Store Information</CardTitle>
                <CardDescription>
                  Printed on every receipt header and used for the till summary.
                </CardDescription>
              </CardHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Store Name
                  </label>
                  <input
                    type="text"
                    value={storeInfo.name}
                    onChange={(e) => setStoreInfo((s) => ({ ...s, name: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Address
                  </label>
                  <input
                    type="text"
                    value={storeInfo.address}
                    onChange={(e) => setStoreInfo((s) => ({ ...s, address: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Phone</label>
                  <input
                    type="text"
                    value={storeInfo.phone}
                    onChange={(e) => setStoreInfo((s) => ({ ...s, phone: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Pharmacy License Number
                  </label>
                  <input
                    type="text"
                    value={storeInfo.licenseNumber ?? ''}
                    onChange={(e) => setStoreInfo((s) => ({ ...s, licenseNumber: e.target.value }))}
                    className="input"
                    placeholder="e.g. ON-12345"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Email</label>
                  <input
                    type="email"
                    value={storeInfo.email ?? ''}
                    onChange={(e) => setStoreInfo((s) => ({ ...s, email: e.target.value }))}
                    className="input"
                    placeholder="pharmacy@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Receipt Logo
                  </label>
                  <div className="flex items-center gap-3">
                    {storeInfo.logoDataUrl ? (
                      <img
                        src={storeInfo.logoDataUrl}
                        alt="Receipt logo preview"
                        className="h-12 w-auto max-w-[160px] rounded-[var(--radius)] border border-[var(--border)] bg-white object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-12 w-24 items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
                        No logo
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleUploadLogo()}
                      className="min-h-9 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                    >
                      Upload Logo
                    </button>
                    {storeInfo.logoDataUrl && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveLogo()}
                        className="min-h-9 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive)]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    PNG, JPG, GIF, or WebP, up to 2MB. Appears at the top of every receipt.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {sectionVisible('receiptTemplate') && (
            <Card>
              <CardHeader>
                <CardTitle>Receipt Template</CardTitle>
                <CardDescription>
                  Upload a custom HTML receipt template, or preview/export the receipt as it will
                  print today.
                </CardDescription>
              </CardHeader>
              <div className="space-y-4 mt-4">
                <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] p-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      Use custom receipt template
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {storeInfo.customReceiptTemplateHtml
                        ? 'A custom template has been uploaded.'
                        : 'Upload an HTML template below to enable this.'}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(storeInfo.useCustomReceiptTemplate)}
                    onCheckedChange={handleToggleCustomTemplate}
                    disabled={!storeInfo.customReceiptTemplateHtml}
                    aria-label="Use custom receipt template"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleUploadReceiptTemplate()}
                    className="min-h-9 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                  >
                    Upload Custom Template (.html)
                  </button>
                  {storeInfo.customReceiptTemplateHtml && (
                    <button
                      type="button"
                      onClick={() => void handleClearReceiptTemplate()}
                      className="min-h-9 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive)]"
                    >
                      Remove Custom Template
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Templates use <code>{'{{storeName}}'}</code>, <code>{'{{logo}}'}</code>,{' '}
                  <code>{'{{items}}'}</code>, <code>{'{{total}}'}</code>, and similar placeholders —
                  see the app documentation for the full token list.
                </p>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                  <button
                    type="button"
                    onClick={() => void handleViewReceipt()}
                    className="min-h-9 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                  >
                    View Current Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportReceipt()}
                    className="min-h-9 rounded-[var(--radius)] border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                  >
                    Export Receipt (PDF/HTML)
                  </button>
                </div>
              </div>
            </Card>
          )}

          {sectionVisible('credit') && (
            <Card>
              <CardHeader>
                <CardTitle>Customer Credit & Loyalty</CardTitle>
                <CardDescription>
                  Tab shortfalls are allowed for an attached customer. Set the loyalty earn rate
                  here.
                </CardDescription>
              </CardHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Loyalty points earned per dollar spent
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={creditSettings.loyaltyPointsPerDollar}
                    onChange={(e) =>
                      setCreditSettings((s) => ({
                        ...s,
                        loyaltyPointsPerDollar: Number(e.target.value)
                      }))
                    }
                    className="input w-24"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                    Warn if a customer&apos;s debt is older than (days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={creditSettings.debtWarningThresholdDays}
                    onChange={(e) =>
                      setCreditSettings((s) => ({
                        ...s,
                        debtWarningThresholdDays: Number(e.target.value)
                      }))
                    }
                    className="input w-24"
                  />
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Customers with an unpaid tab older than this show up as warnings in Reports ›
                    Customers, and count toward the Dashboard&apos;s overdue-tabs alert.
                  </p>
                </div>
                <button
                  onClick={() => void saveCreditSettings()}
                  className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
                >
                  Save customer settings
                </button>
              </div>
            </Card>
          )}

          {sectionVisible('customerDisplay') && (
            <Card>
              <CustomerDisplaySettingsCard />
            </Card>
          )}

          {sectionVisible('density') && (
            /* Display Density — device-level, visible to every role (not gated on
                `isManager`/user role like the other sections). */
            <DisplayDensityCard />
          )}
        </div>
      )}

      {/* Compliance & modules — reference info and one-time toggles. */}
      {tierVisible('compliance') && (
        <div className="space-y-4">
          <div className="border-b border-[var(--border)] pb-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {TIER_LABELS.compliance.title}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {TIER_LABELS.compliance.description}
            </p>
          </div>

          {sectionVisible('compliance') && (
            <Card>
              <CardHeader>
                <CardTitle>Compliance & Operations</CardTitle>
                <CardDescription>
                  Rx lookup, aging reports, signature capture, PSE checks, DSCSA scan, and FSA/HSA
                  eligibility are available from the tills.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3 mt-4 text-sm text-[var(--foreground)]">
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                  <p className="font-semibold text-[var(--foreground)]">
                    Rx lookup / pickup status
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    Search by patient, Rx number, or drug name from the register to confirm pickup
                    state and outstanding balance.
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                  <p className="font-semibold text-[var(--foreground)]">
                    Compliance export & audit trail
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    Every override, PSE event, and ledger adjustment is logged with user/station
                    metadata and exportable for review.
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                  <p className="font-semibold text-[var(--foreground)]">Backup & restore</p>
                  <p className="text-[var(--muted-foreground)]">
                    Prompted on logout and available on demand — see Data Backup above.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {sectionVisible('featureFlags') && (
            <div className="space-y-4">
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4">
                <h3 className="text-base font-semibold text-[var(--foreground)]">Feature Flags</h3>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Payments, compliance, and optional modules are grouped to keep setup
                  plain-language and predictable.
                </p>
              </div>
              <div className="grid gap-4">
                {flags.map((flag) => (
                  <FeatureFlagCard key={flag.key} flag={flag} onToggle={handleToggle} />
                ))}
              </div>
            </div>
          )}

          {(sectionVisible('optionalModules') ||
            sectionVisible('reportingSnapshot') ||
            sectionVisible('reportEmail') ||
            sectionVisible('reportCsvExport')) && (
            <div className="grid gap-4 md:grid-cols-2">
              {sectionVisible('optionalModules') && (
                <Card>
                  <CardHeader>
                    <CardTitle>Optional Modules</CardTitle>
                    <CardDescription>
                      Each module defaults to off until a pharmacy opts in.
                    </CardDescription>
                  </CardHeader>
                  <div className="space-y-3 text-sm text-[var(--foreground)]">
                    <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">Reward points</p>
                        <p className="text-[var(--muted-foreground)]">
                          Enable dollar- or product-based loyalty.
                        </p>
                      </div>
                      <ModuleStatusBadge enabled={rewardFlag?.enabled} />
                    </div>
                    <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">Ontario lottery</p>
                        <p className="text-[var(--muted-foreground)]">
                          Turn on ticket sales and win tracking when installed.
                        </p>
                      </div>
                      <ModuleStatusBadge enabled={lotteryFlag?.enabled} />
                    </div>
                    <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">Charge accounts</p>
                        <p className="text-[var(--muted-foreground)]">
                          Support invoice and statement billing.
                        </p>
                      </div>
                      <ModuleStatusBadge enabled={chargeFlag?.enabled} />
                    </div>
                    <div className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">Pharmacy Credit</p>
                        <p className="text-[var(--muted-foreground)]">
                          Allow short-pay, advance-fill, and credit-ledger flows.
                        </p>
                      </div>
                      <ModuleStatusBadge enabled={tabFlag?.enabled} />
                    </div>
                  </div>
                </Card>
              )}

              {sectionVisible('reportingSnapshot') && (
                <Card>
                  <CardHeader>
                    <CardTitle>Reporting Snapshot</CardTitle>
                    <CardDescription>
                      A simple owner dashboard and export-ready analytics are now wired to the
                      shared reporting layer.
                    </CardDescription>
                  </CardHeader>
                  <div className="space-y-3 text-sm text-[var(--foreground)]">
                    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                      <p className="font-semibold text-[var(--foreground)]">Daily sales summary</p>
                      <p className="text-[var(--muted-foreground)]">
                        Track transaction counts, revenue, top movers, and low-stock counts from one
                        dashboard.
                      </p>
                    </div>
                    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
                      <p className="font-semibold text-[var(--foreground)]">CSV/XLSX exports</p>
                      <p className="text-[var(--muted-foreground)]">
                        Export report data for accountants without a proprietary format lock-in.
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {sectionVisible('reportEmail') && (
                <Card>
                  <ReportEmailSettingsCard />
                </Card>
              )}

              {sectionVisible('reportCsvExport') && (
                <Card>
                  <ReportCsvExportSettingsCard />
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* System — updates and diagnostics, rarely needed. */}
      {tierVisible('system') && (
        <div className="space-y-4">
          <div className="border-b border-[var(--border)] pb-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {TIER_LABELS.system.title}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {TIER_LABELS.system.description}
            </p>
          </div>

          {sectionVisible('updates') && <UpdateSettingsCard />}

          {sectionVisible('testMode') && (
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
          )}
        </div>
      )}

      {/* Danger Zone — always shown at the very bottom, regardless of tier/search filtering. */}
      <div className="space-y-4">
        <div className="border-b border-[var(--error)]/30 pb-1">
          <h2 className="text-base font-semibold text-[var(--error)]">Danger Zone</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Irreversible actions. Proceed with extreme caution.
          </p>
        </div>
        <Card className="border-[var(--error)]/40 bg-[var(--error-bg)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-medium text-[var(--error)]">
                Delete all data
              </CardTitle>
              <CardDescription className="text-xs text-[var(--error)]/80">
                Permanently erases every product, customer, transaction, and setting in this
                store. Requires manager re-authentication and a confirmation code.
              </CardDescription>
            </div>
            <button
              onClick={() => setShowDeleteAllDataModal(true)}
              className="min-h-11 shrink-0 rounded-[var(--radius)] bg-[var(--error)] px-4 text-sm font-semibold text-white"
            >
              DELETE ALL DATA
            </button>
          </div>
        </Card>
      </div>

      {showDeleteAllDataModal && (
        <DeleteAllDataModal onClose={() => setShowDeleteAllDataModal(false)} />
      )}

      {showBackupModal && user && (
        <BackupModal
          userId={user.id}
          standalone
          presetDrive={
            backupDestination
              ? { path: backupDestination.drivePath, name: backupDestination.driveName }
              : undefined
          }
          onClose={() => {
            setShowBackupModal(false)
            void loadBackupSettings()
          }}
        />
      )}

      {showRestoreModal && <RestoreBackupModal onClose={() => setShowRestoreModal(false)} />}
    </div>
  )
}
