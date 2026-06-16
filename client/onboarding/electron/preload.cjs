const { contextBridge, ipcRenderer } = require('electron')

// Electron preload shim — exposes the same `window.remotepair` surface the onboarding-webview
// React UI uses. Each data method is routed to the main process over a single `rp` channel
// ({method, args}) which dispatches to onboarding-bridge.js; `complete` uses its own IPC.
const rp = (method, args = []) => ipcRenderer.invoke('rp', { method, args })

contextBridge.exposeInMainWorld('remotepair', {
  hostInfo: () => rp('hostInfo'),
  getConfig: () => rp('getConfig'),
  setHost: (host) => rp('setHost', [host]),
  addMapping: (clientPath, hostPath) => rp('addMapping', [clientPath, hostPath]),
  setBackend: (sync, mount) => rp('setBackend', [sync, mount]),
  mount: (hostPath, mountpoint) => rp('mount', [hostPath, mountpoint]),
  hostPathExists: (hostPath) => rp('hostPathExists', [hostPath]),
  defaultMountpoint: (hostPath) => rp('defaultMountpoint', [hostPath]),
  sshKeygen: () => rp('sshKeygen'),
  sshReachable: (host) => rp('sshReachable', [host]),
  tailscaleStatus: () => rp('tailscaleStatus'),
  // Discovery / pairing (component ⑤). The PIN is the only secret that transits here (renderer →
  // CLI argv); passwords/passphrases are collected only by the askpass helper, never via IPC.
  discover: () => rp('discover'),
  pair: (opts) => rp('pair', [opts]),
  installHost: (opts) => rp('installHost', [opts]),
  hostKeyFingerprint: (host) => rp('hostKeyFingerprint', [host]),
  // Telemetry (consent-gated PostHog; no-ops until opt-in). The webview fires Phase-1 funnel
  // events and reads/writes the two consent flags through these.
  tCapture: (event, props) => rp('tCapture', [event, props]),
  tCatalog: () => rp('tCatalog'),
  tGetConsent: () => rp('tGetConsent'),
  tSetConsent: (telemetry, crashReport) => rp('tSetConsent', [telemetry, crashReport]),
  // `complete` is fire-and-forget: main launches the IDE and quits, so no result returns.
  complete: () => {
    ipcRenderer.invoke('onboarding:complete')
    return Promise.resolve()
  },
})
