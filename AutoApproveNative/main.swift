// AutoApprove (native) — 단일 정식 네이티브 앱 = approve(승인 다이얼로그 클릭) + tmux computer-use host
//
// applet(osacompile AppleScript) 대체. 네이티브라서:
//  - tmux 서버를 자식으로 붙들 수 있음(posix_spawn, non-blocking) → host의 responsible-process가 이 앱
//    → 그 안 claude가 AX·SR 상속 → computer-use 동작 (daemon/asuser 불필요; dtach 없이 patched-tmux로 충분)
//  - 메뉴바(NSStatusItem) = graphic-session 확보 (AX 합성입력 게이트 통과 조건)
//  - approve는 기존 engine.applescript를 NSAppleScript로 in-process 실행(이 앱 신원으로 AX 클릭)
//
// 권한(1회): System Settings 에서 이 앱에 손쉬운 사용(AX) + 화면 기록(SR) [+ 자동화(System Events)] 허용.

import Cocoa
import Darwin

// ── 설정 ──────────────────────────────────────────────────────────────────
let HOME = NSHomeDirectory()
let TMUX = "\(HOME)/.local/bin/tmux-aqua"            // daemon→setsid 패치된 tmux
let SOCKET = "/tmp/aqua-tmux.sock"                    // host tmux 서버 소켓 (launcher가 attach)
let ENGINE = "\(HOME)/.claude/auto-approve/engine.applescript"  // 기존 approve 로직 재사용
let LOGP = "\(HOME)/.claude/logs/auto-approve-native.log"
let HEARTBEAT = "\(HOME)/.claude/logs/auto-approve.heartbeat"   // watchdog 호환

func log(_ s: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    if let fh = FileHandle(forWritingAtPath: LOGP) { fh.seekToEndOfFile(); fh.write(line.data(using: .utf8)!); try? fh.close() }
    else { try? line.write(toFile: LOGP, atomically: false, encoding: .utf8) }
}

// ── HOST: patched-tmux 서버를 이 앱의 자식으로 띄워 붙든다 ───────────────────
final class HostManager {
    private(set) var childPid: pid_t = 0

    func ensureServer() {
        if childPid != 0 && kill(childPid, 0) == 0 { return }   // 살아있으면 유지
        spawn()
    }

    private func spawn() {
        unlink(SOCKET)
        // script(1)로 pty 확보 → tmux-aqua new-session(attached, _keeper) → 서버가 이 앱 서브트리에 남음.
        // patched tmux(setsid+stdio redirect, no reparent)라 server PPID가 client→app 체인 유지.
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

// ── APPROVE: 기존 engine.applescript tick()을 이 앱 프로세스에서 실행 ─────────
final class ApproveManager {
    func tick() {
        guard let src = try? String(contentsOfFile: ENGINE, encoding: .utf8) else { return }
        // 스크립트 본문 + 최상위에서 tick() 호출 (NSAppleScript는 in-process 실행 → AX가 이 앱 신원)
        let full = src + "\n\ntick()\n"
        guard let script = NSAppleScript(source: full) else { return }
        var err: NSDictionary?
        script.executeAndReturnError(&err)
        if let err = err, let n = err[NSAppleScript.errorNumber] as? Int, n != 0 {
            log("APPROVE: \(err[NSAppleScript.errorMessage] ?? "err") (\(n))")
        }
        // watchdog 호환 heartbeat
        try? "".write(toFile: HEARTBEAT, atomically: false, encoding: .utf8)
    }
}

// ── 앱 ───────────────────────────────────────────────────────────────────
final class AppDelegate: NSObject, NSApplicationDelegate {
    let host = HostManager()
    let approve = ApproveManager()
    var statusItem: NSStatusItem!
    var hostTimer: Timer?
    var approveTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "⌗⌘"
        let menu = NSMenu()
        menu.addItem(withTitle: "AutoApprove — approve + computer-use host", action: nil, keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Restart tmux host", action: #selector(restartHost), keyEquivalent: "")
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        log("launched (native)")

        host.ensureServer()
        // host keepalive
        hostTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.host.ensureServer() }
        // approve loop (기존 1s 주기)
        approveTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.approve.tick() }
    }

    @objc func restartHost() { host.ensureServer() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // 메뉴바 전용 (Dock 아이콘 없음, graphic-session 보유)
app.run()
