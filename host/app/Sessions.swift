// Sessions.swift — Session query/control for the tmux-aqua server (menu-bar dynamic list + modal actions).

import Foundation

struct TmuxSession {
    let name: String
    let created: Date?
    let attached: Int       // number of attached clients
    let windows: Int
    let path: String        // cwd of the first window (#{pane_current_path})
}

enum Sessions {
    private static func tmux(_ args: [String]) -> (out: String, status: Int32) {
        return runCapture(TMUX, ["-S", SOCKET] + args,
                          env: ["PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HOME": HOME])
    }

    /// List of user sessions excluding _keeper (internal-keepalive). Sorted by creation time, descending.
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

    /// Whether the server (=_keeper) is alive.
    static func serverUp() -> Bool { tmux(["has-session"]).status == 0 }

    // ── Helpers for the M6 (LEVEL-2 native relaunch) gate ─────────────────────
    // Before the in-app Updater swaps the .app binary and relaunches, it must factually know
    // "is there real work running that must not be interrupted right now?". Since list() already
    // excludes _keeper (the internal-keepalive dummy), its result is exactly the "user sessions".
    // It includes both attached and detached (dropped but still alive) sessions — because even a
    // detached session may still have a claude session running inside it (risk of loss on relaunch).

    /// List of real user sessions excluding _keeper, regardless of attached/detached. (Exposes list()'s meaning under an explicit name.)
    static func listReal() -> [TmuxSession] { list() }

    /// Count for the LEVEL-2 gate decision — sum of attached + detached. 0 means an uninterrupted relaunch is safe.
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
