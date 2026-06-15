// main.swift — RemotePairHost entry point.  (top-level executable statements may only live in this file)
//
// Menu-bar-only accessory app: no Dock icon + holds a graphic session (the gating condition for AX synthetic input).
// Responsibilities are split across the individual .swift files: Config / HostManager / ApproveManager / Sessions /
//   Permissions / Updater / SettingsWindow / AppDelegate.

import Cocoa

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu-bar only (holds a graphic session)
app.run()
