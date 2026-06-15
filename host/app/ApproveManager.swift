// ApproveManager.swift — Launches the approve router as a child of this app (granted identity), on-demand.
//
// Clicks/keys must always originate within the RemotePairHost (AX+SR+PostEvent granted) subtree (inherited).
// The router watches the screen (OCR), detects which approval window it is, and routes accordingly. claude/skills only "request".

import Cocoa

final class ApproveManager {
    private var running = false
    func run() {
        if running { return }                          // The router retries internally, so prevent duplicate spawns
        running = true
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [ROUTER]
        p.environment = ["HOME": HOME,
                         // Put the bundled Helpers at the front of PATH — so the router finds the bundled ocr-find
                         "PATH": "\(HELPERS):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                         "LANG": "en_US.UTF-8",
                         // Explicitly inject so the router reads rules/logs from the correct namespace
                         "RP_DIR": RP_DIR, "RULES_FILE": RULES_FILE, "LOG_FILE": LOGP]
        p.terminationHandler = { [weak self] _ in self?.running = false }
        do { try p.run(); log("APPROVE: router spawned") }      // async — does not block the main thread
        catch { log("APPROVE: router spawn failed \(error)"); running = false }
    }
}
