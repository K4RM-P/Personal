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
    <Card className="flex items-center justify-between">
      <div className="space-y-1 pr-4">
        <CardTitle className="text-base font-semibold text-[var(--foreground)]">
          {flag.label}
        </CardTitle>
        <CardDescription className="text-sm text-[var(--muted-foreground)]">
          {flag.description || 'No description provided.'}
        </CardDescription>
        <div className="mt-1 text-xs font-mono text-[var(--muted-foreground)]">key: {flag.key}</div>
      </div>
      <Switch checked={flag.enabled} onCheckedChange={handleToggle} disabled={loading} />
    </Card>
  )
}
