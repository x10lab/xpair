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
