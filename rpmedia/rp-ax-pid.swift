// PID-targeted AX text insert: find an AXTextArea in app <pid> and set its value.
// Proves cross-process AX text insertion into a real NSTextView, independent of
// which app is frontmost (uses AXUIElementCreateApplication, not system-wide focus).
import Foundation
import ApplicationServices
guard CommandLine.arguments.count >= 3, let pid = Int32(CommandLine.arguments[1]) else { print("usage: pid text"); exit(2) }
let text = CommandLine.arguments[2]
guard AXIsProcessTrusted() else { print("not trusted"); exit(2) }
let appEl = AXUIElementCreateApplication(pid)
func find(_ el: AXUIElement, _ d: Int) -> AXUIElement? {
  if d > 14 { return nil }
  var role: CFTypeRef?
  AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &role)
  if (role as? String) == "AXTextArea" { return el }
  var kids: CFTypeRef?
  if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &kids) == .success, let arr = kids as? [AXUIElement] {
    for k in arr { if let f = find(k, d+1) { return f } }
  }
  return nil
}
if let ta = find(appEl, 0) {
  let r = AXUIElementSetAttributeValue(ta, kAXValueAttribute as CFString, text as CFString)
  print("found textarea, set rc=\(r.rawValue)")
  exit(r == .success ? 0 : 1)
} else { print("no AXTextArea found in pid \(pid)"); exit(1) }
