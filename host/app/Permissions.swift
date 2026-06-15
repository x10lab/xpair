// Permissions.swift — Check Accessibility(AX) + Screen Recording(SR) + Full Disk Access(FDA) permission status + open System Settings.
//
// computer-use 2 gates (required):  AX(synthetic input) = AXIsProcessTrusted(),  SR(screenshot) = CGPreflightScreenCaptureAccess().
// FDA(recommended): on a headless host, the macOS TCC folder prompt cannot be clicked remotely, so the session stalls.
//   Enabling FDA makes that prompt disappear entirely. The trade-off, in exchange, is that every session can silently read the whole disk (including Mail/Messages/browser).
// Since this is SIP+non-MDM, only the user can toggle — we just show the status + open the correct settings pane.

import Cocoa
import ApplicationServices
import CoreGraphics

enum Permissions {
    static func axTrusted() -> Bool { AXIsProcessTrusted() }
    static func srGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    /// FDA has no public preflight API → infer it by actually reading a TCC-protected file (TCC.db) that can only be opened with FDA.
    static func fdaGranted() -> Bool {
        let probe = (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/Application Support/com.apple.TCC/TCC.db")
        guard let fh = FileHandle(forReadingAtPath: probe) else { return false }
        defer {
            // Closing the read-only probe handle failing is genuinely ignorable, but trace it so a leaked fd is diagnosable.
            do { try fh.close() } catch { log(.debug, "fdaGranted: close TCC.db probe handle failed: \(error)") }
        }
        // A successful 1-byte read means FDA is granted; a read error means it isn't (the load-bearing inference) — log the error so a non-FDA failure is distinguishable from other I/O faults.
        do {
            return try fh.read(upToCount: 1) != nil
        } catch {
            log(.debug, "fdaGranted: TCC.db probe read failed (treating as FDA not granted): \(error)")
            return false
        }
    }

    /// One-line summary for the menu bar status. e.g. "Permissions: Accessibility ✓  Screen Recording ✗  Full Disk ✗"
    static func summary() -> String {
        "Permissions: Accessibility \(axTrusted() ? "✓" : "✗")  Screen Recording \(srGranted() ? "✓" : "✗")  Full Disk \(fdaGranted() ? "✓" : "✗")"
    }

    /// Only checks computer-use's required gates (FDA is recommended, so it's not a gate).
    static func allGranted() -> Bool { axTrusted() && srGranted() }

    /// Trigger the permission prompts + open the relevant settings pane + show guidance.
    static func requestAndOpen() {
        // CLIENT = ACCESS-ONLY: never raise the AX/SR system prompts (this machine is not a permission boundary).
        // Return early before calling either prompt API (AXIsProcessTrustedWithOptions / CGRequestScreenCaptureAccess).
        if isClientRole {
            let a = NSAlert()
            a.messageText = "This machine is client (access-only)"
            a.informativeText = """
            A client machine does not request permissions (Accessibility / Screen Recording).
            computer-use permissions are granted only on host (host/both) machines.
            This machine connects to a host via the 'remote-pair' CLI and uses its sessions.
            """
            a.addButton(withTitle: "OK")
            bringToFront()
            a.runModal()
            return
        }
        // Trigger the system prompts (a dialog on first run, no-op once already decided).
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        if !srGranted() { CGRequestScreenCaptureAccess() }

        let panes = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        ]
        for u in panes { if let url = URL(string: u) { NSWorkspace.shared.open(url) } }

        let a = NSAlert()
        a.messageText = "Grant permissions (one time)"
        a.informativeText = """
        In System Settings → Privacy & Security, turn on \(APP_NAME):
          • Accessibility               [required]    : \(axTrusted() ? "✓ already on" : "OFF — turn on")
          • Screen Recording            [required]    : \(srGranted() ? "✓ already on" : "OFF — turn on")
          • Full Disk Access            [recommended] : \(fdaGranted() ? "✓ already on" : "OFF — turn on if headless")
        If it's not in the list, add /Applications/\(APP_NAME).app with +.
        Full Disk Access removes the folder prompts that can't be clicked remotely, but lets every session read the whole disk (trade-off).
        After toggling, use 'Restart tmux host' from the menu to pick up the grant.
        """
        a.addButton(withTitle: "OK")
        bringToFront()
        a.runModal()
    }

    /// Onboarding-triggered single-permission request (the onboarding owns the surrounding UI, so no alert/panes here).
    /// AX → AXIsProcessTrustedWithOptions(prompt) shows the system prompt AND registers the app in the Accessibility list.
    /// SR → CGRequestScreenCaptureAccess() registers the app in the Screen Recording list. FDA has no request API.
    static func request(_ key: String) {
        if isClientRole { return }   // client = access-only, never requests
        switch key {
        case "ax":
            let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(opts)
        case "sr":
            if !srGranted() { CGRequestScreenCaptureAccess() }
        default:
            break   // fda: no programmatic request API — the user adds the app via the Full Disk Access pane
        }
    }
}

/// This is an accessory(LSUIElement) app, so an explicit activate is needed to bring modals/windows to the front.
func bringToFront() {
    NSApp.activate(ignoringOtherApps: true)
}
