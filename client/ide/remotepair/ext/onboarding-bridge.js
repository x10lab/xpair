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
 *  publickey-only auth, and BatchMode so ssh NEVER drops to a password prompt (which would hang the
 *  GUI with no tty). Used by every read/probe ssh call; the install path (runSecret) is exempt —
 *  it legitimately registers the key with the account password. */
function sshProbeOpts(connectTimeout = 5) {
  const opts = [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${connectTimeout}`,
    "-o", "PreferredAuthentications=publickey",
    "-o", "StrictHostKeyChecking=accept-new",
  ];
  try {
    if (fs.existsSync(SSH_KEY)) opts.push("-o", "IdentitiesOnly=yes", "-i", SSH_KEY);
  } catch { /* key probe failed — let ssh use the agent / defaults */ }
  return opts;
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

/** Like run(), but hands the CLI ONE secret (the account password) over an inherited pipe on fd 3,
 *  NOT via argv / an env VALUE / a temp file — so the secret never appears in `ps`, a log line, or
 *  on disk. The child exports RP_ASKPASS_FD=3; the install ssh's askpass helper reads the single
 *  line from that descriptor (Path 1) instead of popping a separate GUI dialog. The secret is
 *  written once and the pipe closed immediately. Used ONLY by installHost's password path; the
 *  key-auth path uses plain cli() and no pipe is ever created. */
function runSecret(cmd, args, secret) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = cp.spawn(cmd, args, {
        windowsHide: true,
        env: spawnEnv({ RP_ASKPASS_FD: "3" }),
        stdio: ["ignore", "pipe", "pipe", "pipe"], // fd3 = inherited pipe; the child reads the secret
      });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e && e.message ? e.message : e) });
    }
    try {
      const w = child.stdio[3];
      w.on("error", () => {}); // EPIPE if the child never reads (e.g. key auth won) — benign.
      w.write(String(secret) + "\n");
      w.end();
    } catch {
      /* a write race (child already gone) must never crash the main process */
    }
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e.message) }));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

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
    if (!host) return { reachable: false, err: "no host" };
    const r = await run("ssh", [...sshProbeOpts(5), host, "true"]);
    return { reachable: r.code === 0, err: r.err };
  },

  // Connection — persist REMOTE_HOST via the CLI.
  async setHost(host) {
    return cli(["config", "set", "host", host]);
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
    const host = parseEnv(CLIENT_ENV).REMOTE_HOST;
    if (!host) return { exists: false, err: "REMOTE_HOST not set" };
    const r = await run("ssh", [...sshProbeOpts(5), host, "test", "-e", p]);
    return { exists: r.code === 0, err: r.err };
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
  // SECURITY (Principle 2): NONE of these methods ever receives or returns a key passphrase —
  // those are collected ONLY by the separate askpass helper (the renderer never sees them). The
  // ONE secret that transits here is the account password (installHost), and it is handed to the
  // CLI over an inherited pipe (never argv/log/disk). Do NOT add a tCapture/telemetry call inside
  // discover/installHost.

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

  // Setup — remote install over SSH. `password` (optional) is the account password the user typed
  // INTO the onboarding window (no separate dialog). It is handed to the CLI over an inherited pipe
  // via runSecret (fd 3 → ssh askpass), NEVER argv/log/disk, and is dropped here right after. When
  // the host already trusts the client key, omit it — the install authenticates by key. Returns
  // {ok, out, err}; `out` carries the redacted progress stream for StepInstalling.
  async installHost({ host, user, password } = {}) {
    if (!host) return { ok: false, out: "", err: "installHost requires host" };
    const args = ["install-host", "--host", String(host)];
    if (user) args.push("--account", String(user));
    const r = password
      ? await runSecret(rpBin(), args, password)
      : await cli(args);
    return { ok: r.code === 0, out: r.out, err: r.code === 0 ? "" : (r.err || "install failed") };
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
      return { alive: false, ax: false, sr: false, fda: false, err: r.err || "could not read host status" };
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
    const sshArgs = sshProbeOpts(6);
    // One round-trip: print whether the .app dir exists, then the status.json contents.
    const probe =
      '[ -d "$HOME/Applications/XpairHost.app" ] && echo RP_APP_INSTALLED=1 || echo RP_APP_INSTALLED=0; ' +
      'cat "$HOME/.xpair/host/logs/status.json" 2>/dev/null || true';
    const r = await run("ssh", [...sshArgs, h, probe]);
    if (r.code !== 0) {
      return { installed: false, version: "", compatible: false, err: r.err || "could not reach host over SSH" };
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
