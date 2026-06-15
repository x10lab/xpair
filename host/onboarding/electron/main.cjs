const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const child_process = require('node:child_process')


function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 560,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const PANE_URLS = {
  ax: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  sr: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  fda: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
}

ipcMain.handle('perm:open', (_e, key) => {
  const url = PANE_URLS[key]
  if (url) child_process.execFile('open', [url], (err) => { if (err) console.error('perm:open failed', err) })
})

// Ask the running RemotePairHost app to actually REQUEST the permission (AXIsProcessTrustedWithOptions
// prompt → adds RemotePairHost to the Accessibility/SR list). Only the host app itself can register for
// TCC, so the onboarding signals it via a trigger file the app watches; the app then prompts + opens panes.
// The file content is the permission key ("ax" | "sr" | "fda") the app should request.
ipcMain.handle('perm:request', (_e, key) => {
  try { fs.writeFileSync('/tmp/remote-pair.grant-request', String(key)) } catch (e) { console.error('perm:request failed', e) }
})

// Signal the running RemotePairHost app to run its real installer (Installer.install) by dropping a
// trigger file the app watches (~1s). The content is irrelevant — presence of the file is the signal.
ipcMain.handle('install:start', () => {
  try { fs.writeFileSync('/tmp/remote-pair.install-request', '1') } catch (e) { console.error('install:start failed', e) }
})

// Report real install progress by probing the host's runtime state:
//   appAlive            — status.json fresh (host process running)
//   launchAgentPresent  — LaunchAgent plist installed
//   serverUp            — tmux socket present (server up / install done)
ipcMain.handle('install:status', () => {
  const fresh = () => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.remote-pair/logs/status.json'), 'utf8'))
      return (Date.now() / 1000 - (j.ts || 0)) < 6
    } catch {
      return false
    }
  }
  return {
    appAlive: fresh(),
    launchAgentPresent: fs.existsSync(path.join(os.homedir(), 'Library/LaunchAgents/com.x10lab.remote-pair-host.plist')),
    serverUp: fs.existsSync('/tmp/aqua-tmux.sock'),
  }
})

// Real identity of THIS machine (replaces the mockup's hardcoded host name).
ipcMain.handle('host:info', () => ({ hostname: os.hostname(), user: os.userInfo().username }))

ipcMain.handle('status:get', () => {
  try {
    const p = path.join(os.homedir(), '.remote-pair/logs/status.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    const fresh = Date.now() / 1000 - (j.ts || 0) < 6
    return { alive: fresh, ax: !!j.ax, sr: !!j.sr, fda: !!j.fda }
  } catch {
    return { alive: false, ax: false, sr: false, fda: false }
  }
})

ipcMain.handle('onboarding:complete', () => {
  app.quit()
})
