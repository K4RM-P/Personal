import * as React from 'react'
import {
  DEFAULT_DENSITY_LEVEL,
  DensityLevel,
  applyDensityLevel,
  readCachedDensityLevel,
  writeCachedDensityLevel
} from '../lib/density'

interface DensityContextValue {
  level: DensityLevel
  setLevel: (level: DensityLevel) => void
}

const DensityContext = React.createContext<DensityContextValue | undefined>(undefined)

/**
 * Device-level display density. The synchronous cached value is already
 * applied to the document root before React mounts (see main.tsx); this
 * provider reconciles with the DB-backed value (source of truth) once IPC
 * resolves, and applies any live change immediately + persists it.
 */
export function DensityProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [level, setLevelState] = React.useState<DensityLevel>(readCachedDensityLevel)

  React.useEffect(() => {
    let cancelled = false
    window.api?.settings
      ?.getDisplayDensity()
      .then((dbLevel) => {
        if (cancelled) return
        const lvl = (dbLevel >= 1 && dbLevel <= 8 ? dbLevel : DEFAULT_DENSITY_LEVEL) as DensityLevel
        setLevelState(lvl)
        applyDensityLevel(lvl)
        writeCachedDensityLevel(lvl)
      })
      .catch(() => {
        // Device has no persisted value yet / IPC unavailable — keep the cached/default value.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setLevel = React.useCallback((next: DensityLevel) => {
    setLevelState(next)
    applyDensityLevel(next)
    writeCachedDensityLevel(next)
    void window.api?.settings?.saveDisplayDensity(next).catch(() => {
      // Non-fatal — the setting still applies live for this session and is cached locally.
    })
  }, [])

  const value = React.useMemo(() => ({ level, setLevel }), [level, setLevel])
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}

export function useDensity(): DensityContextValue {
  const ctx = React.useContext(DensityContext)
  if (!ctx) throw new Error('useDensity must be used within a DensityProvider')
  return ctx
}
