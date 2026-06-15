// Sessions.swift — tmux-aqua 서버의 세션 조회/제어 (메뉴바 동적 목록 + 모달 액션).

import Foundation

struct TmuxSession {
    let name: String
    let created: Date?
    let attached: Int       // 붙어있는 client 수
    let windows: Int
    let path: String        // 첫 윈도우 cwd (#{pane_current_path})
}

enum Sessions {
    private static func tmux(_ args: [String]) -> (out: String, status: Int32) {
        return runCapture(TMUX, ["-S", SOCKET] + args,
                          env: ["PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HOME": HOME])
    }

    /// _keeper(내부 유지용)를 제외한 사용자 세션 목록. 생성시각 내림차순.
    static func list() -> [TmuxSession] {
        let fmt = "#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}\t#{pane_current_path}"
        let r = tmux(["list-sessions", "-F", fmt])
        guard r.status == 0 else { return [] }
        var out: [TmuxSession] = []
        for line in r.out.split(separator: "\n") {
            let f = line.components(separatedBy: "\t")
            guard f.count >= 4 else { continue }
            let name = f[0]
            if name == "_keeper" { continue }
            let createdEpoch = Double(f[1]) ?? 0
            out.append(TmuxSession(
                name: name,
                created: createdEpoch > 0 ? Date(timeIntervalSince1970: createdEpoch) : nil,
                attached: Int(f[2]) ?? 0,
                windows: Int(f[3]) ?? 0,
                path: f.count >= 5 ? f[4] : ""))
        }
        return out.sorted { ($0.created ?? .distantPast) > ($1.created ?? .distantPast) }
    }

    /// 서버(=_keeper) 가 살아있는지.
    static func serverUp() -> Bool { tmux(["has-session"]).status == 0 }

    // ── M6 (LEVEL-2 native relaunch) 게이트용 헬퍼 ────────────────────────────
    // 인앱 Updater 가 .app 바이너리를 교체·재기동하기 전에 "지금 끊기면 안 되는 실제 작업이
    // 돌고 있는가"를 사실로 알아야 한다. list() 가 이미 _keeper(내부 유지 더미)를 제외하므로
    // 그 결과가 곧 "사용자 세션"이다. attached(붙어있는) + detached(떨어졌지만 살아있는) 모두
    // 포함한다 — detached 라도 claude 세션이 그 안에서 계속 돌고 있을 수 있기 때문(재기동 시 손실 위험).

    /// _keeper 제외, attached/detached 무관 실제 사용자 세션 목록. (list() 의 의미를 명시적 이름으로 노출)
    static func listReal() -> [TmuxSession] { list() }

    /// LEVEL-2 게이트 판단용 카운트 — attached + detached 합. 0 이면 무중단 재기동 안전.
    static func liveSessionCount() -> Int { listReal().count }

    @discardableResult
    static func detachAll(_ name: String) -> Bool {
        let r = tmux(["detach-client", "-s", "=\(name)"])
        log("MENU: detach-client \(name) status=\(r.status)")
        return r.status == 0
    }

    @discardableResult
    static func kill(_ name: String) -> Bool {
        let r = tmux(["kill-session", "-t", "=\(name)"])
        log("MENU: kill-session \(name) status=\(r.status)")
        return r.status == 0
    }
}
