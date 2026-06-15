// AppDelegate.swift — menu bar (NSStatusItem) + dynamic session list + permissions/settings/update/About routing.
//
// Separation of responsibilities: tmux host=HostManager, approve=ApproveManager, session query/control=Sessions,
//            permissions=Permissions, updates=Updater, settings window=SettingsWindowController.
// The menu redraws the session list on every open via NSMenuDelegate.menuNeedsUpdate.

import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let host = HostManager()
    let approve = ApproveManager()
    var statusItem: NSStatusItem!
    var menu: NSMenu!
    var hostTimer: Timer?
    var tickTimer: Timer?
    var settings: SettingsWindowController?

    func applicationDidFinishLaunching(_ note: Notification) {
        ensureDirs()
        // Single-instance guard: prevent the churn (the gh-mac-m4 incident) where two instances
        // (LaunchAgent + manual open) reap each other's _keeper on the same tmux-aqua socket.
        // I yield and terminate **only when an older (lower-pid) instance exists**.
        // → Prevents both instances terminating + converges within at most one cycle even in the
        //   dying-previous-instance race of launchctl kickstart -k.
        let myPid = ProcessInfo.processInfo.processIdentifier
        let older = NSRunningApplication.runningApplications(withBundleIdentifier: BUNDLE_ID)
            .filter { $0.processIdentifier != myPid && $0.processIdentifier < myPid && !$0.isTerminated }
        if !older.isEmpty {
            log("launch: an older RemotePairHost instance (pid \(older.map { $0.processIdentifier })) is running — terminating duplicate")
            NSApp.terminate(nil); return
        }
        Installer.ensureInstalled()     // self-install on first run of a downloaded .app (no-op if already installed)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // Menu-bar icon: monochrome template (auto-adapts to light/dark menu bar).
        // Loaded by name from Resources (menubar.png + menubar@2x.png). Falls back to text glyph.
        if let img = NSImage(named: NSImage.Name("menubar")) {
            img.isTemplate = true
            img.size = NSSize(width: 18, height: 18)
            statusItem.button?.image = img
        } else {
            statusItem.button?.title = "⌗⌘"
        }

        menu = NSMenu()
        menu.delegate = self           // rebuilt each time via menuNeedsUpdate
        statusItem.menu = menu
        rebuildMenu()

        log("launched (RemotePairHost v\(APP_VERSION), repo=\(GH_REPO))")
        host.ensureServer()
        hostTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.host.ensureServer() }
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.poll() }
        // (legacy v0 InputServer 0.1s main-thread polling removed — screencapture's synchronous blocking froze the menu bar.
        //  Screen sharing/input are replaced by v1/v2 (remote-pair-screen serve-webrtc + rp-input-inject).)

        if UserDefaults.standard.bool(forKey: SettingsWindowController.autoUpdateKey) {
            Updater.checkForUpdates(interactive: false)
        }
    }

    // ── dynamic menu ──
    func menuNeedsUpdate(_ menu: NSMenu) { rebuildMenu() }

    private func rebuildMenu() {
        menu.removeAllItems()

        let header = NSMenuItem(title: "\(APP_NAME) v\(APP_VERSION)", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        // permission status + grant (CLIENT = access-only: status only, Grant item shown on host/both only)
        let perm = NSMenuItem(title: Permissions.summary(), action: nil, keyEquivalent: "")
        perm.isEnabled = false
        menu.addItem(perm)
        if isHostRole {
            menu.addItem(withTitle: "Grant Permissions…", action: #selector(grantPermissions), keyEquivalent: "")
        }
        menu.addItem(.separator())

        // session list (server status + each session → modal on click)
        let serverUp = Sessions.serverUp()
        let sessions = serverUp ? Sessions.list() : []
        let shdr = NSMenuItem(title: serverUp ? "Sessions (\(sessions.count))" : "tmux host: down",
                              action: nil, keyEquivalent: "")
        shdr.isEnabled = false
        menu.addItem(shdr)
        if sessions.isEmpty {
            let none = NSMenuItem(title: serverUp ? "  (no active sessions)" : "  (server not running)",
                                  action: nil, keyEquivalent: "")
            none.isEnabled = false
            menu.addItem(none)
        } else {
            for s in sessions {
                let label = "  \(s.name)   (\(s.attached > 0 ? "attached ×\(s.attached)" : "detached"))"
                let it = NSMenuItem(title: label, action: #selector(sessionClicked(_:)), keyEquivalent: "")
                it.representedObject = s.name
                it.target = self
                menu.addItem(it)
            }
        }
        menu.addItem(withTitle: "Restart tmux host", action: #selector(restartHost), keyEquivalent: "")
        menu.addItem(withTitle: "Repair install", action: #selector(repairInstall), keyEquivalent: "")
        menu.addItem(.separator())

        menu.addItem(withTitle: "Approve now", action: #selector(approveNow), keyEquivalent: "")
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        menu.addItem(withTitle: "Check for Updates…", action: #selector(checkUpdates), keyEquivalent: "")
        menu.addItem(withTitle: "About \(APP_NAME)", action: #selector(about), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }

    // ── session click → modal (Detach all / Kill / Cancel) ──
    @objc private func sessionClicked(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        let list = Sessions.list()
        guard let s = list.first(where: { $0.name == name }) else { return }

        let a = NSAlert()
        a.messageText = "Session: \(s.name)"
        var detail = "Path: \(s.path.isEmpty ? "?" : s.path)\nattached: \(s.attached)  windows: \(s.windows)"
        if let c = s.created {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"
            detail += "\nCreated: \(f.string(from: c))"
        }
        a.informativeText = detail
        a.addButton(withTitle: "Detach all")     // .alertFirstButtonReturn
        a.addButton(withTitle: "Kill session")   // .alertSecondButtonReturn
        a.addButton(withTitle: "Cancel")         // .alertThirdButtonReturn
        bringToFront()
        switch a.runModal() {
        case .alertFirstButtonReturn:
            Sessions.detachAll(s.name)
        case .alertSecondButtonReturn:
            let c = NSAlert()
            c.messageText = "Kill session '\(s.name)'?"
            c.informativeText = "The processes inside this session (claude, etc.) will be cleaned up. This cannot be undone."
            c.addButton(withTitle: "Kill"); c.addButton(withTitle: "Cancel")
            c.alertStyle = .warning
            bringToFront()
            if c.runModal() == .alertFirstButtonReturn { Sessions.kill(s.name) }
        default:
            break
        }
    }

    // ── steady-state loop: heartbeat + status (ground truth) + trigger check (all lightweight) ──
    @objc func poll() {
        do { try "".write(toFile: HEARTBEAT, atomically: false, encoding: .utf8) }
        catch { log(.debug, "heartbeat write failed: \(error)") }   // ignorable: next tick (1s) retries
        writeStatus()   // write app liveness + AX/SR/FDA grant facts to status.json — so the agent reads them without guessing
        if FileManager.default.fileExists(atPath: TRIGGER) {
            do { try FileManager.default.removeItem(atPath: TRIGGER) }
            catch { log(.warn, "approve: removing trigger \(TRIGGER) failed (router may re-fire): \(error)") }
            log("trigger → router")
            approve.run()
        }
        // Onboarding (Electron) → app triggers: only the host app can register for TCC / run the installer.
        let grantReq = "/tmp/remote-pair.grant-request"
        if let raw = try? String(contentsOfFile: grantReq, encoding: .utf8) {
            do { try FileManager.default.removeItem(atPath: grantReq) }
            catch { log(.warn, "onboard: removing grant-request \(grantReq) failed (may re-fire next tick): \(error)") }
            let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            log("grant-request → Permissions.request(\(key))")
            Permissions.request(key)
        }
        let installReq = "/tmp/remote-pair.install-request"
        if FileManager.default.fileExists(atPath: installReq) {
            do { try FileManager.default.removeItem(atPath: installReq) }
            catch { log(.warn, "onboard: removing install-request \(installReq) failed (may re-fire next tick): \(error)") }
            log("install-request → Installer.install")
            Installer.install(force: true, refreshResources: true)
        }
    }

    @objc func grantPermissions() { Permissions.requestAndOpen() }
    @objc func approveNow() { approve.run() }
    @objc func restartHost() {
        // true restart (reap server+sessions, then relaunch) — if there are active sessions, warn about disconnection before proceeding.
        let n = Sessions.serverUp() ? Sessions.list().count : 0
        if n > 0 {
            let a = NSAlert()
            a.messageText = "Restart tmux host?"
            a.informativeText = "⚠ \(n) active session(s) will be disconnected. "
                + "Conversation transcripts are preserved — re-launch the same folder to resume."
            a.addButton(withTitle: "Restart")
            a.addButton(withTitle: "Cancel")
            NSApp.activate(ignoringOtherApps: true)
            guard a.runModal() == .alertFirstButtonReturn else { return }
        }
        host.forceRestart()
    }
    @objc func checkUpdates() { Updater.checkForUpdates(interactive: true) }

    @objc func repairInstall() {
        Installer.install(force: false)   // reapply missing pieces (safe: preserves existing files / running instance)
        rebuildMenu()
    }

    @objc func openSettings() {
        if settings == nil { settings = SettingsWindowController() }
        settings?.show()
    }

    @objc func about() {
        let a = NSAlert()
        a.messageText = "\(APP_NAME)  v\(APP_VERSION)"
        a.informativeText = """
        Hosts a tmux daemon on a remote Mac so that a claude attached remotely (mosh/ssh) \
        can use macOS computer-use (screenshots, clicks, typing).

        • Holds the patched tmux-aqua server as a child of the app to inherit AX/SR permissions
        • Auto-clicks approval dialogs (approve router)
        • Clients connect via the 'remote-pair' CLI + Finder Service

        repo: github.com/\(GH_REPO)
        """
        a.addButton(withTitle: "Open GitHub")
        a.addButton(withTitle: "OK")
        bringToFront()
        if a.runModal() == .alertFirstButtonReturn,
           let u = URL(string: "https://github.com/\(GH_REPO)") {
            NSWorkspace.shared.open(u)
        }
    }
}
