import Foundation; import ApplicationServices
let pid=Int32(CommandLine.arguments[1])!; let app=AXUIElementCreateApplication(pid)
func find(_ e:AXUIElement,_ d:Int)->AXUIElement?{if d>14{return nil};var r:CFTypeRef?;AXUIElementCopyAttributeValue(e,kAXRoleAttribute as CFString,&r);if (r as? String)=="AXTextArea"{return e};var k:CFTypeRef?;if AXUIElementCopyAttributeValue(e,kAXChildrenAttribute as CFString,&k) == .success,let a=k as? [AXUIElement]{for c in a{if let f=find(c,d+1){return f}}};return nil}
if let ta=find(app,0){var v:CFTypeRef?;AXUIElementCopyAttributeValue(ta,kAXValueAttribute as CFString,&v);print("READBACK:[\(v as? String ?? "")]")}
