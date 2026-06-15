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
    ///
    /// ── M6 LEVEL-1 (hot update) 비방해 보장 ──────────────────────────────────────
    /// glue/web(CLI·rules·skills·web·hooks) 변경은 CLI(`remote-pair update`)가 디스크에서
    /// 핫스왑한다 — .app/tmux 무재기동. 앱의 역할은 그걸 **방해하지 않는 것**:
    ///   • 버전 동일 → 진짜 no-op. tmux 서버/LaunchAgent/grant 를 절대 건드리지 않는다(핫스왑 보호).
    ///   • 버전 업 → 리소스만 refresh(tmux-aqua 링크/env 정렬), grant·LaunchAgent·host.env 보존.
    /// 즉 LEVEL-1 핫스왑이 디스크 리소스를 바꿔도 앱이 그걸 되돌리거나 재기동을 유발하지 않는다.
    /// (네이티브 재기동이 필요한 LEVEL-2 는 Updater.swift 의 게이트가 담당.)
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
        if installed && stamped == APP_VERSION { return }                 // LEVEL-1: 버전 동일 → 진짜 no-op (핫스왑/tmux 무간섭)
        if installed {
            log("INSTALL: version \(stamped.isEmpty ? "(none)" : stamped) → \(APP_VERSION) — refreshing resources (grant/config preserved)")
            install(force: false, refreshResources: true)                 // LEVEL-1: 버전업 → 리소스만 갱신(grant/LaunchAgent 보존)
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

        // 3.5 host 알림 훅 미러 — cask-only 호스트(install.sh 안 거친 경우)도 알림 전달이 되도록,
        //     CLI 와 동일하게 remote-pair-notify.sh + manage-claude-hooks.py 를 best-effort 로 설치/등록.
        installNotifyHook()

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

        // 4b. 화면공유 3종 심볼릭링크 → 번들 Helpers/{screen,rp-screencap,rp-input-inject}.
        //     익스텐션/문서가 호출하는 안정 경로 ~/.remote-pair/bin/<name> 를 번들의 서명 바이너리로
        //     해소한다(SSH deploy 폐기 후 유일 배달경로 = 번들). 심볼릭이므로 .app 업데이트 시 항상
        //     새 번들을 가리켜 버전 스큐가 없고, serve_webrtc resolver 의 current_exe().canonicalize()
        //     가 링크를 실제 Helpers 경로로 해소해 형제 헬퍼를 발견한다.
        //     구 SSH deploy 가 남긴 stale 실제파일(ad-hoc 서명)이 있으면 심볼릭으로 교체 — 안정 cert
        //     바이너리로 grant 가 해소되도록(S3c stale 정리). install.sh manifest 가역성과 동일 의미.
        linkBundledBinaries(["screen", "rp-screencap", "rp-input-inject"])

        // 5. watchdog 스크립트 + LaunchAgent plist (앱 + watchdog) — install.sh 와 동일 모양
        writeWatchdogScript()
        writeFile(appPlist, appPlistXML())
        writeFile(wdPlist, watchdogPlistXML())
        bootstrap(label: APP_LABEL, plist: appPlist)
        bootstrap(label: WATCHDOG_LABEL, plist: wdPlist)

        try? APP_VERSION.write(toFile: versionFile, atomically: true, encoding: .utf8)   // 버전 스탬프 → 다음 실행 no-op 판단
        log("INSTALL: done (force=\(force) → version \(APP_VERSION))")
    }

    // ── host 알림 훅 미러 (cask-only 호스트용) ────────────────────────────────────
    //
    // 왜: 알림 전달은 host 의 Claude Code 훅(remote-pair-notify.sh)이 이벤트를 큐에 적는 것에서
    //   시작한다. install.sh(--role host)는 이걸 깔지만, cask 로 .app 만 받은 호스트는 install.sh 를
    //   거치지 않아 훅이 없다 → 클라가 알림을 못 받는다. 그래서 앱 자기설치가 CLI 와 같은 방식으로 미러.
    //
    // 방식(shared/install.sh 의 approve/notify 훅 섹션과 정합):
    //   소스 탐색 순서 ① 앱 번들 Contents/Helpers/hooks ② repo HOST_DIR/hooks (개발/소스 트리)
    //   둘 다 없으면(순수 cask + repo 도달 불가) graceful skip — 로그만 남기고 통과.
    //   설치 위치(install.sh 와 글자 단위 동일 — 가역성 보장): notify.sh → $RP_DIR/bin/remote-pair-notify.sh,
    //             manage-claude-hooks.py → $RP_DIR/bin/ (멱등 JSON 머지기, install.sh 와 동일)
    //   등록: manage-claude-hooks.py add <settings> <approve_cmd> <notify_cmd> — 기존 사용자 훅 보존(멱등).
    //     notify_cmd 는 install.sh 와 동일한 절대경로($RP_DIR/bin/remote-pair-notify.sh)로 등록한다 →
    //     uninstall.sh 의 path-keyed remove(manage-claude-hooks.py remove)가 CLI/앱 어느 쪽이 등록했든
    //     같은 키로 정확히 제거한다(가역성 leak 차단).
    //   python3 없으면 skip(스킬/알림스크립트는 깔되 훅 등록만 보류) — install.sh 와 동일한 보수적 처리.
    //
    // 가역성(cask-only): install.sh 를 안 거친 순수 cask 호스트는 install.sh manifest 가 없다. 그래서
    //   여기서 설치/등록한 것을 $RP_DIR/.install-manifest 에 shared/lib.sh record() 의 TAB 포맷으로
    //   직접 추가한다(FILE notify.sh + FILE manage-claude-hooks.py [+ FILE approve-reminder.sh],
    //   HOOKS <settings> <cmd>). uninstall.sh 가 .install-manifest 를 글롭해 역순 원복하므로 leak 없음.
    //   (install.sh 가 깐 .manifest-host 와는 별도 파일 — 중복/충돌 없음.)
    //
    // best-effort: 실패해도 데몬 bring-up(install() 본체)을 막지 않는다.
    private static func installNotifyHook() {
        // python3 게이트 (manage-claude-hooks.py 는 멱등 JSON 머지에 python3 필요 — macOS 에 jq 없음)
        guard let py = whichPython3() else {
            log("INSTALL: notify 훅 skip — python3 없음 (CLT 설치 후 install.sh --role host 권장)")
            return
        }

        // 소스 탐색: ① 번들 Helpers/hooks ② repo HOST_DIR/hooks
        let bundleHooks = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/hooks").path
        let repoHooks = repoHostHooksDir()
        let candidates = [bundleHooks, repoHooks].compactMap { $0 }
        var notifySrc: String?
        var managerSrc: String?
        var approveSrc: String?
        for base in candidates {
            let n = "\(base)/remote-pair-notify.sh"
            let m = "\(base)/manage-claude-hooks.py"
            if notifySrc == nil, fm.fileExists(atPath: n) { notifySrc = n }
            if managerSrc == nil, fm.fileExists(atPath: m) { managerSrc = m }
            let ar = "\(base)/approve-reminder.sh"
            if approveSrc == nil, fm.fileExists(atPath: ar) { approveSrc = ar }
        }

        guard let notify = notifySrc, let manager = managerSrc else {
            // cask-only + repo 도달 불가 → 알림 훅 소스가 번들에 없음. graceful skip.
            log("INSTALL: notify 훅 skip — 소스 미도달 (notify.sh/manage-claude-hooks.py 없음; cask-only 면 정상)")
            return
        }

        let claudeDir = "\(HOME)/.claude"
        let hooksDst = "\(claudeDir)/hooks"
        // FIX 9: install.sh 와 동일 경로로 통일 — notify.sh 는 $RP_DIR/bin (CLI 와 같은 키로 등록/원복).
        let notifyDst = "\(RP_DIR)/bin/remote-pair-notify.sh"
        let managerDst = "\(RP_DIR)/bin/manage-claude-hooks.py"
        let approveDst = "\(hooksDst)/remote-pair-approve-reminder.sh"   // install.sh 와 동일(approve 전용)
        let settings = "\(claudeDir)/settings.json"

        // cask-only 가역성 기록 대상(install.sh 의 .manifest-host 와 별개 파일). 새로 만든 파일/등록만 기록.
        let manifest = "\(RP_DIR)/.install-manifest"
        var fileRecords: [String] = []     // record FILE <path>
        let settingsExisted = fm.fileExists(atPath: settings)

        // 1) 스크립트 복사 (실행권한 부여) — 모두 $RP_DIR/bin (notify·manager), approve 는 ~/.claude/hooks.
        ensureDir(hooksDst)
        ensureDir("\(RP_DIR)/bin")
        let notifyNew = !fm.fileExists(atPath: notifyDst)
        if !copyFile(notify, to: notifyDst, mode: 0o755) {
            log("INSTALL: notify 훅 skip — notify.sh 복사 실패")
            return
        }
        if notifyNew { fileRecords.append(notifyDst) }
        let managerNew = !fm.fileExists(atPath: managerDst)
        if !copyFile(manager, to: managerDst, mode: 0o755) {
            log("INSTALL: notify 훅 skip — manage-claude-hooks.py 복사 실패")
            return
        }
        if managerNew { fileRecords.append(managerDst) }

        // FIX 11: approve-reminder 소스가 있을 때만 dedicated approve 훅을 깔고 등록한다.
        //   없으면 approve identity 등록을 SKIP 한다(notify 훅만 등록) — notifyDst 로 aliasing 하지 않는다.
        //   (aliasing 하면 approve 이벤트에 notify.sh 가 붙어 전용 approve-skill nudge 를 잃는 degraded 동작.)
        var approveCmdPath: String? = nil
        if let approve = approveSrc {
            let approveNew = !fm.fileExists(atPath: approveDst)
            if copyFile(approve, to: approveDst, mode: 0o755) {
                approveCmdPath = approveDst
                if approveNew { fileRecords.append(approveDst) }
            } else {
                log("INSTALL: approve-reminder 복사 실패 — approve 등록 skip(notify 훅만)")
            }
        } else {
            log("INSTALL: approve-reminder 소스 없음 — approve 등록 skip(notify 훅만, aliasing 안 함)")
        }

        // 2) 멱등 등록: manage-claude-hooks.py add <settings> <approve_cmd> <notify_cmd>
        //    (python add 모드가 approve 계열 + Stop/Notification/SubagentStop 훅을 한 번에 머지. 기존 훅 보존.)
        //    approve 가 없으면 빈 인자로 garbage 엔트리가 생기므로, approve 부재 시엔 notify 경로를 approve
        //    인자로도 넘기되 — python 의 has_ours(substring) 멱등성 덕에 notify 엔트리만 한 번 등록된다(중복 무시).
        //    즉 "approve identity 미등록 + notify 만" 을 달성하고, manifest HOOKS 도 notify 한 줄만 기록한다.
        let approveArg = approveCmdPath ?? notifyDst
        let r = runCapture(py, [managerDst, "add", settings, approveArg, notifyDst])
        if r.status == 0 {
            log("INSTALL: notify 훅 등록 ok (\(settings))")
            // 3) cask-only 가역성 기록 — install.sh manifest 가 없을 때만(글롭 .manifest-* 부재) 의미가 있다.
            //    install.sh 가 이미 깐 호스트면 그쪽 .manifest-host 가 원복을 담당하므로 중복 기록만 피하면 됨:
            //    여기 기록은 .install-manifest(별도 파일)라 install.sh 의 .manifest-host 와 충돌하지 않는다.
            //    재실행(버전업 refresh) 시 add 가 no-op 면 새 HOOKS 가 없으므로 HOOKS 기록은 생략(manifest bloat 방지).
            //    add 가 실제로 머지했을 때만(=출력에 "no-op" 없음) HOOKS/신규 settings 를 기록한다.
            let registeredNew = !r.out.contains("no-op")
            recordManifest(manifest, fileRecords: fileRecords,
                           settings: settings, settingsExisted: settingsExisted,
                           approveCmd: approveCmdPath, notifyCmd: notifyDst,
                           recordHooks: registeredNew)
        } else {
            log("INSTALL: notify 훅 등록 rc=\(r.status) — 수동 확인 필요 (\(settings))")
        }
    }

    /// cask-only 가역성 기록 — shared/lib.sh record() 와 동일한 TAB 3-필드 포맷으로 $RP_DIR/.install-manifest 에 append.
    ///   FILE  <path>            : 새로 만든 파일(notify.sh / manage-claude-hooks.py / approve-reminder.sh)
    ///   HOOKS <settings> <cmd>  : settings.json 에 머지한 우리 훅(경로 키). settings 가 기존 파일일 때만 surgical
    ///                             HOOKS 로 기록하고, 우리가 새로 만들었으면 FILE <settings> 한 줄로 통째 원복.
    /// install.sh 의 approve/notify 훅 섹션(existed 분기)과 동일한 의미. python3/lib.sh 정합.
    private static func recordManifest(_ manifest: String, fileRecords: [String],
                                       settings: String, settingsExisted: Bool,
                                       approveCmd: String?, notifyCmd: String,
                                       recordHooks: Bool) {
        func rec(_ action: String, _ a: String, _ b: String = "") -> String {
            // shared/lib.sh record(): printf '%s\t%s\t%s\n' — 미사용 필드는 빈 문자열.
            return "\(action)\t\(a)\t\(b)\n"
        }
        var lines = ""
        for f in fileRecords { lines += rec("FILE", f) }
        // 훅 머지가 실제로 새 엔트리를 추가했을 때만 HOOKS/신규 settings 를 기록(no-op 재실행은 생략).
        if recordHooks {
            if settingsExisted {
                // 기존 사용자 파일 → 우리 엔트리만 surgical 제거. approve/notify 각각 한 줄(경로별 고유 키).
                if let ac = approveCmd { lines += rec("HOOKS", settings, ac) }
                lines += rec("HOOKS", settings, notifyCmd)
            } else {
                // 우리가 새로 만든 settings.json → 통째 삭제로 원복.
                lines += rec("FILE", settings)
            }
        }
        guard !lines.isEmpty else { return }
        ensureDir((manifest as NSString).deletingLastPathComponent)
        if let h = FileHandle(forWritingAtPath: manifest) {
            h.seekToEndOfFile()
            if let d = lines.data(using: .utf8) { h.write(d) }
            try? h.close()
        } else {
            // 파일 없음 → 새로 생성(append 시작점). 실패해도 best-effort.
            try? lines.write(toFile: manifest, atomically: true, encoding: .utf8)
        }
        log("INSTALL: cask-only manifest 기록 → \(manifest) (\(fileRecords.count) file + hooks)")
    }

    /// repo 소스 트리의 host/hooks 경로를 best-effort 로 추정(개발/소스 설치). 없으면 nil.
    /// 번들은 보통 /Applications 에 있어 repo 와 무관 → 환경변수/관용 경로만 가볍게 확인.
    private static func repoHostHooksDir() -> String? {
        var bases: [String] = []
        if let env = ProcessInfo.processInfo.environment["REPO_ROOT"], !env.isEmpty {
            bases.append("\(env)/host/hooks")
        }
        // bootstrap.sh 가 쓰는 관용 위치 (있으면)
        bases.append("\(HOME)/.local/share/remote-pair/host/hooks")
        for b in bases where fm.fileExists(atPath: "\(b)/remote-pair-notify.sh") { return b }
        return nil
    }

    /// python3 경로 탐색 — 관용 경로 우선, 없으면 /usr/bin/env 로 PATH 위임.
    private static func whichPython3() -> String? {
        for p in ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"] {
            if fm.isExecutableFile(atPath: p) { return p }
        }
        let r = runCapture("/usr/bin/which", ["python3"])
        let path = r.out.trimmingCharacters(in: .whitespacesAndNewlines)
        return (r.status == 0 && !path.isEmpty && fm.isExecutableFile(atPath: path)) ? path : nil
    }

    /// 원자적 복사(덮어쓰기) + 권한. 성공 여부 반환.
    @discardableResult
    private static func copyFile(_ src: String, to dst: String, mode: Int) -> Bool {
        ensureDir((dst as NSString).deletingLastPathComponent)
        guard let data = fm.contents(atPath: src) else { return false }
        let tmp = dst + ".rp-tmp"
        do {
            try data.write(to: URL(fileURLWithPath: tmp), options: .atomic)
            try? fm.removeItem(atPath: dst)
            try fm.moveItem(atPath: tmp, toPath: dst)
            try? fm.setAttributes([.posixPermissions: mode], ofItemAtPath: dst)
            return true
        } catch {
            try? fm.removeItem(atPath: tmp)
            log("INSTALL: copyFile 실패 \(src) → \(dst): \(error)")
            return false
        }
    }

    /// 번들 Contents/Helpers/<name> → ~/.remote-pair/bin/<name> 심볼릭링크(잘못/stale 링크·실제파일이면 교체).
    /// 화면공유 사이드카·헬퍼의 안정 호출경로(~/.remote-pair/bin)를 서명된 번들 바이너리로 해소한다.
    /// 번들에 없는 항목은 조용히 skip(개발/부분 번들). 멱등 — 이미 올바른 링크면 no-op.
    private static func linkBundledBinaries(_ names: [String]) {
        let helpersDir = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers").path
        let binDir = "\(RP_DIR)/bin"
        ensureDir(binDir)
        for name in names {
            let src = "\(helpersDir)/\(name)"
            let link = "\(binDir)/\(name)"
            guard fm.fileExists(atPath: src) else { log("INSTALL: bundled \(name) 없음 (\(src)) — link skip"); continue }
            let cur = try? fm.destinationOfSymbolicLink(atPath: link)
            if cur == src { continue }                       // 이미 올바른 링크 → no-op
            // stale 링크 또는 구 deploy 가 남긴 실제파일(ad-hoc) 제거 후 새 심볼릭으로 교체.
            try? fm.removeItem(atPath: link)
            do { try fm.createSymbolicLink(atPath: link, withDestinationPath: src); log("INSTALL: \(name) link → \(src)") }
            catch { log("INSTALL: \(name) link 실패: \(error)") }
        }
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
