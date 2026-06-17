// ScreenServer.swift — owns the v2 WebRTC screen-share sidecar (`screen serve-webrtc`).
//
// Screen sharing belongs to the host app, not the client. ScreenCaptureKit requires a
// GUI/Aqua session with WindowServer access AND a per-binary Screen Recording (TCC) grant,
// so the capture+encode now runs IN THIS APP PROCESS (CaptureEngine) using the app's grant.
// The sidecar (`screen serve-webrtc`, env RP_AU_STDIN=1) does ONLY WebRTC transport: it reads
// already-encoded H.264 access units from its stdin and writes control lines to its stdout.
//
// Wiring (per session):
//   pipe A (app -> child stdin): the AU stream — CaptureEngine sink writes [4B len][AU] here.
//   pipe B (child stdout -> app): control lines — {"capture":"start"} / {"capture":"stop"}.
//   child stderr (fd2): LOG_DIR/screen-serve.log (as before).
// On {"capture":"start"} we start CaptureEngine (in-app SCK+VT capture); on {"capture":"stop"}
// we stop it. Capture is thus per-connection — no capture (privacy/power cost) while idle.
//
// Lifecycle: the sidecar process is kept alive for as long as the app runs (idle = a listening
// signaling socket, no capture). On app quit we kill the sidecar and stop the engine; a stale
// one from a crash is reaped on the next ensure().
import Cocoa
import Darwin

final class ScreenServer {
    private(set) var childPid: pid_t = 0
    private var observer: NSObjectProtocol?

    // In-app capture/encode (uses the APP's Screen Recording TCC grant, not a helper binary's).
    private let captureEngine = CaptureEngine()
    // Pipe A write end (app -> child stdin: the AU stream). -1 when not spawned.
    private var auWriteFD: Int32 = -1
    // Pipe B read end (child stdout -> app: control lines). -1 when not spawned.
    private var ctlReadFD: Int32 = -1
    // Serialize writes to pipe A: SCK's sample callback runs on its own queue.
    private let auWriteQueue = DispatchQueue(label: "rp.screenserver.au-write")

    init() {
        // Kill the sidecar when the app terminates (no AppDelegate wiring needed).
        observer = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: nil, queue: nil
        ) { [weak self] _ in self?.stop() }
    }

    /// Absolute path to the bundled sidecar (Contents/Helpers/screen). Launching the
    /// bundle path keeps rp-screencap as a resolvable sibling.
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
        captureEngine.stop()
        closePipes()
        if childPid != 0 { kill(childPid, SIGTERM); childPid = 0 }
        reapStrays()
    }

    private func closePipes() {
        auWriteQueue.sync {
            if auWriteFD >= 0 { close(auWriteFD); auWriteFD = -1 }
        }
        if ctlReadFD >= 0 { close(ctlReadFD); ctlReadFD = -1 }
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
        // Writing AUs into pipe A can hit EPIPE if the child died; ignore SIGPIPE so that
        // surfaces as a -1/EPIPE return in writeAU (handled) instead of killing the app.
        signal(SIGPIPE, SIG_IGN)
        // A fresh spawn: tear down any leftover engine/pipes from a previous (dead) child.
        captureEngine.stop()
        closePipes()
        reapStrays()
        usleep(150_000)

        // Log stderr (serve-webrtc logs there) so connection/capture issues are diagnosable.
        try? FileManager.default.createDirectory(atPath: LOG_DIR, withIntermediateDirectories: true)
        let logPath = "\(LOG_DIR)/screen-serve.log"

        // pipe A: app -> child stdin (AU stream). pipe B: child stdout -> app (control lines).
        var pipeA: [Int32] = [-1, -1] // [read(child fd0), write(app)]
        var pipeB: [Int32] = [-1, -1] // [read(app), write(child fd1)]
        guard pipe(&pipeA) == 0 else { log(.error, "SCREEN: pipe(A) failed errno=\(errno)"); return }
        guard pipe(&pipeB) == 0 else {
            close(pipeA[0]); close(pipeA[1])
            log(.error, "SCREEN: pipe(B) failed errno=\(errno)"); return
        }
        let aRead = pipeA[0], aWrite = pipeA[1]
        let bRead = pipeB[0], bWrite = pipeB[1]

        let argv = [bin, "serve-webrtc"]
        let env = ["PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                   "HOME=\(HOME)", "LANG=en_US.UTF-8", "RP_AU_STDIN=1"]
        var cargs = argv.map { strdup($0) }; cargs.append(nil)
        var cenv = env.map { strdup($0) }; cenv.append(nil)
        defer { cargs.forEach { free($0) }; cenv.forEach { free($0) } }

        var fa: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fa)
        // fd0 = read end of pipe A (AU stream from app), fd1 = write end of pipe B (control to app),
        // fd2 = log file (as before).
        posix_spawn_file_actions_adddup2(&fa, aRead, 0)
        posix_spawn_file_actions_adddup2(&fa, bWrite, 1)
        posix_spawn_file_actions_addopen(&fa, 2, logPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        defer { posix_spawn_file_actions_destroy(&fa) }

        var pid: pid_t = 0
        let rc = posix_spawn(&pid, bin, &fa, nil, cargs, cenv)
        // Close the child-side ends in the parent regardless of outcome.
        close(aRead); close(bWrite)
        guard rc == 0 else {
            close(aWrite); close(bRead)
            log(.error, "SCREEN: posix_spawn failed rc=\(rc)")
            return
        }
        childPid = pid
        auWriteFD = aWrite
        ctlReadFD = bRead
        log("SCREEN: serve-webrtc spawned pid=\(pid) RP_AU_STDIN=1 (\(bin))")
        startControlReader(fd: bRead)
    }

    /// Background reader for pipe B (child stdout): newline-delimited control lines.
    /// {"capture":"start"} -> start in-app CaptureEngine (sink writes AUs to pipe A);
    /// {"capture":"stop"}  -> stop it. Exits on EOF (child gone).
    private func startControlReader(fd: Int32) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var buf = Data()
            var chunk = [UInt8](repeating: 0, count: 4096)
            while true {
                let n = read(fd, &chunk, chunk.count)
                if n <= 0 { break } // EOF or error: child gone
                buf.append(contentsOf: chunk[0..<n])
                // Process each complete newline-delimited line.
                while let nl = buf.firstIndex(of: 0x0A) {
                    let lineData = buf.subdata(in: buf.startIndex..<nl)
                    buf.removeSubrange(buf.startIndex...nl)
                    guard let self = self,
                          let line = String(data: lineData, encoding: .utf8) else { continue }
                    self.handleControlLine(line.trimmingCharacters(in: .whitespaces))
                }
            }
        }
    }

    private func handleControlLine(_ line: String) {
        if line.isEmpty { return }
        if line.contains("\"capture\":\"start\"") || line.contains("\"capture\": \"start\"") {
            log("SCREEN: control start -> begin in-app capture")
            captureEngine.start { [weak self] data in
                self?.writeAU(data)
            }
        } else if line.contains("\"capture\":\"stop\"") || line.contains("\"capture\": \"stop\"") {
            log("SCREEN: control stop -> stop in-app capture")
            captureEngine.stop()
        } else {
            log(.warn, "SCREEN: unknown control line: \(line)")
        }
    }

    /// Write one framed AU ([4B len][AU]) to pipe A, serialized. On EPIPE/short write
    /// (child died) stop the engine so we don't spin writing into a dead pipe.
    private func writeAU(_ data: Data) {
        auWriteQueue.async { [weak self] in
            guard let self = self, self.auWriteFD >= 0 else { return }
            let fd = self.auWriteFD
            var ok = true
            data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                guard let base = raw.baseAddress else { return }
                var off = 0
                let total = raw.count
                while off < total {
                    let w = write(fd, base + off, total - off)
                    if w > 0 { off += w; continue }
                    if w == -1 && errno == EINTR { continue }
                    ok = false // EPIPE or other error: child gone
                    break
                }
            }
            if !ok {
                log(.warn, "SCREEN: AU pipe write failed (child gone?) — stopping capture")
                self.captureEngine.stop()
                if self.auWriteFD >= 0 { close(self.auWriteFD); self.auWriteFD = -1 }
            }
        }
    }
}
