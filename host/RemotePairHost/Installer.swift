// Installer.swift — 다운로드된 .app 첫 실행 시 자기설치(self-install).
//
// GitHub Releases 에서 받은 .app 이 shared/install.sh 없이도 동작하는 host 가 되도록,
// 매 실행마다 ensureInstalled() 가 불린다. 이미 설치돼 있으면 즉시 no-op(파일/launchctl 손대지 않음).
// install(force:) 가 shared/install.sh 의 is_host 섹션과 동일한 상태를 만든다(라벨·plist·경로 동일).
//
// SSOT 주의: 라벨/plist 모양/경로는 shared/config.sh + shared/install.sh 와 글자 단위로 일치해야 한다.

import Cocoa

enum Installer {
    // shared/config.sh 와 일치하는 식별자 (이 앱 번들 기준 파생)
    static let RP_ORG = "com.x10lab"
    static let APP_LABEL = BUNDLE_ID                       // = BUNDLE_PREFIX (Info.plist CFBundleIdentifier)
    static let WATCHDOG_LABEL = "\(BUNDLE_ID)-watchdog"
    static let LAUNCH_AGENTS = "\(HOME)/Library/LaunchAgents"
    static let LOCAL_BIN = "\(HOME)/.local/bin"
    static let COMMON_ENV = "\(RP_DIR)/common.env"
    static let HOST_ENV = "\(RP_DIR)/host.env"
    static let WATCHDOG_SH = "\(RP_DIR)/bin/remote-pair-watchdog.sh"
    static let APP_EXEC = Bundle.main.executablePath ?? "/Applications/\(APP_NAME).app/Contents/MacOS/\(APP_NAME)"

    private static var fm: FileManager { FileManager.default }
    private static var appPlist: String { "\(LAUNCH_AGENTS)/\(APP_LABEL).plist" }
    private static var wdPlist: String { "\(LAUNCH_AGENTS)/\(WATCHDOG_LABEL).plist" }

    private static var versionFile: String { "\(RP_DIR)/.version" }

    /// 매 실행마다 호출. "설치됨 + 버전 동일" 이면 진짜 no-op(돌고 있는 tmux 서버를 안 건드림).
    /// 설치됐지만 버전이 올라갔으면 리소스(skills/rules/tmux-aqua)만 갱신한다 — 앱만 새 버전으로
    /// 바뀌고 ~/.remote-pair·~/.claude 리소스가 옛날로 남는 문제(앱 교체/인앱 업데이트 공통)를 막는다.
    /// grant·LaunchAgent·host.env(사용자 설정)는 건드리지 않는다.
    /// 호스트 자기설치를 하면 안 되는 머신/실행인가. (gh-mac-m4 사고: 클라 노트북이 build/ 앱을 한 번
    /// 열어 호스트로 자기설치된 사례 차단.) ① 비설치 위치(repo build/)에서 실행 ② role=client 마커
    /// ③ client.env 만 있고 host.env 없음(호스트 아닌 클라 설치) → 어느 하나라도 참이면 skip.
    static func shouldSkipSelfInstall() -> Bool {
        let p = Bundle.main.bundlePath
        if !(p.hasPrefix("/Applications/") || p.hasPrefix("\(HOME)/Applications/")) {
            log("INSTALL: 비설치 위치 실행(\(p)) — 호스트 자기설치 거부(빌드/개발 실행 가드)")
            return true
        }
        let role = (try? String(contentsOfFile: ROLE_FILE, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if role == "client" {
            log("INSTALL: role=client 마커 — 호스트 자기설치 skip")
            return true
        }
        if role.isEmpty && fm.fileExists(atPath: CLIENT_ENV_FILE) && !fm.fileExists(atPath: HOST_ENV) {
            log("INSTALL: client.env 존재 + host.env 없음 — 클라로 간주, 호스트 자기설치 skip")
            return true
        }
        return false
    }

    static func ensureInstalled() {
        if shouldSkipSelfInstall() { return }
        let installed = fm.fileExists(atPath: appPlist) && fm.fileExists(atPath: HOST_ENV)
        let stamped = (try? String(contentsOfFile: versionFile, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if installed && stamped == APP_VERSION { return }                 // 설치됨 + 최신 → no-op
        if installed {
            log("INSTALL: version \(stamped.isEmpty ? "(none)" : stamped) → \(APP_VERSION) — refreshing resources (grant/config preserved)")
            install(force: false, refreshResources: true)                 // 버전 올라감 → 리소스만 갱신
        } else {
            log("INSTALL: not fully installed (plist=\(fm.fileExists(atPath: appPlist)) host.env=\(fm.fileExists(atPath: HOST_ENV))) → installing")
            install(force: false)
        }
    }

    /// host 설치 단계 — shared/install.sh 의 is_host 섹션을 미러링.
    /// refreshResources=true 면 force 가 아니어도 rules.txt 를 새 번들로 갱신(버전 업 시 리소스 따라오게).
    static func install(force: Bool, refreshResources: Bool = false) {
        // repairInstall 등 직접 호출 경로도 비설치 위치(build/)에서는 거부 — LaunchAgent 가 dev 트리를 가리키지 않게.
        let bp = Bundle.main.bundlePath
        if !(bp.hasPrefix("/Applications/") || bp.hasPrefix("\(HOME)/Applications/")) {
            log("INSTALL: install() 거부 — 비설치 위치 실행(\(bp))")
            return
        }
        log("INSTALL: begin (force=\(force) refreshResources=\(refreshResources))")
        ensureDir(RP_DIR)
        ensureDir(LOG_DIR)
        ensureDir("\(RP_DIR)/bin")
        // role 마커: install.sh 가 안 깔았으면(순수 cask 설치) host 로 기록. 이미 있으면 존중(both/host).
        if !fm.fileExists(atPath: ROLE_FILE) { try? "host\n".write(toFile: ROLE_FILE, atomically: true, encoding: .utf8) }

        // 1. env 파일 (host.env: HOST_KEYS 기본값, common.env: COMMON_KEYS)
        writeEnv(COMMON_ENV, [
            ("LOCAL_BIN", LOCAL_BIN),
            ("AQUA_SOCK", SOCKET),
        ], onlyIfAbsent: false)                            // common 은 항상 동일 → 갱신 무해
        writeEnv(HOST_ENV, [
            ("RP_ORG", RP_ORG),
            ("BUNDLE_PREFIX", BUNDLE_ID),
            ("APP_NAME", APP_NAME),
            ("SIGN_CN", "RemotePair Local Signing"),
            ("GH_REPO", GH_REPO),
            ("APPROVE_TRIGGER", TRIGGER),
            ("LOG_FILE", LOGP),
            ("HEARTBEAT_FILE", HEARTBEAT),
            ("RULES_FILE", RULES_FILE),
        ], onlyIfAbsent: !force)

        // NOTE: rules.txt(approve 설정) + skills(claude 하네스)는 앱이 설치하지 않는다 (결합도 낮게).
        //       그건 CLI/README 단일설치(shared/install.sh)의 몫이다. 앱은 자기 데몬 bring-up 만.

        // 4. tmux-aqua 심볼릭링크 → 번들 Helpers/tmux-aqua (잘못/오래된 링크면 교체)
        let tmuxSrc = "\(Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers").path)/tmux-aqua"
        let tmuxLink = "\(LOCAL_BIN)/tmux-aqua"
        if fm.fileExists(atPath: tmuxSrc) {
            ensureDir(LOCAL_BIN)
            let cur = try? fm.destinationOfSymbolicLink(atPath: tmuxLink)
            if cur != tmuxSrc {
                try? fm.removeItem(atPath: tmuxLink)
                do { try fm.createSymbolicLink(atPath: tmuxLink, withDestinationPath: tmuxSrc); log("INSTALL: tmux-aqua link → \(tmuxSrc)") }
                catch { log("INSTALL: tmux-aqua link 실패: \(error)") }
            }
        } else { log("INSTALL: bundled tmux-aqua 없음 (\(tmuxSrc))") }

        // 5. watchdog 스크립트 + LaunchAgent plist (앱 + watchdog) — install.sh 와 동일 모양
        writeWatchdogScript()
        writeFile(appPlist, appPlistXML())
        writeFile(wdPlist, watchdogPlistXML())
        bootstrap(label: APP_LABEL, plist: appPlist)
        bootstrap(label: WATCHDOG_LABEL, plist: wdPlist)

        try? APP_VERSION.write(toFile: versionFile, atomically: true, encoding: .utf8)   // 버전 스탬프 → 다음 실행 no-op 판단
        log("INSTALL: done (force=\(force) → version \(APP_VERSION))")
    }

    // ── helpers ──

    private static func ensureDir(_ p: String) {
        try? fm.createDirectory(atPath: p, withIntermediateDirectories: true)
    }

    private static func writeFile(_ path: String, _ contents: String, mode: Int? = nil) {
        ensureDir((path as NSString).deletingLastPathComponent)
        try? contents.write(toFile: path, atomically: true, encoding: .utf8)
        if let mode = mode { try? fm.setAttributes([.posixPermissions: mode], ofItemAtPath: path) }
    }

    /// _write_env 미러: 헤더 + `KEY=<shell-quoted value>` (bash printf %q 와 일치).
    private static func writeEnv(_ path: String, _ pairs: [(String, String)], onlyIfAbsent: Bool) {
        if onlyIfAbsent && fm.fileExists(atPath: path) { return }
        let base = (path as NSString).lastPathComponent
        var s = "# RemotePair config (\(base)) — written by RemotePairHost self-install. Safe to edit manually.\n"
        for (k, v) in pairs { s += "\(k)=\(shellQuote(v))\n" }
        writeFile(path, s)
        log("INSTALL: env \(path)")
    }

    /// bash `printf %q` 호환 인용: 안전한 문자만이면 그대로, 아니면 특수문자를 백슬래시로 이스케이프.
    private static func shellQuote(_ s: String) -> String {
        if s.isEmpty { return "''" }
        let safe = CharacterSet(charactersIn:
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./:=@%+,")
        if s.unicodeScalars.allSatisfy({ safe.contains($0) }) { return s }
        var out = ""
        for ch in s {
            if ch == "\\" || ch == "'" || ch == "\"" || ch == " " || ch == "$" || ch == "`" {
                out.append("\\")
            }
            out.append(ch)
        }
        return out
    }

    private static func writeWatchdogScript() {
        // install.sh 의 here-doc 와 동일한 런타임 동작(HB stale 시 kickstart).
        let label = "gui/$(id -u)/\(APP_LABEL)"
        let s = """
        #!/bin/bash
        # remote-pair-watchdog.sh — Restart \(APP_NAME) when heartbeat goes stale. (generated by RemotePairHost self-install)
        set -u
        HB="\(HEARTBEAT)"; LOG="\(LOGP)"
        STALE=90; LABEL="\(label)"; now=$(date +%s)
        if [ -f "$HB" ]; then
          age=$(( now - $(stat -f %m "$HB" 2>/dev/null || echo 0) ))
          [ "$age" -gt "$STALE" ] && { launchctl kickstart -k "$LABEL" >/dev/null 2>&1; printf '%s watchdog: stale %ss\\n' "$(date '+%F %T')" "$age" >> "$LOG"; }
        else launchctl kickstart -k "$LABEL" >/dev/null 2>&1; fi
        """
        writeFile(WATCHDOG_SH, s + "\n", mode: 0o755)
    }

    private static func appPlistXML() -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
          <key>Label</key><string>\(APP_LABEL)</string>
          <key>ProgramArguments</key><array><string>\(APP_EXEC)</string></array>
          <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
          <key>ProcessType</key><string>Interactive</string>
          <key>StandardOutPath</key><string>\(LOG_DIR)/remote-pair.out.log</string>
          <key>StandardErrorPath</key><string>\(LOG_DIR)/remote-pair.err.log</string>
        </dict></plist>

        """
    }

    private static func watchdogPlistXML() -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
          <key>Label</key><string>\(WATCHDOG_LABEL)</string>
          <key>ProgramArguments</key><array><string>/bin/bash</string><string>\(WATCHDOG_SH)</string></array>
          <key>RunAtLoad</key><true/><key>StartInterval</key><integer>30</integer>
          <key>StandardErrorPath</key><string>\(LOG_DIR)/remote-pair-watchdog.err.log</string>
        </dict></plist>

        """
    }

    /// launchctl bootstrap gui/<uid> — best-effort. 이미 로드돼 있으면 무시(이미 실행 중인 인스턴스를 안 죽임).
    private static func bootstrap(label: String, plist: String) {
        let uid = getuid()
        let r = runCapture("/bin/launchctl", ["bootstrap", "gui/\(uid)", plist])
        if r.status != 0 { log("INSTALL: bootstrap \(label) rc=\(r.status) (이미 로드됐을 수 있음 — 무시)") }
        else { log("INSTALL: bootstrap \(label) ok") }
    }
}
