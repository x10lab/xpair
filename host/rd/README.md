# remotepair-rs

RemotePair's native screen-sharing (remote desktop) engine. A sibling repo to
`remote-pair` (main) and `remotepair-ide` (IDE). Implemented in native Rust/Swift for
performance, it streams to the IDE's screen-sharing tab via H.264/WebRTC.

## Components
- `screen/` — Rust sidecar. Capture + webrtc-rs (UDP/RTP) transport. Subcommands:
  - `serve` — v1a: WebSocket JPEG (frame-skip + --scale). Legacy/fallback.
  - `serve-webrtc` — v1b: H.264/WebRTC. Signaling WS + webrtc-rs PeerConnection (UDP),
    TrackLocalStaticSample (H264). Built with `--features webrtc`.
- `rpmedia/` — Swift VideoToolbox encoder + capture.
  - `rp-screencap.swift` — ScreenCaptureKit capture + VT H.264 (IOSurface zero-copy, recommended).
  - `rp-vt-encode.swift` — stdin(BGRA)→stdout(NAL) streaming encoder (pipe-based).
  - `vt-encode-spike.swift` — viability spike.
  - `webrtc-test.html` — browser RTCPeerConnection viewer (webview porting reference).

## Status (2026-06-15)
- H.264/WebRTC E2E operation verified (playwright): capture→VT H.264→webrtc-rs UDP→browser <video>.
- **serve-webrtc capture switched to SCK (rp-screencap)** — removed xcap full-grab + raw pipe (~178MB/s) + swizzle,
  IOSurface zero-copy. rp-screencap standalone verification: SCK capture + VT, IDR 36KB / P-frame avg 2.2KB.
  (The previous xcap path was capped at 20fps for release decode.)
- The client uses the browser's native WebRTC → cross-platform (mac/win/linux) decode.
- Specify the helper path via the `RP_SCREENCAP` environment variable (default `~/.remote-pair/bin/rp-screencap` or PATH).

## License
Apache-2.0. No AGPL mixing (`screen/deny.toml`). VideoToolbox/SCK = Apple EULA (system).
