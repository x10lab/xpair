// Updater.swift — GitHub Releases-based self-update. (LEVEL-2 of M6 TWO-LEVEL UPDATE)
//
// ── M6 two-level update model (cf. RN CodePush) ──────────────────────────────
// LEVEL-1 (hot, no restart): changes to glue/web (CLI·rules·skills·web bridge/assets·hooks). Swapped
//   on disk by `xpair update` (CLI/ORCH). It does not touch .app/tmux. The app just needs to
//   not get in the way → that guarantee lives in Installer.swift (same version = true no-op, version bump = refresh resources only).
// LEVEL-2 (native restart, GATED): handled here in the Updater. Triggered only when the .app **binary**
//   or the underlying interface contract (InputServer primitive shot/click/key format, status.json schema, tmux-aqua socket path,
//   LaunchAgent layout) changes. Since a restart may break computer-use and require re-attach,
//   if there are live sessions we **never restart without the user's explicit consent**.
//
// Flow: query releases/latest → tag vs CFBundleShortVersionString(semver) → if newer:
//   ⓐ enumerate live tmux-aqua sessions (Sessions.liveSessionCount) → ⓑ if any, NSAlert consent gate
//   → download asset(zip) → ditto extract → codesign --verify --strict + verify stable cert (leaf CN)
//   → swap into /Applications → detached helper waits for current process to exit, then launchctl kickstart -k to restart.
//
// ⚠ Self-signed/non-notarized: the release asset MUST be signed with the same "RemotePair Local Signing" cert
//   for the TCC grant (designated requirement) to persist. On leaf CN mismatch, warn (re-toggle required).
//
// ⚠⚠ SPIKE (unresolved, not solved here): after an .app restart, **whether the existing tmux session +
//   the Accessibility inheritance of the claude inside it survives**. This is an unknown that needs measuring —
//   it is unverified whether TCC responsible-process attribution stays sticky to the new process, or whether
//   the new app can re-adopt the orphaned tmux server and re-inherit AX. This implementation does not claim "the session survives".
//   Instead it implements only the safe, shippable part (session awareness + explicit consent gate). See the
//   SPIKE comment in promptAndApply.

import Cocoa

enum Updater {
    static let signCN = "RemotePair Local Signing"

    struct Release { let tag: String; let assetURL: URL; let notes: String }

    // ── semver compare: a > b ? ──
    // Supports optional alpha suffix on the patch component: e.g. "0.5.0a13".
    // Ordering convention: (major, minor, patch, alpha) where a missing alpha
    // suffix is treated as Int.max (i.e. a plain "0.5.0" final release is
    // considered GREATER than any "0.5.0aN" alpha — matching the expectation
    // that the final release supersedes all its alphas). During an alpha train
    // "0.5.0a13" > "0.5.0a12" because 13 > 12.
    static func isNewer(_ a: String, than b: String) -> Bool {
        // Parse "major.minor.patchaNNN" → (major, minor, patch, alpha)
        // alpha == Int.max means no suffix (final release).
        func parse(_ s: String) -> (Int, Int, Int, Int) {
            let core = s.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
                        .split(separator: "-").first.map(String.init) ?? s
            let parts = core.split(separator: ".").map(String.init)
            let major = parts.count > 0 ? (Int(parts[0]) ?? 0) : 0
            let minor = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
            // patch component may carry an alpha suffix: "0a12"
            let patchStr = parts.count > 2 ? parts[2] : "0"
            let alpha: Int
            let patch: Int
            if let aRange = patchStr.range(of: "a", options: .caseInsensitive),
               let patchNum = Int(patchStr[patchStr.startIndex..<aRange.lowerBound]),
               let alphaNum = Int(patchStr[aRange.upperBound...]) {
                patch = patchNum
                alpha = alphaNum
            } else {
                patch = Int(patchStr) ?? 0
                alpha = Int.max   // no suffix → final release, beats any alpha
            }
            return (major, minor, patch, alpha)
        }
        let x = parse(a), y = parse(b)
        if x.0 != y.0 { return x.0 > y.0 }
        if x.1 != y.1 { return x.1 > y.1 }
        if x.2 != y.2 { return x.2 > y.2 }
        if x.3 != y.3 { return x.3 > y.3 }
        return false
    }

    // ── menu entry point ──
    static func checkForUpdates(interactive: Bool) {
        DispatchQueue.global(qos: .userInitiated).async {
            fetchLatest { result in
                DispatchQueue.main.async {
                    switch result {
                    case .failure(let err):
                        let msg = "\(err)"
                        if interactive { info("Update check failed", msg) }
                        log(.warn, "check failed — \(msg)")
                    case .success(let rel):
                        if isNewer(rel.tag, than: APP_VERSION) {
                            promptAndApply(rel)
                        } else if interactive {
                            info("Latest version", "\(APP_NAME) \(APP_VERSION) is already up to date (latest: \(rel.tag)).")
                        }
                        log(.info, "current=\(APP_VERSION) latest=\(rel.tag)")
                    }
                }
            }
        }
    }

    // ── update channel ──
    // "stable" (default) tracks GitHub's /releases/latest, which EXCLUDES pre-releases — so alpha
    // (0.5.0aN, published as pre-release) never reaches stable hosts. "alpha" scans the full
    // /releases list and takes the newest tag INCLUDING pre-releases. Opt a host in with:
    //   defaults write \(BUNDLE_ID) RPUpdateChannel alpha     (or env RP_UPDATE_CHANNEL=alpha)
    static var channel: String {
        if let env = ProcessInfo.processInfo.environment["RP_UPDATE_CHANNEL"], !env.isEmpty {
            return env.lowercased()
        }
        return (UserDefaults.standard.string(forKey: "RPUpdateChannel") ?? "stable").lowercased()
    }

    /// Build a Release from a GitHub release JSON object, or nil if it has no usable .zip asset.
    private static func release(from json: [String: Any]) -> Release? {
        guard let tag = json["tag_name"] as? String,
              let assets = json["assets"] as? [[String: Any]] else { return nil }
        let notes = (json["body"] as? String) ?? ""
        let zips = assets.compactMap { a -> URL? in
            guard let n = a["name"] as? String, n.hasSuffix(".zip"),
                  let s = a["browser_download_url"] as? String, let u = URL(string: s) else { return nil }
            return u
        }
        guard let asset = zips.first(where: { $0.lastPathComponent.lowercased().contains("xpairhost") }) ?? zips.first else {
            return nil
        }
        return Release(tag: tag, assetURL: asset, notes: notes)
    }

    // ── GitHub API ──
    private static func fetchLatest(_ done: @escaping (Result<Release, RPError>) -> Void) {
        func fail(_ m: String) { done(.failure(RPError(m))) }
        // alpha → scan the full release list (incl. pre-releases); stable → /releases/latest only.
        let isAlpha = channel == "alpha"
        let path = isAlpha ? "releases?per_page=30" : "releases/latest"
        guard let url = URL(string: "https://api.github.com/repos/\(GH_REPO)/\(path)") else {
            fail("invalid repo URL: \(GH_REPO)"); return
        }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("XpairHost/\(APP_VERSION)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { fail(err.localizedDescription); return }
            guard let http = resp as? HTTPURLResponse else { fail("no response"); return }
            guard http.statusCode == 200, let data = data else {
                fail("HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1) (no release or rate limit)"); return
            }
            let obj = try? JSONSerialization.jsonObject(with: data)
            if isAlpha {
                // /releases returns an array (newest-first by GitHub, but we don't rely on that — pick
                // the genuinely-newest tag via isNewer so a back-dated draft can't win).
                guard let arr = obj as? [[String: Any]] else {
                    log(.debug, "fetchLatest(alpha): release list unparseable (\(data.count) bytes)")
                    fail("failed to parse response"); return
                }
                let rels = arr.compactMap { release(from: $0) }
                guard let newest = rels.max(by: { isNewer($1.tag, than: $0.tag) }) else {
                    fail("no release with a zip asset (alpha channel)"); return
                }
                done(.success(newest))
            } else {
                guard let json = obj as? [String: Any], let rel = release(from: json) else {
                    log(.debug, "fetchLatest: release JSON missing/unparseable (\(data.count) bytes)")
                    fail("failed to parse response (no zip asset?)"); return
                }
                done(.success(rel))
            }
        }.resume()
    }

    // ── LEVEL-2 consent gate → download → verify → swap → restart ──
    //
    // Key point: if there are live sessions, no "silent restart". (a) enumerate sessions → (b) if any,
    // get explicit consent via an NSAlert that spells out how many are running, that the restart may break
    // computer-use and require re-attach, and that a running claude session may lose its Accessibility
    // inheritance until re-attach. (c) if 0 sessions, proceed directly (still safe).
    private static func promptAndApply(_ rel: Release) {
        // ── (a) enumerate live tmux-aqua sessions (attached + detached, excluding _keeper) ──
        let liveCount = Sessions.liveSessionCount()

        let a = NSAlert()
        a.messageText = "Update available: \(rel.tag) (app restart required)"
        if liveCount > 0 {
            // ── (b) real sessions present → explicit consent gate ──
            // SPIKE note: the warning below is a conservative "may be interrupted" warning. Since there is no
            // guarantee the session survives a restart (see header SPIKE above), it never says "carries over safely".
            a.alertStyle = .warning
            a.informativeText =
                "Moving from \(APP_VERSION) → \(rel.tag) is an app binary / interface contract change, so "
                + "applying it requires restarting the app.\n\n"
                + "⚠ You currently have \(liveCount) tmux-aqua session(s) running. Restarting will:\n"
                + "  • interrupt computer-use (screen control) and may require re-attach.\n"
                + "  • a running claude session may lose its Accessibility inheritance until re-attach.\n"
                + "  • the conversation transcript is preserved and can be resumed by re-launching in the same folder.\n\n"
                + "Update (restart) now?\n\n"
                + (rel.notes.isEmpty ? "" : String(rel.notes.prefix(300)))
            a.addButton(withTitle: "Update now (restarts)")
            a.addButton(withTitle: "Later")
            bringToFront()
            // ⓒ proceed only on consent (alertFirstButtonReturn). Otherwise (Later/close), do not restart.
            guard a.runModal() == .alertFirstButtonReturn else {
                log(.info, "LEVEL-2 relaunch declined by user (\(liveCount) live session(s)) — staying on \(APP_VERSION)")
                return
            }
            log(.info, "LEVEL-2 relaunch consented (\(liveCount) live session(s)) → \(rel.tag)")
        } else {
            // ── (c) 0 real sessions → safe with no interruption. Still get explicit confirmation (prevent an unexpected restart). ──
            a.informativeText = "Moving from \(APP_VERSION) → \(rel.tag). No sessions are running, so it is safe. Apply now?\n\n"
                + (rel.notes.isEmpty ? "" : String(rel.notes.prefix(400)))
            a.addButton(withTitle: "Download and apply")
            a.addButton(withTitle: "Later")
            bringToFront()
            guard a.runModal() == .alertFirstButtonReturn else { return }
            log(.info, "LEVEL-2 relaunch (0 live sessions) → \(rel.tag)")
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let newApp = try downloadAndStage(rel.assetURL)
                let warn = try verifySignature(newApp)
                try swapInPlace(newApp)
                DispatchQueue.main.async {
                    // Happy path (signature OK → TCC grant preserved): no extra modal. The user already
                    // consented to update+restart in promptAndApply's gate, so just relaunch — don't make
                    // them click a second "Restart" button or read a reassurance they don't need.
                    // Surface a modal ONLY on a cert MISMATCH (warn != nil), because then they MUST
                    // re-grant Accessibility/Screen Recording after the restart.
                    if let warn = warn {
                        let m = NSAlert()
                        m.messageText = "Update applied: \(rel.tag)"
                        m.informativeText = warn
                        m.addButton(withTitle: "Restart")
                        NSApp.activate(ignoringOtherApps: true)
                        bringToFront(); m.runModal()
                    }
                    relaunch()
                }
            } catch {
                DispatchQueue.main.async { info("Update failed", "\(error)") }
                log(.error, "apply failed — \(error)")
            }
        }
    }

    private static func downloadAndStage(_ url: URL) throws -> String {
        let tmp = NSTemporaryDirectory() + "rp-update-\(getpid())"
        do { try FileManager.default.removeItem(atPath: tmp) }
        catch { log(.debug, "stage: no stale tmp to clear at \(tmp): \(error)") }
        try FileManager.default.createDirectory(atPath: tmp, withIntermediateDirectories: true)
        let zipPath = tmp + "/update.zip"

        // synchronous download (called from a background queue)
        let sem = DispatchSemaphore(value: 0)
        var dlErr: Error?
        let task = URLSession.shared.downloadTask(with: url) { loc, _, err in
            if let err = err { dlErr = err }
            else if let loc = loc {
                // Preserve original flow: a failed move is detected by the fileExists guard below
                // (which throws "no download artifact"); just make the underlying cause traceable.
                do { try FileManager.default.moveItem(atPath: loc.path, toPath: zipPath) }
                catch { log(.warn, "download: staging move failed: \(error)") }
            }
            sem.signal()
        }
        task.resume(); sem.wait()
        if let dlErr = dlErr { throw RPError("download failed: \(dlErr.localizedDescription)") }
        guard FileManager.default.fileExists(atPath: zipPath) else { throw RPError("no download artifact") }

        // safe extract with ditto -x -k
        let un = runCapture("/usr/bin/ditto", ["-x", "-k", zipPath, tmp])
        guard un.status == 0 else { throw RPError("extraction failed") }
        // find the .app
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: tmp),
              let appName = entries.first(where: { $0.hasSuffix(".app") }) else {
            log(.debug, "stage: no .app among extracted entries at \(tmp)")
            throw RPError("no .app inside the zip")
        }
        // FIX 10 defense line: the bundle name is an untrusted value coming from the downloaded zip. Proceed only when
        //   it exactly matches the expected name (APP_NAME.app) — do not pass an abnormal/tampered name (shell metacharacters, etc.) downstream.
        guard appName == "\(APP_NAME).app" else {
            throw RPError("unexpected bundle name: \(appName) (expected: \(APP_NAME).app)")
        }
        return tmp + "/" + appName
    }

    /// Returns: nil = same cert (grant preserved), string = warning (cert mismatch → re-toggle required)
    ///
    /// ⚠ Security (FIX 10 command injection): the .app directory name in appPath comes from the downloaded release zip,
    ///   so it is untrusted (e.g. x'$(...).app). Never interpolate it into /bin/sh -c "...'\(appPath)'...".
    ///   Always invoke codesign with array arguments (array-form Process), and since Authority comes out on stderr,
    ///   merge-capture stderr into stdout and parse the 'Authority=' line in Swift (no shell → injection impossible).
    private static func verifySignature(_ appPath: String) throws -> String? {
        let v = runCapture("/usr/bin/codesign", ["--verify", "--strict", appPath])
        guard v.status == 0 else { throw RPError("codesign verification failed — corrupted or unsigned") }
        // codesign -dvv emits all diagnostics on stderr → merge stderr into stdout and capture (array args, no shell).
        let d = runCaptureMergingStderr("/usr/bin/codesign", ["-dvv", appPath])
        let authority = d.out
            .split(separator: "\n")
            .filter { $0.contains("Authority=") }
            .joined(separator: "\n")
        if !authority.contains(signCN) {
            return "⚠ The signing cert differs, so permissions will be reset. Re-toggle Accessibility/Screen Recording in System Settings."
        }
        return nil
    }

    /// Merged stdout+stderr capture — for tools like codesign -dvv that emit diagnostics on stderr. Array args (no shell).
    /// (The global runCapture discards stderr, so this variant is needed to catch the Authority line.)
    private static func runCaptureMergingStderr(_ launchPath: String, _ args: [String]) -> (out: String, status: Int32) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: launchPath)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe          // stderr → merged into the same pipe
        do { try p.run() } catch { return ("", -1) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (String(data: data, encoding: .utf8) ?? "", p.terminationStatus)
    }

    private static func swapInPlace(_ newApp: String) throws {
        // Replace the CURRENTLY-RUNNING bundle wherever it lives. Hard-coding /Applications broke
        // ~/Applications installs (explicitly allowed by Installer.shouldSkipSelfInstall): the update
        // either failed for lack of /Applications write permission or dropped a second copy in
        // /Applications while the LaunchAgent kept restarting the old ~/Applications binary. The
        // LaunchAgent points at Bundle.main, so swap into that same path.
        let dest = Bundle.main.bundlePath
        let destParent = (dest as NSString).deletingLastPathComponent
        runCapture("/usr/bin/xattr", ["-dr", "com.apple.quarantine", newApp])
        do { try FileManager.default.removeItem(atPath: dest) }
        catch { log(.warn, "swap: could not remove existing app at \(dest) (may be absent or locked): \(error)") }
        try FileManager.default.createDirectory(atPath: destParent, withIntermediateDirectories: true)
        try FileManager.default.moveItem(atPath: newApp, toPath: dest)
        log(.info, "swapped → \(dest)")
    }

    private static func relaunch() {
        // ⚠⚠ SPIKE — here, after NSApp.terminate, the LaunchAgent restarts with the new binary.
        //   Unresolved questions (need measuring, not guaranteed by this code):
        //     1) Does the existing tmux-aqua server (_keeper + user sessions) survive this restart?
        //        — the tmux server is a separate detached process, so the process itself likely survives, but
        //     2) it is unverified whether the new app process re-"adopts" that orphaned server, reconnects the
        //        InputServer primitive paths/sockets, and keeps/re-inherits the Accessibility inheritance
        //        (TCC responsible-process attribution) of the claude inside it stickily.
        //   So this function is reached only after the consent gate (promptAndApply) passes — the user has already
        //   acknowledged and consented that sessions may be interrupted. It does not rely on the assumption that "the session survives".
        let uid = getuid()
        // Relaunch the bundle we actually swapped into, wherever it lives (/Applications OR
        // ~/Applications). Hard-coding /Applications here would, on a ~/Applications install, either
        // open a stale /Applications copy or fail to restart at all, leaving the host down.
        let appPath = Bundle.main.bundlePath
        // detached helper: wait for the current PID to exit → LaunchAgent kickstart. (Automatic if KeepAlive, but guaranteed explicitly.)
        let script = """
        while kill -0 \(getpid()) 2>/dev/null; do sleep 0.3; done
        /bin/launchctl kickstart -k gui/\(uid)/\(BUNDLE_ID) 2>/dev/null \
          || /usr/bin/open '\(appPath)'
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", script]
        // run independently of the parent; if the helper fails to spawn, the app will terminate
        // below without anything to relaunch it (unless LaunchAgent KeepAlive kicks in) — log loudly.
        do { try p.run() }
        catch { log(.error, "relaunch: failed to spawn restart helper, app may not come back: \(error)") }
        NSApp.terminate(nil)
    }
}

struct RPError: Error, CustomStringConvertible { let m: String; init(_ m: String) { self.m = m }; var description: String { m } }

func info(_ title: String, _ body: String) {
    let a = NSAlert(); a.messageText = title; a.informativeText = body
    a.addButton(withTitle: "OK"); bringToFront(); a.runModal()
}
