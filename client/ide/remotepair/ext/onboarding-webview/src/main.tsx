import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Stamp the build id into the window title so a launched window is verifiably the latest build
// (visible in the title bar; also queryable via the OS window list).
document.title = `RemotePair Onboarding · build ${__BUILD_ID__}`

// The standalone Electron preload installs `window.remotepair` before this bundle runs, so the UI
// always has its bridge by the time React mounts.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
