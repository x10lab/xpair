# rpmedia — Native H.264 encode (screen-sharing performance path)

A media module for upgrading screen sharing from JPEG-over-WS to **H.264 (inter-frame) HW encode**.
To respect cross-platform client (Win/Linux) constraints, **decoding is done via webview WebCodecs** (Chromium, all OSes),
and **only encoding runs on the host (macOS) VideoToolbox**.

## Status (2026-06-15)

**G002 viability proven** — `vt-encode-spike.swift` demonstrates that it encodes a capture frame (3024×1964)
to VideoToolbox HW H.264 and produces Annex-B NAL that WebCodecs consumes directly.

Evidence (`swiftc -O vt-encode-spike.swift -o enc && ./enc <png> out.h264`):
```
encoded 3024x1964 -> 166225 bytes Annex-B H.264
NAL types in order: [7, 8, 6, 5]   (7=SPS, 8=PPS, 6=SEI, 5=IDR)
hex head: 00 00 00 01 27 42 00 33 ...   (start code + SPS, profile 0x42=Baseline)
```
- Keyframe 166KB vs JPEG q60 452KB for the same frame → **2.7x↓** (P-frames expected to be tens of times smaller).
- `kVTCompressionPropertyKey_RealTime`, `AllowFrameReordering=false` (no B-frames, 1-in-1-out),
  `ProfileLevel=Baseline_AutoLevel` (WebCodecs compatible), `MaxKeyFrameInterval=60`, HW forced.

## Encoder path decision

| Candidate | Verdict |
|------|------|
| ffmpeg `h264_videotoolbox` pipe | **Rejected** — ffmpeg on this machine is broken due to a missing libx265 dylib + host runtime dependency (unsuitable for turnkey) |
| objc2-video-toolbox (Rust native) | Feasible but causes an explosion of unsafe code, deferred |
| **Swift VideoToolbox** (`swiftc` 6.3.2) | **Adopted** — the VT API is first-class, proven |

## Integration architecture (next chunk — G003)

**Transport must be webrtc-rs (UDP/RTP).** TCP/WebSocket must not be used because head-of-line blocking would
stall screen sharing on a single lost packet (user hard requirement). The encoder (Swift VT) emits the
same NAL regardless of transport, and webrtc-rs packetizes it into RTP. Static linking of Swift↔Rust is avoided
(an independent helper `rp-vt-encode` process pipe, deny-clean).

```
screen serve-webrtc (tokio, --features webrtc):
  xcap capture (RGBA) ──swizzle→ BGRA ──stdin──▶ rp-vt-encode (persistent VTCompressionSession)
                                                    │ inter-frame P/IDR
  webrtc-rs ◀── length-prefixed Annex-B NAL ──stdout┘
    H264 packetizer(FU-A) → TrackLocalStaticRTP::write_rtp → SRTP/DTLS → UDP/ICE(host-only)
        │  (SDP/ICE signaling runs over the existing /api/screen bridge on top of ssh)
        ▼
  webview remote-desktop.js:
    RTCPeerConnection (Chromium native WebRTC — identical on macOS/Win/Linux, cross-platform)
      ontrack → <video> render. (No manual WebCodecs decode needed — the browser WebRTC decodes H264)
```

Because the browser RTCPeerConnection handles decoding, the client needs none of NSView/Metal/WebCodecs and is
identical on every OS — satisfying the cross-platform constraint. Transport is UDP, so there is no HoL.

### Remaining work (checklist)
- [x] `rp-vt-encode.swift`: streaming helper (stdin BGRA→stdout length-prefixed Annex-B), persistent-session P-frames. ✓
- [ ] webrtc-rs viability: `cargo run --example webrtc_selftest --features webrtc` PASS (H264 offer). ← in progress
- [ ] `serve_webrtc.rs`: capture→swizzle→encoder stdin, stdout NAL→H264 packetizer→write_rtp.
      The capture/swizzle/NAL-reader logic is verified (recovered from the old serve_h264). tokio runtime.
- [ ] Signaling: bridge `/api/screen/signal/:token` (SDP/ICE relay), webview RTCPeerConnection.
- [ ] `main.rs` `serve-webrtc` subcommand (cfg feature webrtc).
- [ ] `remotepair-ext`: v2 mode with RTCPeerConnection + <video>. ssh -L handles signaling only (media is UDP).
- [ ] Launch RemotePair.app via computer-use to confirm H.264/webrtc rendering + measure static-frame bandwidth.
- [ ] Keyframe-on-connect (PLI/force IDR), deny licenses (verify webrtc transitive MIT/Apache).

### Verification environment notes (G001 harness)
- Sidecar Screen Recording granted (the release binary captures successfully).
- Built IDE: `remotepair-ide/VSCode-darwin-arm64/RemotePair.app` (not the installed copy → computer-use
  request_access requires bundle id `com.x10lab.remotepair-ide`, or registering with LaunchServices via `open` first).
- The IDE is computer-use tier "click" (no typing) → opening Remote Desktop relies on activity-bar clicks.
- Local self-loopback: REMOTE_HOST=gh-mac-m1 (remote), ssh localhost needs known_hosts to be supplemented.
  For local verification, the simplest debug path connects the webview directly to ws://127.0.0.1:<port>.

## License
Swift/VideoToolbox = Apple EULA (system framework, no linking obligation). The helper is a separate process, so it
does not conflict with remote-pair's Apache-2.0. Unrelated to AGPL.
