// Updater.swift — GitHub Releases 기반 자가 업데이트. (M6 TWO-LEVEL UPDATE 의 LEVEL-2)
//
// ── M6 두 단계 업데이트 모델 (RN CodePush 참조) ──────────────────────────────
// LEVEL-1 (hot, 무재기동): glue/web (CLI·rules·skills·web bridge/assets·hooks) 변경. 디스크에서
//   `remote-pair update`(CLI/ORCH)가 스왑한다. .app/tmux 는 건드리지 않는다. 앱은 이걸 방해만
//   안 하면 된다 → 그 보장은 Installer.swift(버전 동일=진짜 no-op, 버전업=리소스만 갱신)에 있다.
// LEVEL-2 (native 재기동, GATED): 여기 Updater 가 담당. .app **바이너리** 또는 기반 인터페이스
//   계약(InputServer primitive shot/click/key 포맷, status.json 스키마, tmux-aqua 소켓 경로,
//   LaunchAgent 모양)이 바뀔 때만 발생한다. 재기동은 computer-use 를 끊고 재attach 가 필요할 수
//   있으므로 — 살아있는 세션이 있으면 **명시적 사용자 동의 없이는 절대 재기동하지 않는다**.
//
// 흐름: releases/latest 조회 → tag vs CFBundleShortVersionString(semver) → 최신이면
//   ⓐ 살아있는 tmux-aqua 세션 열거(Sessions.liveSessionCount) → ⓑ 있으면 NSAlert 동의 게이트
//   → asset(zip) 다운 → ditto 압축해제 → codesign --verify --strict + 안정 cert(leaf CN) 확인
//   → /Applications 스왑 → detached 헬퍼가 현 프로세스 종료 대기 후 launchctl kickstart -k 재기동.
//
// ⚠ 자기서명/비공증: 릴리스 자산은 반드시 동일 "RemotePair Local Signing" cert 로 서명돼야
//   TCC grant(designated requirement)가 유지된다. leaf CN 불일치 시 경고(재토글 필요).
//
// ⚠⚠ SPIKE (미해결, 여기서 풀지 않음): .app 재기동 후 **기존 tmux 세션 + 그 안 claude 의
//   Accessibility 상속이 살아남는가**. 이건 측정 필요한 미지수다 — TCC responsible-process
//   귀속이 새 프로세스로 sticky 하게 유지되는지, 새 앱이 orphan 된 tmux 서버를 다시 입양해
//   AX 를 재상속시킬 수 있는지 확인된 바 없다. 본 구현은 "세션이 살아남는다"고 주장하지 않는다.
//   대신 안전·출하 가능한 부분(세션 인지 + 명시적 동의 게이트)만 구현한다. promptAndApply 의
//   SPIKE 주석 참조.

import Cocoa

enum Updater {
    static let signCN = "RemotePair Local Signing"

    struct Release { let tag: String; let assetURL: URL; let notes: String }

    // ── semver 비교: a > b ? ──
    static func isNewer(_ a: String, than b: String) -> Bool {
        func nums(_ s: String) -> [Int] {
            s.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
             .split(separator: "-").first.map(String.init)?      // pre-release suffix 무시
             .split(separator: ".").map { Int($0) ?? 0 } ?? []
        }
        let x = nums(a), y = nums(b)
        for i in 0..<max(x.count, y.count) {
            let xi = i < x.count ? x[i] : 0, yi = i < y.count ? y[i] : 0
            if xi != yi { return xi > yi }
        }
        return false
    }

    // ── 메뉴 진입점 ──
    static func checkForUpdates(interactive: Bool) {
        DispatchQueue.global(qos: .userInitiated).async {
            fetchLatest { result in
                DispatchQueue.main.async {
                    switch result {
                    case .failure(let err):
                        let msg = "\(err)"
                        if interactive { info("업데이트 확인 실패", msg) }
                        log("UPDATE: check failed — \(msg)")
                    case .success(let rel):
                        if isNewer(rel.tag, than: APP_VERSION) {
                            promptAndApply(rel)
                        } else if interactive {
                            info("최신 버전", "\(APP_NAME) \(APP_VERSION) 가 이미 최신입니다 (latest: \(rel.tag)).")
                        }
                        log("UPDATE: current=\(APP_VERSION) latest=\(rel.tag)")
                    }
                }
            }
        }
    }

    // ── GitHub API ──
    private static func fetchLatest(_ done: @escaping (Result<Release, RPError>) -> Void) {
        func fail(_ m: String) { done(.failure(RPError(m))) }
        guard let url = URL(string: "https://api.github.com/repos/\(GH_REPO)/releases/latest") else {
            fail("repo URL 잘못됨: \(GH_REPO)"); return
        }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("RemotePairHost/\(APP_VERSION)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { fail(err.localizedDescription); return }
            guard let http = resp as? HTTPURLResponse else { fail("응답 없음"); return }
            guard http.statusCode == 200, let data = data else {
                fail("HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1) (릴리스 없음 또는 rate limit)"); return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = json["tag_name"] as? String,
                  let assets = json["assets"] as? [[String: Any]] else {
                fail("응답 파싱 실패"); return
            }
            let notes = (json["body"] as? String) ?? ""
            // .zip 자산 우선(이름에 app 포함 우선)
            let zips = assets.compactMap { a -> URL? in
                guard let n = a["name"] as? String, n.hasSuffix(".zip"),
                      let s = a["browser_download_url"] as? String, let u = URL(string: s) else { return nil }
                return u
            }
            guard let asset = zips.first(where: { $0.lastPathComponent.lowercased().contains("remotepairhost") }) ?? zips.first else {
                fail("zip 자산 없음 (\(tag))"); return
            }
            done(.success(Release(tag: tag, assetURL: asset, notes: notes)))
        }.resume()
    }

    // ── LEVEL-2 동의 게이트 → 다운로드 → 검증 → 스왑 → 재기동 ──
    //
    // 핵심: 살아있는 세션이 있으면 "조용한 재기동" 금지. (a) 세션 열거 → (b) 있으면 몇 개가
    // 돌고 있는지·재기동이 computer-use 를 끊고 재attach 가 필요할 수 있음·실행 중 claude 세션은
    // 재attach 전까지 Accessibility 상속을 잃을 수 있음을 명시한 NSAlert 로 명시적 동의를 받는다.
    // (c) 세션이 0 이면 바로 진행(여전히 안전).
    private static func promptAndApply(_ rel: Release) {
        // ── (a) 살아있는 tmux-aqua 세션 열거 (attached + detached, _keeper 제외) ──
        let liveCount = Sessions.liveSessionCount()

        let a = NSAlert()
        a.messageText = "업데이트 가능: \(rel.tag) (앱 재기동 필요)"
        if liveCount > 0 {
            // ── (b) 실제 세션 있음 → 명시적 동의 게이트 ──
            // SPIKE 주의: 아래 경고는 "끊길 수 있다"는 보수적 경고다. 세션이 재기동을 살아남는다는
            // 보장이 없으므로(위 헤더 SPIKE 참조) 절대 "안전하게 이어진다"고 말하지 않는다.
            a.alertStyle = .warning
            a.informativeText =
                "현재 \(APP_VERSION) → \(rel.tag) 는 앱 바이너리/인터페이스 계약 변경이라 "
                + "적용하려면 앱을 재기동해야 합니다.\n\n"
                + "⚠ 지금 실행 중인 tmux-aqua 세션이 \(liveCount)개 있습니다. 재기동하면:\n"
                + "  • computer-use(화면제어)가 끊기고 재attach 가 필요할 수 있습니다.\n"
                + "  • 실행 중인 claude 세션은 재attach 전까지 Accessibility 상속을 잃을 수 있습니다.\n"
                + "  • 대화 transcript 는 보존되어 같은 폴더 재launch 로 이어갈 수 있습니다.\n\n"
                + "지금 업데이트(재기동)하시겠습니까?\n\n"
                + (rel.notes.isEmpty ? "" : String(rel.notes.prefix(300)))
            a.addButton(withTitle: "지금 업데이트(재기동됨)")
            a.addButton(withTitle: "나중에")
            bringToFront()
            // ⓒ 동의(alertFirstButtonReturn) 일 때만 진행. 그 외(나중에/닫기) 면 재기동 안 함.
            guard a.runModal() == .alertFirstButtonReturn else {
                log("UPDATE: LEVEL-2 relaunch declined by user (\(liveCount) live session(s)) — staying on \(APP_VERSION)")
                return
            }
            log("UPDATE: LEVEL-2 relaunch consented (\(liveCount) live session(s)) → \(rel.tag)")
        } else {
            // ── (c) 실제 세션 0 → 무중단으로 안전. 그래도 명시적 확인은 받는다(예기치 않은 재기동 방지). ──
            a.informativeText = "현재 \(APP_VERSION) → \(rel.tag). 실행 중인 세션이 없어 안전합니다. 지금 적용할까요?\n\n"
                + (rel.notes.isEmpty ? "" : String(rel.notes.prefix(400)))
            a.addButton(withTitle: "다운로드 후 적용")
            a.addButton(withTitle: "나중에")
            bringToFront()
            guard a.runModal() == .alertFirstButtonReturn else { return }
            log("UPDATE: LEVEL-2 relaunch (0 live sessions) → \(rel.tag)")
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let newApp = try downloadAndStage(rel.assetURL)
                let warn = try verifySignature(newApp)
                try swapInPlace(newApp)
                DispatchQueue.main.async {
                    let m = NSAlert()
                    m.messageText = "업데이트 적용됨: \(rel.tag)"
                    m.informativeText = (warn ?? "서명 검증 OK — TCC grant 유지됩니다.") + "\n지금 재기동합니다."
                    m.addButton(withTitle: "재기동")
                    bringToFront(); m.runModal()
                    relaunch()
                }
            } catch {
                DispatchQueue.main.async { info("업데이트 실패", "\(error)") }
                log("UPDATE: apply failed — \(error)")
            }
        }
    }

    private static func downloadAndStage(_ url: URL) throws -> String {
        let tmp = NSTemporaryDirectory() + "rp-update-\(getpid())"
        try? FileManager.default.removeItem(atPath: tmp)
        try FileManager.default.createDirectory(atPath: tmp, withIntermediateDirectories: true)
        let zipPath = tmp + "/update.zip"

        // 동기 다운로드 (백그라운드 큐에서 호출됨)
        let sem = DispatchSemaphore(value: 0)
        var dlErr: Error?
        let task = URLSession.shared.downloadTask(with: url) { loc, _, err in
            if let err = err { dlErr = err }
            else if let loc = loc { try? FileManager.default.moveItem(atPath: loc.path, toPath: zipPath) }
            sem.signal()
        }
        task.resume(); sem.wait()
        if let dlErr = dlErr { throw RPError("다운로드 실패: \(dlErr.localizedDescription)") }
        guard FileManager.default.fileExists(atPath: zipPath) else { throw RPError("다운로드 산출물 없음") }

        // ditto -x -k 로 안전 해제
        let un = runCapture("/usr/bin/ditto", ["-x", "-k", zipPath, tmp])
        guard un.status == 0 else { throw RPError("압축 해제 실패") }
        // .app 찾기
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: tmp),
              let appName = entries.first(where: { $0.hasSuffix(".app") }) else {
            throw RPError("zip 안에 .app 없음")
        }
        // FIX 10 방어선: 번들 이름은 다운로드 zip 에서 온 신뢰 불가 값이다. 기대 이름(APP_NAME.app)과
        //   정확히 일치할 때만 진행한다 — 비정상/조작된 이름(셸 메타문자 등)을 하류로 흘리지 않는다.
        guard appName == "\(APP_NAME).app" else {
            throw RPError("예상치 못한 번들 이름: \(appName) (기대: \(APP_NAME).app)")
        }
        return tmp + "/" + appName
    }

    /// 반환: nil = 동일 cert(grant 유지), 문자열 = 경고(cert 불일치 → 재토글 필요)
    ///
    /// ⚠ 보안(FIX 10 command injection): appPath 의 .app 디렉토리 이름은 다운로드된 릴리스 zip 에서
    ///   왔으므로 신뢰 불가다(예: x'$(...).app). 절대 /bin/sh -c "...'\(appPath)'..." 로 보간하지 않는다.
    ///   codesign 은 항상 배열 인자(array-form Process)로 호출하고, Authority 는 stderr 로 나오므로
    ///   stderr 를 stdout 으로 병합 캡처해 Swift 에서 'Authority=' 줄을 파싱한다(셸 미경유 → 인젝션 불가).
    private static func verifySignature(_ appPath: String) throws -> String? {
        let v = runCapture("/usr/bin/codesign", ["--verify", "--strict", appPath])
        guard v.status == 0 else { throw RPError("codesign 검증 실패 — 손상되었거나 미서명") }
        // codesign -dvv 는 모든 진단을 stderr 로 낸다 → stderr 를 stdout 으로 병합해 캡처(배열 인자, 셸 없음).
        let d = runCaptureMergingStderr("/usr/bin/codesign", ["-dvv", appPath])
        let authority = d.out
            .split(separator: "\n")
            .filter { $0.contains("Authority=") }
            .joined(separator: "\n")
        if !authority.contains(signCN) {
            return "⚠ 서명 cert 가 달라 권한이 초기화됩니다. System Settings 에서 손쉬운사용/화면기록 재토글 필요."
        }
        return nil
    }

    /// stdout+stderr 병합 캡처 — codesign -dvv 처럼 진단을 stderr 로 내는 도구용. 배열 인자(셸 미경유).
    /// (전역 runCapture 는 stderr 를 버리므로, Authority 줄을 잡으려면 이 변종이 필요하다.)
    private static func runCaptureMergingStderr(_ launchPath: String, _ args: [String]) -> (out: String, status: Int32) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: launchPath)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe          // stderr → 같은 pipe 로 병합
        do { try p.run() } catch { return ("", -1) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (String(data: data, encoding: .utf8) ?? "", p.terminationStatus)
    }

    private static func swapInPlace(_ newApp: String) throws {
        let dest = "/Applications/\(APP_NAME).app"
        runCapture("/usr/bin/xattr", ["-dr", "com.apple.quarantine", newApp])
        try? FileManager.default.removeItem(atPath: dest)
        try FileManager.default.createDirectory(atPath: "/Applications", withIntermediateDirectories: true)
        try FileManager.default.moveItem(atPath: newApp, toPath: dest)
        log("UPDATE: swapped → \(dest)")
    }

    private static func relaunch() {
        // ⚠⚠ SPIKE — 여기서 NSApp.terminate 후 LaunchAgent 가 새 바이너리로 재기동된다.
        //   미해결 질문(측정 필요, 이 코드가 보장하지 않음):
        //     1) 기존 tmux-aqua 서버(_keeper + 사용자 세션)가 이 재기동을 살아남는가?
        //        — tmux 서버는 별도 detached 프로세스라 프로세스 자체는 살 가능성이 높지만,
        //     2) 새 앱 프로세스가 그 orphan 서버를 다시 "입양"해 InputServer primitive 경로/소켓을
        //        재연결하고, 그 안 claude 의 Accessibility 상속(TCC responsible-process 귀속)을
        //        sticky 하게 유지/재상속시키는지는 확인된 바 없다.
        //   따라서 본 함수는 동의 게이트(promptAndApply)가 통과한 뒤에만 도달한다 — 세션이 끊길 수
        //   있음을 사용자가 이미 인지·동의한 상태. "세션이 살아남는다"는 가정에 의존하지 않는다.
        let uid = getuid()
        // detached 헬퍼: 현 PID 종료 대기 → LaunchAgent kickstart. (KeepAlive 면 자동이지만 명시 보장)
        let script = """
        while kill -0 \(getpid()) 2>/dev/null; do sleep 0.3; done
        /bin/launchctl kickstart -k gui/\(uid)/\(BUNDLE_ID) 2>/dev/null \
          || /usr/bin/open -a '/Applications/\(APP_NAME).app'
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", script]
        try? p.run()   // 부모와 독립 실행
        NSApp.terminate(nil)
    }
}

struct RPError: Error, CustomStringConvertible { let m: String; init(_ m: String) { self.m = m }; var description: String { m } }

func info(_ title: String, _ body: String) {
    let a = NSAlert(); a.messageText = title; a.informativeText = body
    a.addButton(withTitle: "확인"); bringToFront(); a.runModal()
}
