const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('remotepair', {
  complete: () => ipcRenderer.invoke('onboarding:complete'),
})
