import * as React from 'react'
import { cn } from '../../lib/utils'

export interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

/**
 * Friendly placeholder for empty lists/search results — icon + message, never
 * a blank void. Keep it compact: this fills operational screens, not a
 * marketing page, so no oversized centered icon eating vertical space.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-center', className)}>
      <Icon className="h-6 w-6 text-[var(--muted-foreground)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
      {description && <p className="text-xs text-[var(--muted-foreground)]">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
