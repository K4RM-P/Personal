import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { applyCachedDensityBeforeFirstPaint } from './lib/density'
import './index.css'

// Apply the last-known display density synchronously, before React renders,
// so there's no flash of default density on startup. The authoritative
// DB-backed value is reconciled shortly after by DensityProvider.
applyCachedDensityBeforeFirstPaint()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
