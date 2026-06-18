// CaptureEngine.swift — in-app ScreenCaptureKit capture + VideoToolbox H.264 encode.
//
// WHY THIS EXISTS: macOS Screen Recording (TCC) permission is granted PER BINARY.
// The standalone `rp-screencap` helper (host/rd/rpmedia/rp-screencap.swift) is a
// separate executable, so the RemotePairHost.app Screen Recording grant does NOT
// cover it — ScreenCaptureKit returns SCStreamErrorDomain Code=-3801 ("user
// declined TCCs"), the helper exits, and the WebRTC stream is BLACK on a freshly
// installed host. Running the SAME SCK+VT pipeline INSIDE this app process makes
// capture use the APP's grant (and the app's GUI/Aqua session), so it works.
//
// This is a faithful lift of rp-screencap.swift's exact SCK config, exact VT
// settings, and exact Annex-B framing ([4B BE len][AU]). The ONLY differences:
//   1) instead of FileHandle.standardOutput.write, each framed AU is handed to a
//      `sink` closure (ScreenServer pipes it to the sidecar's stdin), and
//   2) it does NOT block the thread (no RunLoop.main.run()/sem.wait()) — the app
//      already runs a runloop; SCK's sample handler fires on its own queue. start()
//      kicks off capture and returns; stop() tears down cleanly so the next session
//      can start fresh.
import Foundation
import ScreenCaptureKit
import VideoToolbox
import CoreMedia
import CoreVideo

final class CaptureEngine {
    private let startCode = Data([0, 0, 0, 1])

    // VT/SCK state (all touched on the SCK sample queue once capture is running).
    private var session: VTCompressionSession?
    private var stream: SCStream?
    private var output: StreamOutput?
    private var au = Data()
    private var fps = 30
    private var bitrate = 4_000_000
    private var sink: ((Data) -> Void)?

    /// Advisory: true while capture is running (a viewer is connected → the sidecar sent capture:start).
    /// Read cross-thread only for the menu-bar status line, so a one-tick-stale value is acceptable.
    var isCapturing: Bool { stream != nil }

    // Keyframe forcing. A 76KB IDR can lose a packet on a lossy link → undecodable;
    // with no further keyframe the remote viewer stays BLACK forever. We force a
    // keyframe: (1) on the first frame after start, (2) periodically (~every 1s), and
    // (3) on demand when the client signals PictureLossIndication/FIR via the sidecar.
    // `forceKeyframeFlag` is set from ScreenServer's control-reader thread but consumed
    // on SCK's sample queue, so it is guarded by `keyframeLock`. `frameCount` is only
    // touched on the sample queue (and reset under the lock in start()/stop()).
    private let keyframeLock = NSLock()
    private var forceKeyframeFlag = false
    private var frameCount: UInt64 = 0
    private let periodicKeyframeInterval: UInt64 = 30 // ~1s @ 30fps

    /// Start capturing the first display and encoding to H.264. `sink` receives one
    /// `[4B BE len][Annex-B AU]` Data per encoded frame, on SCK's sample queue (the
    /// caller must serialize any shared writes). Idempotent: a no-op if already running.
    func start(fps: Int = 30, bitrate: Int = 4_000_000, scale: Double = 1.0, sink: @escaping (Data) -> Void) {
        if stream != nil { return } // already running
        self.fps = fps
        self.bitrate = bitrate
        self.sink = sink
        // Fresh per-session keyframe state: force a keyframe on the first encoded frame.
        keyframeLock.lock()
        frameCount = 0
        forceKeyframeFlag = false
        keyframeLock.unlock()

        SCShareableContent.getWithCompletionHandler { [weak self] content, err in
            guard let self = self else { return }
            guard let content = content, let display = content.displays.first else {
                log(.error, "CAPTURE: no display from SCShareableContent: \(String(describing: err))")
                return
            }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let cfg = SCStreamConfiguration()
            cfg.width = max(2, Int(Double(display.width) * scale)) & ~1
            cfg.height = max(2, Int(Double(display.height) * scale)) & ~1
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
            cfg.pixelFormat = kCVPixelFormatType_32BGRA
            cfg.queueDepth = 5
            cfg.showsCursor = true

            let out = StreamOutput(engine: self)
            let s = SCStream(filter: filter, configuration: cfg, delegate: nil)
            do {
                try s.addStreamOutput(out, type: .screen, sampleHandlerQueue: DispatchQueue(label: "rp.sck"))
                s.startCapture { e in
                    if let e = e {
                        log(.error, "CAPTURE: startCapture failed (Screen Recording grant?): \(e)")
                        return
                    }
                    log("CAPTURE: SCK \(cfg.width)x\(cfg.height) @\(fps)fps capturing")
                }
            } catch {
                log(.error, "CAPTURE: addStreamOutput/start failed: \(error)")
                return
            }
            self.output = out
            self.stream = s
        }
    }

    /// Stop capture, invalidate the VT session, and release state so start() can be
    /// called again cleanly for the next session. Idempotent.
    func stop() {
        if let s = stream {
            s.stopCapture { _ in }
        }
        stream = nil
        output = nil
        if let sess = session {
            VTCompressionSessionInvalidate(sess)
        }
        session = nil
        au.removeAll(keepingCapacity: false)
        sink = nil
        keyframeLock.lock()
        frameCount = 0
        forceKeyframeFlag = false
        keyframeLock.unlock()
    }

    /// Request that the next encoded frame be a keyframe (IDR). Called from another
    /// thread (ScreenServer's control reader) when the client signals picture loss
    /// (RTCP PLI/FIR). Thread-safe: guarded by `keyframeLock`. The flag is consumed
    /// and cleared on the SCK sample queue in the encode path.
    func requestKeyframe() {
        keyframeLock.lock()
        forceKeyframeFlag = true
        keyframeLock.unlock()
    }

    // ---- VT encoder (created once we know dimensions) ----
    private func ensureEncoder(_ w: Int, _ h: Int) {
        if session != nil { return }
        var s: VTCompressionSession?
        let st = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault, width: Int32(w), height: Int32(h),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true] as CFDictionary,
            imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: { refcon, _, status, _, sample in
                guard let refcon = refcon else { return }
                let engine = Unmanaged<CaptureEngine>.fromOpaque(refcon).takeUnretainedValue()
                engine.encOutput(status, sample)
            },
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &s)
        guard st == noErr, let sess = s else {
            log(.error, "CAPTURE: VTCompressionSessionCreate failed: \(st)")
            return
        }
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_AutoLevel)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: (self.fps * 2) as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: self.bitrate as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: self.fps as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(sess)
        session = sess
    }

    private func appendParamSets(_ fmt: CMFormatDescription) {
        var count = 0
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
        for i in 0..<count {
            var p: UnsafePointer<UInt8>? = nil; var s = 0
            if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &p, parameterSetSizeOut: &s, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let pp = p {
                au.append(startCode); au.append(UnsafeBufferPointer(start: pp, count: s))
            }
        }
    }

    private func appendAVCC(_ bb: CMBlockBuffer) {
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

    /// Decide whether the frame about to be encoded should be forced to a keyframe,
    /// and advance/consume the per-session keyframe state atomically. Runs on the SCK
    /// sample queue; `forceKeyframeFlag` may be set concurrently by requestKeyframe().
    private func shouldForceKeyframe() -> Bool {
        keyframeLock.lock()
        defer { keyframeLock.unlock() }
        let isFirst = frameCount == 0
        let periodic = frameCount % periodicKeyframeInterval == 0
        let onDemand = forceKeyframeFlag
        forceKeyframeFlag = false // consume the on-demand request
        frameCount &+= 1
        return isFirst || periodic || onDemand
    }

    private func encOutput(_ status: OSStatus, _ sample: CMSampleBuffer?) {
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
        var hdr = Data(bytes: &len, count: 4); hdr.append(au)
        sink?(hdr)
    }

    // ---- SCK stream output: IOSurface CVPixelBuffer -> VT (zero-copy) ----
    private final class StreamOutput: NSObject, SCStreamOutput {
        private unowned let engine: CaptureEngine
        init(engine: CaptureEngine) { self.engine = engine }

        func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
            guard type == .screen, CMSampleBufferIsValid(sample) else { return }
            // Skip frames SCK marks as idle/blank (no on-screen change) — frame-skip for free.
            if let arr = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
               let info = arr.first, let raw = info[.status] as? Int, let st = SCFrameStatus(rawValue: raw), st != .complete {
                return
            }
            guard let pb = CMSampleBufferGetImageBuffer(sample) else { return }
            let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
            engine.ensureEncoder(w, h)
            guard let sess = engine.session else { return }
            let pts = CMSampleBufferGetPresentationTimeStamp(sample)
            // Force a keyframe on the first/periodic/on-demand (PLI/FIR) frame so a lost
            // IDR packet on a lossy link can recover instead of leaving the viewer black.
            let frameProps: CFDictionary? = engine.shouldForceKeyframe()
                ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary
                : nil
            VTCompressionSessionEncodeFrame(sess, imageBuffer: pb, presentationTimeStamp: pts, duration: .invalid, frameProperties: frameProps, sourceFrameRefcon: nil, infoFlagsOut: nil)
        }
    }
}
