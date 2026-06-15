// Config.swift — RemotePairHost shared constants/paths + logging. (multiple .swift files are compiled together)
//
// All runtime state lives under ~/.remote-pair — it does not depend on ~/.claude syncing.
// host helpers (tmux-aqua, router, ocr-find) are bundled in the app's Contents/Helpers; falls back to an external path if absent.

import Cocoa
import Darwin

let HOME = NSHomeDirectory()
let RP_DIR = "\(HOME)/.remote-pair"
let LOG_DIR = "\(RP_DIR)/logs"
let ROLE_FILE = "\(RP_DIR)/role"            // host|client|both — written by install.sh. Used to block host self-install on a client.
let CLIENT_ENV_FILE = "\(RP_DIR)/client.env" // present = client installed on this machine

/// This machine's role. ROLE_FILE trimmed and used as-is (host|client|both); "" if absent or empty (= default host).
/// Parsing is kept consistent with Installer.shouldSkipSelfInstall(Installer.swift:50-55).
func currentRole() -> String {
    (try? String(contentsOfFile: ROLE_FILE, encoding: .utf8))?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

/// Does this machine act as a host? host / both / empty (unset = default host) → true.  Only client is false.
/// HOST/both use the same grant flow as today; client is ACCESS-ONLY (no AX/SR prompts).
var isHostRole: Bool {
    let role = currentRole()
    return role == "host" || role == "both" || role.isEmpty
}

/// Is this a client (ACCESS-ONLY) machine? true only when role == "client".
var isClientRole: Bool { currentRole() == "client" }

let HELPERS = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers").path
func helper(_ name: String, _ fallback: String) -> String {
    let bundled = "\(HELPERS)/\(name)"
    return FileManager.default.fileExists(atPath: bundled) ? bundled : fallback
}

let TMUX = helper("tmux-aqua", "\(HOME)/.local/bin/tmux-aqua")        // tmux patched with daemon→setsid
let SOCKET = "/tmp/aqua-tmux.sock"                                    // host tmux server socket
let ROUTER = helper("remote-pair-approve-router.sh", "\(RP_DIR)/bin/remote-pair-approve-router.sh")
let LOGP = "\(LOG_DIR)/remote-pair.log"
let HEARTBEAT = "\(LOG_DIR)/remote-pair.heartbeat"                    // read by the watchdog
let STATUS_FILE = "\(LOG_DIR)/status.json"                            // ground truth read by the agent: app alive + AX/SR/FDA grant
let RULES_FILE = "\(RP_DIR)/rules.txt"                                // approve router rules
let TRIGGER = "/tmp/remote-pair.approve-request"                     // (legacy) /approve skill touch → old router fallback
// (legacy v0 InputServer file channel INPUT_REQ/INPUT_RES removed — its 0.1s main-thread polling froze
//  the menu bar. Screen sharing and input are replaced by v1/v2: remote-pair(screen) serve-webrtc + rp-input-inject.)

// Display version + update target (Info.plist is the single source; populated by build-host.sh)
let APP_VERSION = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
let GH_REPO = (Bundle.main.infoDictionary?["RPGitHubRepo"] as? String) ?? "ghyeongl/remote-pair"
let APP_NAME = (Bundle.main.infoDictionary?["CFBundleName"] as? String) ?? "RemotePairHost"
let BUNDLE_ID = Bundle.main.bundleIdentifier ?? "com.x10lab.remote-pair-host"

func ensureDirs() {
    try? FileManager.default.createDirectory(atPath: LOG_DIR, withIntermediateDirectories: true)
}

/// The single ground truth read by the agent (remote-pair status/doctor). Lets it know whether the app
/// is alive and granted as fact, not by guessing (pgrep, etc.). Refreshed every tick (1s) → liveness judged from ts freshness.
func writeStatus() {
    ensureDirs()
    let ts = Int(Date().timeIntervalSince1970)
    let json = "{\"ts\":\(ts),\"pid\":\(getpid()),\"version\":\"\(APP_VERSION)\","
        + "\"bundle_id\":\"\(BUNDLE_ID)\",\"socket\":\"\(SOCKET)\","
        + "\"ax\":\(Permissions.axTrusted()),\"sr\":\(Permissions.srGranted()),\"fda\":\(Permissions.fdaGranted())}\n"
    try? json.write(toFile: STATUS_FILE, atomically: true, encoding: .utf8)
}

let LOG_MAX_BYTES = 5_000_000        // rotate remote-pair.log past 5MB, keep one .1 backup (24/7 host → unbounded growth otherwise)

/// Size-cap rotation: if `path` exceeds `maxBytes`, move it to `path.1` (overwriting the prior backup).
/// Append-only callers tolerate the race; worst case is one lost line at the rotation instant.
func rotateIfNeeded(_ path: String, _ maxBytes: Int) {
    let fm = FileManager.default
    guard let attrs = try? fm.attributesOfItem(atPath: path),
          let size = (attrs[.size] as? NSNumber)?.intValue, size > maxBytes else { return }
    let backup = path + ".1"
    try? fm.removeItem(atPath: backup)
    try? fm.moveItem(atPath: path, toPath: backup)
}

func log(_ s: String) {
    ensureDirs()
    rotateIfNeeded(LOGP, LOG_MAX_BYTES)
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    if let fh = FileHandle(forWritingAtPath: LOGP) { fh.seekToEndOfFile(); fh.write(line.data(using: .utf8)!); try? fh.close() }
    else { try? line.write(toFile: LOGP, atomically: false, encoding: .utf8) }
}

// Short synchronous run helper — captures stdout (coordinates, session lists, etc.). Don't use it for heavy work.
@discardableResult
func runCapture(_ launchPath: String, _ args: [String], env: [String: String]? = nil) -> (out: String, status: Int32) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: launchPath)
    p.arguments = args
    if let env = env { p.environment = env }
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return ("", -1) }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (String(data: data, encoding: .utf8) ?? "", p.terminationStatus)
}
