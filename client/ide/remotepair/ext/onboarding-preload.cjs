const { contextBridge, ipcRenderer } = require('electron')

// Preload for the single-app onboarding BrowserWindow (hosted by the IDE main process).
// Exposes the same `window.remotepair` surface the onboarding-webview React UI expects. Each data
// method routes to the main process over a single `rp` channel ({method, args}) dispatched to
// onboarding-bridge.js; `complete` hands control back to electron-main to open the workbench.
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
  // Discovery / pairing. Secrets that transit here (renderer → main, NEVER argv/log): the 6-digit
  // PIN (pair) and the account password (installHost) — main hands the password to the CLI over an
  // inherited pipe, never the command line. hostPermissions SSH-reads the host's grant status
  // (status.json) so the Grant step can confirm AX/SR were granted on the host's screen.
  discover: () => rp('discover'),
  pair: (opts) => rp('pair', [opts]),
  installHost: (opts) => rp('installHost', [opts]),
  hostPermissions: (opts) => rp('hostPermissions', [opts]),
  hostKeyFingerprint: (host) => rp('hostKeyFingerprint', [host]),
  // Telemetry (consent-gated PostHog; no-ops until opt-in).
  tCapture: (event, props) => rp('tCapture', [event, props]),
  tCatalog: () => rp('tCatalog'),
  tGetConsent: () => rp('tGetConsent'),
  tSetConsent: (telemetry, crashReport) => rp('tSetConsent', [telemetry, crashReport]),
  // `complete` is fire-and-forget: main closes the onboarding window and opens the workbench.
  complete: () => {
    ipcRenderer.invoke('onboarding:complete')
    return Promise.resolve()
  },
})
