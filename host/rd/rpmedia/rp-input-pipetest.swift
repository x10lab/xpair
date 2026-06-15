// rp-input-pipetest — B5 cross-check: feed framed JSON to rp-input-inject and
// assert the host actually injected matching events (captured via CGEventTap).
// This is the "client-sent vs host-injected" equality check from plan Step 5,
// run headlessly. Needs Accessibility. Usage: rp-input-pipetest /path/to/rp-input-inject
import Foundation
import CoreGraphics

let helper = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/rp-input-inject"

final class Cap { var text = ""; var keyDowns: [(CGKeyCode, CGEventFlags)] = []; var mouses: [CGPoint] = [] }
let cap = Cap()
let mask: CGEventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.mouseMoved.rawValue) | (1 << CGEventType.leftMouseDown.rawValue)
let cb: CGEventTapCallBack = { _, type, ev, _ in
  if type == .keyDown {
    var n = 0; var b = [UniChar](repeating: 0, count: 8)
    ev.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &n, unicodeString: &b)
    if n > 0 { cap.text += String(utf16CodeUnits: b, count: n) }
    cap.keyDowns.append((CGKeyCode(ev.getIntegerValueField(.keyboardEventKeycode)), ev.flags))
  } else if type == .mouseMoved || type == .leftMouseDown { cap.mouses.append(ev.location) }
  return Unmanaged.passRetained(ev)
}
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: cb, userInfo: nil) else {
  print("{\"pass\":false,\"error\":\"tapCreate failed — grant Accessibility\"}"); exit(2)
}
CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// spawn the helper
let proc = Process(); proc.executableURL = URL(fileURLWithPath: helper)
let inPipe = Pipe(); proc.standardInput = inPipe; proc.standardError = FileHandle.nullDevice
do { try proc.run() } catch { print("{\"pass\":false,\"error\":\"spawn helper: \(error)\"}"); exit(2) }

let main = CGDisplayBounds(CGMainDisplayID())
let tx = 300.0, ty = 200.0   // target point
let rx = (tx - main.origin.x) / main.size.width, ry = (ty - main.origin.y) / main.size.height
func send(_ j: [String: Any]) {
  let b = try! JSONSerialization.data(withJSONObject: j)
  var len = UInt32(b.count).bigEndian
  inPipe.fileHandleForWriting.write(Data(bytes: &len, count: 4)); inPipe.fileHandleForWriting.write(b)
}
func pump(_ s: Double) { CFRunLoopRunInMode(.defaultMode, s, false) }

send(["t":"m","seq":1,"rx":rx,"ry":ry]); pump(0.2)
send(["t":"k","seq":2,"code":1,"flags":1048576]); pump(0.2)   // cmd+s
send(["t":"x","seq":3,"s":"안녕rp"]); pump(0.5)
inPipe.fileHandleForWriting.closeFile(); proc.terminate()

var cases: [String: Bool] = [:]
cases["mouse"] = cap.mouses.contains { abs($0.x - tx) <= 2 && abs($0.y - ty) <= 2 }
cases["modifier"] = cap.keyDowns.contains { $0.0 == 1 && $0.1.contains(.maskCommand) }
cases["korean"] = cap.text.contains("안녕rp")
let pass = cases.values.allSatisfy { $0 }
let cj = cases.map { "\"\($0.key)\":\($0.value)" }.joined(separator: ",")
print("{\"pass\":\(pass),\"cases\":{\(cj)},\"captured_text\":\"\(cap.text.replacingOccurrences(of: "\"", with: "'"))\"}")
exit(pass ? 0 : 1)
