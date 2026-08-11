/**
 * Display density — macOS-style "Larger Text <-> More Space" scaling.
 *
 * Two independent CSS variable systems (see index.css):
 *  - `--pos-density-scale` (this module): a multiplier applied ONLY to font-size,
 *    icon size, control/button sizing, and internal control padding.
 *  - `--pos-spacing-unit` (fixed, index.css): gaps/margins/grid-gutters. NEVER
 *    multiplied by density scale — always constant regardless of density level.
 *
 * Persistence: device-level via the Setting table (settings.getDisplayDensity /
 * settings.saveDisplayDensity IPC, see settingsQueries.ts) — not tied to a user
 * account. Also cached in localStorage so the correct scale can be applied
 * synchronously before first paint (avoids a flash of default density).
 */

export type DensityLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface DensityLevelInfo {
  level: DensityLevel
  label: string
  scale: number
}

// Exactly 8 discrete levels — not a continuous slider. Level 4 ("Default") is
// the app's baseline (scale 1.0). Values below 1.0 (5-8) are the fixed
// touch-target floor (36px) territory once controls hit it.
export const DENSITY_LEVELS: DensityLevelInfo[] = [
  { level: 1, label: 'Larger Text', scale: 1.3 },
  { level: 2, label: 'Large', scale: 1.15 },
  { level: 3, label: 'Comfortable', scale: 1.05 },
  { level: 4, label: 'Default', scale: 1.0 },
  { level: 5, label: 'Compact', scale: 0.9 },
  { level: 6, label: 'Dense', scale: 0.82 },
  { level: 7, label: 'More Space', scale: 0.75 },
  { level: 8, label: 'Maximum Space', scale: 0.68 }
]

export const DEFAULT_DENSITY_LEVEL: DensityLevel = 4

const LOCAL_STORAGE_KEY = 'pos.displayDensityLevel'

export function getDensityInfo(level: number): DensityLevelInfo {
  return DENSITY_LEVELS.find((d) => d.level === level) ?? DENSITY_LEVELS[3]
}

/** Apply a density level to the document root. Synchronous — safe to call before first paint. */
export function applyDensityLevel(level: number): void {
  const info = getDensityInfo(level)
  document.documentElement.style.setProperty('--pos-density-scale', String(info.scale))
  document.documentElement.setAttribute('data-density-level', String(info.level))
}

export function readCachedDensityLevel(): DensityLevel {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    const n = raw ? parseInt(raw, 10) : NaN
    if (Number.isFinite(n) && n >= 1 && n <= 8) return n as DensityLevel
  } catch {
    // localStorage unavailable (rare) — fall back to default.
  }
  return DEFAULT_DENSITY_LEVEL
}

export function writeCachedDensityLevel(level: number): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, String(level))
  } catch {
    // ignore — persistence to the DB-backed Setting is the source of truth
  }
}

/** Called synchronously at module load (before React renders) to avoid a flash of default density. */
export function applyCachedDensityBeforeFirstPaint(): void {
  applyDensityLevel(readCachedDensityLevel())
}
