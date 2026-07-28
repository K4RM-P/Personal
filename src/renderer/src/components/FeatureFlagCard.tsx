import * as React from 'react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Switch } from './ui/Switch'
import { FeatureFlag } from '@shared/types'

interface FeatureFlagCardProps {
  flag: FeatureFlag
  onToggle: (key: string, enabled: boolean) => Promise<void>
}

export function FeatureFlagCard({ flag, onToggle }: FeatureFlagCardProps) {
  const [loading, setLoading] = React.useState(false)

  const handleToggle = async (checked: boolean) => {
    setLoading(true)
    try {
      await onToggle(flag.key, checked)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="flex items-center justify-between transition-all hover:border-[#0d9488]/50">
      <div className="space-y-1 pr-4">
        <CardTitle className="text-base font-semibold text-white">{flag.label}</CardTitle>
        <CardDescription className="text-sm text-[#94a3b8]">
          {flag.description || 'No description provided.'}
        </CardDescription>
        <div className="mt-1 text-xs text-[#64748b] font-mono">key: {flag.key}</div>
      </div>
      <Switch checked={flag.enabled} onCheckedChange={handleToggle} disabled={loading} />
    </Card>
  )
}
