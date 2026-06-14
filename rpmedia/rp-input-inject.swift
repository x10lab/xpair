// rp-input-inject — v2 remote-input host helper (plan Step 1).
// Reads length-prefixed JSON commands from stdin and injects them as native
// CGEvents. Spawned once per PeerConnection by serve_webrtc.rs; the Rust side
// feeds DataChannel messages (rp-ctl / rp-move) into this helper's stdin.
//
// Wire format: [4-byte BE len][JSON]  per command. JSON shapes:
//   {"t":"m","seq":N,"rx":0..1,"ry":0..1}                 mouse move
//   {"t":"c","seq":N,"rx":0..1,"ry":0..1,"btn":"l"|"r"}   click (move+down+up)
//   {"t":"k","seq":N,"code":<mac vk>,"flags":<CGEventFlags raw>}  key (down+up)
//   {"t":"x","seq":N,"s":"완성 텍스트"}                     text via Unicode (Korean-safe)
// Echoes one line per command to stderr: RPIN seq=<N> t=<t> ...  (for the B5 cross-check).
// Needs Accessibility (TCC). Korean text uses keyboardSetUnicodeString (layout-independent).
import Foundation
import CoreGraphics
import ApplicationServices

let src = CGEventSource(stateID: .hidSystemState)
let err = FileHandle.standardError
func log(_ s: String) { err.write((s + "\n").data(using: .utf8)!) }
// Cross-process CGEvent delivery to OTHER apps requires THIS binary to be
// Accessibility-trusted. (A same-process CGEventTap can capture posted events
// even when untrusted — which is why earlier tap-based tests gave false pass.)
log("rp-input-inject: AXIsProcessTrusted=\(AXIsProcessTrusted())")

// display logical bounds for relative→point mapping (queried once)
let mainBounds = CGDisplayBounds(CGMainDisplayID())

func point(_ rx: Double, _ ry: Double) -> CGPoint {
  CGPoint(x: mainBounds.origin.x + rx * mainBounds.size.width,
          y: mainBounds.origin.y + ry * mainBounds.size.height)
}
func injectMove(_ p: CGPoint) {
  CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}
func injectClick(_ p: CGPoint, right: Bool) {
  injectMove(p)
  let down: CGEventType = right ? .rightMouseDown : .leftMouseDown
  let up: CGEventType = right ? .rightMouseUp : .leftMouseUp
  let btn: CGMouseButton = right ? .right : .left
  CGEvent(mouseEventSource: src, mouseType: down, mouseCursorPosition: p, mouseButton: btn)?.post(tap: .cghidEventTap)
  CGEvent(mouseEventSource: src, mouseType: up, mouseCursorPosition: p, mouseButton: btn)?.post(tap: .cghidEventTap)
}
func injectKey(_ code: CGKeyCode, _ flags: CGEventFlags) {
  let d = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true); d?.flags = flags; d?.post(tap: .cghidEventTap)
  let u = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false); u?.flags = flags; u?.post(tap: .cghidEventTap)
}
// Find a focused/text element: production = system-wide focused element (whatever
// app the host user is in). RP_INPUT_TARGET_PID (test only) = target a specific
// app's text area by pid, bypassing the frontmost-active requirement (used by the
// live full-chain harness where the automated env can't make a window active).
func textTargetElement() -> AXUIElement? {
  if let pidStr = ProcessInfo.processInfo.environment["RP_INPUT_TARGET_PID"], let pid = Int32(pidStr) {
    func find(_ e: AXUIElement, _ d: Int) -> AXUIElement? {
      if d > 14 { return nil }
      var r: CFTypeRef?; AXUIElementCopyAttributeValue(e, kAXRoleAttribute as CFString, &r)
      if (r as? String) == "AXTextArea" { return e }
      var k: CFTypeRef?
      if AXUIElementCopyAttributeValue(e, kAXChildrenAttribute as CFString, &k) == .success, let a = k as? [AXUIElement] {
        for c in a { if let f = find(c, d + 1) { return f } }
      }
      return nil
    }
    return find(AXUIElementCreateApplication(pid), 0)
  }
  let sys = AXUIElementCreateSystemWide()
  var f: CFTypeRef?
  if AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute as CFString, &f) == .success { return (f as! AXUIElement) }
  return nil
}

func injectText(_ s: String) {
  // Text (incl. Korean) via Accessibility — insert exact Unicode. CGEvent
  // keyboardSetUnicodeString does NOT reach Cocoa/most apps; System Events
  // mangles Hangul. AX kAXSelectedTextAttribute lands exact Korean. See FINDINGS.
  guard let el = textTargetElement() else { log("injectText: no target element"); return }
  // prefer selected-text (insert at cursor); fall back to value (replace) for elements that reject it
  var r = AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, s as CFString)
  if r != .success { r = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, s as CFString) }
  if r != .success { log("injectText: AX set rc=\(r.rawValue)") }
}

func handle(_ j: [String: Any]) {
  let t = j["t"] as? String ?? "?"
  let seq = j["seq"] as? Int ?? -1
  switch t {
  case "m": if let rx = j["rx"] as? Double, let ry = j["ry"] as? Double { injectMove(point(rx, ry)) }
  case "c": if let rx = j["rx"] as? Double, let ry = j["ry"] as? Double { injectClick(point(rx, ry), right: (j["btn"] as? String) == "r") }
  case "k": if let code = j["code"] as? Int { injectKey(CGKeyCode(code), CGEventFlags(rawValue: UInt64(j["flags"] as? Int ?? 0))) }
  case "x": if let s = j["s"] as? String { injectText(s) }
  default: break
  }
  log("RPIN seq=\(seq) t=\(t)")
}

// read [4B BE len][JSON] frames from stdin
let stdin = FileHandle.standardInput
func readN(_ n: Int) -> Data? {
  var buf = Data()
  while buf.count < n {
    let chunk = stdin.readData(ofLength: n - buf.count)
    if chunk.isEmpty { return nil }
    buf.append(chunk)
  }
  return buf
}
log("rp-input-inject: ready (display \(Int(mainBounds.size.width))x\(Int(mainBounds.size.height)))")
while let hdr = readN(4) {
  let len = hdr.withUnsafeBytes { Int($0.load(as: UInt32.self).bigEndian) }
  if len == 0 || len > 1 << 20 { break }
  guard let body = readN(len),
        let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { break }
  handle(obj)
}
