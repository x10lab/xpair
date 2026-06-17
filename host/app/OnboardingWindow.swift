// OnboardingWindow.swift — in-process onboarding, replacing the standalone Electron app.
//
// The host menu-bar app now hosts the React onboarding (host/onboarding/dist, bundled into
// Contents/Resources/onboarding) inside a WKWebView. A WKUserScript injected atDocumentStart
// defines `window.remotepair` with the same method surface the Electron preload exposed, each
// returning a Promise backed by a single WKScriptMessageHandlerWithReply (`rpbridge`, macOS 11+
// async reply). The Swift reply handler dispatches by method name.
//
// This window is shown by AppDelegate ONLY while Screen Recording is not granted (the hard run-gate).
// onComplete fires when the React Done → complete() posts; closing it before SR is granted quits the app.

import Cocoa
import WebKit

final class OnboardingWindow: NSObject, NSWindowDelegate, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let onComplete: () -> Void
    // Set true once the React side calls complete() (Screen Recording granted). Distinguishes a
    // legitimate finish from the user dismissing the window while still ungranted (→ hard gate quit).
    private var completed = false

    /// onComplete is invoked on the main thread when the React onboarding signals completion.
    init(onComplete: @escaping () -> Void) {
        self.onComplete = onComplete
        super.init()
    }

    // The JS shim: define window.remotepair with a Promise-returning method per bridge call. Each
    // method posts {method, args} to the `rpbridge` reply handler and awaits the async reply.
    private static let bridgeShim = """
    (function () {
      const post = (method, args) =>
        window.webkit.messageHandlers.rpbridge.postMessage({ method: method, args: args || [] });
      window.remotepair = {
        openPermissionPane: (key) => post('openPermissionPane', [key]),
        requestPermission: (key) => post('requestPermission', [key]),
        startInstall: () => post('startInstall', []),
        getInstallStatus: () => post('getInstallStatus', []),
        getHostInfo: () => post('getHostInfo', []),
        getStatus: () => post('getStatus', []),
        getConsent: () => post('getConsent', []),
        setConsent: (c) => post('setConsent', [c]),
        complete: () => post('complete', []),
      };
    })();
    """

    /// Build + show the onboarding window. Main thread only.
    func show() {
        assert(Thread.isMainThread, "OnboardingWindow.show must run on the main thread")

        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        let script = WKUserScript(source: Self.bridgeShim,
                                  injectionTime: .atDocumentStart,
                                  forMainFrameOnly: true)
        controller.addUserScript(script)
        controller.addScriptMessageHandler(self, contentWorld: .page, name: "rpbridge")
        config.userContentController = controller

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 720, height: 560), configuration: config)

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 560),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.title = APP_NAME
        window.contentView = webView
        window.delegate = self
        window.center()

        // The React build uses vite base './', so index.html references its assets relatively.
        // Load via file:// granting read access to the onboarding resource dir so the relative
        // asset requests resolve.
        guard let index = Bundle.main.url(forResource: "index",
                                          withExtension: "html",
                                          subdirectory: "onboarding") else {
            log(.error, "onboarding: Contents/Resources/onboarding/index.html missing in bundle")
            // Without the UI we cannot gate interactively — fail closed (app quits via the gate path).
            return
        }
        let dir = index.deletingLastPathComponent()
        webView.loadFileURL(index, allowingReadAccessTo: dir)

        // RemotePairHost is LSUIElement (menu-bar accessory) → no Dock icon + weak window focus, so
        // the onboarding can end up invisible/behind. Temporarily become a regular app so it shows in
        // the Dock and can take focus; revert to .accessory in finish() (menu-bar-only after onboarding).
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        log(.info, "onboarding window shown (run-gate; activation → regular for Dock + focus)")
    }

    // MARK: - WKScriptMessageHandlerWithReply (async reply, macOS 11+)

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let method = body["method"] as? String else {
            replyHandler(nil, "rpbridge: malformed message")
            return
        }
        let args = body["args"] as? [Any] ?? []

        switch method {
        case "getStatus":
            replyHandler([
                "alive": true,
                "ax": Permissions.axTrusted(),
                "sr": Permissions.srGranted(),
                "fda": Permissions.fdaGranted(),
            ], nil)

        case "requestPermission":
            if let key = args.first as? String { Permissions.request(key) }
            replyHandler(nil, nil)

        case "openPermissionPane":
            if let key = args.first as? String { openPane(key) }
            replyHandler(nil, nil)

        case "getHostInfo":
            replyHandler([
                "hostname": Host.current().localizedName ?? ProcessInfo.processInfo.hostName,
                "user": NSUserName(),
            ], nil)

        case "getInstallStatus":
            // Already installed (the app self-launched this onboarding), so report ready.
            replyHandler(["appAlive": true, "launchAgentPresent": true, "serverUp": true], nil)

        case "startInstall":
            // No-op: installation already happened before onboarding is shown.
            replyHandler(nil, nil)

        case "getConsent":
            // Both flags are opt-in (default OFF via AppDelegate's UserDefaults.register). The
            // onboarding reads/writes the SAME keys the rest of the host uses (Settings, startup
            // gates), so there is one source of truth.
            replyHandler([
                "telemetry": UserDefaults.standard.bool(forKey: TelemetryClient.consentKey),
                "crash": UserDefaults.standard.bool(forKey: SentryBridge.consentKey),
            ], nil)

        case "setConsent":
            // Persist the user's opt-in choices. Defensive about JS payload types: only treat an
            // explicit Bool true as ON; anything else (missing/null/non-bool) leaves it OFF.
            if let c = args.first as? [String: Any] {
                UserDefaults.standard.set((c["telemetry"] as? Bool) ?? false,
                                          forKey: TelemetryClient.consentKey)
                UserDefaults.standard.set((c["crash"] as? Bool) ?? false,
                                          forKey: SentryBridge.consentKey)
            }
            replyHandler(nil, nil)

        case "complete":
            replyHandler(nil, nil)
            finish()

        default:
            replyHandler(nil, "rpbridge: unknown method \(method)")
        }
    }

    // MARK: - helpers

    private func openPane(_ key: String) {
        let urls = [
            "ax": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "sr": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "fda": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        ]
        guard let s = urls[key], let url = URL(string: s) else { return }
        NSWorkspace.shared.open(url)
    }

    /// React Done → complete(): close the window and start serving.
    private func finish() {
        completed = true
        // Consent was already persisted via setConsent during onboarding. Re-run the Sentry gate so
        // an opt-in chosen here takes effect THIS session without a restart. Safe: startup ran with
        // consent OFF (Noop backend), so this is the first real init when crash consent is now ON.
        SentryBridge.setupIfConsented()
        log(.info, "onboarding complete → starting serving")
        window.close()
        // Revert to menu-bar-only (LSUIElement) now that onboarding is done.
        NSApp.setActivationPolicy(.accessory)
        onComplete()
    }

    // MARK: - NSWindowDelegate (hard gate)

    func windowWillClose(_ notification: Notification) {
        // If the window is dismissed while AX/SR are still ungranted and the user did not complete
        // the flow, enforce the hard run-gate: the app quits. (allGranted = axTrusted && srGranted.)
        if !completed && !Permissions.allGranted() {
            log(.warn, "onboarding dismissed without Accessibility+Screen Recording — quitting (hard gate)")
            NSApp.terminate(nil)
        }
    }
}
