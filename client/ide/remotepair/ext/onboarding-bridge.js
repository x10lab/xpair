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

const HOME = os.homedir();
const RP_DIR = path.join(HOME, ".remote-pair");
const CLIENT_ENV = path.join(RP_DIR, "client.env");
const SSH_KEY = path.join(HOME, ".ssh", "id_ed25519");

/** Resolve the remote-pair binary (installed to ~/.local/bin, else on PATH). */
function rpBin() {
  const local = path.join(HOME, ".local", "bin", "remote-pair");
  return fs.existsSync(local) ? local : "remote-pair";
}

/** Run argv-safe; resolve {code, out, err} (never rejects). */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = cp.spawn(cmd, args, { windowsHide: true, ...opts });
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
  async sshKeygen() {
    if (!fs.existsSync(SSH_KEY)) {
      await run("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", SSH_KEY, "-q"]);
    }
    let pubkey = "";
    try {
      pubkey = fs.readFileSync(SSH_KEY + ".pub", "utf8").trim();
    } catch {
      /* keygen may have failed */
    }
    return { pubkey };
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

  // Mappings — actually mount a host folder. `remote-pair-mount` takes a SUBCOMMAND first, so via the
  // wrapper this is `remote-pair mount mount <hostPath>` (1st "mount" = the remote-pair subcommand that
  // execs remote-pair-mount; 2nd "mount" = its mount action). Returns the parsed Mountpoint for the map.
  async mount(hostPath) {
    const h = String(hostPath || "").trim();
    if (!h) return { code: -1, out: "", err: "mount requires a host path", mountpoint: "" };
    const r = await cli(["mount", "mount", h]);
    let mountpoint = "";
    for (const line of (r.out || "").split("\n")) {
      const m = line.match(/^\s*Mountpoint:\s*(\S.*?)\s*$/);
      if (m) {
        mountpoint = m[1];
        break;
      }
    }
    return { code: r.code, out: r.out, err: r.err, mountpoint };
  },

  // Mappings — manual add of a client→host mapping (hard-gate: >=1).
  async addMapping(clientPath, hostPath) {
    return cli(["map", "add", clientPath, hostPath]);
  },
};

module.exports = bridge;
