// HostManager.swift — launches the patched-tmux server as a child of this app and keeps it pinned.
//
// For claude to use computer-use, the tmux server must live in the granted .app (RemotePairHost) subtree
// so it inherits AX/SR. With patched tmux (daemon→setsid, no reparent), the server PPID stays in the app chain.

import Cocoa
import Darwin

final class HostManager {
    private(set) var childPid: pid_t = 0

    func ensureServer() {
        if childPid != 0 && isAlive(childPid) { return }   // keep it if it is genuinely alive
        spawn()
    }

    // Whether childPid is "genuinely" alive. We never waitpid after posix_spawn, so when the child (script)
    // dies it lingers as a zombie (defunct). A zombie returns kill(pid,0)==0 until reaped → if we misjudge it
    // as "alive", the server is never restarted even after tmux-aqua dies (0 sessions). Here we reap the zombie and judge it dead.
    private func isAlive(_ pid: pid_t) -> Bool {
        var status: Int32 = 0
        let r = waitpid(pid, &status, WNOHANG)
        if r == pid { return false }          // a zombie we just reaped = dead
        if r == -1 && errno == ECHILD { return false }  // not our child (already reaped/gone) = dead
        return kill(pid, 0) == 0              // r==0: still running → re-confirm it is truly alive
    }

    /// Force restart — reaps the existing server (+the sessions inside it) and launches a fresh _keeper.
    /// This drops sessions, so user confirmation before calling is recommended (see AppDelegate.restartHost).
    func forceRestart() { childPid = 0; spawn() }   // spawn() runs reapStrays() first

    // Reaps orphaned tmux-aqua servers (+the sessions inside them) from a previous instance. Called only at spawn() = all orphaned, so it is safe.
    private func reapStrays() {
        // Traceability: record which sessions this reap is about to kill ("why did my sessions die on restart?").
        // The session name is the cross-machine correlation id, so log it before pkill removes the evidence.
        let (out, _) = runCapture(TMUX, ["-S", SOCKET, "ls", "-F", "#S"])
        let names = out.split(separator: "\n").map(String.init).filter { !$0.isEmpty && $0 != "_keeper" }
        if !names.isEmpty { log("HOST: reaping \(names.count) session(s): \(names.joined(separator: ", "))") }
        for pat in ["tmux-aqua -S \(SOCKET)", "/usr/bin/script -q /dev/null \(TMUX)"] {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            p.arguments = ["-f", pat]
            try? p.run(); p.waitUntilExit()
        }
        usleep(250_000)
    }

    private func spawn() {
        reapStrays()
        unlink(SOCKET)
        // Acquire a pty via script(1) → tmux-aqua new-session(attached, _keeper) → the server stays in the app subtree.
        let argv: [String] = ["/usr/bin/script", "-q", "/dev/null",
                              TMUX, "-S", SOCKET, "new-session", "-s", "_keeper", "sleep 2147483647"]
        let env: [String] = ["PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                             "TERM=xterm-256color", "HOME=\(HOME)", "LANG=en_US.UTF-8"]
        var cargs = argv.map { strdup($0) }; cargs.append(nil)
        var cenv = env.map { strdup($0) }; cenv.append(nil)
        defer { cargs.forEach { free($0) }; cenv.forEach { free($0) } }

        var fa: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fa)
        posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0)
        posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0)
        defer { posix_spawn_file_actions_destroy(&fa) }

        var pid: pid_t = 0
        let rc = posix_spawn(&pid, "/usr/bin/script", &fa, nil, cargs, cenv)
        if rc == 0 { childPid = pid; log("HOST: tmux server spawned pid=\(pid) sock=\(SOCKET)") }
        else { log("HOST: posix_spawn failed rc=\(rc)") }
    }
}
