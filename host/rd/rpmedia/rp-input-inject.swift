// rp-input-inject — v2 remote-input host helper (plan Step 1).
// Reads length-prefixed JSON commands from stdin and injects them as native
// CGEvents. Spawned once per PeerConnection by serve_webrtc.rs; the Rust side
// feeds DataChannel messages (rp-ctl / rp-move) into this helper's stdin.
//
// Wire format: [4-byte BE len][JSON]  per command. JSON shapes:
//   {"t":"m","seq":N,"rx":0..1,"ry":0..1,"btn":"l"|"r"}   move / drag when btn is present
//   {"t":"d","seq":N,"rx":0..1,"ry":0..1,"btn":"l"|"r"}   mouse down
//   {"t":"u","seq":N,"rx":0..1,"ry":0..1,"btn":"l"|"r"}   mouse up
//   {"t":"c","seq":N,"rx":0..1,"ry":0..1,"btn":"l"|"r"}   legacy click (move+down+up)
//   {"t":"w","seq":N,"dx":0,"dy":0,"mode":0|1|2}          wheel / trackpad scroll
//   {"t":"k","seq":N,"code":<mac vk>,"flags":<CGEventFlags raw>,"action":"down"|"up"}  key
//   {"t":"x","seq":N,"s":"composed text"}                 text via Unicode (Korean-safe)
// Echoes one line per command to stderr: RPIN seq=<N> t=<t> ...  (for the B5 cross-check).
// Needs Accessibility (TCC). Korean text uses keyboardSetUnicodeString (layout-independent).
import Foundation
import CoreGraphics
import ApplicationServices

let src = CGEventSource(stateID: .hidSystemState)
let err = FileHandle.standardError
func log(_ s: String) {
  if let data = (s + "\n").data(using: .utf8) {
    err.write(data)
  }
}
// Cross-process CGEvent delivery to OTHER apps requires THIS binary to be
// Accessibility-trusted. (A same-process CGEventTap can capture posted events
// even when untrusted — which is why earlier tap-based tests gave false pass.)
let axTrusted = AXIsProcessTrusted()
log("rp-input-inject: AXIsProcessTrusted=\(axTrusted)")

func activeDisplayIDs() -> [CGDirectDisplayID] {
  var count: UInt32 = 0
  guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
    return []
  }
  var displays = Array(repeating: CGDirectDisplayID(0), count: Int(count))
  guard CGGetActiveDisplayList(count, &displays, &count) == .success else {
    return []
  }
  return Array(displays.prefix(Int(count))).filter { $0 != 0 }
}

func configuredDisplayID() -> CGDirectDisplayID? {
  guard let raw = ProcessInfo.processInfo.environment["RP_CAPTURE_DISPLAY_ID"],
        let value = UInt32(raw),
        value != 0 else {
    return nil
  }
  return CGDirectDisplayID(value)
}

// CaptureEngine and rp-screencap capture the first display exposed by SCK. Use
// the first active CoreGraphics display for the same default policy, with an env
// override for tests/future display selection.
let targetDisplayID = configuredDisplayID() ?? activeDisplayIDs().first ?? CGMainDisplayID()
let targetBounds = CGDisplayBounds(targetDisplayID)

func point(_ rx: Double, _ ry: Double) -> CGPoint {
  CGPoint(x: targetBounds.origin.x + rx * targetBounds.size.width,
          y: targetBounds.origin.y + ry * targetBounds.size.height)
}

func mouseButton(_ btn: String?) -> CGMouseButton {
  btn == "r" ? .right : .left
}

func injectMove(_ p: CGPoint, dragging btn: String? = nil) {
  let button = mouseButton(btn)
  let eventType: CGEventType
  if btn == "r" {
    eventType = .rightMouseDragged
  } else if btn == "l" {
    eventType = .leftMouseDragged
  } else {
    eventType = .mouseMoved
  }
  CGEvent(mouseEventSource: src, mouseType: eventType, mouseCursorPosition: p, mouseButton: button)?.post(tap: .cghidEventTap)
}

func injectMouse(_ p: CGPoint, down: Bool, right: Bool) {
  injectMove(p)
  let eventType: CGEventType
  if right {
    eventType = down ? .rightMouseDown : .rightMouseUp
  } else {
    eventType = down ? .leftMouseDown : .leftMouseUp
  }
  let button: CGMouseButton = right ? .right : .left
  CGEvent(mouseEventSource: src, mouseType: eventType, mouseCursorPosition: p, mouseButton: button)?.post(tap: .cghidEventTap)
}

func injectClick(_ p: CGPoint, right: Bool) {
  injectMove(p)
  injectMouse(p, down: true, right: right)
  injectMouse(p, down: false, right: right)
}

func wheelScale(_ mode: Int) -> Double {
  switch mode {
  case 1: return 40.0
  case 2: return max(1.0, Double(targetBounds.height))
  default: return 1.0
  }
}

func clampWheel(_ value: Double) -> Int32 {
  let bounded = max(-32767.0, min(32767.0, value.rounded()))
  return Int32(bounded)
}

func injectWheel(dx: Double, dy: Double, mode: Int) {
  let scale = wheelScale(mode)
  let wheelX = clampWheel(-dx * scale)
  let wheelY = clampWheel(-dy * scale)
  CGEvent(
    scrollWheelEvent2Source: src,
    units: .pixel,
    wheelCount: 2,
    wheel1: wheelY,
    wheel2: wheelX,
    wheel3: 0
  )?.post(tap: .cghidEventTap)
}
func axDeleteLast() {
  guard let el = textTargetElement() else { return }
  var v: CFTypeRef?
  if AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &v) == .success,
     var s = v as? String, !s.isEmpty {
    s.removeLast()
    AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, s as CFString)
  }
}

let modifierKeyCodes: Set<Int> = [54, 55, 56, 58, 59, 60, 61, 62]

func postKeyEvent(_ code: Int, down: Bool, flags: UInt64) {
  guard code >= 0, code <= Int(UInt16.max),
        let ev = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(code), keyDown: down) else {
    log("injectKey: invalid key code \(code)")
    return
  }
  ev.flags = CGEventFlags(rawValue: flags)
  ev.post(tap: .cghidEventTap)
}

func systemEventsKey(_ code: Int, _ flags: UInt64) {
  var mods: [String] = []
  if flags & 0x100000 != 0 { mods.append("command down") }
  if flags & 0x020000 != 0 { mods.append("shift down") }
  if flags & 0x040000 != 0 { mods.append("control down") }
  if flags & 0x080000 != 0 { mods.append("option down") }
  let using = mods.isEmpty ? "" : " using {\(mods.joined(separator: ", "))}"
  let script = "tell application \"System Events\" to key code \(code)\(using)"
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  p.arguments = ["-e", script]
  p.standardError = FileHandle.nullDevice
  try? p.run()
  p.waitUntilExit()
}

func injectKey(_ code: Int, _ flags: UInt64, _ action: String) {
  if action == "up" {
    postKeyEvent(code, down: false, flags: flags)
    return
  }

  // Text-producing keys with no modifier → AX text path (reliable + targetable),
  // matching the AX text injection used for typed characters:
  //   Return(36)→"\n", Tab(48)→"\t", Delete/Backspace(51)→delete last char.
  if flags == 0 && action == "down" {
    switch code {
    case 36: injectText("\n"); return
    case 48: injectText("\t"); return
    case 51: axDeleteLast(); return
    default: break
    }
  }

  if modifierKeyCodes.contains(code) {
    postKeyEvent(code, down: true, flags: flags)
    return
  }

  // True shortcuts (cmd/ctrl/... + key) and other keys → System Events `key code`.
  // CGEvent keyboard does NOT reach apps (verified); System Events does. Targets
  // the FRONTMOST app (a real host's focused app); layout-independent.
  if action == "down" {
    systemEventsKey(code, flags)
  }
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
  if AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute as CFString, &f) == .success,
     let element = f {
    return unsafeBitCast(element, to: AXUIElement.self)
  }
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

func number(_ value: Any?) -> Double? {
  if let value = value as? Double { return value }
  if let value = value as? Int { return Double(value) }
  if let value = value as? NSNumber { return value.doubleValue }
  return nil
}

func integer(_ value: Any?) -> Int? {
  if let value = value as? Int { return value }
  if let value = value as? NSNumber { return value.intValue }
  return nil
}

func handle(_ j: [String: Any]) {
  let t = j["t"] as? String ?? "?"
  let seq = integer(j["seq"]) ?? -1
  switch t {
  case "m":
    if let rx = number(j["rx"]), let ry = number(j["ry"]) {
      injectMove(point(rx, ry), dragging: j["btn"] as? String)
    }
  case "d":
    if let rx = number(j["rx"]), let ry = number(j["ry"]) {
      injectMouse(point(rx, ry), down: true, right: (j["btn"] as? String) == "r")
    }
  case "u":
    if let rx = number(j["rx"]), let ry = number(j["ry"]) {
      injectMouse(point(rx, ry), down: false, right: (j["btn"] as? String) == "r")
    }
  case "c":
    if let rx = number(j["rx"]), let ry = number(j["ry"]) {
      injectClick(point(rx, ry), right: (j["btn"] as? String) == "r")
    }
  case "w":
    if let dx = number(j["dx"]), let dy = number(j["dy"]) {
      injectWheel(dx: dx, dy: dy, mode: integer(j["mode"]) ?? 0)
    }
  case "k":
    if let code = integer(j["code"]) {
      let flags = UInt64(integer(j["flags"]) ?? 0)
      injectKey(code, flags, j["action"] as? String ?? "down")
    }
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
func emitInputStatus(kind: String, reason: String? = nil) {
  var payload: [String: Any] = [
    "kind": kind,
    "axTrusted": axTrusted,
    "displayId": UInt32(targetDisplayID),
    "width": Double(targetBounds.width),
    "height": Double(targetBounds.height),
  ]
  if let reason = reason {
    payload["reason"] = reason
  }
  guard let data = try? JSONSerialization.data(withJSONObject: payload),
        let json = String(data: data, encoding: .utf8) else {
    return
  }
  log("RPINPUT \(json)")
}

if axTrusted {
  emitInputStatus(kind: "ready")
} else {
  emitInputStatus(
    kind: "error",
    reason: "Accessibility permission is not granted to rp-input-inject/XpairHost.app"
  )
}
log("rp-input-inject: ready (display \(Int(targetBounds.size.width))x\(Int(targetBounds.size.height)) id=\(UInt32(targetDisplayID)))")
while let hdr = readN(4) {
  let len = hdr.withUnsafeBytes { Int($0.load(as: UInt32.self).bigEndian) }
  if len == 0 || len > 1 << 20 { break }
  guard let body = readN(len),
        let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { break }
  handle(obj)
}
