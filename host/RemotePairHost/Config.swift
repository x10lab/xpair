// Config.swift — RemotePairHost 공통 상수/경로 + 로깅. (여러 .swift 가 같이 컴파일됨)
//
// 모든 런타임 상태는 ~/.remote-pair 아래 — ~/.claude 동기화에 의존하지 않는다.
// host 헬퍼(tmux-aqua·router·ocr-find)는 앱 번들 Contents/Helpers 에 동봉; 없으면 외부경로 폴백.

import Cocoa
import Darwin

let HOME = NSHomeDirectory()
let RP_DIR = "\(HOME)/.remote-pair"
let LOG_DIR = "\(RP_DIR)/logs"

let HELPERS = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers").path
func helper(_ name: String, _ fallback: String) -> String {
    let bundled = "\(HELPERS)/\(name)"
    return FileManager.default.fileExists(atPath: bundled) ? bundled : fallback
}

let TMUX = helper("tmux-aqua", "\(HOME)/.local/bin/tmux-aqua")        // daemon→setsid 패치된 tmux
let SOCKET = "/tmp/aqua-tmux.sock"                                    // host tmux 서버 소켓
let ROUTER = helper("remote-pair-approve-router.sh", "\(RP_DIR)/bin/remote-pair-approve-router.sh")
let LOGP = "\(LOG_DIR)/remote-pair.log"
let HEARTBEAT = "\(LOG_DIR)/remote-pair.heartbeat"                    // watchdog 가 읽음
let RULES_FILE = "\(RP_DIR)/rules.txt"                                // approve 라우터 룰
let TRIGGER = "/tmp/remote-pair.approve-request"                     // /approve 스킬이 touch → on-demand 승인

// 표시용 버전 + 업데이트 대상 (Info.plist 단일 출처; build-host.sh 가 채움)
let APP_VERSION = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
let GH_REPO = (Bundle.main.infoDictionary?["RPGitHubRepo"] as? String) ?? "ghyeongl/remote-pair"
let APP_NAME = (Bundle.main.infoDictionary?["CFBundleName"] as? String) ?? "RemotePairHost"
let BUNDLE_ID = Bundle.main.bundleIdentifier ?? "com.x10lab.remote-pair-host"

func ensureDirs() {
    try? FileManager.default.createDirectory(atPath: LOG_DIR, withIntermediateDirectories: true)
}

func log(_ s: String) {
    ensureDirs()
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    if let fh = FileHandle(forWritingAtPath: LOGP) { fh.seekToEndOfFile(); fh.write(line.data(using: .utf8)!); try? fh.close() }
    else { try? line.write(toFile: LOGP, atomically: false, encoding: .utf8) }
}

// 짧은 동기 실행 헬퍼 — stdout 캡처(좌표/세션목록 등). 무거운 작업엔 쓰지 말 것.
@discardableResult
func runCapture(_ launchPath: String, _ args: [String], env: [String: String]? = nil) -> (out: String, status: Int32) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: launchPath)
    p.arguments = args
    if let env = env { p.environment = env }
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return ("", -1) }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (String(data: data, encoding: .utf8) ?? "", p.terminationStatus)
}
