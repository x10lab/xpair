// InputServer.swift — 앱 = 권한 경계. CLI(두뇌, 권한 0)가 요청하는 "원자적 권한 primitive"만 실행한다.
//
//   요청 INPUT_REQ (탭구분):  shot\t<outpath>  |  click\t<x>\t<y>  |  key\t<combo>
//   응답 INPUT_RES         :  ok  |  ok\t<path>  |  err\t<msg>
//
// 라우팅/OCR/비전/타이밍/재시도 = 전부 CLI. 앱은 요청 하나당 primitive 하나만(screencapture=SR, cliclick=AX).
// screencapture·cliclick 는 앱(granted)의 자식으로 실행되어 권한을 상속한다 → 권한 사용은 앱 안에서만.

import Cocoa

final class InputServer {
    private let CLICK = helper("cliclick", "/opt/homebrew/bin/cliclick")
    private let SCAP = "/usr/sbin/screencapture"

    /// 빠른 타이머(~0.1s)가 호출. 요청 파일이 있으면 소비하고 결과를 쓴다.
    func tick() {
        guard FileManager.default.fileExists(atPath: INPUT_REQ),
              let raw = try? String(contentsOfFile: INPUT_REQ, encoding: .utf8) else { return }
        try? FileManager.default.removeItem(atPath: INPUT_REQ)          // consume (1 요청 = 1 응답)
        let p = raw.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\t")
        let res = execute(p)
        try? res.write(toFile: INPUT_RES, atomically: true, encoding: .utf8)
        log("INPUT: \(p.joined(separator: " ")) → \(res.replacingOccurrences(of: "\t", with: " "))")
    }

    private func execute(_ p: [String]) -> String {
        switch p.first {
        case "shot":
            let out = (p.count > 1 && !p[1].isEmpty) ? p[1] : "/tmp/rp-shot.png"
            let r = runCapture(SCAP, ["-x", out])
            return r.status == 0 ? "ok\t\(out)" : "err\tscreencapture rc=\(r.status)"
        case "click":
            guard p.count >= 3, let x = Int(p[1]), let y = Int(p[2]) else { return "err\tbad click args" }
            return runCapture(CLICK, ["c:\(x),\(y)"]).status == 0 ? "ok" : "err\tclick failed"
        case "key":
            guard p.count >= 2, !p[1].isEmpty else { return "err\tbad key args" }
            return sendKey(p[1]) ? "ok" : "err\tkey failed"
        default:
            return "err\tunknown verb: \(p.first ?? "")"
        }
    }

    // 키 전송은 osascript(System Events)로 통일 — cliclick(CGEvent 합성키)은 Chrome 확장 등 웹 UI 팝업에
    // 안 먹히지만(실측) System Events key code/keystroke 는 먹힌다. 라우터(remote-pair-approve-router.sh)와 동일.
    //   "cmd+return" → key code 36 using {command down}  ;  일반키 → keystroke "x"
    private func sendKey(_ combo: String) -> Bool {
        let comps = combo.split(separator: "+").map(String.init)
        guard let key = comps.last else { return false }
        let mods = comps.dropLast()
        let kc: [String: Int] = ["return": 36, "enter": 36, "esc": 53, "escape": 53, "space": 49, "tab": 48]
        var flags: [String] = []
        for m in mods {
            switch m.lowercased() {
            case "cmd", "command":  flags.append("command down")
            case "shift":           flags.append("shift down")
            case "ctrl", "control": flags.append("control down")
            case "alt", "option":   flags.append("option down")
            default: break
            }
        }
        let using = flags.isEmpty ? "" : " using {\(flags.joined(separator: ", "))}"
        let script: String
        if let code = kc[key.lowercased()] {
            script = "tell application \"System Events\" to key code \(code)\(using)"
        } else {
            script = "tell application \"System Events\" to keystroke \"\(key)\"\(using)"
        }
        return runCapture("/usr/bin/osascript", ["-e", script]).status == 0
    }
}
