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
const HOST_RE = /^(?!-)[A-Za-z0-9._-]+$/;
const ACCOUNT_RE = /^(?!-)[A-Za-z0-9._-]+$/;

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
const RICH_PATH = `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`;

/** Resolve the running ssh-agent's auth socket. A GUI Electron app launched from Finder/Dock does
 *  NOT inherit SSH_AUTH_SOCK, so ssh can't reach the agent and silently falls back to a password
 *  prompt even when key auth would succeed in a terminal. On macOS the system ssh-agent socket is a
 *  stable launchd path under /tmp/com.apple.launchd.*; recover it so probes use key auth. Returns
 *  the socket path, or "" if none is found (caller simply omits SSH_AUTH_SOCK then). */
function sshAuthSock() {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
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

/** Non-interactive ssh options for reachability/read probes: name the key explicitly, force
 *  publickey-only auth, and BatchMode so ssh NEVER drops to a password/passphrase prompt (which
 *  would hang or spawn an out-of-band GUI prompt). Used by every read/probe ssh call and by the
 *  install preflight: fingerprint-confirmed key auth is the primary path. */
function sshProbeOpts(connectTimeout = 5) {
  const opts = [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${connectTimeout}`,
    "-o", "ConnectionAttempts=1",
    "-o", "PreferredAuthentications=publickey",
    "-o", "PubkeyAuthentication=yes",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "NumberOfPasswordPrompts=0",
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
  UNREACHABLE: "unreachable",
});

const SSH_ACTION = Object.freeze({
  CONTINUE: "continue",
  ABORT: "abort",
  RECOVER_HOST_KEY: "recover_host_key",
  APPROVE_OR_RETRY: "approve_or_retry",
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

function sshFailureMessage(state, err) {
  if (state === SSH_STATE.HOST_KEY_MISMATCH) {
    return "SSH host key mismatch: the host identity changed. Re-confirm the fingerprint, remove the stale known_hosts entry if this is your Mac, then retry.";
  }
  if (state === SSH_STATE.KEY_AUTH_BLOCKED) {
    return "SSH key auth blocked: unlock or approve your SSH agent/key passphrase, make sure this Mac's public key is authorized on the host, then retry.";
  }
  return err || "could not reach host over SSH";
}

function sshActionForState(state) {
  if (state === SSH_STATE.READY) return SSH_ACTION.CONTINUE;
  if (state === SSH_STATE.INVALID_HOST || state === SSH_STATE.INVALID_ACCOUNT) return SSH_ACTION.ABORT;
  if (state === SSH_STATE.HOST_KEY_MISMATCH) return SSH_ACTION.RECOVER_HOST_KEY;
  if (state === SSH_STATE.KEY_AUTH_BLOCKED) return SSH_ACTION.APPROVE_OR_RETRY;
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
 *  secret to a remote `read -r KEY` over ssh WITHOUT it ever touching argv (`ps`), a log line, or
 *  disk. ssh forwards its own stdin to the remote command's stdin, so a single `printf '%s' "$KEY" |`
 *  isn't needed on the client side — we just pipe the line in. Used ONLY by setHostEngineAuth (the
 *  engine API key). The secret is written once and the pipe closed immediately. */
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
const PATH_PREFIX = 'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ';
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

// Per-engine host install command (brew; npm fallback for claude where the cask/formula may lag).
const ENGINE_INSTALL = {
  claude: 'brew install --quiet claude || npm install -g @anthropic-ai/claude-code',
  shell: 'true',
  codex: 'brew install --quiet codex',
  opencode: 'brew install --quiet opencode',
};

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
    'grep -v "# >>> xpair ' + varName + ' >>>" "$RC" | grep -v "export ' + varName + '=" | grep -v "# <<< xpair ' + varName + ' <<<" > "$TMP" || true; ' +
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
    const r = await run("ssh", [...sshProbeOpts(5), h, "true"]);
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
    const r = await run("ssh", [...sshProbeOpts(6), host, probe]);
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

  // Engine — install `engine` on the host over SSH (brew, non-interactive). brew is non-interactive
  // by default (no tty needed); we run it under a login shell so the host's brew is on PATH. Returns
  // {ok, err}. Re-probe with hostEngineStatus afterwards — never trust the exit code alone.
  async installHostEngine(engine) {
    const e = String(engine || "");
    const host = String(parseEnv(CLIENT_ENV).REMOTE_HOST || "").trim();
    if (!host) return { ok: false, err: "REMOTE_HOST not set" };
    if (!validHost(host)) {
      return { ok: false, err: invalidHost(host), state: SSH_STATE.INVALID_HOST, action: SSH_ACTION.ABORT };
    }
    if (!ENGINE_INSTALL[e]) return { ok: false, err: `unknown engine: ${e}` };
    // Login shell so the host's brew (e.g. /opt/homebrew/bin) is on PATH; NONINTERACTIVE=1 keeps brew
    // from prompting. The formula name differs per engine (ENGINE_INSTALL).
    const cmd = `export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; NONINTERACTIVE=1 ${ENGINE_INSTALL[e]}`;
    const r = await run("ssh", [...sshProbeOpts(20), host, cmd], { /* brew can take a while */ });
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
    const r = await runSecretStdin("ssh", [...sshProbeOpts(15), host, writer], apiKey);
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
    const r = await run("ssh", [...sshProbeOpts(5), host, "test", "-e", p]);
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
  // SECURITY (Principle 2): NONE of these methods ever receives or returns an SSH key passphrase or
  // uses a password/PIN as the primary path. SSH probes/install preflight are BatchMode,
  // publickey-only; host-key mismatch and key-agent/passphrase failures are returned as explicit
  // recovery states. Do NOT add a tCapture/telemetry call inside discover/installHost.

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

  // Setup — remote install over SSH. Primary path is automatic public-key auth after the user has
  // confirmed the host fingerprint. We preflight that exact key-only path before calling the CLI so
  // the CLI's legacy askpass path never becomes a password/passphrase prompt. `password` remains in
  // the destructuring only for older preload/renderers; it is intentionally ignored. Returns
  // {ok,out,err,state,action}; `out` carries the redacted progress stream for StepInstalling.
  async installHost({ host, user, password } = {}) {
    if (!host) return { ok: false, out: "", err: "installHost requires host" };
    const h = String(host || "").trim();
    if (!validHost(h)) {
      return {
        ok: false,
        out: "",
        err: invalidHost(h),
        state: SSH_STATE.INVALID_HOST,
        action: SSH_ACTION.ABORT,
      };
    }
    const account = String(user || "").trim();
    if (account && !validAccount(account)) {
      return {
        ok: false,
        out: "",
        err: invalidAccount(account),
        state: SSH_STATE.INVALID_ACCOUNT,
        action: SSH_ACTION.ABORT,
      };
    }
    void password; // compatibility-only: do not route onboarding through account-password auth.
    const target = account ? `${account}@${h}` : h;
    const preflight = await run("ssh", [...sshProbeOpts(8), target, "true"]);
    if (preflight.code !== 0) {
      const s = sshResult(preflight);
      return { ok: false, out: "", err: s.err, state: s.state, action: s.action };
    }
    const args = ["install-host", "--host", h];
    if (account) args.push("--account", account);
    const r = await cli(args);
    if (r.code === 0) {
      return { ok: true, out: r.out, err: "", state: SSH_STATE.READY, action: SSH_ACTION.CONTINUE };
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
  // Returns {installed, version, compatible, err}.
  async hostAppStatus(host) {
    const h = String(host || "").trim();
    if (!h) return { installed: false, version: "", compatible: false, err: "no host" };
    if (!validHost(h)) {
      return {
        installed: false,
        version: "",
        compatible: false,
        err: invalidHost(h),
        state: SSH_STATE.INVALID_HOST,
        action: SSH_ACTION.ABORT,
      };
    }
    const sshArgs = sshProbeOpts(6);
    // One round-trip: print whether the .app dir exists, then the status.json contents.
    const probe =
      // install-host puts the app in /Applications (system) OR ~/Applications; check BOTH so a
      // correctly-installed host app is never false-flagged "missing" (which would wrongly gate onboarding).
      '{ [ -d "$HOME/Applications/XpairHost.app" ] || [ -d "/Applications/XpairHost.app" ]; } && echo RP_APP_INSTALLED=1 || echo RP_APP_INSTALLED=0; ' +
      'cat "$HOME/.xpair/host/logs/status.json" 2>/dev/null || true';
    const r = await run("ssh", [...sshArgs, h, probe]);
    if (r.code !== 0) {
      const s = sshResult(r);
      return { installed: false, version: "", compatible: false, err: s.err, state: s.state, action: s.action };
    }
    const out = r.out || "";
    const installed = /RP_APP_INSTALLED=1/.test(out);
    if (!installed) {
      return { installed: false, version: "", compatible: false, err: "Host has no Xpair host app" };
    }
    let version = "";
    const jsonStart = out.indexOf("{");
    if (jsonStart !== -1) {
      try {
        const j = JSON.parse(out.slice(jsonStart));
        if (j && typeof j.version === "string") version = j.version;
      } catch { /* status.json absent/garbled — version stays unknown */ }
    }
    const clientV = clientVersion();
    const hostMajor = versionMajor(version);
    const clientMajor = versionMajor(clientV);
    // Unknown host version ⇒ don't block (compatible). Known + same major ⇒ compatible.
    const compatible = !hostMajor ? true : hostMajor === clientMajor;
    return {
      installed: true,
      version,
      compatible,
      err: compatible
        ? ""
        : `Host version ${version || "?"} is incompatible with client ${clientV}`,
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
};

module.exports = bridge;
