// SettingsWindow.swift — 호스트 설정/현황 창 (네이티브, nib 없이 코드로 구성).
//
// 호스트에 의미있는 항목만: 버전·소켓·repo·권한 상태·자동 업데이트 토글·활성 세션 cwd 목록 + 액션 버튼.

import Cocoa

final class SettingsWindowController: NSWindowController {
    private var infoLabel: NSTextField!
    private var autoUpdate: NSButton!

    static let autoUpdateKey = "RPAutoUpdateCheck"

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 420),
                           styleMask: [.titled, .closable], backing: .buffered, defer: false)
        win.title = "\(APP_NAME) 설정"
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

        autoUpdate = NSButton(checkboxWithTitle: "시작 시 업데이트 자동 확인", target: self, action: #selector(toggleAuto))
        autoUpdate.state = UserDefaults.standard.bool(forKey: Self.autoUpdateKey) ? .on : .off
        stack.addArrangedSubview(autoUpdate)

        let row = NSStackView()
        row.orientation = .horizontal; row.spacing = 8
        for (t, sel) in [("권한 부여…", #selector(grant)),
                         ("업데이트 확인…", #selector(update)),
                         ("폴더 열기", #selector(openDir)),
                         ("새로고침", #selector(refresh))] {
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
    @objc private func grant() { Permissions.requestAndOpen(); refresh() }
    @objc private func update() { Updater.checkForUpdates(interactive: true) }
    @objc private func openDir() {
        ensureDirs()
        NSWorkspace.shared.open(URL(fileURLWithPath: RP_DIR))
    }

    @objc private func refresh() {
        let sessions = Sessions.list()
        var s = ""
        s += "소켓:        \(SOCKET)  (\(Sessions.serverUp() ? "up" : "down"))\n"
        s += "릴리스 repo:  \(GH_REPO)\n"
        s += "네임스페이스: \(RP_DIR)\n"
        s += "\(Permissions.summary())\n"
        s += "\n활성 세션 (\(sessions.count)):\n"
        if sessions.isEmpty {
            s += "  (없음)\n"
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
