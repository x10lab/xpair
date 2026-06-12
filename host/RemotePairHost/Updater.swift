// Updater.swift — GitHub Releases 기반 자가 업데이트.
//
// 흐름: releases/latest 조회 → tag vs CFBundleShortVersionString(semver) → 최신이면 asset(zip) 다운
//   → ditto 압축해제 → codesign --verify --strict + 안정 cert(leaf CN) 확인 → /Applications 스왑
//   → detached 헬퍼가 현 프로세스 종료 대기 후 launchctl kickstart -k 로 재기동.
//
// ⚠ 자기서명/비공증: 릴리스 자산은 반드시 동일 "RemotePair Local Signing" cert 로 서명돼야
//   TCC grant(designated requirement)가 유지된다. leaf CN 불일치 시 경고(재토글 필요).

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

    // ── 다운로드 → 검증 → 스왑 → 재기동 ──
    private static func promptAndApply(_ rel: Release) {
        let a = NSAlert()
        a.messageText = "업데이트 가능: \(rel.tag)"
        let activeCount = Sessions.list().count
        let sessWarn = activeCount > 0
            ? "⚠ 활성 세션 \(activeCount)개 — 적용을 위한 재기동 시 모두 끊깁니다. "
              + "(대화 transcript 는 보존되어 같은 폴더 재launch 로 이어갈 수 있음.)\n\n"
            : ""
        a.informativeText = "현재 \(APP_VERSION) → \(rel.tag). 지금 다운로드하고 적용할까요?\n\n"
            + sessWarn
            + (rel.notes.isEmpty ? "" : String(rel.notes.prefix(400)))
        a.addButton(withTitle: "다운로드 후 적용")
        a.addButton(withTitle: "나중에")
        bringToFront()
        guard a.runModal() == .alertFirstButtonReturn else { return }

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
        return tmp + "/" + appName
    }

    /// 반환: nil = 동일 cert(grant 유지), 문자열 = 경고(cert 불일치 → 재토글 필요)
    private static func verifySignature(_ appPath: String) throws -> String? {
        let v = runCapture("/usr/bin/codesign", ["--verify", "--strict", appPath])
        guard v.status == 0 else { throw RPError("codesign 검증 실패 — 손상되었거나 미서명") }
        let d = runCapture("/usr/bin/codesign", ["-dvv", appPath])  // stderr 로 Authority 나옴 → 캡처 안 될 수 있음
        let dd = runCapture("/bin/sh", ["-c", "/usr/bin/codesign -dvv '\(appPath)' 2>&1 | grep -i 'Authority='"])
        let authority = dd.out.isEmpty ? d.out : dd.out
        if !authority.contains(signCN) {
            return "⚠ 서명 cert 가 달라 권한이 초기화됩니다. System Settings 에서 손쉬운사용/화면기록 재토글 필요."
        }
        return nil
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
