import * as React from 'react'
import { FeatureFlag } from '@shared/types'
import { FeatureFlagCard } from '../components/FeatureFlagCard'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'
import { Switch } from '../components/ui/Switch'

export function SettingsScreen() {
  const [flags, setFlags] = React.useState<FeatureFlag[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [forceReject, setForceReject] = React.useState(false)

  const loadFlags = async () => {
    try {
      if (window.api && window.api.featureFlag) {
        const data = await window.api.featureFlag.getAll()
        setFlags(data)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load feature flags.')
    }
  }

  React.useEffect(() => {
    loadFlags()
  }, [])

  const handleToggle = async (key: string, enabled: boolean) => {
    setError(null)

    // Store previous state for revert
    const previousFlags = [...flags]

    // Optimistic update
    setFlags((prev) =>
      prev.map((f) => (f.key === key ? { ...f, enabled } : f))
    )

    try {
      if (forceReject) {
        throw new Error('IPC Handler Force-Rejected: Simulation of main process error.')
      }

      if (window.api && window.api.featureFlag) {
        const updated = await window.api.featureFlag.upsert(key, enabled)
        setFlags((prev) =>
          prev.map((f) => (f.key === key ? updated : f))
        )
      }
    } catch (err: any) {
      // Revert state
      setFlags(previousFlags)
      setError(err?.message || 'Failed to update feature flag.')
    }
  }

  const otcFlag = flags.find((f) => f.key === 'otcMode')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-[#94a3b8]">Configure system preferences and toggle active feature modules.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/50 p-4 text-red-200 text-sm flex items-center justify-between">
          <div>
            <span className="font-semibold">Error: </span>
            {error}
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Force Reject Testing Utility */}
      <Card className="border border-amber-500/30 bg-amber-950/20">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm text-amber-400 font-medium">
              IPC Error-Bubble Path Test Mode
            </CardTitle>
            <CardDescription className="text-xs text-amber-200/70">
              Enable this to force IPC handler to reject with an error when toggling flags, testing Switch revert & error toast path.
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

      {/* Placeholder card that dynamically appears/disappears based on otcMode flag */}
      {otcFlag?.enabled && (
        <Card className="border-[#0d9488] bg-[#0d9488]/10 text-white transition-all animate-in fade-in">
          <CardHeader>
            <CardTitle className="text-[#14b8a6]">OTC-Only Mode Preview Active</CardTitle>
            <CardDescription className="text-[#94a3b8]">
              This placeholder card is rendered conditionally because the <strong>OTC-Only Mode</strong> feature flag is enabled in SQLite database.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}
