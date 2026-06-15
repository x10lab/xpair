# rpmedia — 네이티브 H.264 인코드 (화면공유 성능 경로)

화면공유를 JPEG-over-WS에서 **H.264(inter-frame) HW 인코드**로 끌어올리기 위한 미디어 모듈.
크로스플랫폼 클라(Win/Linux) 제약을 지키기 위해 **디코드는 웹뷰 WebCodecs**(Chromium, 모든 OS)로,
**인코드만 호스트(macOS) VideoToolbox**로 한다.

## 상태 (2026-06-15)

**G002 viability 증명 완료** — `vt-encode-spike.swift`가 캡쳐 프레임(3024×1964)을 VideoToolbox
HW H.264로 인코드해 WebCodecs가 바로 먹는 Annex-B NAL을 산출함을 실증.

증거 (`swiftc -O vt-encode-spike.swift -o enc && ./enc <png> out.h264`):
```
encoded 3024x1964 -> 166225 bytes Annex-B H.264
NAL types in order: [7, 8, 6, 5]   (7=SPS, 8=PPS, 6=SEI, 5=IDR)
hex head: 00 00 00 01 27 42 00 33 ...   (start code + SPS, profile 0x42=Baseline)
```
- 키프레임 166KB vs 같은 프레임 JPEG q60 452KB → **2.7x↓** (P프레임은 수십배↓ 예상).
- `kVTCompressionPropertyKey_RealTime`, `AllowFrameReordering=false`(B프레임 금지, 1-in-1-out),
  `ProfileLevel=Baseline_AutoLevel`(WebCodecs 호환), `MaxKeyFrameInterval=60`, HW 강제.

## 인코더 경로 결정

| 후보 | 판정 |
|------|------|
| ffmpeg `h264_videotoolbox` 파이프 | **기각** — 이 머신 ffmpeg가 libx265 dylib 누락으로 깨짐 + 호스트 런타임 의존(turnkey 부적합) |
| objc2-video-toolbox (Rust 네이티브) | 가능하나 unsafe 폭증, 보류 |
| **Swift VideoToolbox** (`swiftc` 6.3.2) | **채택** — VT API가 일급, 증명 완료 |

## 통합 아키텍처 (다음 청크 — G003)

**전송은 webrtc-rs(UDP/RTP) 필수.** TCP/WebSocket은 head-of-line blocking으로 화면공유가
패킷 1개 유실에 멈춰서 안 됨(사용자 hard requirement). 인코더(Swift VT)는 전송과 무관하게
같은 NAL을 내고, webrtc-rs가 RTP로 패킷화한다. Swift↔Rust 정적링킹은 회피
(독립 헬퍼 `rp-vt-encode` 프로세스 파이프, deny-clean).

```
remote-pair-screen serve-webrtc (tokio, --features webrtc):
  xcap capture (RGBA) ──swizzle→ BGRA ──stdin──▶ rp-vt-encode (영속 VTCompressionSession)
                                                    │ inter-frame P/IDR
  webrtc-rs ◀── length-prefixed Annex-B NAL ──stdout┘
    H264 packetizer(FU-A) → TrackLocalStaticRTP::write_rtp → SRTP/DTLS → UDP/ICE(host-only)
        │  (SDP/ICE 시그널링은 기존 /api/screen 브리지를 ssh 위로)
        ▼
  webview remote-desktop.js:
    RTCPeerConnection (Chromium 네이티브 WebRTC — macOS/Win/Linux 동일, 크로스플랫폼)
      ontrack → <video> 렌더. (WebCodecs 수동 디코드 불요 — 브라우저 WebRTC가 H264 디코드)
```

브라우저 RTCPeerConnection이 디코드를 맡으므로 클라는 NSView/Metal/WebCodecs 전부 불요이고
모든 OS에서 동일 — 크로스플랫폼 제약 충족. 전송은 UDP라 HoL 없음.

### 남은 작업 (체크리스트)
- [x] `rp-vt-encode.swift`: 스트리밍 헬퍼(stdin BGRA→stdout length-prefixed Annex-B), 영속세션 P프레임. ✓
- [ ] webrtc-rs viability: `cargo run --example webrtc_selftest --features webrtc` PASS (H264 offer). ← 진행중
- [ ] `serve_webrtc.rs`: 캡쳐→swizzle→인코더 stdin, stdout NAL→H264 packetizer→write_rtp.
      capture/swizzle/NAL-reader 로직은 검증됨(구 serve_h264 회수). tokio 런타임.
- [ ] 시그널링: 브리지 `/api/screen/signal/:token`(SDP/ICE 릴레이), 웹뷰 RTCPeerConnection.
- [ ] `main.rs` `serve-webrtc` 서브커맨드(cfg feature webrtc).
- [ ] `remotepair-ext`: RTCPeerConnection + <video>로 v2 모드. ssh -L은 시그널링만(미디어는 UDP).
- [ ] computer-use로 RemotePair.app 띄워 H.264/webrtc 렌더 확인 + 정지화면 대역폭 측정.
- [ ] 키프레임-on-connect(PLI/force IDR), deny licenses(webrtc 트랜지티브 MIT/Apache 확인).

### 검증 환경 메모 (G001 하네스)
- 사이드카 Screen Recording 그랜트됨(release 바이너리 capture 성공).
- 빌드된 IDE: `remotepair-ide/VSCode-darwin-arm64/RemotePair.app` (설치본 아님 → computer-use
  request_access는 bundle id `com.x10lab.remotepair-ide` 또는 `open`으로 LaunchServices 등록 후).
- IDE는 computer-use tier "click"(타이핑 불가) → Remote Desktop 열기는 액티비티바 클릭 활용.
- 로컬 self-loopback: REMOTE_HOST=gh-mac-m1(원격), ssh localhost는 known_hosts 보완 필요.
  로컬검증은 웹뷰를 ws://127.0.0.1:<port>에 직결하는 디버그 경로가 가장 단순.

## 라이선스
Swift/VideoToolbox = Apple EULA(시스템 프레임워크, 링크의무 없음). 헬퍼는 별도 프로세스라
remote-pair Apache-2.0와 무충돌. AGPL 무관.
