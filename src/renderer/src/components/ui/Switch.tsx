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
      // The app-wide `button { min-height: 44px }` reset (index.css) isn't
      // scoped to a Tailwind layer, so it wins over the h-6 utility below and
      // stretches this into a tall blob unless overridden inline.
      style={{ minHeight: '1.5rem', minWidth: '2.75rem' }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}
