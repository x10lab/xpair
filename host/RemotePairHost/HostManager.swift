// HostManager.swift — patched-tmux 서버를 이 앱의 자식으로 띄워 붙든다.
//
// claude 가 computer-use 를 쓰려면 tmux 서버가 granted .app(RemotePairHost) 서브트리에 있어야
// AX·SR 를 상속한다. patched tmux(daemon→setsid, no reparent)라 server PPID 가 app 체인 유지.

import Cocoa
import Darwin

final class HostManager {
    private(set) var childPid: pid_t = 0

    func ensureServer() {
        if childPid != 0 && kill(childPid, 0) == 0 { return }   // 살아있으면 유지
        spawn()
    }

    /// 강제 재시작 — 기존 서버(+그 안 세션)를 reap 하고 새 _keeper 를 띄운다.
    /// 세션을 끊으므로 호출 전 사용자 확인 권장(AppDelegate.restartHost 참고).
    func forceRestart() { childPid = 0; spawn() }   // spawn() 이 reapStrays() 선행

    // 이전 인스턴스의 고아 tmux-aqua 서버(+그 안 세션)를 reap. spawn() 시점에만 호출 = 전부 고아라 안전.
    private func reapStrays() {
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
        // script(1)로 pty 확보 → tmux-aqua new-session(attached, _keeper) → 서버가 앱 서브트리에 남음.
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
