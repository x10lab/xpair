// onboarding-bridge.js — Node ↔ remote-pair CLI bridge for the IDE-embedded client onboarding.
//
// The client onboarding runs inside the RemotePair IDE (VSCodium) as a webview; this module is the
// extension-side bridge the webview calls to perform REAL setup (Tailscale/SSH connection, file-access
// backend, folder mappings) via the `remote-pair` CLI. Per §0.1 the CLI is the brain — this bridge only
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
const RP_DIR = path.join(HOME, ".remote-pair");
const CLIENT_ENV = path.join(RP_DIR, "client.env");
const SSH_KEY = path.join(HOME, ".ssh", "id_ed25519");

/** Resolve the remote-pair binary (installed to ~/.local/bin, else on PATH). */
function rpBin() {
  const local = path.join(HOME, ".local", "bin", "remote-pair");
  return fs.existsSync(local) ? local : "remote-pair";
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
      const richPath = `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`;
      child = cp.spawn(cmd, args, {
        windowsHide: true,
        env: { ...process.env, PATH: richPath },
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

  // Current client config (real state, not hardcoded).
  getConfig() {
    const e = parseEnv(CLIENT_ENV);
    return {
      remoteHost: e.REMOTE_HOST || "",
      folderMaps: e.FOLDER_MAPS || "",
      syncBackend: e.SYNC_BACKEND || "",
      mountBackend: e.MOUNT_BACKEND || "",
    };
  },

  // Connection — Tailscale-first reachability probe.
  async tailscaleStatus() {
    const which = await run("which", ["tailscale"]);
    if (which.code !== 0) return { installed: false, up: false };
    const st = await run("tailscale", ["status"]);
    return { installed: true, up: st.code === 0 };
  },

  // Connection — full SSH-assist: generate ed25519 if missing, return the pubkey to add to the host.
  // `keygenNew` tells the UI whether a fresh key was created (feeds ssh_config_completed.keygen_new).
  async sshKeygen() {
    let keygenNew = false;
    if (!fs.existsSync(SSH_KEY)) {
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
    const r = await run("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=accept-new",
      host, "true",
    ]);
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
    const r = await run("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=accept-new",
      host, "test", "-e", p,
    ]);
    return { exists: r.code === 0, err: r.err };
  },

  // Mappings — compute the default mountpoint the same way remote-pair-mount does, so the UI
  // can pre-fill the field before the user clicks Mount.
  //
  // Mirrors remote-pair-mount default_mountpoint + sanitize_path exactly:
  //   sanitize_path: strip leading '/', replace remaining '/' with '_',
  //                  then replace every char not in [A-Za-z0-9._-] with '_'.
  //   host_slug:     replace every char not in [A-Za-z0-9._-] with '_'.
  //   result:        ~/.remote-pair/mounts/<host_slug>/<path_slug>
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

  // Mappings — actually mount a host folder. `remote-pair-mount` takes a SUBCOMMAND first, so via the
  // wrapper this is `remote-pair mount mount <hostPath> [mountpoint]` (1st "mount" = the remote-pair
  // subcommand that execs remote-pair-mount; 2nd "mount" = its mount action).
  // mountpoint is optional: when provided it overrides the default computed by remote-pair-mount.
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

  // --- Discovery / pairing (component ⑤ — shells to the CLI brain) -----------------------------
  //
  // SECURITY (Principle 2): NONE of these methods ever receives or returns a password or key
  // passphrase — those are collected ONLY by the separate askpass helper (the renderer never
  // sees them). The 6-digit PIN is the ONE secret that transits here (renderer → CLI argv);
  // it is bound to a 120s TTL on the host, never logged by this bridge, and never passed to any
  // telemetry.capture() call. Do NOT add a tCapture/telemetry call inside discover/pair/installHost.

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

  // Pairing (PIN path) — runs the client side of the PAKE through the CLI. `pin` is the 6-digit
  // code the user read off the host's physical screen; it is NEVER logged or telemetered here.
  // `fp` is the host-key fingerprint shown to the user for TOFU; it is passed as --expect-fp so
  // the CLI fails closed on a mismatched host key. Returns {ok, err}.
  async pair({ host, pin, fp } = {}) {
    if (!host || !pin) return { ok: false, err: "pair requires host and pin" };
    const args = ["pair", "--host", String(host), "--pin", String(pin)];
    if (fp) args.push("--expect-fp", String(fp));
    const r = await cli(args);
    // r.out/r.err deliberately NOT echoed into any telemetry payload (could contain the PIN).
    return { ok: r.code === 0, err: r.code === 0 ? "" : (r.err || "pairing failed") };
  },

  // Setup (password path) — remote install over SSH. The account password is collected ONLY by
  // the askpass helper the CLI spawns (detached TTY); this method passes NO secret. Returns
  // {ok, out, err} where `out` carries the redacted progress stream for StepInstalling.
  async installHost({ host, user } = {}) {
    if (!host) return { ok: false, out: "", err: "installHost requires host" };
    const args = ["install-host", "--host", String(host)];
    if (user) args.push("--account", String(user));
    const r = await cli(args);
    return { ok: r.code === 0, out: r.out, err: r.code === 0 ? "" : (r.err || "install failed") };
  },

  // TOFU display — fetch the host-key fingerprint the CLI observes for `host`, so the pairing
  // step can show "Matches what <host> shows?" before any key is trusted. Returns {fp, err}.
  async hostKeyFingerprint(host) {
    if (!host) return { fp: "", err: "no host" };
    const r = await cli(["discover", "--fingerprint", String(host)]);
    return { fp: r.code === 0 ? r.out.trim() : "", err: r.code === 0 ? "" : r.err };
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
