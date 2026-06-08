// make-menubar-template.swift — turn a black-on-white cube glyph into a macOS
// menu-bar TEMPLATE image (pure black, alpha taken from darkness) at @1x/@2x sizes.
// Usage: make-menubar-template <src.png> <outDir>
//   writes <outDir>/menubar.png (18px) and <outDir>/menubar@2x.png (36px)
import AppKit
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 3 else { FileHandle.standardError.write("usage: <src.png> <outDir>\n".data(using:.utf8)!); exit(2) }
let srcPath = args[1], outDir = args[2]

guard let nsimg = NSImage(contentsOfFile: srcPath),
      let cg = nsimg.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load \(srcPath)\n".data(using:.utf8)!); exit(1)
}
let w = cg.width, h = cg.height
let cs = CGColorSpaceCreateDeviceRGB()
// 1) draw source into RGBA8 buffer
var buf = [UInt8](repeating: 0, count: w*h*4)
guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
        bytesPerRow: w*4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
ctx.draw(cg, in: CGRect(x:0,y:0,width:w,height:h))
// 2) build template buffer: RGB=0 (black), alpha = 255 - luminance (dark→opaque, white→clear)
var out = [UInt8](repeating: 0, count: w*h*4)
for i in stride(from: 0, to: w*h*4, by: 4) {
  let r = Double(buf[i]), g = Double(buf[i+1]), b = Double(buf[i+2])
  let lum = 0.299*r + 0.587*g + 0.114*b
  let a = UInt8(max(0, min(255, 255.0 - lum)))
  out[i]=0; out[i+1]=0; out[i+2]=0; out[i+3]=a   // premultiplied: black*a = 0
}
guard let tctx = CGContext(data: &out, width: w, height: h, bitsPerComponent: 8,
        bytesPerRow: w*4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let templateFull = tctx.makeImage() else { exit(1) }

func writePNG(_ image: CGImage, _ path: String) -> Bool {
  guard let dest = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { return false }
  return (try? dest.write(to: URL(fileURLWithPath: path))) != nil
}
// 3) scale into target sizes (fit, preserve aspect, transparent padding)
func scaled(_ side: Int) -> CGImage? {
  guard let c = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
          bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
  c.interpolationQuality = .high
  c.clear(CGRect(x:0,y:0,width:side,height:side))
  c.draw(templateFull, in: CGRect(x:0,y:0,width:side,height:side))
  return c.makeImage()
}
var ok = true
if let s1 = scaled(18) { ok = writePNG(s1, "\(outDir)/menubar.png") && ok } else { ok=false }
if let s2 = scaled(36) { ok = writePNG(s2, "\(outDir)/menubar@2x.png") && ok } else { ok=false }
print(ok ? "wrote menubar.png (18) + menubar@2x.png (36)" : "write failed")
exit(ok ? 0 : 1)
