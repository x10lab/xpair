// heartbeat.js — CLIENT→HOST liveness heartbeat for the RemotePair IDE.
//
// While the client GUI is alive (the pre-workbench onboarding window AND/OR the IDE workbench),
// it periodically writes a tiny heartbeat file to the HOST over SSH. When the GUI quits, the
// heartbeats stop and the host expires the entry. This is liveness + identity ONLY — no revoke,
// no secrets. The host reads ~/.remote-pair/clients/<id>.json and shows which clients are connected.
//
// CONTRACT (must match the host side exactly):
//   - Host file:   ~/.remote-pair/clients/<id>.json on the HOST (the remote Mac).
//   - <id>     :   sanitized "<user>_<hostname>" of THIS (client) machine; every char outside
//                  [A-Za-z0-9._-] replaced with '_'  (e.g. ghyeong_gh-mac-m4.json).
//   - Content  :   {"name": <client hostname>, "user": <client user>, "ts": <unix epoch seconds>}
//   - Cadence  :   write immediately on start, then every 30s.
//   - Transport:   ssh -o BatchMode=yes -o ConnectTimeout=6 "$REMOTE_HOST" \
//                    'mkdir -p ~/.remote-pair/clients && cat > ~/.remote-pair/clients/<id>.json'
//                  with the JSON piped on stdin. BatchMode = key auth, never prompt.
//   - Shutdown :   best-effort `ssh ... 'rm -f ~/.remote-pair/clients/<id>.json'`.
//
// Robustness: every ssh spawn is fire-and-forget with error handlers — the heartbeat must NEVER
// crash the IDE or block. If REMOTE_HOST is empty or ssh fails, skip silently (retry next tick).
//
// Loaded by BOTH the onboarding main process (onboarding-main.cjs) and the workbench extension host
// (extension.js) via `require("./heartbeat.js")`. Node built-ins only.

const cp = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

const HOME = os.homedir();
const RP_DIR = path.join(HOME, ".remote-pair");
const CLIENT_ENV = path.join(RP_DIR, "client.env");
const INTERVAL_MS = 30 * 1000;
const CONNECT_TIMEOUT = "6";

/** Sanitize to the host-side filename charset: every char outside [A-Za-z0-9._-] → '_'. */
function sanitize(s) {
  return String(s || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

/** This client machine's identity. */
function clientUser() {
  try { return os.userInfo().username; } catch { return "unknown"; }
}
function clientHost() {
  try { return os.hostname(); } catch { return "unknown"; }
}

/** <id> = sanitized "<user>_<hostname>" of THIS client machine. */
function clientId() {
  return sanitize(`${clientUser()}_${clientHost()}`);
}

/** Parse a KEY="value" env file into an object. Mirrors onboarding-bridge.js parseEnv. */
function parseEnv(file) {
  const env = {};
  let txt = "";
  try {
    txt = fs.readFileSync(file, "utf8");
  } catch {
    return env;
  }
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']/, "").replace(/["']\s*$/, "");
  }
  return env;
}

/** Read REMOTE_HOST from client.env (empty string if unset / unreadable). */
function remoteHost() {
  return (parseEnv(CLIENT_ENV).REMOTE_HOST || "").trim();
}

let _timer = null;

/** Fire one heartbeat write over SSH. Fire-and-forget; never throws, never blocks. */
function writeOnce() {
  const host = remoteHost();
  if (!host) return; // not connected yet — retry next tick.
  const id = clientId();
  const payload = JSON.stringify({
    name: clientHost(),
    user: clientUser(),
    ts: Math.floor(Date.now() / 1000),
  });
  try {
    // GUI Electron apps inherit a minimal PATH; prepend the standard user-tool locations so `ssh`
    // resolves without a shell wrapper (same approach as onboarding-bridge.js run()).
    const richPath = `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`;
    const child = cp.spawn(
      "ssh",
      [
        "-o", "BatchMode=yes",
        "-o", `ConnectTimeout=${CONNECT_TIMEOUT}`,
        host,
        "mkdir -p ~/.remote-pair/clients && cat > ~/.remote-pair/clients/" + id + ".json",
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, PATH: richPath } },
    );
    child.on("error", () => { /* ssh missing / spawn failure — skip silently */ });
    const w = child.stdin;
    if (w) {
      w.on("error", () => { /* EPIPE if ssh dies early — benign */ });
      try { w.write(payload); w.end(); } catch { /* write race — ignore */ }
    }
  } catch {
    /* spawn threw — never let the heartbeat crash the IDE */
  }
}

/** Start the heartbeat: write immediately, then every 30s. Idempotent (no double interval). */
function startHeartbeat() {
  if (_timer) return; // already running — do not stack intervals.
  writeOnce();
  _timer = setInterval(writeOnce, INTERVAL_MS);
  if (_timer && typeof _timer.unref === "function") _timer.unref(); // don't keep the process alive.
}

/** Stop the heartbeat: clear the interval and best-effort remove the host file. Never throws. */
function stopHeartbeat() {
  if (_timer) {
    try { clearInterval(_timer); } catch { /* ignore */ }
    _timer = null;
  }
  const host = remoteHost();
  if (!host) return;
  const id = clientId();
  try {
    const richPath = `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`;
    const child = cp.spawn(
      "ssh",
      ["-o", "BatchMode=yes", host, "rm -f ~/.remote-pair/clients/" + id + ".json"],
      { windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, PATH: richPath } },
    );
    child.on("error", () => { /* best-effort — ignore */ });
  } catch {
    /* never let shutdown cleanup crash the caller */
  }
}

module.exports = { startHeartbeat, stopHeartbeat, clientId };
