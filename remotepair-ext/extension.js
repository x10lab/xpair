// RemotePair client extension for the RemotePair IDE (VSCodium fork).
// Plain CommonJS, vscode API + node stdlib only. No external npm deps.
//
// Reuses the proven RemotePair host backend (host = REMOTE_HOST over ssh):
//   InputServer file channel on the host:
//     write "<verb>\t<args>" to /tmp/remote-pair.input-req, then read /tmp/remote-pair.input-res
//     verbs: shot\t<outpath> -> writes screenshot PNG, replies "ok\t<path>"
//            click\t<x>\t<y> -> clicks at host display pixels
//            key\t<combo>     -> sends a key combo
//
// All ssh invocations are argv-safe (spawn, never a shell string built from REMOTE_HOST).

const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// --- constants -------------------------------------------------------------

const AI_EXTENSIONS = [
  "anthropic.claude-code",
  "openai.chatgpt",
  "jeanp413.open-remote-ssh",
];

// Host-side InputServer channel files.
const REQ_FILE = "/tmp/remote-pair.input-req";
const RES_FILE = "/tmp/remote-pair.input-res";
const SHOT_FILE = "/tmp/rp-rd.png"; // remote temp screenshot path

const SHOT_INTERVAL_MS = 1200; // poll cadence while view visible
const SHOT_SETTLE_MS = 400; // wait for host to render the png after request
const NOTIFY_INTERVAL_MS = 5000;
const INPUT_THROTTLE_MS = 120; // min gap between forwarded input events
const SSH_CONNECT_TIMEOUT = 6; // seconds

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

/** Send one InputServer verb to the host (fire-and-forget-ish, returns res). */
async function sendInput(host, fields) {
  // Build the request line safely: tab-separated fields written via printf.
  // The content contains only our own validated tokens (verbs, integers, simple
  // key combos); we still POSIX-single-quote it defensively before the shell.
  const reqCmd =
    `printf %s ${shSingleQuote(fields.join("\t"))} > ${REQ_FILE}; ` +
    `sleep 0.05; cat ${RES_FILE} 2>/dev/null`;
  return sshRun(host, reqCmd, { timeoutMs: 8000 });
}

/** POSIX single-quote escape for embedding a literal in a sh command. */
function shSingleQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// --- Remote Desktop webview view provider ----------------------------------

class RemoteDesktopViewProvider {
  /** @param {vscode.Uri} extensionUri */
  constructor(extensionUri, state) {
    this.extensionUri = extensionUri;
    this.state = state; // shared mutable: { inputEnabled, lastShot:{w,h} }
    this.view = null;
    this.pollTimer = null;
    this.visible = false;
    this.busy = false;
    this.lastInputTs = 0;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage((msg) => this.onMessage(msg));

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.visible = true;
        this.startPolling();
      } else {
        this.visible = false;
        this.stopPolling();
      }
    });
    webviewView.onDidDispose(() => {
      this.visible = false;
      this.stopPolling();
      this.view = null;
    });

    this.visible = webviewView.visible;
    this.postInputState();
    if (this.visible) this.startPolling();
  }

  postInputState() {
    if (this.view) {
      this.view.webview.postMessage({ type: "inputState", enabled: !!this.state.inputEnabled });
    }
  }

  async onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const host = getValidHost();
    if (msg.type === "ready") {
      this.postInputState();
      return;
    }
    if (msg.type === "refresh") {
      this.tick(true);
      return;
    }
    if (!host) return;
    if (!this.state.inputEnabled) return;

    const now = Date.now();
    if (now - this.lastInputTs < INPUT_THROTTLE_MS) return;
    this.lastInputTs = now;

    if (msg.type === "click") {
      // msg.rx, msg.ry are relative 0..1. Scale to host display pixels using
      // the dimensions of the last screenshot (defaults to display size).
      const dim = this.state.lastShot || { w: 1344, h: 1008 };
      const rx = clamp01(Number(msg.rx));
      const ry = clamp01(Number(msg.ry));
      if (!isFinite(rx) || !isFinite(ry)) return;
      const x = Math.round(rx * dim.w);
      const y = Math.round(ry * dim.h);
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      log(`click -> ${x},${y} (rel ${rx.toFixed(3)},${ry.toFixed(3)} of ${dim.w}x${dim.h})`);
      await sendInput(host, ["click", String(x), String(y)]);
    } else if (msg.type === "key") {
      const combo = sanitizeCombo(msg.combo);
      if (!combo) return;
      log(`key -> ${combo}`);
      await sendInput(host, ["key", combo]);
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.tick(true);
    this.pollTimer = setInterval(() => this.tick(false), SHOT_INTERVAL_MS);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** One screenshot poll cycle. */
  async tick(force) {
    if (!this.view || (!this.visible && !force)) return;
    if (this.busy) return;
    this.busy = true;
    try {
      const host = getValidHost();
      if (!host) {
        this.post({ type: "status", state: "no-host" });
        return;
      }
      // Request shot, wait for host to render, read back as base64, then clean.
      const reqLine = shSingleQuote(`shot\t${SHOT_FILE}`);
      const settle = (SHOT_SETTLE_MS / 1000).toFixed(2);
      const remoteCmd =
        `printf %s ${reqLine} > ${REQ_FILE}; ` +
        `sleep ${settle}; ` +
        `cat ${RES_FILE} 2>/dev/null; printf '\\n'; ` +
        `base64 < ${SHOT_FILE} 2>/dev/null; ` +
        `rm -f ${SHOT_FILE}`;
      const res = await sshRun(host, remoteCmd, {
        encoding: "utf8",
        timeoutMs: 12000,
        maxBuffer: 24 * 1024 * 1024,
      });
      if (res.code !== 0 && res.code !== null) {
        log(`shot ssh exited code=${res.code} stderr=${res.stderr.slice(0, 200)}`);
        this.post({ type: "status", state: "unreachable", detail: firstLine(res.stderr) });
        return;
      }
      const text = String(res.stdout);
      const nl = text.indexOf("\n");
      const statusLine = nl >= 0 ? text.slice(0, nl) : text;
      const b64 = (nl >= 0 ? text.slice(nl + 1) : "").replace(/\s+/g, "");
      if (!b64) {
        log(`shot returned no image. status=${statusLine.slice(0, 80)}`);
        this.post({ type: "status", state: "no-image", detail: statusLine });
        return;
      }
      // Update cached dimensions for input scaling.
      const dim = pngDimensionsFromBase64(b64);
      if (dim) this.state.lastShot = dim;
      this.post({
        type: "frame",
        dataUri: `data:image/png;base64,${b64}`,
        w: dim ? dim.w : null,
        h: dim ? dim.h : null,
      });
    } catch (e) {
      log(`tick error: ${e && e.message ? e.message : e}`);
      this.post({ type: "status", state: "error", detail: String(e && e.message ? e.message : e) });
    } finally {
      this.busy = false;
    }
  }

  post(m) {
    if (this.view) {
      try {
        this.view.webview.postMessage(m);
      } catch (_e) {}
    }
  }

  refresh() {
    if (this.view) this.tick(true);
  }

  getHtml(webview) {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "remote-desktop.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "remote-desktop.css")
    );
    // Strict CSP: only our nonce'd script, our stylesheet, and data: images.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
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
    <img id="screen" alt="Host screen" draggable="false" />
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

// --- helpers for image / input ---------------------------------------------

function clamp01(n) {
  if (!isFinite(n)) return NaN;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Allow only a conservative key-combo grammar: tokens of [a-z0-9] joined by '+'. */
function sanitizeCombo(combo) {
  if (typeof combo !== "string") return null;
  const c = combo.toLowerCase().trim();
  if (!c) return null;
  if (!/^[a-z0-9]+(\+[a-z0-9]+)*$/.test(c)) return null;
  if (c.length > 64) return null;
  return c;
}

/** Decode the IHDR of a PNG from its base64 to get width/height. */
function pngDimensionsFromBase64(b64) {
  try {
    // Only need the first ~32 bytes; decode a small prefix.
    const head = Buffer.from(b64.slice(0, 64), "base64");
    // PNG signature (8) + length(4) + "IHDR"(4) + width(4) + height(4)
    if (head.length < 24) return null;
    if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) return null;
    if (head.toString("ascii", 12, 16) !== "IHDR") return null;
    const w = head.readUInt32BE(16);
    const h = head.readUInt32BE(20);
    if (w > 0 && h > 0 && w < 100000 && h < 100000) return { w, h };
    return null;
  } catch (_e) {
    return null;
  }
}

function firstLine(s) {
  const t = String(s || "").trim();
  const nl = t.indexOf("\n");
  return nl >= 0 ? t.slice(0, nl) : t;
}

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

async function connectHost() {
  const host = getValidHost();
  if (!host) {
    vscode.window.showWarningMessage(
      "RemotePair: REMOTE_HOST is not set (or invalid) in ~/.remote-pair/client.env."
    );
    return;
  }
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

// --- activation -------------------------------------------------------------

function activate(context) {
  log("RemotePair activating…");

  const state = { inputEnabled: true, lastShot: null };

  // 1) First-run: ensure the 3 AI extensions (best-effort, swallow errors).
  ensureExtensions(false).catch((e) => log(`ensureExtensions error: ${e}`));

  // 2) Remote Desktop webview view.
  const provider = new RemoteDesktopViewProvider(context.extensionUri, state);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("remotepair.remoteDesktop", provider, {
      webviewOptions: { retainContextWhenHidden: false },
    })
  );

  // 3) Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("remotepair.connectHost", () => connectHost()),
    vscode.commands.registerCommand("remotepair.remoteDesktop.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("remotepair.remoteDesktop.toggleInput", () => {
      state.inputEnabled = !state.inputEnabled;
      provider.postInputState();
      vscode.window.setStatusBarMessage(
        `RemotePair input forwarding: ${state.inputEnabled ? "ON" : "OFF"}`,
        2000
      );
    }),
    vscode.commands.registerCommand("remotepair.ensureExtensions", () => ensureExtensions(true))
  );

  // 4) Host notifications poller.
  const notifier = new NotificationPoller();
  notifier.start();
  context.subscriptions.push({ dispose: () => notifier.stop() });

  // 5) Reveal the RemotePair view on startup — Remote Desktop is this client's primary surface.
  vscode.commands.executeCommand("workbench.view.extension.remotepair").then(undefined, () => {});

  log("RemotePair activated.");
}

function deactivate() {}

module.exports = { activate, deactivate };
