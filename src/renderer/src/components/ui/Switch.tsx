import { cn } from '../../lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
  disabled?: boolean
}

export function Switch({ checked, onCheckedChange, className, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      // The visible track is only 24px tall (Apple-style), but the button
      // itself is the tap target — pad it out to a real 44x44px hit area so
      // it isn't a touch-target violation, without stretching the track.
      style={{ minHeight: '2.75rem', minWidth: '2.75rem' }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className
      )}
    >
      <span
        aria-hidden="true"
        style={{ minHeight: '1.5rem', minWidth: '2.75rem' }}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
          checked ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </span>
    </button>
  )
}
