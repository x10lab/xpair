// rp-input-target — controlled GUI sink for the cross-process input landing test.
// Opens an NSTextView window, makes it the key/active first responder, waits for
// an EXTERNAL rp-input-inject process to type into it, then prints what landed.
// Proves real keyboard/cursor input lands in a separate app (not in-process).
import Cocoa

let app = NSApplication.shared
app.setActivationPolicy(.regular)

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

// after the injector has had time to type, read back and report
let waitSec = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 3.0 : 3.0
DispatchQueue.main.asyncAfter(deadline: .now() + waitSec) {
  let got = tv.string
  let key = win.isKeyWindow
  let active = NSApp.isActive
  let fr = (win.firstResponder === tv) || (win.firstResponder is NSText)
  FileHandle.standardError.write(
    "TARGET_GOT:[\(got)] isKey=\(key) isActive=\(active) tvFirstResponder=\(fr)\n".data(using: .utf8)!)
  exit(got.contains("안녕") ? 0 : 1)
}
app.run()
