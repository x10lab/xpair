const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const cp = require('node:child_process')

// onboarding-bridge.js is a pure Node module (no vscode dep). Run it in the main process and
// dispatch UI calls to it over the `rp` IPC channel. Path is relative to this electron dir:
// client/onboarding/electron -> client/ide/remotepair/ext/onboarding-bridge.js
const bridge = require(path.join(
  __dirname, '..', '..', 'ide', 'remotepair', 'ext', 'onboarding-bridge.js',
))

// Built RemotePair IDE app candidates (prod identity first, then local).
const IDE_APP_CANDIDATES = [
  path.join(__dirname, '..', '..', 'ide', 'dist', 'VSCode-darwin-arm64', 'RemotePair.app'),
  path.join(__dirname, '..', '..', 'ide', 'dist', 'VSCode-darwin-arm64', 'RemotePairLocal.app'),
]

let win = null

function createWindow() {
  win = new BrowserWindow({
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

  // Load the REAL onboarding UI — the built onboarding-webview React app (base './'), not
  // client/onboarding's old src. onboarding-webview is built separately (US-007).
  win.loadFile(path.join(
    __dirname, '..', '..', 'ide', 'remotepair', 'ext', 'onboarding-webview', 'dist', 'index.html',
  ))

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** Launch the RemotePair IDE argv-safe (never a shell string). Try the built .app, else fall back. */
function launchIDE() {
  const appPath = IDE_APP_CANDIDATES.find((p) => fs.existsSync(p))
  const args = appPath ? ['-a', appPath] : ['-a', 'RemotePair']
  try {
    cp.spawn('open', args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* best effort — IDE may not be built yet on a clean dev checkout */
  }
}

/** "onboarded" ⇔ REMOTE_HOST set AND FOLDER_MAPS has >=1 non-empty entry (split on ';'). */
function isOnboarded() {
  const file = path.join(os.homedir(), '.remote-pair', 'client.env')
  let txt = ''
  try {
    txt = fs.readFileSync(file, 'utf8')
  } catch {
    return false
  }
  const env = {}
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']/, '').replace(/["']\s*$/, '')
  }
  const host = (env.REMOTE_HOST || '').trim()
  const maps = (env.FOLDER_MAPS || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  return host.length > 0 && maps.length >= 1
}

app.whenReady().then(() => {
  if (isOnboarded()) {
    // Already set up: open the IDE directly and quit — no onboarding window (US-004).
    launchIDE()
    app.quit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Dispatch UI data calls to onboarding-bridge.js (own-property guard; argv-safe; never crashes).
ipcMain.handle('rp', async (_e, msg) => {
  const method = msg && msg.method
  if (!method || !Object.prototype.hasOwnProperty.call(bridge, method)) {
    return { error: 'unknown method: ' + method }
  }
  const fn = bridge[method]
  if (typeof fn !== 'function') {
    return { error: 'unknown method: ' + method }
  }
  try {
    const args = Array.isArray(msg.args) ? msg.args : []
    return await fn.apply(bridge, args)
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) }
  }
})

// Completion: launch the IDE and quit the onboarding app (US-005).
ipcMain.handle('onboarding:complete', () => {
  launchIDE()
  app.quit()
})
