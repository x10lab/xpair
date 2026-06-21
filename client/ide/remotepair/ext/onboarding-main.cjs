// onboarding-main.cjs — single-app onboarding window, hosted by the IDE's MAIN process.
//
// One app, one main process (spec .omc/specs/deep-interview-single-app-onboarding.md): the VSCodium
// electron-main calls shouldOnboard()/openOnboardingWindow() on first run and shows this
// PRE-WORKBENCH BrowserWindow INSTEAD of creating the workbench window; on completion the window
// closes and the caller-provided onComplete() opens the workbench (RD auto-opens there). This
// REPLACES the old standalone client/onboarding 2nd-process Electron wrapper — no second app, no
// app.quit, no IDE re-launch.
//
// Self-contained in the extension dir: the bridge, telemetry, preload, and onboarding-webview dist
// all resolve via __dirname, so the same paths work in the repo and inside the built app bundle.

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const bridge = require('./onboarding-bridge.js')
let telemetry = null
try { telemetry = require('./telemetry.js') } catch { /* telemetry optional */ }
// CLIENT→HOST liveness heartbeat — started here so the onboarding window already counts as a
// connected client. The workbench keeps it going afterwards, so stop is OPTIONAL here.
let heartbeat = null
try { heartbeat = require('./heartbeat.js') } catch { /* heartbeat optional */ }

const WEBVIEW_INDEX = path.join(__dirname, 'onboarding-webview', 'dist', 'index.html')
const PRELOAD = path.join(__dirname, 'onboarding-preload.cjs')

/** Sentinel that forces onboarding on the next launch (written by the IDE's "Re-run setup"
 *  command, which can't pass an env var across an app quit+relaunch). Deleted once onboarding
 *  actually opens, so it forces exactly one run. */
const FORCE_ONBOARDING_SENTINEL = path.join(os.homedir(), '.xpair/host', '.force-onboarding')

/** @returns {boolean} true if the force-onboarding sentinel file exists. */
function forceOnboardingSentinelExists() {
  try { return fs.existsSync(FORCE_ONBOARDING_SENTINEL) } catch { return false }
}

/** Remove the force-onboarding sentinel (best-effort; safe if absent). */
function clearForceOnboardingSentinel() {
  try { fs.rmSync(FORCE_ONBOARDING_SENTINEL, { force: true }) } catch { /* ignore */ }
}

/** "onboarded" ⇔ REMOTE_HOST is set. Folder mappings are OPTIONAL (you can attach to a host for
 *  screen share / terminal with no folders mapped and add them later from the IDE), so a connected
 *  but unmapped client still counts as onboarded — otherwise the hard guard would re-show onboarding
 *  forever for anyone who skipped mapping. */
function isOnboarded() {
  const file = path.join(os.homedir(), '.xpair/host', 'client.env')
  let txt = ''
  try { txt = fs.readFileSync(file, 'utf8') } catch { return false }
  const env = {}
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']/, '').replace(/["']\s*$/, '')
  }
  return (env.REMOTE_HOST || '').trim().length > 0
}

/** Should the onboarding window show on this launch? `RP_FORCE_ONBOARDING=1` / `--force`, or the
 *  force-onboarding sentinel (written by "Re-run setup") forces it. */
function shouldOnboard(argv = process.argv) {
  if (process.env.RP_FORCE_ONBOARDING === '1' || (Array.isArray(argv) && argv.includes('--force'))) {
    return true
  }
  if (forceOnboardingSentinelExists()) {
    return true
  }
  return !isOnboarded()
}

let _ipcWired = false
function wireIpc(ipcMain, onComplete) {
  if (_ipcWired) return
  _ipcWired = true
  // Data calls → onboarding-bridge.js (own-property guard; argv-safe; never throws to the renderer).
  ipcMain.handle('rp', async (_e, msg) => {
    const method = msg && msg.method
    if (!method || !Object.prototype.hasOwnProperty.call(bridge, method)) {
      return { error: 'unknown method: ' + method }
    }
    const fn = bridge[method]
    if (typeof fn !== 'function') return { error: 'unknown method: ' + method }
    try {
      const args = Array.isArray(msg.args) ? msg.args : []
      return await fn.apply(bridge, args)
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) }
    }
  })
  // Completion → close the onboarding window and hand control back to electron-main to open the
  // workbench (SAME process; no second app, no app.quit). onComplete() is provided by the hook.
  ipcMain.handle('onboarding:complete', () => {
    _completed = true
    try {
      if (telemetry && telemetry.EVENTS) {
        const wowBase = telemetry.installTs && telemetry.installTs()
        telemetry.capture(telemetry.EVENTS.FIRST_SESSION_STARTED, {
          ...(wowBase ? { time_to_wow_ms: Date.now() - wowBase } : {}),
        })
      }
    } catch { /* telemetry must never block completion */ }
    try { if (_win && !_win.isDestroyed()) _win.close() } catch { /* ignore */ }
    try { if (typeof onComplete === 'function') onComplete() } catch { /* main opens workbench */ }
  })
}

let _win = null
let _completed = false

/**
 * Open the pre-workbench onboarding BrowserWindow (loads the onboarding-webview UI). The IDE's
 * electron-main calls this on first run INSTEAD of creating the workbench window; on completion the
 * window closes and `onComplete` is invoked so electron-main opens the workbench.
 * @param {object}  o
 * @param {typeof import('electron')} o.electron   the electron module from the main process
 * @param {() => void} o.onComplete                opens the workbench window (same process)
 * @returns {import('electron').BrowserWindow}
 */
function openOnboardingWindow({ electron, onComplete }) {
  const { app, BrowserWindow, ipcMain, shell } = electron
  // Onboarding is actually opening now, so consume the one-shot force sentinel (if any). This
  // guarantees exactly one forced run — a later normal launch won't re-trigger onboarding.
  clearForceOnboardingSentinel()
  try { if (telemetry && telemetry.firstRunStamp) telemetry.firstRunStamp() } catch { /* */ }
  // Count the onboarding window as a connected client (fire-and-forget; never blocks/throws).
  try { if (heartbeat && heartbeat.startHeartbeat) heartbeat.startHeartbeat() } catch { /* */ }
  wireIpc(ipcMain, onComplete)

  _win = new BrowserWindow({
    width: 720,
    height: 560,
    resizable: false,
    show: false, // show on ready-to-show so it appears focused, not behind
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#ffffff',
    webPreferences: {
      // Own session partition so this window escapes the IDE main's defaultSession security
      // interceptors (VSCode blocks raw file:// via security.promptForLocalFileProtocolHandling and
      // restricts vscode-file:// to registered editor windows — neither of which our pre-workbench
      // onboarding window is). A fresh partition has no such interceptors, so loadFile() works.
      partition: 'remotepair-onboarding',
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  _win.once('ready-to-show', () => {
    try { app.dock && app.dock.show && app.dock.show() } catch { /* not macOS */ }
    _win.show()
    _win.focus()
    try { app.focus({ steal: true }) } catch { try { app.focus() } catch { /* */ } }
  })

  _win.loadFile(WEBVIEW_INDEX)
  _win.webContents.setWindowOpenHandler(({ url }) => {
    try { shell.openExternal(url) } catch { /* */ }
    return { action: 'deny' }
  })
  // If the user closes the onboarding window WITHOUT completing (traffic-light), don't leave the app
  // running window-less: fall through to opening the workbench so they still land in the IDE.
  _win.on('closed', () => {
    _win = null
    if (!_completed) { try { if (typeof onComplete === 'function') onComplete() } catch { /* */ } }
  })
  return _win
}

module.exports = { isOnboarded, shouldOnboard, openOnboardingWindow }
