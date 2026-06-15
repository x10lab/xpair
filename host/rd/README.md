# remotepair-rs

RemotePair의 네이티브 화면공유(remote desktop) 엔진. `remote-pair`(메인)·`remotepair-ide`(IDE)와
형제 레포. 성능을 위해 Rust/Swift 네이티브로 구현하며 IDE 화면공유 탭에 H.264/WebRTC로 스트림한다.

## 구성
- `screen/` — Rust 사이드카. 캡처 + webrtc-rs(UDP/RTP) 전송. 서브커맨드:
  - `serve` — v1a: WebSocket JPEG (프레임스킵 + --scale). 레거시/폴백.
  - `serve-webrtc` — v1b: H.264/WebRTC. 시그널링 WS + webrtc-rs PeerConnection(UDP),
    TrackLocalStaticSample(H264). `--features webrtc` 빌드.
- `rpmedia/` — Swift VideoToolbox 인코더 + 캡처.
  - `rp-screencap.swift` — ScreenCaptureKit 캡처 + VT H.264 (IOSurface 제로카피, 권장).
  - `rp-vt-encode.swift` — stdin(BGRA)→stdout(NAL) 스트리밍 인코더(파이프 방식).
  - `vt-encode-spike.swift` — viability 스파이크.
  - `webrtc-test.html` — 브라우저 RTCPeerConnection 뷰어(웹뷰 포팅 레퍼런스).

## 상태 (2026-06-15)
- H.264/WebRTC E2E 동작 검증됨(playwright): 캡처→VT H.264→webrtc-rs UDP→브라우저 <video>.
- **serve-webrtc 캡처를 SCK(rp-screencap)로 전환** — xcap 풀그랩+raw파이프(~178MB/s)+swizzle
  제거, IOSurface 제로카피. rp-screencap 단독 검증: SCK 캡처+VT, IDR 36KB/P프레임 평균 2.2KB.
  (이전 xcap 경로는 릴리스 디코드 20fps 캡이었음.)
- 클라이언트는 브라우저 네이티브 WebRTC → 크로스플랫폼(mac/win/linux) 디코드.
- `RP_SCREENCAP` 환경변수로 헬퍼 경로 지정(기본 `~/.remote-pair/bin/rp-screencap` 또는 PATH).

## 라이선스
Apache-2.0. AGPL 무혼입(`screen/deny.toml`). VideoToolbox/SCK = Apple EULA(시스템).
