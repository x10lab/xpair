// rp-input-selftest — autoresearch evaluator for native input injection.
//
// Injects mouse/key/Korean-text CGEvents and captures them via a listen-only
// CGEventTap in the same process, asserting the captured events match what was
// injected. Emits JSON to stdout: {"pass":bool,"score":float,"cases":{...}}.
// Needs Accessibility (TCC) permission for THIS binary (CGEventPost + tap).
//
// Iteration 1: bootstrap harness + first injection impl (Unicode-string path for
// text incl. Korean). Later iterations refine the Korean/reachability strategy.
import Foundation
import CoreGraphics
import ApplicationServices

// ---- module under test: injection primitives ----
let src = CGEventSource(stateID: .hidSystemState)

func injectMouseMove(_ x: Double, _ y: Double) {
  CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?.post(tap: .cghidEventTap)
}
func injectKey(_ keycode: CGKeyCode, _ flags: CGEventFlags) {
  let down = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: true)
  down?.flags = flags
  down?.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: false)
  up?.flags = flags
  up?.post(tap: .cghidEventTap)
}
func injectText(_ s: String) {
  // Unicode-string path: one keyDown/up per character carrying the composed
  // Unicode (works for completed Hangul syllables; bypasses IME composition).
  for ch in s {
    let u = Array(String(ch).utf16)
    let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
    down?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u)
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
    up?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u)
    up?.post(tap: .cghidEventTap)
  }
}

// ---- capture via listen-only tap ----
final class Cap {
  var keysText = ""
  var mouses: [CGPoint] = []   // all captured moves (real moves during the test can interleave)
  var keyDowns: [(CGKeyCode, CGEventFlags)] = []
}
let cap = Cap()

let mask: CGEventMask =
  (1 << CGEventType.keyDown.rawValue) |
  (1 << CGEventType.mouseMoved.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .keyDown {
    var len = 0
    var buf = [UniChar](repeating: 0, count: 8)
    event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &len, unicodeString: &buf)
    if len > 0 { cap.keysText += String(utf16CodeUnits: buf, count: len) }
    let kc = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
    cap.keyDowns.append((kc, event.flags))
  } else if type == .mouseMoved {
    cap.mouses.append(event.location)
  }
  return Unmanaged.passRetained(event)
}

guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
        options: .listenOnly, eventsOfInterest: mask, callback: callback, userInfo: nil) else {
  print("{\"pass\":false,\"score\":0,\"error\":\"tapCreate failed — grant Accessibility to this binary\"}")
  exit(1)
}
let runSrc = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runSrc, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// pump the run loop briefly to let injected events flow to the tap
func pump(_ secs: Double) { CFRunLoopRunInMode(.defaultMode, secs, false) }

// ---- run cases ----
injectMouseMove(300, 200); pump(0.15)
injectKey(1, .maskCommand); pump(0.15)            // keycode 1 = 's' -> cmd+s
injectText("hi 안녕하세요 123"); pump(0.5)

// ---- assert ----
var cases: [String: Bool] = [:]
cases["mouse"] = cap.mouses.contains { abs($0.x - 300) <= 2 && abs($0.y - 200) <= 2 }
cases["modifier"] = cap.keyDowns.contains { $0.0 == 1 && $0.1.contains(.maskCommand) }
let want = "hi 안녕하세요 123"
cases["text_ascii"] = cap.keysText.contains("hi")
cases["text_korean"] = cap.keysText.contains("안녕하세요")
let passed = cases.values.allSatisfy { $0 }
let score = Double(cases.values.filter { $0 }.count) / Double(cases.count)

func esc(_ s: String) -> String { s.replacingOccurrences(of: "\"", with: "\\\"") }
let casesJson = cases.map { "\"\($0.key)\":\($0.value)" }.joined(separator: ",")
print("{\"pass\":\(passed),\"score\":\(score),\"cases\":{\(casesJson)},\"captured\":\"\(esc(cap.keysText))\",\"want\":\"\(esc(want))\"}")
exit(passed ? 0 : 1)
