// SettingsWindow.swift — host settings/status window (native, built in code without a nib).
//
// Only items meaningful to the host: version, socket, repo, permission status, auto-update toggle, active session cwd list, and action buttons.

import Cocoa

final class SettingsWindowController: NSWindowController {
    private var infoLabel: NSTextField!
    private var autoUpdate: NSButton!
    private var telemetryConsent: NSButton!
    private var crashConsent: NSButton!

    static let autoUpdateKey = "RPAutoUpdateCheck"

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 420),
                           styleMask: [.titled, .closable], backing: .buffered, defer: false)
        win.title = "\(APP_NAME) Settings"
        self.init(window: win)
        build()
    }

    private func build() {
        guard let win = window, let content = win.contentView else { return }

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 18, bottom: 16, right: 18)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])

        let title = NSTextField(labelWithString: "\(APP_NAME)  v\(APP_VERSION)")
        title.font = .boldSystemFont(ofSize: 15)
        stack.addArrangedSubview(title)

        infoLabel = NSTextField(wrappingLabelWithString: "")
        infoLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        infoLabel.lineBreakMode = .byWordWrapping
        infoLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        infoLabel.translatesAutoresizingMaskIntoConstraints = false
        infoLabel.widthAnchor.constraint(equalToConstant: 424).isActive = true
        stack.addArrangedSubview(infoLabel)

        autoUpdate = NSButton(checkboxWithTitle: "Automatically check for updates on launch", target: self, action: #selector(toggleAuto))
        autoUpdate.state = UserDefaults.standard.bool(forKey: Self.autoUpdateKey) ? .on : .off
        stack.addArrangedSubview(autoUpdate)

        // Privacy: dual opt-in telemetry consent (both default OFF — registered in AppDelegate). Default OFF
        // means zero network calls (TelemetryClient.capture / SentryBridge no-op until the matching flag is ON).
        telemetryConsent = NSButton(checkboxWithTitle: "Share anonymous usage analytics (PostHog)", target: self, action: #selector(toggleTelemetry))
        telemetryConsent.state = UserDefaults.standard.bool(forKey: TelemetryClient.consentKey) ? .on : .off
        stack.addArrangedSubview(telemetryConsent)

        crashConsent = NSButton(checkboxWithTitle: "Send anonymized crash reports (Sentry)", target: self, action: #selector(toggleCrash))
        crashConsent.state = UserDefaults.standard.bool(forKey: SentryBridge.consentKey) ? .on : .off
        stack.addArrangedSubview(crashConsent)

        let row = NSStackView()
        row.orientation = .horizontal; row.spacing = 8
        // Permission granting now lives in the onboarding ("Set up…"/"Permissions…" menu items), not here.
        let buttons: [(String, Selector)] = [("Check for Updates…", #selector(update)),
                    ("Open Folder", #selector(openDir)),
                    ("Refresh", #selector(refresh))]
        for (t, sel) in buttons {
            let b = NSButton(title: t, target: self, action: sel)
            b.bezelStyle = .rounded
            row.addArrangedSubview(b)
        }
        stack.addArrangedSubview(row)

        refresh()
    }

    @objc private func toggleAuto() {
        UserDefaults.standard.set(autoUpdate.state == .on, forKey: Self.autoUpdateKey)
    }
    @objc private func toggleTelemetry() {
        UserDefaults.standard.set(telemetryConsent.state == .on, forKey: TelemetryClient.consentKey)
    }
    @objc private func toggleCrash() {
        // Takes effect on next launch (SentryBridge.setupIfConsented runs at startup); no live re-init here.
        UserDefaults.standard.set(crashConsent.state == .on, forKey: SentryBridge.consentKey)
    }
    @objc private func update() { Updater.checkForUpdates(interactive: true) }
    @objc private func openDir() {
        ensureDirs()
        NSWorkspace.shared.open(URL(fileURLWithPath: RP_DIR))
    }

    @objc private func refresh() {
        let sessions = Sessions.list()
        var s = ""
        s += "Socket:       \(SOCKET)  (\(Sessions.serverUp() ? "up" : "down"))\n"
        s += "Release repo: \(GH_REPO)\n"
        s += "Namespace:    \(RP_DIR)\n"
        s += "\(Permissions.summary())\n"
        s += "\nActive sessions (\(sessions.count)):\n"
        if sessions.isEmpty {
            s += "  (none)\n"
        } else {
            for ses in sessions {
                s += "  • \(ses.name)  [attached \(ses.attached), win \(ses.windows)]\n      \(ses.path)\n"
            }
        }
        infoLabel.stringValue = s
    }

    func show() {
        refresh()
        bringToFront()
        window?.center()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }
}
