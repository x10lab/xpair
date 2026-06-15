// rp-input-reach — Step 0 (B2) reachability spike.
// Injects Korean+ASCII text into the FRONTMOST app via the validated
// keyboardSetUnicodeString path, then reads back the focused UI element's value
// via Accessibility to prove the synthetic CGEvents actually REACHED the target
// app (not just that we can post them). The known risk: synthetic CGEvent keys
// don't reach some web-UI popups (per RemotePairHost InputServer's measured note).
//
// Usage: rp-input-reach "<text to inject>"   (target app must be frontmost+focused)
// Emits JSON: {"injected":"…","readback":"…","reached":bool}
// Needs Accessibility (TCC) for this binary.
import Foundation
import CoreGraphics
import ApplicationServices

func die(_ m: String) -> Never { FileHandle.standardError.write((m+"\n").data(using:.utf8)!); exit(2) }

let text = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "안녕하세요 hi 123"

guard AXIsProcessTrusted() else {
  print("{\"reached\":false,\"error\":\"Accessibility not granted to this binary\"}"); exit(2)
}
let src = CGEventSource(stateID: .hidSystemState)

// validated text injection path (from rp-input-selftest)
func injectText(_ s: String) {
  for ch in s {
    let u = Array(String(ch).utf16)
    let d = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
    d?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u); d?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
    up?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u); up?.post(tap: .cghidEventTap)
    usleep(8000)
  }
}

// read the focused element's text value from the frontmost app
func readbackFocusedValue() -> String? {
  let sys = AXUIElementCreateSystemWide()
  var focused: CFTypeRef?
  guard AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
        let el = focused else { return nil }
  let elem = el as! AXUIElement
  var val: CFTypeRef?
  if AXUIElementCopyAttributeValue(elem, kAXValueAttribute as CFString, &val) == .success,
     let s = val as? String { return s }
  return nil
}

let before = readbackFocusedValue() ?? ""
injectText(text)
usleep(300000)
let after = readbackFocusedValue() ?? ""

// reached if the focused field now contains the injected text (delta)
let reached = after.contains(text)
func esc(_ s: String) -> String { s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
print("{\"injected\":\"\(esc(text))\",\"readback\":\"\(esc(after))\",\"before\":\"\(esc(before))\",\"reached\":\(reached)}")
exit(reached ? 0 : 1)
