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
  // `complete` is fire-and-forget: main launches the IDE and quits, so no result returns.
  complete: () => {
    ipcRenderer.invoke('onboarding:complete')
    return Promise.resolve()
  },
})
