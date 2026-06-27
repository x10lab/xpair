// rp-input-target — controlled GUI sink for the cross-process input landing test.
// Opens an NSTextView window, makes it the key/active first responder, waits for
// an EXTERNAL rp-input-inject process to type into it, then prints what landed.
// Proves real keyboard/cursor input lands in a separate app (not in-process).
import Cocoa

let app = NSApplication.shared
app.setActivationPolicy(.regular)

// Edit menu so cmd+V / cmd+C / cmd+X route to the first responder (paste:, etc.)
let mainMenu = NSMenu()
let editTop = NSMenuItem(); mainMenu.addItem(editTop)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
editTop.submenu = editMenu
app.mainMenu = mainMenu

let win = NSWindow(contentRect: NSMakeRect(300, 300, 600, 240),
                   styleMask: [.titled], backing: .buffered, defer: false)
win.title = "rp-input-target"
let tv = NSTextView(frame: win.contentView!.bounds)
tv.isEditable = true
tv.isSelectable = true
win.contentView!.addSubview(tv)
win.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
win.makeFirstResponder(tv)
try? "\(ProcessInfo.processInfo.processIdentifier)".write(toFile: "/tmp/rptarget.pid", atomically: true, encoding: .utf8)

import ApplicationServices

// Self-contained injection test: once we are key, inject Korean two ways into
// the focused element and read back — eliminates external focus races.
//   method A: AX  -> set kAXSelectedTextAttribute (exact Unicode)
//   method B: clipboard + CGEvent-free... (paste needs a real shortcut; skip)
// Passive sink: stay alive indefinitely (until killed), re-assert key, and keep
// writing the current textview contents to a file so an external reader can see
// what landed at any time. Lives long enough for a full live chain to deliver.
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
  win.makeKeyAndOrderFront(nil); win.makeFirstResponder(tv)
  let got = tv.string
  try? "TARGET_GOT:[\(got)] isKey=\(win.isKeyWindow)\n".data(using: .utf8)!
    .write(to: URL(fileURLWithPath: "/tmp/rp-target-result.txt"))
}
app.run()
