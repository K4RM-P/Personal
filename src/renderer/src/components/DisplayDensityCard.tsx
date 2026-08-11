import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { useDensity } from '../context/DensityContext'
import { DENSITY_LEVELS, DensityLevel, getDensityInfo } from '../lib/density'

/**
 * Device-level display density control. Visible to every role — not gated on
 * manager/cashier like most of this screen. Exactly 8 discrete, labeled,
 * snapping steps (not a free-drag continuous slider) — the current selection
 * applies live as the control moves, no save/apply step, no restart.
 */
export function DisplayDensityCard(): React.JSX.Element {
  const { level, setLevel } = useDensity()
  const info = getDensityInfo(level)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display Density</CardTitle>
        <CardDescription>
          Larger Text shows bigger buttons, icons, and type. More Space shrinks controls so more
          fits on screen at once. Spacing between items never changes — only content size does.
          Applies immediately on this device and on every restart.
        </CardDescription>
      </CardHeader>

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Larger Text</span>
          <span className="rounded-[var(--radius)] border border-[var(--primary)] bg-[var(--muted)] px-3 py-1 text-sm font-semibold text-[var(--primary)]">
            {info.label}
          </span>
          <span className="text-xs font-medium text-[var(--muted-foreground)]">More Space</span>
        </div>

        {/* 8 discrete snapping stops via a native range input restricted to
            integer steps 1-8 — not a free-drag continuous slider. */}
        <input
          type="range"
          min={1}
          max={8}
          step={1}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value) as DensityLevel)}
          aria-label="Display density level"
          className="w-full accent-[var(--primary)]"
          style={{ minHeight: '36px' }}
        />

        <div className="flex justify-between">
          {DENSITY_LEVELS.map((d) => (
            <button
              key={d.level}
              type="button"
              onClick={() => setLevel(d.level)}
              title={d.label}
              aria-label={d.label}
              aria-pressed={d.level === level}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              <span
                aria-hidden="true"
                className={`block h-3 w-3 rounded-full border ${
                  d.level === level
                    ? 'border-[var(--primary)] bg-[var(--primary)]'
                    : 'border-[var(--border)] bg-[var(--muted)]'
                }`}
              />
            </button>
          ))}
        </div>

        <DensityPreview level={level} />
      </div>
    </Card>
  )
}

/** Miniature mock of the checkout product grid + cart, reflecting the live density scale. */
function DensityPreview({ level }: { level: DensityLevel }): React.JSX.Element {
  const scale = getDensityInfo(level).scale

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3">
      <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">Live preview</p>
      <div
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3"
        // Scoped preview scale — mirrors --pos-density-scale without touching
        // the real document root, so the preview updates live but the gaps
        // below (grid-cols-3 gap-2) stay fixed just like the real screen.
        style={{ ['--pos-density-scale' as string]: String(scale) }}
      >
        <div className="grid grid-cols-3 gap-2">
          {['Aspirin', 'Cough Syrup', 'Vitamin C'].map((name) => (
            <div
              key={name}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)]"
              style={{ padding: 'calc(0.5rem * var(--pos-density-scale))' }}
            >
              <div
                className="truncate font-medium text-[var(--foreground)]"
                style={{ fontSize: 'calc(0.75rem * var(--pos-density-scale))' }}
              >
                {name}
              </div>
              <div
                className="font-semibold text-[var(--primary)]"
                style={{ fontSize: 'calc(0.7rem * var(--pos-density-scale))' }}
              >
                $9.99
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
          <span
            className="text-[var(--muted-foreground)]"
            style={{ fontSize: 'calc(0.7rem * var(--pos-density-scale))' }}
          >
            2 line items
          </span>
          <div
            className="flex items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] font-bold text-[var(--primary-foreground)]"
            style={{
              minHeight: 'max(24px, calc(28px * var(--pos-density-scale)))',
              minWidth: 'max(48px, calc(64px * var(--pos-density-scale)))',
              fontSize: 'calc(0.7rem * var(--pos-density-scale))'
            }}
          >
            PAY
          </div>
        </div>
      </div>
    </div>
  )
}
