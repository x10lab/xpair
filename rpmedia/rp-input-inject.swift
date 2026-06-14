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
func injectText(_ s: String) {
  for ch in s {
    let u = Array(String(ch).utf16)
    let d = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
    d?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u); d?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
    up?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u); up?.post(tap: .cghidEventTap)
  }
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
