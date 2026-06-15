const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('remotepair', {
  openPermissionPane: (key) => ipcRenderer.invoke('perm:open', key),
  requestPermission: (key) => ipcRenderer.invoke('perm:request', key),
  startInstall: () => ipcRenderer.invoke('install:start'),
  getInstallStatus: () => ipcRenderer.invoke('install:status'),
  getHostInfo: () => ipcRenderer.invoke('host:info'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  complete: () => ipcRenderer.invoke('onboarding:complete'),
})
