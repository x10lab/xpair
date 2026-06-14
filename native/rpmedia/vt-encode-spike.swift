// VideoToolbox H.264 encode viability spike.
// Reads a PNG, HW-encodes one frame to H.264, writes Annex-B NAL to out path.
// Proves the encoder path works before any Rust/FFI integration.
import Foundation
import VideoToolbox
import CoreMedia
import CoreVideo
import ImageIO
import CoreGraphics

func die(_ m: String) -> Never { FileHandle.standardError.write((m+"\n").data(using:.utf8)!); exit(1) }

let args = CommandLine.arguments
guard args.count >= 3 else { die("usage: enc <in.png> <out.h264>") }
let inPath = args[1], outPath = args[2]

// --- load PNG -> CGImage ---
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: inPath) as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { die("cannot load PNG") }
let w = cg.width, h = cg.height

// --- CGImage -> BGRA CVPixelBuffer ---
var pbOpt: CVPixelBuffer?
let attrs: [String: Any] = [
  kCVPixelBufferCGImageCompatibilityKey as String: true,
  kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
  kCVPixelBufferIOSurfacePropertiesKey as String: [:]
]
CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pbOpt)
guard let pb = pbOpt else { die("CVPixelBufferCreate failed") }
CVPixelBufferLockBaseAddress(pb, [])
let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb), width: w, height: h, bitsPerComponent: 8,
  bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
ctx?.draw(cg, in: CGRect(x:0,y:0,width:w,height:h))
CVPixelBufferUnlockBaseAddress(pb, [])

// --- collected Annex-B output ---
var out = Data()
let startCode = Data([0,0,0,1])

func appendAVCCtoAnnexB(_ bb: CMBlockBuffer) {
  var lenTotal = 0
  var dataPtr: UnsafeMutablePointer<Int8>? = nil
  guard CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &lenTotal, dataPointerOut: &dataPtr) == noErr,
        let base = dataPtr else { return }
  var off = 0
  while off + 4 <= lenTotal {
    var nalLen: UInt32 = 0
    memcpy(&nalLen, base + off, 4)
    nalLen = UInt32(bigEndian: nalLen)
    off += 4
    if off + Int(nalLen) > lenTotal { break }
    out.append(startCode)
    base.withMemoryRebound(to: UInt8.self, capacity: lenTotal) { u8 in
      out.append(UnsafeBufferPointer(start: u8 + off, count: Int(nalLen)))
    }
    off += Int(nalLen)
  }
}

// --- output callback: prepend SPS/PPS (Annex-B) on keyframe, then slice NAL ---
let cb: VTCompressionOutputCallback = { _, _, status, _, sample in
  guard status == noErr, let sample = sample, CMSampleBufferDataIsReady(sample) else { return }
  // keyframe? -> emit SPS/PPS first
  if let attA = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false),
     CFArrayGetCount(attA) > 0 {
    let dict = unsafeBitCast(CFArrayGetValueAtIndex(attA, 0), to: CFDictionary.self)
    let notSync = (dict as NSDictionary)[kCMSampleAttachmentKey_NotSync as String] as? Bool ?? false
    if !notSync, let fmt = CMSampleBufferGetFormatDescription(sample) {
      var count = 0
      CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
      for i in 0..<count {
        var psPtr: UnsafePointer<UInt8>? = nil; var psSize = 0
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &psPtr, parameterSetSizeOut: &psSize, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let p = psPtr {
          out.append(Data([0,0,0,1])); out.append(UnsafeBufferPointer(start: p, count: psSize))
        }
      }
    }
  }
  if let bb = CMSampleBufferGetDataBuffer(sample) { appendAVCCtoAnnexB(bb) }
}

// --- create session, low-latency props ---
var sessOpt: VTCompressionSession?
let specs: [CFString: Any] = [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true]
let st = VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(w), height: Int32(h),
  codecType: kCMVideoCodecType_H264, encoderSpecification: specs as CFDictionary,
  imageBufferAttributes: nil, compressedDataAllocator: nil, outputCallback: cb,
  refcon: nil, compressionSessionOut: &sessOpt)
guard st == noErr, let sess = sessOpt else { die("VTCompressionSessionCreate failed: \(st)") }
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_AutoLevel)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: 60 as CFNumber)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: 4_000_000 as CFNumber)
VTCompressionSessionPrepareToEncodeFrames(sess)

let pts = CMTime(value: 0, timescale: 30)
let est = VTCompressionSessionEncodeFrame(sess, imageBuffer: pb, presentationTimeStamp: pts, duration: .invalid, frameProperties: nil, sourceFrameRefcon: nil, infoFlagsOut: nil)
guard est == noErr else { die("EncodeFrame failed: \(est)") }
VTCompressionSessionCompleteFrames(sess, untilPresentationTimeStamp: .invalid)

try? out.write(to: URL(fileURLWithPath: outPath))
print("encoded \(w)x\(h) -> \(out.count) bytes Annex-B H.264")
