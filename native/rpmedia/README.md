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

**Swift↔Rust 정적링킹 회피.** 검증된 인코더를 **독립 헬퍼 바이너리 `rp-vt-encode`**로 만들어
arm's-length 프로세스 파이프로 연결 (deny-clean, 링킹 리스크 0, screencapture 호출과 동일 패턴):

```
remote-pair-screen serve-h264:
  xcap capture (RGBA) ──swizzle→ BGRA raw frame ──stdin──▶ rp-vt-encode (영속 VTCompressionSession)
                                                              │ 인코드 (inter-frame P/IDR)
  WS broadcast ◀── length-prefixed Annex-B NAL ──stdout──────┘
        │
        ▼  ws://127.0.0.1:port  (기존 serve와 동일 전송, ssh -L)
  webview remote-desktop.js:
    WebCodecs VideoDecoder({codec:'avc1.42...'}) ── decode ──▶ VideoFrame ──drawImage──▶ canvas
```

### 남은 작업 (체크리스트)
- [ ] `rp-vt-encode.swift`: 스파이크를 stdin(W*H*4 BGRA 루프)→stdout(4바이트 BE 길이 + Annex-B NAL)
      스트리밍으로 진화. 영속 세션 → P프레임. args: w h fps bitrate.
- [ ] 빌드: `swiftc -O rp-vt-encode.swift -o rp-vt-encode`, 배포 스크립트(`remote-pair-screen-deploy`)가
      사이드카와 함께 호스트에 설치.
- [ ] `native/remote-pair-screen/src/serve_h264.rs`: 캡쳐→BGRA swizzle→인코더 stdin, stdout NAL
      프레임 읽기 스레드→WS broadcast. 변경감지 프레임스킵 재사용(무변화면 인코더에 안 보냄).
- [ ] `main.rs`에 `serve-h264` 서브커맨드.
- [ ] `remotepair-ext/media/remote-desktop.js`: WebCodecs `VideoDecoder` 추가. SPS/PPS로 디코더
      configure, IDR/P NAL feed, VideoFrame→canvas. 모드 협상(JPEG vs H264, 첫 메시지로 코덱 광고).
- [ ] computer-use로 RemotePair.app 띄워 H.264 경로 렌더 확인 + 정지화면 대역폭 측정.

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
