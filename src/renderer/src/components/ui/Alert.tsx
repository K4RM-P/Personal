import * as React from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '../../lib/utils'

export type AlertVariant = 'success' | 'error' | 'warning' | 'info'

export interface AlertProps {
  variant: AlertVariant
  children: React.ReactNode
  className?: string
}

const VARIANT_CONFIG: Record<AlertVariant, { icon: React.ElementType; border: string; bg: string; text: string; label: string }> = {
  success: { icon: CheckCircle2, border: 'border-[var(--success)]/30', bg: 'bg-[var(--success-bg)]', text: 'text-[var(--success)]', label: 'Success' },
  error: { icon: XCircle, border: 'border-[var(--error)]/30', bg: 'bg-[var(--error-bg)]', text: 'text-[var(--error)]', label: 'Error' },
  warning: { icon: AlertTriangle, border: 'border-[var(--warning)]/30', bg: 'bg-[var(--warning-bg)]', text: 'text-[var(--warning)]', label: 'Warning' },
  info: { icon: Info, border: 'border-[var(--primary)]/30', bg: 'bg-[var(--muted)]', text: 'text-[var(--primary)]', label: 'Info' }
}

/**
 * Status banner used for scan feedback, form errors, printer/backup states, etc.
 * Always pairs an icon with the message — colorblind-safe per the design guide,
 * never relies on color/border tint alone.
 */
export function Alert({ variant, children, className }: AlertProps): React.JSX.Element {
  const { icon: Icon, border, bg, text, label } = VARIANT_CONFIG[variant]
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-[var(--radius)] border p-3 text-xs', border, bg, text, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      <span className="leading-snug">{children}</span>
    </div>
  )
}
