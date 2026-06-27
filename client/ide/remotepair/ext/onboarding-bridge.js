// onboarding-bridge.js — Node ↔ xpair CLI bridge for the IDE-embedded client onboarding.
//
// The client onboarding runs inside the Xpair IDE (VSCodium) as a webview; this module is the
// extension-side bridge the webview calls to perform REAL setup (Tailscale/SSH connection, file-access
// backend, folder mappings) via the `xpair` CLI. Per §0.1 the CLI is the brain — this bridge only
// shells out to it (argv-safe spawn, never a shell string), it does not reimplement install/map logic.
//
// Spec: .omc/specs/deep-interview-client-onboarding-real-wiring.md
const cp = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

// Zero-dep telemetry (PostHog capture + consent). Shared with the extension host. Consent is
// opt-in (default OFF) → all capture() calls below are no-ops until the user opts in.
const telemetry = require("./telemetry.js");

const HOME = os.homedir();
const RP_DIR = path.join(HOME, ".xpair/host");
const CLIENT_ENV = path.join(RP_DIR, "client.env");
const SSH_KEY = path.join(HOME, ".ssh", "id_ed25519");
const SSH_KNOWN_HOSTS = path.join(HOME, ".ssh", "known_hosts");
const HOST_RE = /^(?!-)[A-Za-z0-9._-]+$/;
const ACCOUNT_RE = /^(?!-)[A-Za-z0-9._-]+$/;
const EFFECTIVE_KNOWN_HOSTS_FILES = new Map();
let sshEphemeralKnownHostsDir;

function validHost(host) {
  return HOST_RE.test(String(host || "").trim());
}

function invalidHost(host) {
  return `invalid host: ${String(host || "").trim()}`;
}

function validAccount(account) {
  return ACCOUNT_RE.test(String(account || "").trim());
}

function invalidAccount(account) {
  return `invalid account: ${String(account || "").trim()}`;
}

/** Resolve the xpair binary (installed to ~/.local/bin, else on PATH). */
function rpBin() {
  const local = path.join(HOME, ".local", "bin", "xpair");
  return fs.existsSync(local) ? local : "xpair";
}

/** The xpair binary ONLY when it resolves to a real absolute path on disk; null when it would
 *  fall back to the bare "xpair" PATH lookup (which silently ENOENTs from a GUI Electron app whose
 *  inherited PATH omits ~/.local/bin). Used by the hard CLI guard so we never claim "ready" off a
 *  PATH guess. */
function rpBinAbs() {
  const local = path.join(HOME, ".local", "bin", "xpair");
  try { if (fs.existsSync(local)) return local; } catch { /* ignore */ }
  return null;
}

/** Client version SSOT — the same 0.5.0a{N} lockstep stamp the webview build embeds (read from the
 *  shared monotonic build counter). Repo-relative from this file: ext → remotepair → ide → client →
 *  repo-root. In a built app bundle the counter is absent, so we fall back to the base "0.5.0a". */
function clientVersion() {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "..", "shared", ".build-counter"),
    path.join(__dirname, "shared", ".build-counter"),
  ];
  for (const f of candidates) {
    try {
      const n = fs.readFileSync(f, "utf8").trim();
      if (n) return `0.5.0a${n}`;
    } catch { /* try next */ }
  }
  return "0.5.0a";
}

/** Extract the major component of a version string for coarse compatibility (e.g. "0.5.0a3" → "0",
 *  "1.2.0" → "1"). Empty/garbage → "". */
function versionMajor(v) {
  const m = String(v || "").match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

/** The OLDEST host version this client can talk to. **BUMP THIS** whenever a host↔client
 *  protocol/interface changes incompatibly — e.g. the a49 RD session-token requirement made
 *  rd-session-token and serve-webrtc --token mandatory, and a51 reworked the RD screen/control
 *  channel (serve_webrtc rewrite + new control.rs + rp-input-inject) this client now drives, so an
 *  a50-or-older host fails subtly (black RD / no input / "signaling closed 1006"). A same-major host
 *  OLDER than this connects today but breaks; gating it at onboarding with a clear "update the host"
 *  message is far better than a silent breakage. A host >= this is accepted. INVARIANT: the host cask
 *  (Casks/xpair-host.rb) must ship a version >= this floor, AND App.tsx's mirror must stay in sync. */
const MIN_COMPATIBLE_HOST = "0.5.0a51";

/** Compare two "X.Y.Z" or "X.Y.ZaN" version strings → -1 | 0 | 1 (a<b | a==b | a>b).
 *  The alpha suffix sorts BELOW the same release: 0.5.0a44 < 0.5.0a45 < 0.5.0 (a released X.Y.Z
 *  has no `aN`, so it ranks above every alpha of that X.Y.Z). Unparseable input → 0 (unknown). */
function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v || "").match(/^\s*(\d+)\.(\d+)\.(\d+)(?:a(\d+))?/);
    // 4th field: alpha number, or Infinity for a non-alpha release (ranks above any aN).
    return m ? [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : Infinity] : null;
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** Resolve the tailscale binary path (macOS .app / brew / std locations), or null if absent.
 *  Sync existsSync probe — Tailscale on macOS often has NO `tailscale` on PATH, only the .app. */
function resolveTailscale() {
  const cands = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
  ];
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

/** The standard user-tool PATH a GUI Electron app is missing (its inherited PATH is minimal). */
const RICH_PATH = `${HOME}/.local/bin:${HOME}/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`;

/** Resolve the running ssh-agent's auth socket. A GUI Electron app launched from Finder/Dock does
 *  NOT inherit SSH_AUTH_SOCK, so ssh can't reach the agent and silently falls back to a password
 *  prompt even when key auth would succeed in a terminal. Recover it so probes use key auth. Returns
 *  the socket path, or "" if none is found (caller simply omits SSH_AUTH_SOCK then).
 *
 *  Order: an EXPLICIT non-system SSH_AUTH_SOCK (a deliberately forwarded/custom agent) wins; else
 *  the 1Password SSH agent if its socket is present (extremely common — keys configured as
 *  `IdentityFile ~/.ssh/*.pub` are held there, and the system launchd agent can NOT sign them);
 *  else whatever the env held; else the macOS system launchd agent discovered on disk.
 *
 *  Subtlety: a GUI app does NOT inherit a useful SSH_AUTH_SOCK — launchd injects the macOS *system*
 *  ssh-agent socket (/var/run|/private/tmp/com.apple.launchd.<id>/Listeners), which holds no
 *  1Password keys. So that auto-injected value must NOT short-circuit the 1Password lookup, or host
 *  connect/update silently fails for 1Password users (the reported "update host" loop). */
function sshAuthSock() {
  const env = process.env.SSH_AUTH_SOCK || "";
  const isSystemAgent = /\/com\.apple\.launchd\.[^/]+\/Listeners$/.test(env);
  if (env && !isSystemAgent) return env; // explicit/custom agent → respect it
  // 1Password SSH agent — fixed socket under the app's Group Container.
  try {
    const op = path.join(HOME, "Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock");
    if (fs.existsSync(op)) return op;
  } catch { /* not installed — fall through */ }
  if (env) return env; // system agent, no 1Password → use what we were given
  try {
    // macOS: the system agent socket lives in a per-boot dir named like
    // /private/tmp/com.apple.launchd.XXXX/Listeners — find the newest one.
    const tmp = "/private/tmp";
    const dirs = fs
      .readdirSync(tmp)
      .filter((d) => d.startsWith("com.apple.launchd."))
      .map((d) => path.join(tmp, d, "Listeners"))
      .filter((p) => {
        try { return fs.existsSync(p); } catch { return false; }
      });
    if (dirs.length) return dirs[dirs.length - 1];
  } catch { /* no system agent socket — fall through */ }
  return "";
}

/** Spawn env for child processes (PATH enrichment + ssh-agent recovery). When a GUI Electron app
 *  shells out to ssh (directly or via the xpair CLI), this restores both the user PATH and the
 *  SSH_AUTH_SOCK the desktop launch dropped, so ssh uses key auth instead of falling to password. */
function spawnEnv(extra = {}) {
  const env = { ...process.env, PATH: RICH_PATH, ...extra };
  const sock = sshAuthSock();
  if (sock) env.SSH_AUTH_SOCK = sock;
  return env;
}

function sshControlPath() {
  return "/tmp/rp-cm-" + (process.env.RP_SSH_CM_TAG || "x") + "-%C";
}

function sshEphemeralKnownHostsPath() {
  if (sshEphemeralKnownHostsDir === undefined) {
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-kh-"));
      sshEphemeralKnownHostsDir = dir;
      process.on("exit", () => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
      });
    } catch {
      sshEphemeralKnownHostsDir = null;
    }
  }
  return sshEphemeralKnownHostsDir ? path.join(sshEphemeralKnownHostsDir, "known_hosts") : null;
}

function effectiveKnownHostsFiles(host) {
  const h = String(host || "").trim();
  if (!h) return null;
  if (EFFECTIVE_KNOWN_HOSTS_FILES.has(h)) return EFFECTIVE_KNOWN_HOSTS_FILES.get(h);
  try {
    const out = cp.execFileSync("ssh", ["-G", h], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) {
      EFFECTIVE_KNOWN_HOSTS_FILES.set(h, null);
      return null;
    }
    const seen = new Set();
    const files = [];
    for (const line of String(out).split("\n")) {
      const m = line.match(/^\s*(userknownhostsfile|globalknownhostsfile)\s+(.+?)\s*$/i);
      if (!m) continue;
      for (const file of m[2].split(/\s+/).filter(Boolean)) {
        if (seen.has(file)) continue;
        seen.add(file);
        files.push(file);
      }
    }
    const result = files.length ? files : null;
    EFFECTIVE_KNOWN_HOSTS_FILES.set(h, result);
    return result;
  } catch {
    EFFECTIVE_KNOWN_HOSTS_FILES.set(h, null);
    return null;
  }
}

function sshConfigDoubleQuote(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function sshUserKnownHostsFileOption(host) {
  const ephemeral = sshEphemeralKnownHostsPath();
  const defaults = [
    SSH_KNOWN_HOSTS,
    path.join(HOME, ".ssh", "known_hosts2"),
    "/etc/ssh/ssh_known_hosts",
    "/etc/ssh/ssh_known_hosts2",
  ];
  const files = effectiveKnownHostsFiles(host) || defaults;
  return [ephemeral, ...files]
    .filter((file) => typeof file === "string" && file.length > 0)
    .map(sshConfigDoubleQuote)
    .join(" ");
}

function shSingleQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function shPathQuotePreserveHome(p) {
  const s = String(p);
  if (s === "~") return "~";
  if (s === "~/") return "~/";
  if (s.startsWith("~/")) return "~/" + shSingleQuote(s.slice(2));
  const m = s.match(/^(~[A-Za-z0-9._-]*)(?:\/(.*))?$/);
  if (m) return m[2] === undefined ? m[1] : `${m[1]}/${shSingleQuote(m[2])}`;
  return shSingleQuote(s);
}

/** Non-interactive ssh options for reachability/read probes: name the key explicitly, force
 *  publickey-only auth, and BatchMode so ssh NEVER drops to a password/passphrase prompt (which
 *  would hang or spawn an out-of-band GUI prompt). Used by every read/probe ssh call and by the
 *  install preflight: fingerprint-confirmed key auth is the primary path. ControlMaster is shared
 *  within one app launch via RP_SSH_CM_TAG so probes/tunnels multiplex over one authenticated SSH
 *  master without reusing a previous launch's stale master. */
function sshProbeOpts(host, connectTimeout = 5) {
  const opts = [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${connectTimeout}`,
    "-o", "ConnectionAttempts=1",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${sshControlPath()}`,
    "-o", "ControlPersist=300",
    "-o", "PreferredAuthentications=publickey",
    "-o", "PubkeyAuthentication=yes",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "NumberOfPasswordPrompts=0",
    "-o", `UserKnownHostsFile=${sshUserKnownHostsFileOption(host)}`,
    "-o", "StrictHostKeyChecking=accept-new",
  ];
  try {
    if (fs.existsSync(SSH_KEY)) opts.push("-o", "IdentitiesOnly=yes", "-i", SSH_KEY);
  } catch { /* key probe failed — let ssh use the agent / defaults */ }
  return opts;
}

const SSH_STATE = Object.freeze({
  READY: "ready",
  INVALID_HOST: "invalid_host",
  INVALID_ACCOUNT: "invalid_account",
  HOST_KEY_MISMATCH: "host_key_mismatch",
  KEY_AUTH_BLOCKED: "key_auth_blocked",
  NEEDS_PASSWORD: "needs_password",
  PASSWORD_DENIED: "password_denied",
  UNREACHABLE: "unreachable",
});

const SSH_ACTION = Object.freeze({
  CONTINUE: "continue",
  ABORT: "abort",
  RECOVER_HOST_KEY: "recover_host_key",
  APPROVE_OR_RETRY: "approve_or_retry",
  PROMPT_PASSWORD: "prompt_password",
  RETRY: "retry",
});

function sshFailureKind(err) {
  const s = String(err || "");
  if (/REMOTE HOST IDENTIFICATION|Host key verification failed|POSSIBLE DNS SPOOFING|Offending .*known_hosts|host key .*changed/i.test(s)) {
    return SSH_STATE.HOST_KEY_MISMATCH;
  }
  if (/Permission denied \(publickey|sign_and_send_pubkey|agent refused operation|Could not open a connection to your authentication agent|Enter passphrase|passphrase|Too many authentication failures|no such identity|identity file .*not accessible|Load key .*Permission denied|Load key .*invalid format|error in libcrypto/i.test(s)) {
    return SSH_STATE.KEY_AUTH_BLOCKED;
  }
  return SSH_STATE.UNREACHABLE;
}

function isRemotePublickeyDenied(err) {
  return /Permission denied \((?=[^)]*publickey)[^)]*\)/i.test(String(err || ""));
}

// LOCAL key/agent problems — the key can't sign on THIS machine, which is NOT "the host hasn't
// authorized us". ssh may print both (e.g. `sign_and_send_pubkey: agent refused operation` then
// `Permission denied (publickey)`); when a local marker is present we must keep the approve/unlock
// recovery path and NOT spend the account password authorizing an unusable key.
function isLocalKeyFailure(err) {
  return /sign_and_send_pubkey|agent refused operation|Load key [^\n]*:|passphrase|Too many authentication failures|no mutual signature|key_load_public|invalid format|error in libcrypto|No more authentication methods|not accessible/i.test(
    String(err || "")
  );
}

function isPasswordDenied(err) {
  const s = String(err || "");
  return /PASSWORD_DENIED/i.test(s) || /Permission denied \((?=[^)]*password)[^)]*\)/i.test(s);
}

function sshFailureMessage(state, err) {
  if (state === SSH_STATE.HOST_KEY_MISMATCH) {
    return "SSH host key mismatch: the host identity changed. Re-confirm the fingerprint, remove the stale known_hosts entry if this is your Mac, then retry.";
  }
  if (state === SSH_STATE.KEY_AUTH_BLOCKED) {
    return "SSH key auth blocked: unlock or approve your SSH agent/key passphrase, make sure this Mac's public key is authorized on the host, then retry.";
  }
  if (state === SSH_STATE.NEEDS_PASSWORD) {
    return "This host has not authorized this Mac's SSH key yet. Enter the host account password to authorize it once.";
  }
  if (state === SSH_STATE.PASSWORD_DENIED) {
    return "The host account password was denied. Check it and try again.";
  }
  return err || "could not reach host over SSH";
}

function sshActionForState(state) {
  if (state === SSH_STATE.READY) return SSH_ACTION.CONTINUE;
  if (state === SSH_STATE.INVALID_HOST || state === SSH_STATE.INVALID_ACCOUNT) return SSH_ACTION.ABORT;
  if (state === SSH_STATE.HOST_KEY_MISMATCH) return SSH_ACTION.RECOVER_HOST_KEY;
  if (state === SSH_STATE.KEY_AUTH_BLOCKED) return SSH_ACTION.APPROVE_OR_RETRY;
  if (state === SSH_STATE.NEEDS_PASSWORD || state === SSH_STATE.PASSWORD_DENIED) return SSH_ACTION.PROMPT_PASSWORD;
  return SSH_ACTION.RETRY;
}

function sshResult(r, fallbackErr) {
  if (r.code === 0) {
    return {
      reachable: true,
      err: "",
      state: SSH_STATE.READY,
      action: SSH_ACTION.CONTINUE,
    };
  }
  const raw = r.err || r.out || fallbackErr || "could not reach host over SSH";
  const state = sshFailureKind(raw);
  return {
    reachable: false,
    err: sshFailureMessage(state, raw),
    state,
    action: sshActionForState(state),
  };
}

/** Run argv-safe; resolve {code, out, err} (never rejects).
 *  When spawned from a GUI Electron app the inherited PATH is minimal; prepend the standard
 *  user-tool locations so `tailscale`, `ssh`, etc. resolve without requiring a shell wrapper. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = cp.spawn(cmd, args, {
        windowsHide: true,
        env: spawnEnv(),
        ...opts,
      });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e && e.message ? e.message : e) });
    }
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e.message) }));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
const cli = (args) => run(rpBin(), args);

/** Like run(), but writes ONE secret line to the child's STDIN (fd 0) then closes it — for handing a
 *  secret to a child/remote command WITHOUT it ever touching argv (`ps`), a log line, or disk. ssh
 *  forwards its own stdin to the remote command's stdin, and install-host reads its bootstrap account
 *  password from stdin before setting up its bash-managed askpass fd. The secret is written once and
 *  the pipe closed immediately. */
function runSecretStdin(cmd, args, secret) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = cp.spawn(cmd, args, {
        windowsHide: true,
        env: spawnEnv(),
        stdio: ["pipe", "pipe", "pipe"], // fd0 = secret pipe
      });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e && e.message ? e.message : e) });
    }
    try {
      child.stdin.on("error", () => {}); // EPIPE if the remote never reads — benign.
      child.stdin.write(String(secret) + "\n");
      child.stdin.end();
    } catch {
      /* a write race (child already gone) must never crash the main process */
    }
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e.message) }));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

function cliWithPasswordStdin(args, secret) {
  return runSecretStdin(rpBin(), [...args, "--password-stdin"], secret);
}

/** True only when the FULL password-bootstrap toolchain is present: the installed CLI understands
 *  install-host --password-stdin AND its sibling xpair-askpass supports the FIFO (RP_ASKPASS_FIFO)
 *  handoff. Both are bash scripts on disk, so read them and look for the markers — cliReady() only
 *  proves `xpair status` runs, which an old toolchain also passes. Conservative: unreadable → false. */
function cliSupportsPasswordStdin() {
  const bin = rpBinAbs();
  if (!bin) return false;
  try {
    if (!fs.readFileSync(bin, "utf8").includes("--password-stdin")) return false;
    // xpair-askpass ships next to the CLI (rp_askpass_path resolves it as a sibling). A CLI that
    // knows the flag but an old askpass that can't read the FIFO would still dead-end the bootstrap.
    const askpass = path.join(path.dirname(bin), "xpair-askpass");
    return fs.readFileSync(askpass, "utf8").includes("RP_ASKPASS_FIFO");
  } catch {
    return false;
  }
}

// --- Engine constants (claude | codex | opencode | shell) -------------------------------------
// Agent engines run ON THE HOST; these drive the host-side install/auth-check/auth-set guards.
// `shell` is a valid session engine (plain login shell, no install/auth guard), so it is only a
// member of SESSION_ENGINES — never of the install/auth-guarded ENGINES set.
const ENGINES = new Set(["claude", "codex", "opencode"]);
const SESSION_ENGINES = new Set([...ENGINES, "shell"]);

// Per-engine host probe: a single shell line (run over key-auth SSH) that prints a RP_* block:
//   RP_ENGINE_INSTALLED=1|0, RP_ENGINE_VERSION=<v>, RP_ENGINE_AUTHED=1 (only when authed).
// PATH is enriched first so a Homebrew/npm-global engine resolves under a non-login ssh command.
// Auth detection is engine-specific:
//   claude    — ANTHROPIC_API_KEY exported in the login shell, OR ~/.claude/.credentials.json (OAuth).
//   shell     — no auth; uses the host account's default login shell.
//   codex     — `codex login status` exits 0 (API key or ChatGPT login), OR ~/.codex/auth.json.
//   opencode  — a provider env var set (ANTHROPIC_API_KEY/OPENAI_API_KEY), OR ~/.local/share/opencode/auth.json.
const PATH_PREFIX =
  'export PATH="$HOME/.local/bin:$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ';
const ENGINE_PROBE = {
  claude:
    PATH_PREFIX +
    'if command -v claude >/dev/null 2>&1; then echo RP_ENGINE_INSTALLED=1; ' +
    'echo "RP_ENGINE_VERSION=$(claude --version 2>/dev/null | head -1)"; ' +
    'KEY="$(bash -lc \'printf %s "$ANTHROPIC_API_KEY"\' 2>/dev/null)"; ' +
    'if [ -n "$KEY" ] || [ -f "$HOME/.claude/.credentials.json" ]; then echo RP_ENGINE_AUTHED=1; fi; ' +
    'else echo RP_ENGINE_INSTALLED=0; fi',
  shell:
    'SHELL_BIN="${SHELL:-/bin/zsh}"; ' +
    'if [ -x "$SHELL_BIN" ]; then echo RP_ENGINE_INSTALLED=1; echo "RP_ENGINE_VERSION=$SHELL_BIN"; echo RP_ENGINE_AUTHED=1; ' +
    'elif [ -x /bin/bash ]; then echo RP_ENGINE_INSTALLED=1; echo "RP_ENGINE_VERSION=/bin/bash"; echo RP_ENGINE_AUTHED=1; ' +
    'else echo RP_ENGINE_INSTALLED=0; fi',
  codex:
    PATH_PREFIX +
    'if command -v codex >/dev/null 2>&1; then echo RP_ENGINE_INSTALLED=1; ' +
    'echo "RP_ENGINE_VERSION=$(codex --version 2>/dev/null | head -1)"; ' +
    'if codex login status >/dev/null 2>&1 || [ -f "$HOME/.codex/auth.json" ]; then echo RP_ENGINE_AUTHED=1; fi; ' +
    'else echo RP_ENGINE_INSTALLED=0; fi',
  opencode:
    PATH_PREFIX +
    'if command -v opencode >/dev/null 2>&1; then echo RP_ENGINE_INSTALLED=1; ' +
    'echo "RP_ENGINE_VERSION=$(opencode --version 2>/dev/null | head -1)"; ' +
    'KEY="$(bash -lc \'printf %s "${ANTHROPIC_API_KEY}${OPENAI_API_KEY}"\' 2>/dev/null)"; ' +
    'if [ -n "$KEY" ] || [ -f "$HOME/.local/share/opencode/auth.json" ]; then echo RP_ENGINE_AUTHED=1; fi; ' +
    'else echo RP_ENGINE_INSTALLED=0; fi',
};

// Per-engine host install command — each engine's OFFICIAL native installer, run non-interactively.
// No brew/npm: claude/codex land in ~/.local/bin, opencode in ~/.opencode/bin (PATH_PERSIST wires both
// onto the host's login PATH). The installers' own rc-PATH edits are suppressed where supported
// (opencode --no-modify-path) since PATH_PERSIST owns PATH persistence. Mirrored in EngineGuard.swift.
const ENGINE_INSTALL = {
  claude: "bash -c 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash'",
  shell: 'true',
  codex: "bash -c 'set -o pipefail; curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'",
  opencode: "bash -c 'set -o pipefail; curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path'",
};

// PATH persistence (engine-agnostic): write ~/.xpair/env with the canonical PATH (incl. the native
// install dirs ~/.local/bin and ~/.opencode/bin) and source it from zsh/bash login + interactive rc
// files via an idempotent xpair-delimited block — so a bare `claude`/`codex` resolves in the host's own
// Terminal. Idempotent: the delimited block + sourced file are rewritten, never duplicated. Mirrored in
// host/app/EngineGuard.swift (pathPersistScript).
const PATH_PERSIST =
  'set -e; ' +
  'mkdir -p "$HOME/.xpair"; ' +
  'printf \'%s\\n\' \'export PATH="$HOME/.local/bin:$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"\' > "$HOME/.xpair/env"; ' +
  'for RC in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc"; do ' +
  'touch "$RC"; TMP="$(mktemp)"; ' +
  'grep -vF \'# >>> xpair PATH >>>\' "$RC" | grep -vF \'. "$HOME/.xpair/env"\' | grep -vF \'# <<< xpair PATH <<<\' > "$TMP" || true; ' +
  'cat "$TMP" > "$RC"; rm -f "$TMP"; ' +
  '{ echo \'# >>> xpair PATH >>>\'; echo \'[ -f "$HOME/.xpair/env" ] && . "$HOME/.xpair/env"\'; echo \'# <<< xpair PATH <<<\'; } >> "$RC"; ' +
  'done; echo RP_PATH_OK=1';

// Per-engine host auth WRITER — a remote shell command that reads ONE secret line from STDIN
// (`read -r KEY`) and persists it. The key NEVER appears on argv/log/disk on either side:
//   codex     — pipe the key into `codex login --with-api-key` (reads stdin → ~/.codex/auth.json).
//   claude    — append `export ANTHROPIC_API_KEY=...` to the login shell rc (idempotent: drop any
//               prior Xpair-managed line first). claude + opencode both read the provider env at runtime.
//   opencode  — same provider-env export (opencode reads ANTHROPIC_API_KEY natively).
// The rc writer rewrites a single Xpair-delimited block so re-running replaces (not duplicates) it,
// and chmods the rc 600. `read -r KEY` strips the trailing newline; the key stays out of argv.
function rcExportWriter(varName) {
  // Determine the login shell rc (zsh default on macOS, bash fallback), append a managed export block.
  return (
    'read -r KEY; ' +
    'case "${SHELL:-}" in *zsh) RC="$HOME/.zshrc";; *bash) RC="$HOME/.bashrc";; *) RC="$HOME/.zshrc";; esac; ' +
    'touch "$RC"; chmod 600 "$RC" 2>/dev/null || true; ' +
    'TMP="$(mktemp)"; ' +
    // Drop ONLY the previous Xpair-managed block (the lines between, and including, the markers) —
    // NOT every `export VAR=` line. A blanket grep would silently delete a user's own hand-maintained
    // export that lives outside our block. awk skips the delimited region and keeps everything else.
    'awk -v b="# >>> xpair ' + varName + ' >>>" -v e="# <<< xpair ' + varName + ' <<<" \'$0==b{skip=1;next} $0==e{skip=0;next} skip!=1\' "$RC" > "$TMP" || true; ' +
    'mv "$TMP" "$RC"; ' +
    '{ echo "# >>> xpair ' + varName + ' >>>"; printf \'export ' + varName + '=%s\\n\' "$KEY"; echo "# <<< xpair ' + varName + ' <<<"; } >> "$RC"; ' +
    'echo RP_AUTH_OK=1'
  );
}
const ENGINE_AUTH_WRITE = {
  claude: rcExportWriter("ANTHROPIC_API_KEY"),
  codex:
    PATH_PREFIX +
    'read -r KEY; printf %s "$KEY" | codex login --with-api-key >/dev/null 2>&1 && echo RP_AUTH_OK=1',
  opencode: rcExportWriter("ANTHROPIC_API_KEY"),
};

/** Parse a KEY="value" env file into an object. */
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

/** Upsert KEY="value" in client.env. (CLI `config set` only covers host|terminal; backend keys land here.) */
function upsertEnv(key, val) {
  let lines = [];
  try {
    lines = fs.readFileSync(CLIENT_ENV, "utf8").split("\n");
  } catch {
    /* file may not exist yet */
  }
  const re = new RegExp("^\\s*" + key + "=");
  let found = false;
  lines = lines.map((l) => {
    if (re.test(l)) {
      found = true;
      return `${key}="${val}"`;
    }
    return l;
  });
  if (!found) lines.push(`${key}="${val}"`);
  try {
    fs.mkdirSync(RP_DIR, { recursive: true });
    fs.writeFileSync(CLIENT_ENV, lines.join("\n").replace(/\n+$/, "\n"));
  } catch {
    /* best effort */
  }
}

const bridge = {
  // Bridge + real values: this machine's real identity (replaces hardcoded host/user).
  hostInfo() {
    return { hostname: os.hostname(), user: os.userInfo().username };
  },

  // CLI hard guard (global): is the `xpair` CLI actually usable on THIS machine? The whole onboarding
  // shells out to it, so if it isn't there every "real" step silently ENOENTs (code -1) and the wizard
  // would otherwise sail past. Two checks, both required:
  //   1. rpBinAbs() resolves to a real absolute path (NOT the bare "xpair" PATH guess that ENOENTs
  //      from a GUI Electron app whose inherited PATH omits ~/.local/bin).
  //   2. `xpair status` runs to completion (code 0) — a cheap, side-effect-free liveness probe.
  // Returns {ready, bin, err}; ready===false → App.tsx raises a global block that disables every Next.
  async cliReady() {
    const bin = rpBinAbs();
    if (!bin) {
      return { ready: false, bin: "", err: "xpair CLI not found at ~/.local/bin/xpair" };
    }
    const r = await run(bin, ["status"]);
    if (r.code !== 0) {
      const why = r.code === -1
        ? `xpair could not be executed: ${r.err || "spawn failed"}`
        : `xpair status exited ${r.code}: ${r.err || "no output"}`;
      return { ready: false, bin, err: why };
    }
    return { ready: true, bin, err: "" };
  },

  // CLI auto-install (component ⓪ — the "no dead end" path). cliReady===false used to be a hard wall;
  // instead the onboarding calls this to install the BUNDLED client CLI to ~/.local/bin and proceed.
  // We ship a repo-shaped tree next to this file (build.sh §4.7 → <ext>/cli/{shared,client/cli}/...),
  // so the SoT installer runs unmodified: `cli/shared/install.sh --role client`. install.sh sources
  // its own config.sh/lib.sh and derives CLIENT_DIR from its location, so no args/env beyond role are
  // needed; REMOTE_HOST is only prompted on a tty (none here) so client install is non-interactive.
  // Returns {ok, err}; only a FALSE here should make App.tsx show the blocking banner (+ Retry).
  async installCli() {
    // Prefer the bundled copy (production .app); fall back to the in-repo SoT (dev checkout, where the
    // bridge runs from client/ide/remotepair/ext → ../../../../shared/install.sh).
    const candidates = [
      path.join(__dirname, "cli", "shared", "install.sh"),
      path.join(__dirname, "..", "..", "..", "..", "shared", "install.sh"),
    ];
    let installer = "";
    for (const c of candidates) {
      try { if (fs.existsSync(c)) { installer = c; break; } } catch { /* ignore */ }
    }
    if (!installer) {
      return { ok: false, err: "bundled installer not found (cli/shared/install.sh)" };
    }
    // RP_YES=1 + no tty ⇒ install.sh skips the interactive REMOTE_HOST prompt and the trailing
    // onboarding/doctor blocks (all gated on REMOTE_HOST being set, which it is not here).
    const r = await run("bash", [installer, "--role", "client"], {
      cwd: path.dirname(installer),
      env: spawnEnv({ RP_YES: "1" }),
    });
    if (r.code !== 0) {
      return { ok: false, err: r.err || r.out || `installer exited ${r.code}` };
    }
    // Confirm the binary actually landed at the canonical path before claiming success.
    if (!rpBinAbs()) {
      return { ok: false, err: "installer ran but ~/.local/bin/xpair is still missing" };
    }
    return { ok: true, err: "" };
  },

  // Current client config (real state, not hardcoded).
  // SSOT: mappings come from the CLI (`map list --json`), NOT from re-parsing client.env here.
  // rp_set shell-escapes FOLDER_MAPS (e.g. `a::b\;c::d`); the CLI `.`-sources it (unescaping),
  // while parseEnv reads it literally — so a local re-parse split on ';' diverges from the CLI
  // and the UI shows zero/garbled mappings. Re-derive a clean `client::host;...` from the CLI.
  async getConfig() {
    const e = parseEnv(CLIENT_ENV);
    let folderMaps = e.FOLDER_MAPS || "";
    try {
      const r = await cli(["map", "list", "--json"]);
      if (r.code === 0 && r.out) {
        const arr = JSON.parse(r.out);
        if (Array.isArray(arr)) folderMaps = arr.map((m) => `${m.client}::${m.host}`).join(";");
      }
    } catch {
      /* CLI unavailable — fall back to the raw env value */
    }
    return {
      remoteHost: e.REMOTE_HOST || "",
      engine: e.ENGINE || "",
      folderMaps,
      syncBackend: e.SYNC_BACKEND || "",
      mountBackend: e.MOUNT_BACKEND || "",
    };
  },

  // Connection — Tailscale-first reachability probe. On macOS Tailscale commonly ships ONLY as
  // /Applications/Tailscale.app (no `tailscale` on PATH), so a naive `which tailscale` false-negatives
  // ("not installed" despite being installed). Probe the app/brew binary too — matching the CLI's
  // cmd_discover probe — so this agrees with `xpair discover`.
  async tailscaleStatus() {
    const bin = resolveTailscale();
    if (!bin) return { installed: false, up: false };
    const st = await run(bin, ["status"]);
    return { installed: true, up: st.code === 0 };
  },

  // Connection — full SSH-assist: generate ed25519 if missing, return the pubkey to add to the host.
  // `keygenNew` tells the UI whether a fresh key was created (feeds ssh_config_completed.keygen_new).
  async sshKeygen() {
    let keygenNew = false;
    if (!fs.existsSync(SSH_KEY)) {
      const sshDir = path.join(HOME, ".ssh");
      fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(sshDir, 0o700);
      await run("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", SSH_KEY, "-q"]);
      keygenNew = fs.existsSync(SSH_KEY);
    }
    let pubkey = "";
    try {
      pubkey = fs.readFileSync(SSH_KEY + ".pub", "utf8").trim();
    } catch {
      /* keygen may have failed */
    }
    return { pubkey, keygenNew };
  },

  // Connection — real reachability check (hard-gate for the Connect step).
  async sshReachable(host) {
    const h = String(host || "").trim();
    if (!h) return { reachable: false, err: "no host" };
    if (!validHost(h)) {
      return {
        reachable: false,
        err: invalidHost(h),
        state: SSH_STATE.INVALID_HOST,
        action: SSH_ACTION.ABORT,
      };
    }
    const r = await run("ssh", [...sshProbeOpts(h, 5), h, "true"]);
    return sshResult(r);
  },

  // Connection — persist REMOTE_HOST via the CLI.
  async setHost(host) {
    return cli(["config", "set", "host", host]);
  },

  // Engine — persist the chosen session engine via the CLI (`config set engine <claude|codex|opencode|shell>`,
  // → client.env ENGINE, consumed by `xpair launch`). Validates the engine here too so a bad value
  // never reaches the CLI. Returns {code, out, err}.
  async setEngine(engine) {
    if (!SESSION_ENGINES.has(String(engine))) {
      return { code: -1, out: "", err: `unknown engine: ${engine}` };
    }
    return cli(["config", "set", "engine", String(engine)]);
  },

  // --- Engine host-readiness hard guard (component — same philosophy as the CLI/host-app guards) ---
  //
  // The chosen session engine runs ON THE HOST (xpair launch SSHes in and execs `claude`/`codex`/
  // `opencode`, or a plain shell, there). So before pairing we must confirm THAT engine is available
  // on the host, or `xpair launch` dead-ends with "<engine> not found on host" / an auth prompt the
  // GUI can never answer. These three methods mirror installHost's pattern: probe → install → set
  // auth, all over key-auth SSH (BatchMode, never prompts).

  // Engine — is `engine` installed AND authenticated on the host? One SSH round-trip (key auth,
  // BatchMode) runs an engine-specific probe and prints a parseable RP_* block. Auth detection is
  // engine-specific (each engine stores creds differently); see ENGINE_PROBE below. Returns
  // {installed, authed, version, err}.
  async hostEngineStatus(engine) {
    const e = String(engine || "");
    const host = String(parseEnv(CLIENT_ENV).REMOTE_HOST || "").trim();
    if (!host) return { installed: false, authed: false, version: "", err: "REMOTE_HOST not set" };
    if (!validHost(host)) {
      return {
        installed: false,
        authed: false,
        version: "",
        err: invalidHost(host),
        state: SSH_STATE.INVALID_HOST,
        action: SSH_ACTION.ABORT,
      };
    }
    const probe = ENGINE_PROBE[e];
    if (!probe) return { installed: false, authed: false, version: "", err: `unknown engine: ${e}` };
    const r = await run("ssh", [...sshProbeOpts(host, 6), host, probe]);
    if (r.code !== 0) {
      const s = sshResult(r);
      return {
        installed: false,
        authed: false,
        version: "",
        err: s.err,
        state: s.state,
        action: s.action,
      };
    }
    const out = r.out || "";
    const installed = /RP_ENGINE_INSTALLED=1/.test(out);
    if (!installed) {
      return { installed: false, authed: false, version: "", err: `Host has no '${e}' installed` };
    }
    const authed = /RP_ENGINE_AUTHED=1/.test(out);
    let version = "";
    const vm = out.match(/RP_ENGINE_VERSION=(.*)/);
    if (vm) version = vm[1].trim();
    return {
      installed: true,
      authed,
      version,
      err: authed ? "" : `'${e}' is installed on the host but not signed in`,
    };
  },

  // Engine — install `engine` on the host over SSH via its official native installer (non-interactive,
  // no tty). PATH_PREFIX puts curl + the install dirs on PATH; after a non-shell install we run
  // PATH_PERSIST so a bare `claude`/`codex` resolves in the host's own Terminal later. Returns {ok, err}.
  // Re-probe with hostEngineStatus afterwards — never trust the exit code alone (a curl|sh exit 0 means
  // "ran", not "binary is launch-able"). Mirrored in host/app/EngineGuard.swift.
  async installHostEngine(engine) {
    const e = String(engine || "");
    const host = String(parseEnv(CLIENT_ENV).REMOTE_HOST || "").trim();
    if (!host) return { ok: false, err: "REMOTE_HOST not set" };
    if (!validHost(host)) {
      return { ok: false, err: invalidHost(host), state: SSH_STATE.INVALID_HOST, action: SSH_ACTION.ABORT };
    }
    if (!ENGINE_INSTALL[e]) return { ok: false, err: `unknown engine: ${e}` };
    // Run the native installer, then persist PATH (skip for shell — nothing was installed).
    const persist = e === "shell" ? "" : ` && { ${PATH_PERSIST}; }`;
    const cmd = `${PATH_PREFIX}${ENGINE_INSTALL[e]}${persist}`;
    const r = await run("ssh", [...sshProbeOpts(host, 20), host, cmd], { /* installer can take a while */ });
    if (r.code !== 0) {
      const s = sshResult(r, `install exited ${r.code}`);
      return { ok: false, err: s.err, state: s.state, action: s.action };
    }
    return { ok: true, err: "" };
  },

  // Engine — set the host-side API key for `engine`. SECURITY (Principle 2): the key is handed to the
  // host over the SSH STDIN pipe (runSecret-style: written once, fd closed), NEVER on argv (visible in
  // `ps`), NEVER in a log line, NEVER an env VALUE. The remote writer reads ONE line from stdin and
  // persists it engine-specifically (ENGINE_AUTH_WRITE) — codex via its own `login --with-api-key`,
  // claude/opencode via a provider-env export appended to the host login shell rc (idempotent). The
  // key is dropped here right after. Returns {ok, err}.
  async setHostEngineAuth(engine, apiKey) {
    const e = String(engine || "");
    const host = String(parseEnv(CLIENT_ENV).REMOTE_HOST || "").trim();
    if (!host) return { ok: false, err: "REMOTE_HOST not set" };
    if (!validHost(host)) {
      return { ok: false, err: invalidHost(host), state: SSH_STATE.INVALID_HOST, action: SSH_ACTION.ABORT };
    }
    if (!apiKey) return { ok: false, err: "no API key" };
    const writer = ENGINE_AUTH_WRITE[e];
    if (!writer) return { ok: false, err: `unknown engine: ${e}` };
    // The remote command reads the key from stdin (`read -r KEY`) — the key never appears on argv.
    // We pipe it over ssh's stdin via runSecretStdin (fd0), not fd3, since ssh forwards fd0 to the
    // remote shell directly.
    const r = await runSecretStdin("ssh", [...sshProbeOpts(host, 15), host, writer], apiKey);
    if (r.code !== 0) {
      const s = sshResult(r, `auth write exited ${r.code}`);
      return { ok: false, err: s.err, state: s.state, action: s.action };
    }
    return { ok: true, err: "" };
  },

  // Method — record the chosen file-access backend (mount | third-party-sync).
  setBackend(syncBackend, mountBackend) {
    if (syncBackend) upsertEnv("SYNC_BACKEND", syncBackend);
    if (mountBackend) upsertEnv("MOUNT_BACKEND", mountBackend);
    return { code: 0 };
  },

  // Mappings — check whether a path exists on the remote host over SSH.
  // Uses `test -e` which returns 0 if the path exists (file, dir, or symlink).
  async hostPathExists(p) {
    if (!p) return { exists: false, err: "no path" };
    const host = String(parseEnv(CLIENT_ENV).REMOTE_HOST || "").trim();
    if (!host) return { exists: false, err: "REMOTE_HOST not set" };
    if (!validHost(host)) {
      return { exists: false, err: invalidHost(host), state: SSH_STATE.INVALID_HOST, action: SSH_ACTION.ABORT };
    }
    const r = await run("ssh", [...sshProbeOpts(host, 5), host, "test -e " + shPathQuotePreserveHome(p)]);
    if (r.code === 0) return { exists: true, err: "", state: SSH_STATE.READY, action: SSH_ACTION.CONTINUE };
    const s = sshResult(r);
    return { exists: false, err: s.err, state: s.state, action: s.action };
  },

  // Mappings — compute the default mountpoint the same way xpair-mount does, so the UI
  // can pre-fill the field before the user clicks Mount.
  //
  // Mirrors xpair-mount default_mountpoint + sanitize_path exactly:
  //   sanitize_path: strip leading '/', replace remaining '/' with '_',
  //                  then replace every char not in [A-Za-z0-9._-] with '_'.
  //   host_slug:     replace every char not in [A-Za-z0-9._-] with '_'.
  //   result:        ~/.xpair/host/mounts/<host_slug>/<path_slug>
  defaultMountpoint(hostPath) {
    const cfg = parseEnv(CLIENT_ENV);
    const remoteHost = cfg.REMOTE_HOST || "";
    const hostSlug = remoteHost.replace(/[^A-Za-z0-9._-]/g, "_");
    const pathSlug = hostPath
      .replace(/^\//, "")          // strip leading /
      .replace(/\//g, "_")         // remaining / → _
      .replace(/[^A-Za-z0-9._-]/g, "_"); // non-safe chars → _
    const mountsRoot = path.join(RP_DIR, "mounts");
    return path.join(mountsRoot, hostSlug, pathSlug);
  },

  // Mappings — actually mount a host folder. `xpair-mount` takes a SUBCOMMAND first, so via the
  // wrapper this is `xpair mount mount <hostPath> [mountpoint]` (1st "mount" = the xpair
  // subcommand that execs xpair-mount; 2nd "mount" = its mount action).
  // mountpoint is optional: when provided it overrides the default computed by xpair-mount.
  // Returns the parsed Mountpoint from CLI output.
  async mount(hostPath, mountpoint) {
    const h = String(hostPath || "").trim();
    if (!h) return { code: -1, out: "", err: "mount requires a host path", mountpoint: "" };
    const mp = String(mountpoint || "").trim();
    const r = await cli(["mount", "mount", h, ...(mp ? [mp] : [])]);
    let parsedMountpoint = "";
    for (const line of (r.out || "").split("\n")) {
      const m = line.match(/^\s*Mountpoint:\s*(\S.*?)\s*$/);
      if (m) {
        parsedMountpoint = m[1];
        break;
      }
    }
    return { code: r.code, out: r.out, err: r.err, mountpoint: parsedMountpoint };
  },

  // Mappings — manual add of a client→host mapping (hard-gate: >=1).
  async addMapping(clientPath, hostPath) {
    return cli(["map", "add", clientPath, hostPath]);
  },

  // --- Discovery / remote-install (component ⑤ — shells to the CLI brain) -----------------------
  //
  // SECURITY (Principle 2): public-key auth is the PRIMARY path — SSH probes and the install
  // preflight are BatchMode, publickey-only; host-key mismatch and key-agent/passphrase failures are
  // returned as explicit recovery states. An account password is accepted by installHost ONLY as a
  // one-shot bootstrap for the first connection to a host that has not yet authorized this client's
  // key, and even then it is handed to the CLI over stdin (never argv/env-value/log/disk). The CLI
  // sets up the bash-managed askpass fd. A key passphrase is never received or returned. Do NOT add a
  // tCapture/telemetry call inside discover/installHost.

  // Discovery — concurrent Bonjour + Tailscale sweep via the CLI. Returns a deduped peer array
  // (deduped by host-key fingerprint inside the CLI; the UI dedups again as a backstop).
  // Each peer: {name, addrs[], source, sources[], fp, status("reconnect"|"connect"|"setup")}.
  async discover() {
    const r = await cli(["discover", "--json"]);
    if (r.code !== 0) return { peers: [], err: r.err };
    let peers = [];
    try {
      const parsed = JSON.parse(r.out || "[]");
      if (Array.isArray(parsed)) peers = parsed;
    } catch (e) {
      return { peers: [], err: "discover: bad JSON: " + String(e && e.message ? e.message : e) };
    }
    return { peers, err: "" };
  },

  // Setup — remote install over SSH. Keys are the PRIMARY path: we preflight the key-only path and,
  // once the host trusts this client's key, every install/connect is key-auth. But the first install
  // on a host that has NOT yet authorized this client's key cannot connect with a key that isn't
  // there yet — so when that preflight reports a REMOTE publickey denial, the webview collects an
  // account `password` and this bridge hands it to install-host over stdin (never argv/env/disk) to
  // bootstrap that one setup connection; install-host then appends the key (ssh-copy-id) so all later
  // ops are key-auth. `force` reinstalls over an already-installed but incompatible host app (host
  // update flow). Returns {ok,out,err,state,action}; `out` carries the redacted progress stream.
  async installHost({ host, user, password, force } = {}) {
    if (!host) return { ok: false, out: "", err: "installHost requires host" };
    let h = String(host || "").trim();
    let account = String(user || "").trim();
    // Accept `user@host` typed into the host field — the documented way to set a remote login that
    // differs from the local user. HOST_RE rejects `@`, so split it here (an explicit `user` wins)
    // before validation; the CLI install-host then authenticates/normalizes as account@host.
    if (h.includes("@")) {
      const at = h.indexOf("@");
      // An explicit account wins, but the `@`-prefix must be stripped from the host either way —
      // otherwise HOST_RE would reject the host even when a separate login was supplied.
      if (!account) account = h.slice(0, at);
      h = h.slice(at + 1);
    }
    if (!validHost(h)) {
      return {
        ok: false,
        out: "",
        err: invalidHost(h),
        state: SSH_STATE.INVALID_HOST,
        action: SSH_ACTION.ABORT,
      };
    }
    if (account && !validAccount(account)) {
      return {
        ok: false,
        out: "",
        err: invalidAccount(account),
        state: SSH_STATE.INVALID_ACCOUNT,
        action: SSH_ACTION.ABORT,
      };
    }
    const pw = String(password || "");
    const target = account ? `${account}@${h}` : h;
    // Reachability/host-identity preflight ONLY. The key-only probe doubles as a reachability check.
    // A REMOTE "Permission denied (publickey...)" means this host has not authorized the client key
    // yet, so the webview must collect the account password for the one-shot bootstrap. LOCAL key
    // failures (agent refused, passphrase required, unreadable key) stay on the existing key recovery
    // path and must not consume the account password.
    let keyBlocked = false;
    const preflight = await run("ssh", [...sshProbeOpts(target, 8), target, "true"]);
    if (preflight.code !== 0) {
      const raw = preflight.err || preflight.out || "";
      const s = sshResult(preflight);
      if (s.state !== SSH_STATE.KEY_AUTH_BLOCKED) {
        return { ok: false, out: "", err: s.err, state: s.state, action: s.action };
      }
      // Take the password-bootstrap path ONLY for a clean remote publickey denial — NOT when ssh
      // also shows a local key/agent failure (then the key is unusable here and the approve/unlock
      // recovery path applies; a password would only authorize a key later probes still can't use).
      if (!isRemotePublickeyDenied(raw) || isLocalKeyFailure(raw)) {
        return { ok: false, out: "", err: s.err, state: s.state, action: s.action };
      }
      keyBlocked = true; // client key not yet authorized → bootstrap this one connection with the password.
    }
    const args = ["install-host", "--host", h];
    if (account) args.push("--account", account);
    // force:true installs/reinstalls the client-bundled XpairHost for a not-ready host app state
    // — the CLI's --force flag overwrites the existing app when present and restarts the
    // host (terminating any running tmux sessions). Used by the onboarding host-repair flow.
    if (force) args.push("--force");
    if (keyBlocked && !pw) {
      return {
        ok: false,
        out: "",
        err: sshFailureMessage(SSH_STATE.NEEDS_PASSWORD),
        state: SSH_STATE.NEEDS_PASSWORD,
        action: SSH_ACTION.PROMPT_PASSWORD,
      };
    }
    // First-time (key not yet authorized) AND a password was supplied → bootstrap the setup
    // connection via install-host --password-stdin. Otherwise the key is already authorized, so run
    // the existing key-auth path and ignore any stale password value.
    let r;
    if (keyBlocked && pw) {
      // An upgraded IDE can sit on an OLD ~/.local/bin/xpair that predates --password-stdin;
      // cliReady() only proves `xpair status` runs, so verify the flag is actually supported before
      // relying on it — an old CLI would just print its usage error and dead-end first-time setup.
      if (!cliSupportsPasswordStdin()) {
        // NOT a needs_password/prompt state — that would loop the user back to the password form.
        // Surface it as a plain failure so the UI shows the "update the CLI" message + a retry.
        return {
          ok: false,
          out: "",
          err: "The installed xpair CLI is too old for first-time password setup. Update it (run `xpair self-update`, or reinstall the client) and try again.",
          state: SSH_STATE.UNREACHABLE,
          action: SSH_ACTION.RETRY,
        };
      }
      r = await cliWithPasswordStdin(args, pw);
    } else {
      r = await cli(args);
    }
    if (r.code === 0) {
      return { ok: true, out: r.out, err: "", state: SSH_STATE.READY, action: SSH_ACTION.CONTINUE };
    }
    if (keyBlocked && (r.code === 7 || isPasswordDenied(`${r.err}\n${r.out}`))) {
      return {
        ok: false,
        out: r.out,
        err: sshFailureMessage(SSH_STATE.PASSWORD_DENIED),
        state: SSH_STATE.PASSWORD_DENIED,
        action: SSH_ACTION.PROMPT_PASSWORD,
      };
    }
    const s = sshResult(r, "install failed");
    return { ok: false, out: r.out, err: s.err, state: s.state, action: s.action };
  },

  // Host TCC grant status — after install, the host app cannot be granted Accessibility / Screen
  // Recording / Full Disk Access remotely (macOS blocks it); the user must toggle them on the host's
  // own screen. This SSH-reads the status.json the host app writes (LOG_DIR/status.json) so the
  // onboarding can show "permissions granted ✓" vs "waiting for you to grant on the host". Returns
  // {alive, ax, sr, fda} (booleans; all false when the file is absent/unreadable) + {err}.
  async hostPermissions({ host } = {}) {
    if (!host) return { alive: false, ax: false, sr: false, fda: false, err: "no host" };
    // `host-permissions` SSH-reads the host app's status.json (key auth, bounded, never prompts) and
    // emits {alive,ax,sr,fda} as JSON.
    const r = await cli(["host-permissions", "--host", String(host)]);
    if (r.code !== 0) {
      const s = sshResult(r, "could not read host status");
      return {
        alive: false,
        ax: false,
        sr: false,
        fda: false,
        err: s.err,
        state: s.state,
        action: s.action,
      };
    }
    try {
      const j = JSON.parse(r.out.trim() || "{}");
      return {
        alive: !!j.alive,
        ax: !!j.ax,
        sr: !!j.sr,
        fda: !!j.fda,
        err: "",
      };
    } catch (e) {
      return { alive: false, ax: false, sr: false, fda: false, err: "host-permissions: bad JSON" };
    }
  },

  // TOFU display — fetch the host-key fingerprint the CLI observes for `host`, so the connect
  // step can show "Matches what <host> shows?" before any key is trusted. Returns {fp, err}.
  async hostKeyFingerprint(host) {
    if (!host) return { fp: "", err: "no host" };
    const r = await cli(["discover", "--fingerprint", String(host)]);
    if (r.code !== 0) return { fp: "", err: r.err };
    try {
      const parsed = JSON.parse(r.out.trim());
      return { fp: parsed.fp || "", err: parsed.err || "" };
    } catch {
      return { fp: "", err: "fingerprint: bad JSON: " + r.out.trim() };
    }
  },

  // Host-app hard guard (Connect / Reconnect step): being able to SSH to the host (reachable) is NOT
  // enough — the host must actually have the Xpair host app installed AND be version-compatible with
  // this client, or pairing produces a connected-but-dead session that silently does nothing. SSHes
  // once (key auth, BatchMode, never prompts) and probes:
  //   installed  — ~/Applications/XpairHost.app exists on the host.
  //   version    — the host app's status.json `version` field (empty when the app hasn't written it).
  //   compatible — same MAJOR as this client's version. Unknown host version (app installed but no
  //                status yet) is treated as compatible (don't hard-block a fresh install that simply
  //                hasn't stamped status.json); a KNOWN mismatching major is incompatible.
  //   incompatibleKind — WHY compatible is false, so the UI doesn't re-parse versions:
  //                "below_floor"   = same major but older than MIN_COMPATIBLE_HOST → use update wording
  //                                  (the client's bundled host is the same major, just newer).
  //                "major_mismatch"= different major (incl. a NEWER host) → use generic repair wording.
  //                ""              = compatible (no incompatibility).
  // Returns {installed, version, compatible, incompatibleKind, err}.
  async hostAppStatus(host) {
    const h = String(host || "").trim();
    if (!h) return { installed: false, version: "", compatible: false, incompatibleKind: "", err: "no host" };
    if (!validHost(h)) {
      return {
        installed: false,
        version: "",
        compatible: false,
        incompatibleKind: "",
        err: invalidHost(h),
        state: SSH_STATE.INVALID_HOST,
        action: SSH_ACTION.ABORT,
      };
    }
    const sshArgs = sshProbeOpts(h, 6);
    // Resolve the host version that will actually serve the RD session, in priority order:
    //   1. RUNNING version — ~/.xpair/host/logs/status.json. The app rewrites it every second, so a FRESH
    //      file means the app is up and its `version` is the live process version. After an on-disk update
    //      that did not restart the daemon (e.g. `brew upgrade --cask` without kickstart), the running
    //      process — which is what actually serves RD — can be older than the on-disk bundle, so it wins.
    //   2. ON-DISK version of the copy the LaunchAgent will launch — ProgramArguments[0] (config.sh
    //      APP_EXEC / Installer.swift Bundle.main.executablePath) → that bundle's CFBundleShortVersionString.
    //      The label comes from host.env BUNDLE_PREFIX (the current label) so a leftover legacy plist
    //      (e.g. com.ghyeong.xpair-host) can't be picked nondeterministically over the active one.
    //   3. Fallback when no host LaunchAgent is registered yet (e.g. a cask install before first launch):
    //      whichever installed bundle exists (/Applications, the cask default, then ~/Applications) — read
    //      ITS version too, so a cask-installed-but-not-launched old host is gated, not waved through.
    const probe =
      'pf="$(. "$HOME/.xpair/host/host.env" 2>/dev/null && printf %s "${BUNDLE_PREFIX:-}")"; [ -n "$pf" ] || pf=com.x10lab.xpair-host; ' +
      'la="$HOME/Library/LaunchAgents/$pf.plist"; [ -f "$la" ] || la=""; ' +
      'ex="$([ -n "$la" ] && /usr/libexec/PlistBuddy -c "Print :ProgramArguments:0" "$la" 2>/dev/null)"; ' +
      'app="${ex%/Contents/MacOS/*}"; ' +
      'if [ -z "$app" ] || [ ! -d "$app" ]; then for d in "/Applications/XpairHost.app" "$HOME/Applications/XpairHost.app"; do [ -d "$d" ] && { app="$d"; break; }; done; fi; ' +
      'if [ -n "$app" ] && [ -d "$app" ]; then echo RP_APP_INSTALLED=1; dv="$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)"; [ -n "$dv" ] && echo "RP_DISK_VERSION=$dv"; else echo RP_APP_INSTALLED=0; fi; ' +
      'st="$HOME/.xpair/host/logs/status.json"; if [ -f "$st" ]; then now="$(date +%s)"; mt="$(stat -f %m "$st" 2>/dev/null || echo 0)"; [ "$((now - mt))" -le 10 ] && { echo RP_RUNNING=1; cat "$st"; }; fi';
    const r = await run("ssh", [...sshArgs, h, probe]);
    if (r.code !== 0) {
      const s = sshResult(r);
      return { installed: false, version: "", compatible: false, incompatibleKind: "", err: s.err, state: s.state, action: s.action };
    }
    const out = r.out || "";
    const installed = /RP_APP_INSTALLED=1/.test(out);
    if (!installed) {
      return { installed: false, version: "", compatible: false, incompatibleKind: "", err: "Host has no Xpair host app" };
    }
    // The RUNNING process version (fresh status.json) wins over the on-disk bundle — it is what actually
    // serves RD; on-disk is used only when the app is not running (so an old running process is never
    // masked by a newer on-disk bundle that hasn't been started yet).
    let diskVersion = "";
    const dm = out.match(/^RP_DISK_VERSION=(.+)$/m);
    if (dm) diskVersion = dm[1].trim();
    let runningVersion = "";
    if (/^RP_RUNNING=1$/m.test(out)) {
      const j0 = out.indexOf("{");
      if (j0 !== -1) {
        try {
          const j = JSON.parse(out.slice(j0));
          if (j && typeof j.version === "string") runningVersion = j.version.trim();
        } catch { /* status.json garbled — ignore and use the on-disk version */ }
      }
    }
    const version = runningVersion || diskVersion;
    const clientV = clientVersion();
    const hostMajor = versionMajor(version);
    const clientMajor = versionMajor(clientV);
    // Compatibility = same MAJOR (necessary) AND host >= MIN_COMPATIBLE_HOST (the protocol floor).
    // The old check was major-only, which let a too-old same-major host (e.g. a43 vs an a45-protocol
    // client) connect and fail subtly. Version comes from the running process or the installed bundle
    // (above), so an installed host normally has a known version; unknown only when neither is readable
    // (corrupt/partial install), which we allow rather than hard-block on a read glitch.
    let compatible;
    let incompatibleKind = "";
    let reason = "";
    if (!hostMajor) {
      compatible = true; // unreadable bundle version → allow (don't hard-block on a read glitch)
    } else if (hostMajor !== clientMajor) {
      // Different major — including a NEWER host. Keep the diagnostic distinct so the UI can use
      // generic repair wording instead of the below-floor update wording.
      compatible = false;
      incompatibleKind = "major_mismatch";
      reason = `Host version ${version} is a different major than client ${clientV}`;
    } else if (compareVersions(clientV, MIN_COMPATIBLE_HOST) >= 0 && compareVersions(version, MIN_COMPATIBLE_HOST) < 0) {
      // The protocol floor only applies when THIS client is itself a release at/above the floor.
      // A locally-built client derives its version from the untracked shared/.build-counter (low or
      // absent on a fresh checkout), so it can sit below the floor; in that dev case a same-major
      // host built from the same tree must NOT be rejected as "too old" — same major is enough.
      // Same major + below floor → the client's bundled host is the same major (just newer), so a
      // forced update is a safe in-place upgrade.
      compatible = false;
      incompatibleKind = "below_floor";
      reason = `Host version ${version} is older than the minimum compatible ${MIN_COMPATIBLE_HOST} — update the host (xpair install-host --force)`;
    } else {
      compatible = true;
    }
    return {
      installed: true,
      version,
      compatible,
      incompatibleKind,
      err: compatible ? "" : reason,
    };
  },

  // Client version (the 0.5.0a{N} lockstep stamp) — exposed so the UI can show "client Y" in an
  // incompatibility message without re-deriving it.
  clientVersion() {
    return clientVersion();
  },

  // --- Telemetry (consent-gated PostHog; all no-ops until the user opts in) -------------------

  // Fire a Phase-1 PostHog event from the webview. The bridge re-validates the event name and
  // re-coerces reason/path to the controlled enums (defense in depth — the webview can NEVER
  // push a raw error string or an unknown path into a payload). Returns {ok:true} regardless
  // (fire-and-forget); consent/key gating + redaction happen inside telemetry.capture.
  tCapture(event, props) {
    const p = { ...(props || {}) };
    if ("reason" in p) p.reason = telemetry.normalizeReason(p.reason);
    if ("path" in p) p.path = telemetry.normalizePath(p.path);
    // host_connected cardinality = ONCE PER INSTALL (Insight A/B count installs, not IDE
    // restarts). The same shared client.env stamp is honored by extension.js probeHost(), so a
    // host_connected fires at most once whether the webview or the extension observes it first.
    if (event === telemetry.EVENTS.HOST_CONNECTED && !telemetry.claimHostConnectedOnce()) {
      return { ok: true }; // already counted this install — drop the duplicate.
    }
    telemetry.capture(event, p);
    return { ok: true };
  },

  // Phase-1 event-name + enum catalog, so the webview references frozen constants (no string typos).
  tCatalog() {
    return {
      EVENTS: telemetry.EVENTS,
      REASONS: telemetry.REASONS,
      PATHS: telemetry.PATHS,
    };
  },

  // Consent flags for the first-run consent UI (both default false / opt-in).
  tGetConsent() {
    return telemetry.getConsent();
  },
  tSetConsent(telemetryOn, crashReportOn) {
    return telemetry.setConsent(!!telemetryOn, !!crashReportOn);
  },

  // Shared by the Remote Desktop tunnel path so every ssh child gets the same
  // GUI-app PATH enrichment, SSH_AUTH_SOCK recovery, and failure taxonomy.
  spawnEnv,
  sshFailureKind,
  sshFailureMessage,
  sshActionForState,
  SSH_STATE,
  SSH_ACTION,
};

module.exports = bridge;
