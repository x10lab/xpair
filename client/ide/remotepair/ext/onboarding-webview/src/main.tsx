import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// The standalone Electron preload installs `window.remotepair` before this bundle runs, so the UI
// always has its bridge by the time React mounts.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
