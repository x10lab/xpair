// rp-vt-encode — streaming VideoToolbox H.264 encoder helper.
//
// Reads raw BGRA frames from stdin (W*H*4 bytes each, back-to-back) and writes
// one length-prefixed Annex-B H.264 access unit per frame to stdout:
//     [4-byte big-endian length][Annex-B NAL bytes...]
// A persistent VTCompressionSession gives inter-frame (P-frame) compression, so
// a static screen produces tiny P-frames after the first IDR.
//
// Usage: rp-vt-encode <width> <height> <fps> <bitrate_bps>
// arm's-length helper (separate process) — keeps the Rust sidecar deny-clean and
// avoids Swift<->Rust static linking. See README.md.
import Foundation
import VideoToolbox
import CoreMedia
import CoreVideo

func die(_ m: String) -> Never { FileHandle.standardError.write((m+"\n").data(using:.utf8)!); exit(1) }

let a = CommandLine.arguments
guard a.count >= 5, let W = Int(a[1]), let H = Int(a[2]), let FPS = Int32(a[3]), let BR = Int(a[4]) else {
  die("usage: rp-vt-encode <width> <height> <fps> <bitrate_bps>")
}
let frameBytes = W * H * 4
let stdoutFH = FileHandle.standardOutput
let startCode = Data([0,0,0,1])

// --- output: accumulate one access unit, then length-prefix + write atomically ---
var au = Data()

func appendParamSets(_ fmt: CMFormatDescription) {
  var count = 0
  CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
  for i in 0..<count {
    var p: UnsafePointer<UInt8>? = nil; var s = 0
    if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &p, parameterSetSizeOut: &s, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let pp = p {
      au.append(startCode); au.append(UnsafeBufferPointer(start: pp, count: s))
    }
  }
}

func appendAVCC(_ bb: CMBlockBuffer) {
  var total = 0; var dp: UnsafeMutablePointer<Int8>? = nil
  guard CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &total, dataPointerOut: &dp) == noErr, let base = dp else { return }
  var off = 0
  base.withMemoryRebound(to: UInt8.self, capacity: total) { u8 in
    while off + 4 <= total {
      var n: UInt32 = 0; memcpy(&n, base + off, 4); n = UInt32(bigEndian: n); off += 4
      if off + Int(n) > total { break }
      au.append(startCode); au.append(UnsafeBufferPointer(start: u8 + off, count: Int(n)))
      off += Int(n)
    }
  }
}

let cb: VTCompressionOutputCallback = { _, _, status, _, sample in
  guard status == noErr, let sample = sample, CMSampleBufferDataIsReady(sample) else { return }
  au.removeAll(keepingCapacity: true)
  var keyframe = true
  if let arr = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false), CFArrayGetCount(arr) > 0 {
    let d = unsafeBitCast(CFArrayGetValueAtIndex(arr, 0), to: CFDictionary.self)
    if let notSync = (d as NSDictionary)[kCMSampleAttachmentKey_NotSync as String] as? Bool { keyframe = !notSync }
  }
  if keyframe, let fmt = CMSampleBufferGetFormatDescription(sample) { appendParamSets(fmt) }
  if let bb = CMSampleBufferGetDataBuffer(sample) { appendAVCC(bb) }
  var len = UInt32(au.count).bigEndian
  var hdr = Data(bytes: &len, count: 4)
  hdr.append(au)
  stdoutFH.write(hdr)
}

// --- pixel buffer (reused) ---
var pbOpt: CVPixelBuffer?
CVPixelBufferCreate(kCFAllocatorDefault, W, H, kCVPixelFormatType_32BGRA,
  [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &pbOpt)
guard let pb = pbOpt else { die("CVPixelBufferCreate failed") }

// --- session ---
var sOpt: VTCompressionSession?
let st = VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(W), height: Int32(H),
  codecType: kCMVideoCodecType_H264,
  encoderSpecification: [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true] as CFDictionary,
  imageBufferAttributes: nil, compressedDataAllocator: nil, outputCallback: cb, refcon: nil, compressionSessionOut: &sOpt)
guard st == noErr, let sess = sOpt else { die("VTCompressionSessionCreate failed: \(st)") }
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_AutoLevel)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: 120 as CFNumber)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: BR as CFNumber)
VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: FPS as CFNumber)
VTCompressionSessionPrepareToEncodeFrames(sess)

// --- read raw BGRA frames from stdin, encode each ---
let stdinFH = FileHandle.standardInput
func readFull(_ n: Int) -> Data? {
  var buf = Data(); buf.reserveCapacity(n)
  while buf.count < n {
    let chunk = stdinFH.readData(ofLength: n - buf.count)
    if chunk.isEmpty { return buf.isEmpty ? nil : nil } // EOF
    buf.append(chunk)
  }
  return buf
}

var pts = CMTime(value: 0, timescale: FPS)
let dur = CMTime(value: 1, timescale: FPS)
while let frame = readFull(frameBytes) {
  CVPixelBufferLockBaseAddress(pb, [])
  if let dst = CVPixelBufferGetBaseAddress(pb) {
    let rowDst = CVPixelBufferGetBytesPerRow(pb), rowSrc = W * 4
    frame.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      let src = raw.baseAddress!
      if rowDst == rowSrc { memcpy(dst, src, frameBytes) }
      else { for y in 0..<H { memcpy(dst + y*rowDst, src + y*rowSrc, rowSrc) } }
    }
  }
  CVPixelBufferUnlockBaseAddress(pb, [])
  VTCompressionSessionEncodeFrame(sess, imageBuffer: pb, presentationTimeStamp: pts, duration: dur, frameProperties: nil, sourceFrameRefcon: nil, infoFlagsOut: nil)
  pts = CMTimeAdd(pts, dur)
}
VTCompressionSessionCompleteFrames(sess, untilPresentationTimeStamp: .invalid)
