// RemotePair client extension for the RemotePair IDE (VSCodium fork).
// Plain CommonJS, vscode API + node stdlib only. No external npm deps.
//
// All ssh invocations are argv-safe (spawn, never a shell string built from REMOTE_HOST).
//
// Remote Desktop is a single WebRTC path (v2): an ssh local-forward tunnel carries
// only the signaling WebSocket (ws://127.0.0.1:<port> → host `screen serve-webrtc`).
// The H.264 media itself flows P2P over UDP/RTP/ICE and is decoded natively by the
// webview. Input (cursor/keyboard) is captured in the webview and sent over WebRTC
// DataChannels (rp-ctl / rp-move) — not through this extension.

const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

// --- constants -------------------------------------------------------------

// Build-time generated from the monorepo shared/ SoT (screen-protocol + identity).
// Committed so this extension stays self-contained; regenerate via generate-contracts.mjs.
const CONTRACTS = require("./generated/contracts.json");

// RemotePair: AI agent extensions (Claude Code / Codex·ChatGPT) are DISABLED for now —
// CLI-only. Use the New Session picker's claude/codex/gemini CLI agents instead of the
// in-editor GUI extensions. Re-enable later by uncommenting. open-remote-ssh stays: it is
// the SSH transport, not an AI agent.
const AI_EXTENSIONS = [
  // "anthropic.claude-code",
  // "openai.chatgpt",
  "jeanp413.open-remote-ssh",
];

const NOTIFY_INTERVAL_MS = 5000;
const SSH_CONNECT_TIMEOUT = 6; // seconds

// v2 WebRTC signaling (shared/screen-protocol → generated contracts)
const SIGNAL_REMOTE_PORT = CONTRACTS.screen.v2SignalPort; // host `screen serve-webrtc` signaling port
const TUNNEL_SETTLE_MS = 1200; // wait for ssh -fN tunnel to establish before the webview connects

// REMOTE_HOST must be a bare ssh host alias / hostname. Validate hard before
// it ever reaches a spawned process (defense in depth even though spawn is
// argv-safe: prevents an attacker-controlled env from injecting ssh options).
const HOST_RE = /^[A-Za-z0-9._-]+$/;

// --- small utilities -------------------------------------------------------

let outputChannel;
function log(msg) {
  if (!outputChannel) outputChannel = vscode.window.createOutputChannel("RemotePair");
  const ts = new Date().toISOString();
  outputChannel.appendLine(`[${ts}] ${msg}`);
}

/** Read REMOTE_HOST from ~/.remote-pair/client.env (KEY=VALUE lines). */
function readRemoteHost() {
  // env override wins (useful for testing), then the client.env file.
  const fromEnv = process.env.REMOTE_HOST;
  if (fromEnv && HOST_RE.test(fromEnv.trim())) return fromEnv.trim();

  const envPath = path.join(os.homedir(), ".remote-pair", "client.env");
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch (_e) {
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (key !== "REMOTE_HOST") continue;
    let val = t.slice(eq + 1).trim();
    // strip surrounding quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val.trim();
  }
  return null;
}

/** Validated REMOTE_HOST or null. */
function getValidHost() {
  const h = readRemoteHost();
  if (!h) return null;
  if (!HOST_RE.test(h)) {
    log(`REMOTE_HOST rejected (invalid chars): ${JSON.stringify(h)}`);
    return null;
  }
  return h;
}

/** Read ENABLED_TYPES from ~/.remote-pair/notify.conf, or null if absent. */
function readEnabledNotifyTypes() {
  const confPath = path.join(os.homedir(), ".remote-pair", "notify.conf");
  let raw;
  try {
    raw = fs.readFileSync(confPath, "utf8");
  } catch (_e) {
    return null; // no filter -> allow all
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    if (t.slice(0, eq).trim() !== "ENABLED_TYPES") continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const set = new Set(
      val
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return set.size ? set : null;
  }
  return null;
}

/**
 * Run a command on REMOTE_HOST over ssh, argv-safe.
 * @param {string} host validated host
 * @param {string} remoteCmd the command line to run on the host (a single
 *        string passed as ssh's last argv element; ssh runs it via the host's
 *        login shell — we control its content, never the host string)
 * @param {object} [opts] { encoding, maxBuffer, timeoutMs }
 * @returns {Promise<{code:number, stdout:Buffer|string, stderr:string}>}
 */
function sshRun(host, remoteCmd, opts = {}) {
  const encoding = opts.encoding === undefined ? "utf8" : opts.encoding; // null => Buffer
  const maxBuffer = opts.maxBuffer || 16 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 15000;
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    // ControlMaster: reuse ONE persistent connection across frames → faster polling
    // and a single SSH-agent (1Password) authorization instead of one per frame.
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPath=/tmp/rp-cm-%C",
    "-o",
    "ControlPersist=300",
    host, // validated against HOST_RE; passed as its own argv element
    remoteCmd,
  ];
  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn("ssh", args, { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: encoding === null ? Buffer.alloc(0) : "", stderr: String(e) });
      return;
    }
    const outChunks = [];
    const errChunks = [];
    let outLen = 0;
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const outBuf = Buffer.concat(outChunks);
      resolve({
        code,
        stdout: encoding === null ? outBuf : outBuf.toString(encoding),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
      finish(-2);
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      outLen += d.length;
      if (outLen <= maxBuffer) outChunks.push(d);
    });
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", (e) => {
      errChunks.push(Buffer.from(String(e)));
      finish(-1);
    });
    child.on("close", (code) => finish(code == null ? 0 : code));
  });
}

/** POSIX single-quote escape for embedding a literal in a sh command. */
function shSingleQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// --- tunnel helpers ----------------------------------------------------------

/**
 * Find a free local TCP port by asking the OS.
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Spawn an ssh local-forward tunnel (non-blocking: ssh -fN).
 * argv-safe: host is validated, ports are integers.
 *
 * Returns the child process — child.kill() to teardown.
 * The caller should wait TUNNEL_SETTLE_MS before connecting.
 * Forwards the v2 WebRTC signaling port (media itself flows over UDP/ICE, not this TCP tunnel).
 */
function spawnTunnel(host, localPort, remotePort) {
  // -fN: go to background, no remote command.  ControlMaster=auto reuses
  // the existing authenticated master so there's no new key prompt.
  const rport = remotePort;
  const args = [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ControlMaster=auto",
    "-o", "ControlPath=/tmp/rp-cm-%C",
    "-o", "ControlPersist=300",
    "-fN",
    "-L", `${localPort}:127.0.0.1:${rport}`,
    host, // validated HOST_RE element
  ];
  log(`tunnel: ssh -fN -L ${localPort}:127.0.0.1:${rport} ${host}`);
  const child = cp.spawn("ssh", args, { windowsHide: true, detached: false });
  child.stderr.on("data", (d) => log(`tunnel stderr: ${d.toString().trim()}`));
  child.on("error", (e) => log(`tunnel spawn error: ${e.message}`));
  child.on("close", (code) => log(`tunnel exited code=${code}`));
  return child;
}

// --- Remote Desktop editor-tab panel ---------------------------------------
// Wireframe: Remote Desktop is a *pinned editor tab* ("RD") in the main editor
// area (the right pane), behaving like a normal editor tab next to file tabs —
// NOT a view in the left activity bar.

class RemoteDesktopPanel {
  /** @param {vscode.Uri} extensionUri */
  constructor(extensionUri, state) {
    this.extensionUri = extensionUri;
    this.state = state; // shared mutable: { inputEnabled }
    this.panel = null;
    this.visible = false;

    // v2 WebRTC signaling tunnel state
    this._tunnelChild = null;   // ssh -fN child process
    this._tunnelPort = null;    // local signaling port in use
    this._v2Active = false;     // true while the v2 signaling tunnel is up
  }

  /** Create the singleton RD editor tab, or reveal it if it already exists. */
  async reveal() {
    if (this.panel) {
      try {
        this.panel.reveal(this.panel.viewColumn || vscode.ViewColumn.Active, false);
      } catch (_e) {}
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "remotepair.remoteDesktop",
      "RD",
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      }
    );
    this.panel = panel;
    try {
      panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "icon.svg");
    } catch (_e) {}
    panel.webview.html = this.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));

    panel.onDidChangeViewState(() => {
      if (!this.panel) return;
      if (panel.visible) {
        this.visible = true;
        this._startStream();
      } else {
        this.visible = false;
        this._stopAll();
      }
    });
    panel.onDidDispose(() => {
      this.visible = false;
      this._stopAll();
      this.panel = null;
    });

    this.visible = panel.visible;
    this.postInputState();
    // Pin so it behaves like a permanent tab (wireframe: RD is a pinned editor tab).
    // Await so the pin lands on RD before anything else steals editor focus
    // (e.g. setupLayout opening a terminal tab right after).
    try {
      await vscode.commands.executeCommand("workbench.action.pinEditor");
    } catch (_e) {}
    if (this.visible) this._startStream();
  }

  /** Entry point: start the v2 WebRTC stream. */
  async _startStream() {
    // Guard against double-start (refresh + visibility-restore overlap) which
    // could otherwise spawn two ssh tunnels on different ports.
    if (this._v2Active) return;
    const host = getValidHost();
    if (!host) {
      this.post({ type: "status", state: "no-host" });
      return;
    }
    await this._startV2(host);
  }

  /** Tear down the v2 signaling tunnel. */
  _stopAll() {
    this._stopV2();
  }

  // --- v2 WebRTC (UDP/RTP H.264) -------------------------------------------

  async _startV2(host) {
    this._stopV2();
    let localPort;
    try {
      localPort = await getFreePort();
    } catch (e) {
      log(`v2: getFreePort error: ${e.message}`);
      this.post({ type: "status", state: "error", detail: String(e.message) });
      return;
    }
    this._tunnelPort = localPort;
    // Tunnel forwards the SIGNALING port only (TCP). Media flows over UDP/ICE.
    this._tunnelChild = spawnTunnel(host, localPort, SIGNAL_REMOTE_PORT);
    this._v2Active = true;

    const self = this;
    setTimeout(() => {
      if (!self._v2Active || !self.panel) return;
      const signalUrl = `ws://127.0.0.1:${localPort}`;
      log(`v2: telling webview to connect signaling ${signalUrl}`);
      self.post({ type: "v2Connect", signalUrl });
    }, TUNNEL_SETTLE_MS);
  }

  _stopV2() {
    this._v2Active = false;
    if (this._tunnelChild) {
      try { this._tunnelChild.kill("SIGTERM"); } catch (_e) {}
      this._tunnelChild = null;
    }
    this._tunnelPort = null;
  }

  postInputState() {
    if (this.panel) {
      this.panel.webview.postMessage({ type: "inputState", enabled: !!this.state.inputEnabled });
    }
  }

  onMessage(msg) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "ready") {
      this.postInputState();
      return;
    }
    if (msg.type === "refresh") {
      // Restart the v2 signaling tunnel and tell the webview to reconnect.
      this._stopAll();
      this._startStream();
      return;
    }
    // v2 (WebRTC) feedback from webview. Input (cursor/keyboard) is sent directly
    // over WebRTC DataChannels in the webview, so the extension only handles status.
    if (msg.type === "v2FirstFrame") {
      log(`v2: media track rendering`);
      return;
    }
    if (msg.type === "v2Error") {
      log(`v2: webview reported error: ${msg.detail || "unknown"}`);
      this.post({ type: "status", state: "error", detail: String(msg.detail || "webrtc error") });
      return;
    }
  }

  post(m) {
    if (this.panel) {
      try {
        this.panel.webview.postMessage(m);
      } catch (_e) {}
    }
  }

  refresh() {
    if (this.panel) {
      this.onMessage({ type: "refresh" });
    }
  }

  getHtml(webview) {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "remote-desktop.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "remote-desktop.css")
    );
    // CSP: allow our nonce'd script, our stylesheet, the H.264 <video> media,
    // and the v2 signaling WebSocket on loopback.
    const csp = [
      `default-src 'none'`,
      `media-src ${webview.cspSource} blob: mediastream:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      // ws://127.0.0.1:* = v2 WebRTC signaling (loopback, reached over ssh -L).
      // The v2 media itself is UDP/RTP, not subject to CSP.
      `connect-src ws://127.0.0.1:* ws://localhost:*`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" />
<title>Remote Desktop</title>
</head>
<body>
  <div id="stage">
    <video id="screen-video" autoplay muted playsinline></video>
    <div id="overlay" class="hidden">
      <div id="overlay-title">RemotePair</div>
      <div id="overlay-msg">Connecting to host…</div>
    </div>
    <div id="badge" class="off" title="Input forwarding">input: off</div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// --- helpers ----------------------------------------------------------------

function makeNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// --- AI extension bootstrap -------------------------------------------------

async function ensureExtensions(interactive) {
  const missing = AI_EXTENSIONS.filter((id) => !vscode.extensions.getExtension(id));
  if (!missing.length) {
    if (interactive) vscode.window.showInformationMessage("RemotePair: AI extensions already installed.");
    return;
  }
  log(`Installing missing AI extensions: ${missing.join(", ")}`);
  for (const id of missing) {
    try {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", id);
      log(`installed ${id}`);
    } catch (e) {
      // best-effort; swallow but log
      log(`install failed for ${id}: ${e && e.message ? e.message : e}`);
    }
  }
  if (interactive) {
    vscode.window.showInformationMessage(
      `RemotePair: requested install of ${missing.length} extension(s). Reload if prompted.`
    );
  }
}

// --- connect to host --------------------------------------------------------

/**
 * Core connection logic: opens the host filesystem over SSH (open-remote-ssh).
 * @param {string} host validated host alias
 */
async function _doConnectHost(host) {
  // Preferred: open the host filesystem directly via open-remote-ssh's authority,
  // no prompt. Authority format is "ssh-remote+<host>" (from the extension).
  const home = `/Users/${process.env.USER || os.userInfo().username || ""}`.replace(/\/$/, "");
  const remotePath = home && home !== "/Users/" ? home : "/";
  try {
    const uri = vscode.Uri.from({
      scheme: "vscode-remote",
      authority: `ssh-remote+${host}`,
      path: remotePath,
    });
    await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
    log(`connectHost: opened ${uri.toString()}`);
    return;
  } catch (e) {
    log(`connectHost: vscode.openFolder failed: ${e && e.message ? e.message : e}`);
  }
  // Fallback: trigger open-remote-ssh's own prompt (it will ask for the host).
  try {
    await vscode.commands.executeCommand("openremotessh.openEmptyWindow");
    return;
  } catch (e) {
    log(`connectHost: openremotessh.openEmptyWindow failed: ${e && e.message ? e.message : e}`);
  }
  // Last resort: instructions.
  vscode.window.showInformationMessage(
    `RemotePair: open the Remote Explorer and connect to "${host}" via Open Remote - SSH.`
  );
}

/**
 * Show a QuickPick listing the configured endpoint(s) (currently REMOTE_HOST from
 * client.env = one item), then connect to the selected host.
 */
async function connectHost() {
  const host = getValidHost();
  if (!host) {
    vscode.window.showWarningMessage(
      "RemotePair: REMOTE_HOST is not set (or invalid) in ~/.remote-pair/client.env."
    );
    return;
  }

  // Build the list of endpoints. Currently there is exactly one (REMOTE_HOST from
  // client.env). The QuickPick is kept generic so additional endpoints can be
  // appended here in the future without changing the selection UI.
  const items = [
    {
      label: `$(remote) ${host}`,
      description: "REMOTE_HOST (client.env)",
      detail: `Connect to ${host} via Open Remote - SSH`,
      host,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "RemotePair: Select Host to Connect",
    placeHolder: "Choose an endpoint…",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) return; // user cancelled
  log(`connectHost: user selected ${picked.host}`);
  await _doConnectHost(picked.host);
}

// --- launch remote Claude ---------------------------------------------------

/**
 * Open a terminal and stage the `remote-pair launch` command (addNewLine=false
 * so the user reviews before pressing Enter).
 *
 * `remote-pair launch` is the client-side CLI that opens a mosh+tmux session
 * on the host and starts Claude Code inside it.  If the exact subcommand name
 * changes, adjust the sendText argument here; the terminal name makes the
 * intent clear to the user regardless.
 */
function launchRemoteClaude() {
  let term;
  try {
    term = vscode.window.createTerminal("RemotePair — Launch Claude");
    term.show(true);
    // Stage without auto-executing so the user can review / edit first.
    // "remote-pair launch" = mosh → tmux → claude (see remote-pair CLI help).
    // If the exact subcommand differs on your setup, edit before pressing Enter.
    term.sendText("remote-pair launch", false);
  } catch (e) {
    log(`launchRemoteClaude: ${e && e.message ? e.message : e}`);
  }
  vscode.window.showInformationMessage(
    "RemotePair: review 'remote-pair launch' in the terminal and press Enter to open " +
      "a mosh+tmux+Claude Code session on the remote host."
  );
}

// --- file access / folder mapping setup ------------------------------------

/**
 * Open a terminal and stage the interactive `remote-pair onboard` wizard, which
 * configures host, terminal app, folder mapping, and a doctor check. We do NOT
 * auto-run it (addNewLine=false) so the user reviews the command first.
 */
function setupFileAccess() {
  let term;
  try {
    term = vscode.window.createTerminal("RemotePair Setup");
    term.show(true);
    // Stage the command without executing — the user presses Enter to start the
    // interactive wizard (it prompts for host / mapping / backend).
    term.sendText("remote-pair onboard", false);
  } catch (e) {
    log(`setupFileAccess: ${e && e.message ? e.message : e}`);
  }
  vscode.window.showInformationMessage(
    "RemotePair: review 'remote-pair onboard' in the terminal and press Enter to " +
      "configure the host, folder mapping, and file-access backend (Syncthing or mount)."
  );
}

// --- host notifications poller ---------------------------------------------

class NotificationPoller {
  constructor() {
    this.timer = null;
    this.seen = new Set(); // dedupe by ts (+type)
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    // initial delay so startup isn't noisy
    this.timer = setInterval(() => this.poll(), NOTIFY_INTERVAL_MS);
    setTimeout(() => this.poll(), 2500);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  async poll() {
    const host = getValidHost();
    if (!host) return;
    const enabled = readEnabledNotifyTypes(); // Set or null(=all)
    const res = await sshRun(
      host,
      "tail -n 20 ~/.remote-pair/notifications/queue.jsonl 2>/dev/null",
      { timeoutMs: 8000 }
    );
    if (res.code !== 0 && res.code !== null) return; // missing file / unreachable -> quiet
    const lines = String(res.stdout).split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let obj;
      try {
        obj = JSON.parse(t);
      } catch (_e) {
        continue;
      }
      if (!obj || typeof obj !== "object") continue;
      const key = `${obj.ts || ""}|${obj.type || ""}|${obj.session || ""}`;
      if (this.seen.has(key)) continue;
      // On the very first successful poll, mark everything seen WITHOUT showing
      // (avoid replaying history). We detect first-run by an empty seen set.
      const firstRun = this.seen.size === 0;
      this.seen.add(key);
      if (firstRun) continue;
      if (enabled && obj.type && !enabled.has(obj.type)) continue;

      const title = obj.title ? String(obj.title) : "RemotePair";
      const message = obj.message ? String(obj.message) : "";
      const text = message ? `${title}: ${message}` : title;
      if (obj.approvalType) {
        vscode.window.showWarningMessage(`RemotePair (approval: ${obj.approvalType}) — ${text}`);
      } else {
        vscode.window.showInformationMessage(`RemotePair — ${text}`);
      }
    }
    // Bound the dedupe set so it can't grow unbounded.
    if (this.seen.size > 500) {
      const arr = Array.from(this.seen);
      this.seen = new Set(arr.slice(arr.length - 250));
    }
  }
}

// --- one-time workbench layout ---------------------------------------------
// Native model (wireframe): the LEFT activity-bar rail switches a SINGLE primary
// sidebar between containers — "Terminal" (the integrated terminal, moved to the
// Sidebar in terminal.contribution) and "Browser" (the file explorer). Clicking
// a rail item switches the sidebar (no extra column). The editor area (right)
// holds files + the pinned RD tab. The sidebar is user-resizable to mid-screen.

async function setupLayout(context, force) {
  const KEY = "remotepair.layoutInitialized.v7";
  if (!force && context.globalState.get(KEY)) return;
  // Terminal now lives in a custom "Terminal" SIDEBAR container that embeds an
  // EditorPart (workbench source component — see plan #3). The extension only
  // closes the right-side bar; RD is opened in the main editor by activate().
  try {
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  } catch (_e) {}
  // Reveal the custom "Terminal" sidebar (embedded EditorPart, workbench source).
  try {
    await vscode.commands.executeCommand("remotepair.terminalSidebar.view.focus");
  } catch (e) {
    log(`setupLayout reveal terminal sidebar: ${e && e.message ? e.message : e}`);
  }
  try {
    await context.globalState.update(KEY, true);
  } catch (e) {
    log(`setupLayout: globalState.update failed: ${e && e.message ? e.message : e}`);
  }
}

// --- FOLDER_MAPS parser ----------------------------------------------------

/**
 * Read FOLDER_MAPS from ~/.remote-pair/client.env.
 * Format: "clientDir::hostDir" pairs separated by ";".
 * Returns an array of { clientDir, hostDir } objects (may be empty).
 */
/** Expand a leading ~ or ~/ to the user's home dir (env-file paths commonly use ~). */
function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readFolderMaps() {
  const envPath = path.join(os.homedir(), ".remote-pair", "client.env");
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch (_e) {
    return [];
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (key !== "FOLDER_MAPS") continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!val) return [];
    return val
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const sep = pair.indexOf("::");
        if (sep < 0) return null;
        return { clientDir: expandHome(pair.slice(0, sep).trim()), hostDir: pair.slice(sep + 2).trim() };
      })
      .filter(Boolean);
  }
  return [];
}

/**
 * C1.D4 — Reconcile the Browser's workspace roots so they are EXACTLY the FOLDER_MAPS
 * client dirs (that exist on disk), in declared order. This drops any non-mapped folder
 * that leaked in as a launch-arg / workspace folder (the phantom `/tmp/rp-test-folder`)
 * and adds any mapped dir that is missing — in a single updateWorkspaceFolders replace.
 *
 * Returns the resolved clientDirs (may be empty → the Browser shows its empty-state).
 * The `updateWorkspaceFolders` no-op `false` return is logged but not treated as a hard
 * failure: when the current set already matches we skip the call entirely.
 */
function reconcileBrowserRoots() {
  const maps = readFolderMaps();
  const seen = new Set();
  const clientDirs = [];
  for (const m of maps) {
    if (!m.clientDir || seen.has(m.clientDir)) continue;
    seen.add(m.clientDir);
    if (!fs.existsSync(m.clientDir)) {
      log(`reconcileBrowserRoots: skipping missing client dir: ${m.clientDir}`);
      continue;
    }
    clientDirs.push(m.clientDir);
  }

  const current = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  // Target == FOLDER_MAPS clientDirs only. Match requires SAME set AND SAME order so a
  // stray non-mapped folder (phantom root) anywhere in the list forces a replace.
  const alreadyCorrect =
    current.length === clientDirs.length &&
    clientDirs.every((d, i) => current[i] === d);
  if (alreadyCorrect) {
    return clientDirs;
  }

  log(`reconcileBrowserRoots: current=[${current.join(", ")}] target=[${clientDirs.join(", ")}]`);
  // RELOAD CAVEAT: vscode.workspace.updateWorkspaceFolders RELOADS the window when the change
  // transitions to/from 0 folders OR replaces the folder at index 0 (documented behavior). To
  // avoid an unnecessary reload, take an additive fast-path when `current` is a strict prefix of
  // the target (only NEW roots are appended): inserting at the end (start === current.length)
  // never touches index 0 and never crosses the 0-folder boundary, so the window stays put.
  // Anything else (removals, reordering, replacing index 0, or going to/from 0 folders) needs the
  // full replace below, which may reload — but the `alreadyCorrect` guard above already prevents
  // spurious runs, so the replace only fires on a genuine difference.
  const isAdditiveAppend =
    current.length > 0 &&
    clientDirs.length > current.length &&
    current.every((d, i) => clientDirs[i] === d);
  try {
    let ok;
    if (isAdditiveAppend) {
      // Append-only: insert the trailing new roots without disturbing existing ones (no reload).
      const added = clientDirs.slice(current.length);
      log(`reconcileBrowserRoots: additive append of [${added.join(", ")}] (no reload)`);
      ok = vscode.workspace.updateWorkspaceFolders(
        current.length,
        0,
        ...added.map((d) => ({ uri: vscode.Uri.file(d) }))
      );
    } else {
      // Full replace: delete all current folders, insert the mapped clientDirs in order. This may
      // reload the window (index-0 replace and/or the 0-folder boundary). When clientDirs is empty
      // this removes every root (e.g. the phantom launch-arg folder), leaving zero roots so the
      // Browser renders its empty-state add button.
      ok = vscode.workspace.updateWorkspaceFolders(
        0,
        current.length,
        ...clientDirs.map((d) => ({ uri: vscode.Uri.file(d) }))
      );
    }
    if (!ok) {
      // false = no-op or invalid change. This is expected when removing the very last
      // folder is rejected by the workspace model in some single-folder states; it is NOT
      // a thrown error, so we log and continue rather than fall back to a setup wizard.
      log("reconcileBrowserRoots: updateWorkspaceFolders returned false (no-op or invalid)");
    }
  } catch (e) {
    log(`reconcileBrowserRoots: updateWorkspaceFolders threw: ${e && e.message ? e.message : e}`);
  }
  return clientDirs;
}

/**
 * C1.D3 — Run the client `remote-pair` CLI and capture its stdout/stderr. Spawned through
 * the user's login shell so PATH resolution finds `remote-pair` wherever it was installed
 * (~/.local/bin, /opt/homebrew/bin, /usr/local/bin, …) — the extension host does not inherit
 * an interactive PATH. argv is passed as a single POSIX-quoted command string to `sh -lc`.
 *
 * Returns { code, stdout, stderr }. Never throws (spawn errors resolve as code -1).
 */
function runRemotePairCli(args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120000;
  const quoted = ["remote-pair", ...args].map(shSingleQuote).join(" ");
  const shell = process.env.SHELL || "/bin/sh";
  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn(shell, ["-lc", quoted], { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e) });
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: out.join(""), stderr: err.join("") });
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (_e) {}
      finish(-2);
    }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d.toString("utf8")));
    child.stderr.on("data", (d) => err.push(d.toString("utf8")));
    child.on("error", (e) => { err.push(String(e)); finish(-1); });
    child.on("close", (code) => finish(code == null ? 0 : code));
  });
}

/**
 * C1.D3 — Mount-first add-root flow for the Browser's "Add Root" affordance.
 *   1. Prompt for a HOST folder path (v1 = host-path input box).
 *   2. `remote-pair mount <hostPath>` (SMB default, macOS-native no-kext) → real OS mount.
 *   3. Parse the printed "Mountpoint: <path>" and register a FOLDER_MAP via
 *      `remote-pair map add <mountpoint> <hostPath>` (writes <mountpoint>::<hostPath>).
 *   4. Reconcile roots so the mountpoint appears as a Browser root without restart.
 */
async function addRoot() {
  const hostPath = await vscode.window.showInputBox({
    title: "RemotePair — Add Root (mount a host folder)",
    prompt: "Enter the HOST folder path to mount (SMB by default; appears as a Browser root and in Finder).",
    placeHolder: "/Users/you/Projects/myrepo",
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = (v || "").trim();
      if (!t) return "Enter a host folder path.";
      if (!t.startsWith("/")) return "Host path must be absolute (start with /).";
      return null;
    },
  });
  if (!hostPath) return; // user cancelled
  const host = hostPath.trim();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `RemotePair: mounting ${host}…`, cancellable: false },
    async () => {
      // Step 2: mount.
      const mres = await runRemotePairCli(["mount", host], { timeoutMs: 180000 });
      if (mres.code !== 0) {
        log(`addRoot: mount failed (code ${mres.code}): ${mres.stderr || mres.stdout}`);
        const detail = (mres.stderr || mres.stdout || "").trim().split(/\r?\n/).slice(-3).join(" ");
        vscode.window.showErrorMessage(`RemotePair: 'remote-pair mount ${host}' failed. ${detail}`);
        return;
      }

      // Step 3: parse the "Mountpoint: <path>" line (printed to stdout by remote-pair-mount).
      let mountpoint = "";
      for (const line of mres.stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*Mountpoint:\s*(\S.*?)\s*$/);
        if (m) { mountpoint = m[1]; break; }
      }
      if (!mountpoint) {
        log(`addRoot: could not parse mountpoint from mount output: ${mres.stdout}`);
        vscode.window.showErrorMessage("RemotePair: mount succeeded but the mountpoint could not be determined.");
        return;
      }
      log(`addRoot: mounted ${host} at ${mountpoint}`);

      // Step 3b: register the FOLDER_MAP (clientDir=mountpoint :: hostDir=host). 'already mapped'
      // is a benign success (the map exists / is covered) — code 0 in that case.
      const ares = await runRemotePairCli(["map", "add", mountpoint, host], { timeoutMs: 30000 });
      if (ares.code !== 0) {
        log(`addRoot: map add failed (code ${ares.code}): ${ares.stderr || ares.stdout}`);
        vscode.window.showErrorMessage(`RemotePair: mounted at ${mountpoint} but registering the folder map failed.`);
        return;
      }

      // Step 4: reconcile roots so the new mountpoint becomes a Browser root immediately.
      reconcileBrowserRoots();
      try {
        await vscode.commands.executeCommand("workbench.view.explorer");
      } catch (_e) {}
      vscode.window.showInformationMessage(`RemotePair: added Browser root ${mountpoint} (mounted ${host}).`);
    }
  );
}

// --- activation -------------------------------------------------------------

function activate(context) {
  log("RemotePair activating…");

  const state = { inputEnabled: true };

  // 1) First-run: ensure the 3 AI extensions (best-effort, swallow errors).
  ensureExtensions(false).catch((e) => log(`ensureExtensions error: ${e}`));

  // 2) Remote Desktop = a pinned editor tab ("RD") in the main editor area
  //    (NOT a left activity-bar view).
  const panel = new RemoteDesktopPanel(context.extensionUri, state);

  // 3) Status bar Host button (always visible, high priority = left-most).
  //    Shows the configured host NAME + live reachability status instead of the
  //    generic SSH "$(remote)" glyph: $(vm-active) host when reachable, red
  //    background + $(vm-outline) when down, $(sync~spin) while probing, and a
  //    "Set host" affordance when none is configured. Click still opens the
  //    endpoint quickpick (remotepair.connectHost).
  const hostBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100000000);
  hostBtn.command = "remotepair.connectHost";
  context.subscriptions.push(hostBtn);

  let hostReachable = null; // null = unknown/probing, true/false = last probe result
  const renderHostButton = () => {
    const host = getValidHost();
    if (!host) {
      hostBtn.text = "$(gear) Set host";
      hostBtn.tooltip = "RemotePair: no host configured — click to set up";
      hostBtn.backgroundColor = undefined;
    } else if (hostReachable === true) {
      hostBtn.text = `$(vm-active) ${host}`;
      hostBtn.tooltip = `RemotePair: ${host} — reachable. Click to connect.`;
      hostBtn.backgroundColor = undefined;
    } else if (hostReachable === false) {
      hostBtn.text = `$(vm-outline) ${host}`;
      hostBtn.tooltip = `RemotePair: ${host} — unreachable. Click to connect / retry.`;
      hostBtn.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else {
      hostBtn.text = `$(sync~spin) ${host}`;
      hostBtn.tooltip = `RemotePair: ${host} — checking reachability…`;
      hostBtn.backgroundColor = undefined;
    }
    hostBtn.show();
  };
  renderHostButton();

  // Reachability probe: BatchMode ssh `true` over the persistent ControlMaster
  // connection (no password prompt; fails fast if unreachable / no agent key).
  const probeHost = async () => {
    const host = getValidHost();
    if (!host) {
      hostReachable = null;
      renderHostButton();
      return;
    }
    try {
      const r = await sshRun(host, "true", { timeoutMs: 6000 });
      hostReachable = r.code === 0;
    } catch (_e) {
      hostReachable = false;
    }
    renderHostButton();
  };
  probeHost();
  const hostProbeTimer = setInterval(probeHost, 20000);
  context.subscriptions.push({ dispose: () => clearInterval(hostProbeTimer) });

  // 4) Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("remotepair.openRemoteDesktop", () => panel.reveal()),
    vscode.commands.registerCommand("remotepair.connectHost", () => connectHost()),
    vscode.commands.registerCommand("remotepair.launchRemoteClaude", () => launchRemoteClaude()),
    vscode.commands.registerCommand("remotepair.remoteDesktop.refresh", () => panel.refresh()),
    vscode.commands.registerCommand("remotepair.remoteDesktop.toggleInput", () => {
      state.inputEnabled = !state.inputEnabled;
      panel.postInputState();
      vscode.window.setStatusBarMessage(
        `RemotePair input forwarding: ${state.inputEnabled ? "ON" : "OFF"}`,
        2000
      );
    }),
    vscode.commands.registerCommand("remotepair.ensureExtensions", () => ensureExtensions(true)),
    vscode.commands.registerCommand("remotepair.setupFileAccess", () => setupFileAccess()),
    vscode.commands.registerCommand("remotepair.setupLayout", () => setupLayout(context, true)),
    vscode.commands.registerCommand("remotepair.openFileBrowser", () => {
      // Roots == FOLDER_MAPS clientDirs only (C1.D4): reconcile drops any phantom
      // launch-arg / workspace folder and adds the mapped dirs in declared order.
      const clientDirs = reconcileBrowserRoots();
      if (clientDirs.length === 0) {
        // No mapped roots → reveal the Browser so its empty-state "Add Root" button shows.
        log("openFileBrowser: no FOLDER_MAPS client dirs, revealing empty-state");
      } else {
        log(`openFileBrowser: using FOLDER_MAPS clientDirs=${clientDirs.join(", ")}`);
      }
      vscode.commands.executeCommand("workbench.view.explorer").then(
        () => {},
        (e) => log(`openFileBrowser: explorer reveal error: ${e && e.message ? e.message : e}`)
      );
    }),
    vscode.commands.registerCommand("remotepair.browser.addRoot", () =>
      addRoot().catch((e) => {
        log(`addRoot: ${e && e.message ? e.message : e}`);
        vscode.window.showErrorMessage(`RemotePair: Add Root failed. ${e && e.message ? e.message : e}`);
      })
    ),
    vscode.commands.registerCommand("remotepair.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings");
    })
  );

  // C1.D4 — Reconcile Browser roots on activation so a non-mapped launch-arg folder
  // (the phantom `/tmp/rp-test-folder`) is removed even before the user opens the Browser.
  try {
    reconcileBrowserRoots();
  } catch (e) {
    log(`activate: reconcileBrowserRoots failed: ${e && e.message ? e.message : e}`);
  }

  // 4) Host notifications poller.
  const notifier = new NotificationPoller();
  notifier.start();
  context.subscriptions.push({ dispose: () => notifier.stop() });

  // 5) Open the RD editor tab on startup (Remote Desktop is this client's
  //    primary surface), then apply the one-time workbench layout. Chained so
  //    the RD pin lands before setupLayout opens the terminal tab.
  panel
    .reveal()
    .then(() => setupLayout(context, false))
    .catch((e) => log(`setupLayout error: ${e}`));

  log("RemotePair activated.");
}

function deactivate() {}

module.exports = { activate, deactivate };
