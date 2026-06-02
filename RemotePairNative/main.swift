// RemotePair (native) — 단일 정식 네이티브 앱 = approve(승인 다이얼로그 클릭) + tmux computer-use host
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
let ENGINE = "\(HOME)/.claude/auto-approve/engine.applescript"  // approve 엔진 config (rules.txt와 함께 git-sync, 경로 유지)
let LOGP = "\(HOME)/.claude/logs/remote-pair.log"
let HEARTBEAT = "\(HOME)/.claude/logs/remote-pair.heartbeat"    // watchdog가 읽음 (remote-pair-watchdog.sh)
let TRIGGER = "/tmp/remote-pair.approve-request"               // claude(/approve 스킬)가 touch → on-demand 클릭 요청
let APPROVE_WINDOW: TimeInterval = 10                          // 요청 1회당 active 스캔 창(초) — 다이얼로그 늦게 떠도 잡게

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

// ── APPROVE: engine.applescript tick()을 이 앱(granted 신원)에서 실행 — on-demand 만 호출됨 ──
// claude 가 osascript 로 직접 클릭하면 Automation→System Events 신원이 claude/osascript 라 막힘.
// 그래서 클릭은 항상 RemotePair(AX+Automation granted)가 한다. claude 는 /approve 스킬로 "요청"만.
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
    }
}

// ── 앱 ───────────────────────────────────────────────────────────────────
final class AppDelegate: NSObject, NSApplicationDelegate {
    let host = HostManager()
    let approve = ApproveManager()
    var statusItem: NSStatusItem!
    var hostTimer: Timer?
    var tickTimer: Timer?
    var approveActiveUntil = Date.distantPast   // on-demand: 요청 받으면 now+WINDOW 까지만 스캔

    func applicationDidFinishLaunching(_ note: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "⌗⌘"
        let menu = NSMenu()
        menu.addItem(withTitle: "RemotePair — approve(on-demand) + computer-use host", action: nil, keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Approve now (\(Int(APPROVE_WINDOW))s)", action: #selector(approveNow), keyEquivalent: "")
        menu.addItem(withTitle: "Restart tmux host", action: #selector(restartHost), keyEquivalent: "")
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        log("launched (native, approve=on-demand)")

        host.ensureServer()
        hostTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.host.ensureServer() }
        // 항상 도는 가벼운 루프: heartbeat(매초) + 트리거 파일 stat. 무거운 AX 스캔은 요청받은 window 동안만.
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.poll() }
    }

    // 평소: heartbeat + 트리거 확인(둘 다 가벼움 → -1712 없음). 요청 받은 동안에만 approve.tick()(AX 스캔).
    @objc func poll() {
        try? "".write(toFile: HEARTBEAT, atomically: false, encoding: .utf8)           // watchdog용, 항상
        if FileManager.default.fileExists(atPath: TRIGGER) {                            // claude /approve 가 touch
            try? FileManager.default.removeItem(atPath: TRIGGER)
            approveActiveUntil = Date().addingTimeInterval(APPROVE_WINDOW)
            log("APPROVE: requested → active \(Int(APPROVE_WINDOW))s")
        }
        if Date() < approveActiveUntil { approve.tick() }                              // active 창에서만 클릭 시도
    }

    @objc func approveNow() { approveActiveUntil = Date().addingTimeInterval(APPROVE_WINDOW); log("APPROVE: menu → active") }
    @objc func restartHost() { host.ensureServer() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // 메뉴바 전용 (Dock 아이콘 없음, graphic-session 보유)
app.run()
