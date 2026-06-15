// ScreenServer.swift — owns the v2 WebRTC screen-share sidecar (`screen serve-webrtc`).
//
// Screen sharing belongs to the host app, not the client. ScreenCaptureKit (used by
// rp-screencap) requires a GUI/Aqua session with WindowServer access, so the sidecar
// MUST be launched from this GUI menu-bar app — an ssh-launched process has no GUI
// session and would capture nothing. We spawn the bundled `screen` binary from
// Contents/Helpers so serve_webrtc's current_exe() resolver finds its sibling helpers
// (rp-screencap / rp-input-inject) right next to it, and they inherit our GUI session.
//
// Lifecycle: the process is kept alive for as long as the app runs (idle = a listening
// signaling socket, no capture). serve-webrtc itself spawns rp-screencap only while a
// WebRTC peer is connected and kills it on disconnect, so capture is per-connection —
// no capture (and no privacy/power cost) while no client is viewing. On app quit we kill
// the sidecar; a stale one from a crash is reaped on the next ensure().
import Cocoa
import Darwin

final class ScreenServer {
    private(set) var childPid: pid_t = 0
    private var observer: NSObjectProtocol?

    init() {
        // Kill the sidecar when the app terminates (no AppDelegate wiring needed).
        observer = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: nil, queue: nil
        ) { [weak self] _ in self?.stop() }
    }

    /// Absolute path to the bundled sidecar (Contents/Helpers/screen). Launching the
    /// bundle path keeps rp-screencap/rp-input-inject as resolvable siblings.
    private var binPath: String {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/screen").path
    }

    /// Idempotent: (re)spawn the sidecar if it is not genuinely alive. Safe to call from
    /// the same 5 s timer that drives HostManager.ensureServer — doubles as a watchdog.
    func ensureServer() {
        if childPid != 0 && isAlive(childPid) { return }
        spawn()
    }

    func stop() {
        if childPid != 0 { kill(childPid, SIGTERM); childPid = 0 }
        reapStrays()
    }

    // Same zombie-aware liveness check as HostManager: a child we never waitpid lingers as
    // a zombie after it dies; reap it here and judge it dead so the watchdog restarts it.
    private func isAlive(_ pid: pid_t) -> Bool {
        var status: Int32 = 0
        let r = waitpid(pid, &status, WNOHANG)
        if r == pid { return false }
        if r == -1 && errno == ECHILD { return false }
        return kill(pid, 0) == 0
    }

    /// Kill any stray `screen serve-webrtc` from a previous instance (crash / unclean quit).
    private func reapStrays() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        p.arguments = ["-f", "screen serve-webrtc"]
        try? p.run(); p.waitUntilExit()
    }

    private func spawn() {
        let bin = binPath
        guard FileManager.default.isExecutableFile(atPath: bin) else {
            log("SCREEN: sidecar missing/not executable at \(bin) — v2 screen-share unavailable")
            return
        }
        reapStrays()
        usleep(150_000)

        // Log stderr (serve-webrtc logs there) so connection/capture issues are diagnosable.
        try? FileManager.default.createDirectory(atPath: LOG_DIR, withIntermediateDirectories: true)
        let logPath = "\(LOG_DIR)/screen-serve.log"

        let argv = [bin, "serve-webrtc"]
        let env = ["PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                   "HOME=\(HOME)", "LANG=en_US.UTF-8"]
        var cargs = argv.map { strdup($0) }; cargs.append(nil)
        var cenv = env.map { strdup($0) }; cenv.append(nil)
        defer { cargs.forEach { free($0) }; cenv.forEach { free($0) } }

        var fa: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fa)
        posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_addopen(&fa, 1, logPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        posix_spawn_file_actions_addopen(&fa, 2, logPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        defer { posix_spawn_file_actions_destroy(&fa) }

        var pid: pid_t = 0
        let rc = posix_spawn(&pid, bin, &fa, nil, cargs, cenv)
        if rc == 0 { childPid = pid; log("SCREEN: serve-webrtc spawned pid=\(pid) (\(bin))") }
        else { log("SCREEN: posix_spawn failed rc=\(rc)") }
    }
}
