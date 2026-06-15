# RemotePair 사이드카 WebRTC 설계 문서

> 상태: 초안 (2026-06-14)
> 대상 버전: v1b (VideoToolbox HW encode + webrtc-rs 전송)
> 현재 상태: v1a — xcap 캡처 + tungstenite WebSocket, JPEG 프레임 ~10fps
> 라이선스: Apache-2.0 (AGPL 혼입 금지)

---

## (a) RustDesk 프로토콜 참고점 (요약, 출처 URL)

RustDesk는 AGPL-3.0 프로젝트이므로 코드는 일절 참조하지 않는다.
아래는 공개 문서·위키·토론에서 추출한 **아키텍처 설계 참고점**만 정리한다.

### a-1. 서버 구성 — 컨트롤 플레인 / 데이터 플레인 분리

| 컴포넌트 | 역할 | 포트 (기본) |
|---------|------|-----------|
| **hbbs** (Rendezvous/ID 서버) | 피어 등록·발견·NAT 트래버설 조율, 시그널링 | TCP 21115/21116, UDP 21116, WS 21118 |
| **hbbr** (Relay 서버) | 직접 P2P 실패 시 데이터 포워딩 | TCP 21117, WS 21119 |

컨트롤 플레인(hbbs)과 데이터 플레인(hbbr)을 분리해 독립적으로 스케일 아웃할 수 있다.
다수 hbbr 인스턴스를 두고 atomic counter로 라운드로빈 선택한다.

출처: [RustDesk Server DeepWiki](https://deepwiki.com/rustdesk/rustdesk-server)
출처: [RustDesk Self-host 문서](https://rustdesk.com/docs/en/self-host/)

### a-2. 연결 수립 3단계 흐름

```
1. 등록 단계
   클라이언트 → hbbs : RegisterPeer (ID + Ed25519 공개키)
   hbbs : PeerMap(in-memory) + SQLite 저장

2. NAT 트래버설 (UDP Hole Punching 우선)
   클라이언트 A → hbbs : PunchHoleRequest(target_id)
   hbbs → 클라이언트 B : UDP 포워딩
   성공 시 → 직접 P2P (hbbs 이후 관여 없음)
   동일 LAN 감지 시 → 로컬 최적 경로

3. 릴레이 폴백 (Symmetric NAT 등 직접 연결 불가 시)
   클라이언트 A → hbbs : RequestRelay
   hbbs → 클라이언트 B : UDP 포워딩
   클라이언트 B → hbbs : RelayResponse (선택된 hbbr)
   hbbs : Ed25519 서명 후 A에 전달
   A·B 각각 hbbr에 공유 UUID로 접속 → 양방향 포워딩
```

출처: [DeepWiki NAT Traversal](https://deepwiki.com/rustdesk/rustdesk/2.3-nat-traversal-and-relay)
출처: [Punch Hole and Relay Setup](https://deepwiki.com/rustdesk/rustdesk-server-demo/3.2-punch-hole-and-relay-setup)

### a-3. 보안 모델

- 피어 공개키: Ed25519 서명
- 세션 키 교환: Curve25519 ECDH
- 스트림 암호화: XSalsa20/Poly1305 (NaCl)
- 메시지 직렬화: Protocol Buffers (`rendezvous.proto`)
- 선택적 공유키(`-k` 플래그)로 서버-클라이언트 신뢰 확립

### a-4. 코덱 지원 및 품질 적응

- 소프트웨어 코덱: VP8, VP9, AV1
- 하드웨어 코덱: H.264, H.265 (플랫폼 지원 시)
- "Auto Codec" 모드: 하드웨어 지원 여부에 따라 자동 선택 (AV1 > H265 > H264 > VP9 > VP8)
- 비트레이트·양자화(QP)는 수동 제어 가능하지만, v1.2.3 기준 본격 ABR 미구현
  (TCP→UDP/RTP 전환 후 RTCP 기반 ABR 계획 중)
- UDP hole punching은 v1.4.1부터 옵션으로 지원

출처: [RustDesk Advanced Settings](https://rustdesk.com/docs/en/self-host/client-configuration/advanced-settings/)
출처: [ABR Discussion #792](https://github.com/rustdesk/rustdesk/discussions/792)
출처: [Codec Discussion #5961](https://github.com/rustdesk/rustdesk/discussions/5961)

### a-5. 우리 설계에 적용할 핵심 교훈

| RustDesk 접근 | RemotePair 적용 방향 |
|-------------|-------------------|
| 컨트롤/데이터 플레인 분리 | 브리지(`/api/screen/*`)=시그널링, webrtc-rs P2P=데이터 |
| Ed25519 피어 인증 | 기존 세션 토큰 + SSH keypair 활용 |
| P2P 우선, 릴레이 폴백 | SSH 터널 = 내장 릴레이 (별도 hbbr 불필요) |
| 하드웨어 코덱 우선 | VideoToolbox H.264/HEVC HW 인코더 |
| Symmetric NAT에도 릴레이로 보장 | SSH 포트포워딩이 Symmetric NAT 완전 우회 |

---

## (b) 우리 사이드카 시그널링 설계 (브리지 + SSH, 공개 rendezvous 불요)

### b-1. 설계 원칙

RemotePair는 이미 호스트↔클라이언트 간 SSH 연결이 존재한다.
공개 rendezvous 서버(RustDesk의 hbbs 역할)가 **불필요**하며,
기존 `/api/screen/*` 브리지가 시그널링 채널로 충분하다.

### b-2. 시그널링 채널 구성

```
Client (뷰어)                    Host (화면 공유)
     │                                │
     │  HTTPS WebSocket               │
     │  /api/screen/signal/{token}    │
     └──────────── Bridge ────────────┘
                   │
          토큰 검증 (기존 세션 인증)
          SDP offer/answer 릴레이
          ICE candidate 릴레이
```

- **WebSocket 엔드포인트**: 기존 `GET /api/screen/stream/:token` 패턴 확장
  → `GET /api/screen/signal/:token` (JSON 메시지 릴레이)
- **메시지 타입**: `{ "type": "offer"|"answer"|"candidate", "payload": "..." }`
- **인증**: 기존 Bearer 토큰 또는 SSH 공개키 서명 검증
- 시그널링 채널은 SDP·ICE 메타데이터만 전달; 미디어 스트림은 P2P

### b-3. ICE 구성 — 공개 STUN/TURN 없이 연결

**케이스 A: 동일 LAN (가장 일반적인 pair 시나리오)**
```
ICE config: { iceServers: [] }  // 빈 배열
ICE는 host candidate (링크-로컬/LAN IP)만으로 연결
→ 외부 의존성 없음, 최저 지연
```

**케이스 B: 원격 (서로 다른 NAT 뒤)**
```
옵션 1: SSH 포트포워딩 릴레이 (권장)
  ssh -L 4001:localhost:4001 host_machine
  ICE config: { iceServers: [{ urls: "turn:127.0.0.1:4001", ... }] }
  → SSH가 TURN 역할 대행, 공개 TURN 서버 불필요

옵션 2: Tailscale/WireGuard 오버레이 (옵션)
  MagicDNS 또는 WireGuard 가상 IP로 직접 P2P
  ICE는 Tailscale 100.x.x.x 주소를 host candidate로 수집
```

**케이스 C: 향후 — 경량 자체 TURN**
- coturn (MIT) 또는 Rust 구현 `turn-rs` (Apache-2.0)를 호스트 머신에 내장 실행
- 공개 서버 없이 자가 조달 릴레이

### b-4. 세션 수립 시퀀스 (상세)

```
1. Host 사이드카 기동
   screen serve-webrtc --token <SESSION_TOKEN> --port 4000
   → RTCPeerConnection 준비, 시그널링 WebSocket 연결 대기

2. Client 연결
   Bridge /api/screen/signal/:token 에 WebSocket 연결
   → Bridge가 Host 사이드카의 WS에도 연결 (또는 Host가 Bridge에 등록)

3. SDP 교환
   Host : createOffer() → SDP (H.264 코덱 포함)
   Host → Bridge → Client : { type:"offer", payload: sdp }
   Client : createAnswer()
   Client → Bridge → Host : { type:"answer", payload: sdp }

4. ICE Candidate Trickle
   양측에서 ICE candidate 수집 즉시 전송
   Bridge가 릴레이 (단순 JSON 포워딩)

5. DTLS 핸드셰이크 + SRTP 활성화 (webrtc-rs 자동 처리)

6. 미디어 플로우 시작
   Host : ScreenCaptureKit → VideoToolbox H.264 → RTP → webrtc-rs → Client
```

### b-5. webrtc-rs/rtc 크레이트 선택 근거

- **webrtc** (crates.io, MIT/Apache-2.0): 안정적인 async API, 예제 풍부
- **webrtc-rs/rtc** (sans-I/O): 2026-01 feature-complete 달성, I/O 루프 직접 제어 가능
  - TWCC Sender/Receiver 인터셉터 내장
  - H.264, VP8/VP9 코덱 협상
  - ICE (host/srflx/relay), DTLS 1.2, SRTP AES-GCM
  - TrackLocalStaticRTP로 외부 RTP 패킷 직접 주입 가능
- 라이선스: MIT — Apache-2.0 프로젝트와 양립

출처: [webrtc-rs feature-complete blog](https://webrtc.rs/blog/2026/01/18/rtc-feature-complete-whats-next.html)
출처: [webrtc crates.io](https://crates.io/crates/webrtc)
출처: [TrackLocalStaticRTP docs](https://docs.rs/webrtc/latest/webrtc/track/track_local/track_local_static_rtp/struct.TrackLocalStaticRTP.html)

---

## (c) 인코딩 — VideoToolbox 저지연 튜닝 → webrtc-rs RTP

### c-1. ScreenCaptureKit 캡처 (Rust FFI)

현재 v1a는 xcap(동기 one-shot)을 사용한다. v1b에서는 `screencapturekit` 크레이트로 교체한다.

```rust
// screencapturekit crate (MIT, macOS 12.3+)
// crates.io: screencapturekit
// GitHub: svtlabs/screencapturekit-rs

// 주요 특성:
// - CMTime::new(1, 30)  → 30fps 스트림
// - CMTime::new(1, 60)  → 60fps 스트림
// - IOSurface 직접 접근 → 제로카피 Metal/GPU 패스
// - async (tokio/async-std/smol 모두 지원)
// - SCShareableContent::snapshot() 배치 API로 FFI 오버헤드 최소화
```

출처: [screencapturekit crates.io](https://crates.io/crates/screencapturekit)
출처: [screencapturekit-rs GitHub](https://github.com/svtlabs/screencapturekit-rs)

### c-2. VideoToolbox H.264 저지연 인코더 설정 (Swift FFI → Rust)

Rust 사이드카는 Swift/ObjC 브리지 또는 `core-foundation` FFI를 통해 VT 세션을 생성한다.

**세션 생성 — 저지연 레이트컨트롤 활성화**

```c
// 인코더 스펙에서 저지연 레이트컨트롤 활성화 (WWDC21 권장)
CFMutableDictionaryRef encoderSpec = CFDictionaryCreateMutable(...);
CFDictionarySetValue(encoderSpec,
    kVTVideoEncoderSpecification_EnableLowLatencyRateControl,
    kCFBooleanTrue);

// HW 가속 강제 (Apple Silicon은 항상 HW)
CFDictionarySetValue(encoderSpec,
    kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder,
    kCFBooleanTrue);

OSStatus err = VTCompressionSessionCreate(
    kCFAllocatorDefault,
    width, height,
    kCMVideoCodecType_H264,
    encoderSpec,          // 저지연 레이트컨트롤
    NULL, NULL,
    outputCallback, NULL,
    &compressionSession);
```

**세션 생성 후 필수 프로퍼티**

| 프로퍼티 | 값 | 이유 |
|---------|---|------|
| `kVTCompressionPropertyKey_RealTime` | `kCFBooleanTrue` | 레이턴시 우선, 스루풋 포기 |
| `kVTCompressionPropertyKey_AllowFrameReordering` | `kCFBooleanFalse` | B프레임 금지 → 1-in-1-out |
| `kVTCompressionPropertyKey_MaxKeyFrameInterval` | `60` (30fps 기준 2초) | 주기적 IDR, LTR 활용 |
| `kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration` | `2.0` 초 | 시간 기반 IDR 보조 |
| `kVTCompressionPropertyKey_AverageBitRate` | 초기 `2_000_000` (2Mbps) | TWCC 피드백으로 동적 조정 |
| `kVTCompressionPropertyKey_ProfileLevel` | `kVTProfileLevel_H264_ConstrainedHigh_AutoLevel` | 호환성 + 압축 효율 균형 |
| `kVTCompressionPropertyKey_MaxAllowedFrameQP` | `36` (화면공유 적정값) | 텍스트 가독성 유지 하한 |

**LTR (Long-Term Reference) 활성화 — 선택적**

```c
// PLI/FIR 수신 시 IDR 대신 소형 LTR-P 프레임으로 복구
VTSessionSetProperty(compressionSession,
    kVTCompressionPropertyKey_EnableLTR,
    kCFBooleanTrue);

// 인코더 출력 콜백에서:
//   RequireLTRAcknowledgementToken → RTP RTCP RPSI로 수신측 확인
//   AcknowledgedLTRTokens → 확인된 토큰 배열 전달
//   ForceLTRRefresh → PLI 수신 시 호출
```

WWDC21에서 측정된 저지연 모드 절감: 720p 30fps 기준 **최대 100ms** 레이턴시 감소.

출처: [WWDC21 - Explore low-latency video encoding with VideoToolbox](https://developer.apple.com/videos/play/wwdc2021/10158/)
출처: [Apple Developer Forums - H264 low-latency rate control](https://developer.apple.com/forums/thread/799459/)

### c-3. NAL 유닛 → RTP 패킷화 파이프라인

VideoToolbox 출력(CMSampleBuffer)은 **AVCC 형식** (4바이트 길이 접두사)이다.
RTP H.264 페이로드(RFC 6184)는 **Annex B 또는 NALU 직접** 형식을 요구한다.

```
VTCompressionSession 출력 콜백
        │
        ▼
CMSampleBuffer (AVCC: [4-byte len | NALU data])
        │
  AVCC → Annex B 변환
  [0x00 0x00 0x00 0x01 | NALU data]
  (SPS/PPS는 IDR 앞에 prepend)
        │
        ▼
webrtc-rs H264Payloader (rtp 크레이트)
  - 1500바이트 MTU 기준 FU-A 분할
  - 단일 NALU는 Single NAL Unit Packet
        │
        ▼
TrackLocalStaticRTP::write_rtp()
  → SRTP 암호화 → DTLS → UDP/ICE
```

**Rust 구현 스케치**

```rust
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTPCodecType};

// H.264 트랙 생성
let video_track = Arc::new(TrackLocalStaticRTP::new(
    RTCRtpCodecCapability {
        mime_type: "video/H264".to_string(),
        clock_rate: 90000,
        // profile-level-id=42e01f: Constrained Baseline, Level 3.1
        // (ConstrainedHigh 원하면 640c1f)
        sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;\
                         profile-level-id=42e01f".to_string(),
        ..Default::default()
    },
    "video".to_string(),
    "screen".to_string(),
));

// VT 콜백에서 NAL 유닛 수신 후:
// 1. AVCC → Annex B 변환
// 2. rtp::packetizer를 사용해 FU-A 분할
// 3. video_track.write_rtp(&packet).await
```

출처: [webrtc-rs examples README](https://github.com/webrtc-rs/webrtc/blob/master/examples/examples/README.md)
출처: [TrackLocalStaticRTP docs.rs](https://docs.rs/webrtc/latest/webrtc/track/track_local/track_local_static_rtp/struct.TrackLocalStaticRTP.html)
출처: [VideoToolbox NAL format - Mobisoft](https://mobisoftinfotech.com/resources/mguide/h264-encode-decode-using-videotoolbox)

---

## (d) 적응 — 대역폭/fps/해상도/keyframe

### d-1. TWCC 기반 대역폭 추정

webrtc-rs의 TWCC 인터셉터를 활성화하면 수신측이 패킷별 도착 타임스탬프를 피드백한다.
송신측은 이 데이터로 GCC(Google Congestion Control) 알고리즘을 실행한다.

```
GCC 이중 제어기:
1. 손실 기반: 패킷 손실 > 10% → 비트레이트 감소
              손실 2~10% → 유지
              손실 < 2%  → 점진적 증가
2. 지연 기반: 패킷간 도착 지연 Kalman 필터링
             → 큐 빌드업 조기 감지, 손실 전 선제 감소
```

### d-2. 화면공유 특화 적응 전략

화면 공유는 **카메라 영상과 반대**의 우선순위를 가진다:
- **해상도 > fps** (텍스트/UI 선명도 최우선)
- Multi.app 연구: QP 범위 조정(4-36)이 텍스트 가독성에 가장 큰 영향
- VP9 대비 H.264 HW 인코더: 즉시 풀해상도 전송 (소프트웨어는 15-45초 램프업)

**적응 단계표**

| 추정 대역폭 | 해상도 | fps | 비트레이트 | 비고 |
|------------|-------|-----|----------|------|
| > 8 Mbps   | 원본 (Retina/4K) | 30 | 6 Mbps | 고품질 |
| 4~8 Mbps   | 원본 | 15~30 | 3 Mbps | 정상 |
| 2~4 Mbps   | 1080p | 15 | 2 Mbps | 다운스케일 |
| 1~2 Mbps   | 720p  | 10 | 1 Mbps | 대폭 절약 |
| < 1 Mbps   | 720p  | 5  | 700Kbps | 최저 |

**Retina 주의**: MacBook 기본 해상도(예: 2560×1600)는 1080p 대비 픽셀 수 ~6배.
캡처 시 스케일 팩터를 0.5로 설정하거나 SCStreamConfiguration.scaleFactor 활용.

### d-3. 지터 버퍼 조정 — 저지연 우선

화면 공유는 실시간 인터랙션(마우스·키보드 반응)이 중요하므로 지터 버퍼를 최소화한다.

Multi.app 측정: 지터 버퍼 비활성화만으로 **~90ms 레이턴시 감소**.

webrtc-rs에서 playout-delay 헤더 익스텐션으로 수신측 버퍼 힌트 전달:
```
Playout-Delay: min=0, max=0  // 즉시 렌더링 요청
```
출처: [Playout Delay RFC](https://webrtc.googlesource.com/src/+/main/docs/native-code/rtp-hdrext/playout-delay/README.md)

### d-4. PLI/FIR keyframe 처리

수신측이 프레임 손실을 감지하면 RTCP PLI를 전송한다.
- **PLI 수신 시**: LTR 활성화된 경우 `ForceLTRRefresh` → LTR-P 프레임 (IDR보다 수배 작음)
  LTR 없으면 VTCompressionSessionCompleteFrames로 IDR 강제 생성
- **FIR 수신 시**: 새 수신자 합류 시. 즉시 IDR 강제 발행
- **과도한 PLI 방지**: PLI 발생 간격 최소 500ms 쿨다운 (빠른 연속 PLI → IDR 폭증 방지)

출처: [PLI - bloggeek.me](https://bloggeek.me/webrtcglossary/pli/)
출처: [WebRTC Media Communication](https://webrtcforthecurious.com/docs/06-media-communication/)

### d-5. VBR/CBR 모드 선택

- **정적 콘텐츠** (슬라이드, 코드 에디터): VBR — 움직임 없을 때 비트레이트 자동 감소
- **동적 콘텐츠** (스크롤, 동영상 재생): CBR 또는 CBR+버스트 — 급격한 변화 대응
- `kVTCompressionPropertyKey_AverageBitRate` + `DataRateLimits`로 피크 제어

---

## (e) 재연결·견고성

### e-1. ICE 재시작 (ICE Restart)

네트워크 전환(Wi-Fi → LTE, NAT 바인딩 만료) 후 **ICE Restart**가 가장 빠른 복구책이다.

- DTLS 핸드셰이크와 SRTP 키는 **보존됨** (full renegotiation 불필요)
- webrtc-rs에서 `restartIce()` 호출 → 새 offer에 새 ICE credentials
- 타임아웃 트리거: `connectionState == failed` 또는 disconnected 후 2~3초 이내

```rust
// 연결 상태 감시
peer_connection.on_connection_state_change(Box::new(|state| {
    Box::pin(async move {
        match state {
            RTCPeerConnectionState::Failed |
            RTCPeerConnectionState::Disconnected => {
                // ICE Restart 시그널링 → 브리지로 new offer 전송
                trigger_ice_restart().await;
            }
            _ => {}
        }
    })
}));
```

### e-2. 세션 재연결 (Full Reconnect)

ICE Restart가 실패하면 시그널링 채널(WebSocket)을 통해 전체 PeerConnection 재생성.

```
1. 브리지에 재연결 요청 메시지 전송 { "type": "reconnect" }
2. Host 사이드카: 이전 PC 종료, 새 RTCPeerConnection 생성
3. SDP 재교환 → ICE 재수집
4. 캡처 스트림은 중단 없이 유지 (ScreenCaptureKit 스트림 재사용)
```

### e-3. 사이드카 프로세스 감시

- `launchctl` 또는 `supervisord`로 사이드카 프로세스 감시
- 크래시 재시작: 5초 이내 재기동
- 세션 토큰은 파일 또는 소켓으로 재전달 (재기동 후 동일 토큰 재사용)

### e-4. 시그널링 채널(WebSocket) 재연결

```
브리지 WebSocket 단절 감지 → exponential backoff 재연결
  초기 대기: 1s → 2s → 4s → 8s → (최대 30s)
브리지 재연결 성공 시 미디어 세션 상태 확인
  → 활성: 계속 스트리밍
  → 만료: 새 ICE Restart 또는 Full Reconnect
```

### e-5. 캡처 스트림 견고성

- ScreenCaptureKit `SCStream` 델리게이트에서 `stream(_:didStopWithError:)` 처리
- 디스플레이 추가/제거(Core Display Link 변경) 시 자동 재구성
- 캡처 대상 창 종료 시 → 전체 화면 또는 대기 프레임으로 전환

---

## (f) 라이선스 안전성 노트 (AGPL 무혼입 근거)

### f-1. RemotePair 라이선스 정책

```
RemotePair: Apache-2.0
사이드카(screen): Apache-2.0 (Cargo.toml에 명시)
```

AGPL-3.0 라이선스의 소프트웨어(RustDesk 포함)는 링크, 코드 복사, 파생저작물 생성 모두 금지한다.
AGPL은 네트워크 서비스 제공도 소스 공개 의무를 트리거하므로 상용 Apache-2.0 제품과 양립 불가.

### f-2. 의존성 라이선스 검증

`deny.toml`에 `cargo-deny check licenses`를 통해 빌드 타임에 강제 검증:

```toml
# deny.toml (현재 설정 준수)
[licenses]
allow = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unicode-DFS-2016"]
deny = ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.0", "LGPL-2.1", "LGPL-3.0"]
```

**v1b 추가 의존성 사전 검증**

| 크레이트 | 라이선스 | 상태 |
|---------|---------|------|
| `webrtc` | MIT / Apache-2.0 | 허용 |
| `webrtc-rs/rtc` | MIT | 허용 |
| `screencapturekit` | MIT | 허용 |
| `tokio` | MIT | 허용 |
| `bytes` | MIT | 허용 |

VideoToolbox: Apple 시스템 프레임워크 (Apple EULA, 링크 의무 없음). Apache-2.0과 충돌 없음.
ScreenCaptureKit: 동일 (Apple EULA).

### f-3. RustDesk 참조 범위 명시

본 문서에서 RustDesk를 참조한 출처는 전부:
- 공개 문서 사이트 (`rustdesk.com/docs`)
- 공개 GitHub Discussions (소스 코드 아닌 토론)
- 제3자 분석 문서 (DeepWiki)

RustDesk AGPL 소스 코드는 **일절 참조하지 않았으며**, 본 설계는 클린룸 구현 원칙을 준수한다.

출처: [RustDesk AGPL-3.0 License](https://github.com/rustdesk/rustdesk/blob/master/LICENSE)

---

## 구현 로드맵 요약

```
v1a (현재): xcap + tungstenite + JPEG ~10fps
     + 변경감지 프레임스킵(정지화면 ~0 대역폭, raw memcmp) ← 2026-06-15 구현·실측
     + opt-in --scale 다운스케일(Retina 0.5 → 프레임 ~71%↓) ← 2026-06-15 구현·실측
     ↓
v1b-1: screencapturekit + VideoToolbox H.264 저지연 → WebSocket JPEG 대체
       (webrtc 없이 먼저 HW 인코더 검증)
     ↓
v1b-2: webrtc-rs PeerConnection + TrackLocalStaticRTP
       브리지 시그널링 WebSocket 엔드포인트 추가
       ICE host-only (LAN 우선)
     ↓
v1b-3: TWCC 인터셉터 + GCC 비트레이트 적응
       PLI/LTR 처리
       ICE Restart 재연결 로직
     ↓
v1c (미래): HEVC/AV1 HW 코덱, Simulcast, SVC
```

---

## 참고 문헌 전체 목록

- [RustDesk Server DeepWiki Architecture](https://deepwiki.com/rustdesk/rustdesk-server)
- [RustDesk NAT Traversal DeepWiki](https://deepwiki.com/rustdesk/rustdesk/2.3-nat-traversal-and-relay)
- [RustDesk Relay Server DeepWiki](https://deepwiki.com/rustdesk/rustdesk-server/2.2-relay-server-(hbbr))
- [RustDesk Self-host Documentation](https://rustdesk.com/docs/en/self-host/)
- [RustDesk Advanced Settings](https://rustdesk.com/docs/en/self-host/client-configuration/advanced-settings/)
- [RustDesk ABR Discussion #792](https://github.com/rustdesk/rustdesk/discussions/792)
- [RustDesk Codec Discussion #5961](https://github.com/rustdesk/rustdesk/discussions/5961)
- [WWDC21 - Explore low-latency video encoding with VideoToolbox](https://developer.apple.com/videos/play/wwdc2021/10158/)
- [Apple Developer Forums - H264 low-latency rate control](https://developer.apple.com/forums/thread/799459/)
- [VideoToolbox for more control - DEV Community](https://dev.to/video/working-with-videotoolbox-for-more-control-over-video-encoding-and-decoding-6n1)
- [webrtc-rs RTC feature-complete blog](https://webrtc.rs/blog/2026/01/18/rtc-feature-complete-whats-next.html)
- [webrtc crates.io](https://crates.io/crates/webrtc)
- [TrackLocalStaticRTP docs.rs](https://docs.rs/webrtc/latest/webrtc/track/track_local/track_local_static_rtp/struct.TrackLocalStaticRTP.html)
- [screencapturekit crates.io](https://crates.io/crates/screencapturekit)
- [screencapturekit-rs GitHub](https://github.com/svtlabs/screencapturekit-rs)
- [WebRTC codec comparison for screen sharing](https://www.webrtc-developers.com/comparison-of-webrtc-codecs-for-video-and-screen-sharing/)
- [Making WebRTC screenshare legible and fast - Multi.app](https://multi.app/blog/making-illegible-slow-webrtc-screenshare-legible-and-fast)
- [WebRTC Media Communication - webrtcforthecurious](https://webrtcforthecurious.com/docs/06-media-communication/)
- [PLI - bloggeek.me](https://bloggeek.me/webrtcglossary/pli/)
- [TWCC - bloggeek.me](https://bloggeek.me/webrtcglossary/transport-cc/)
- [Tweaking WebRTC video quality - bloggeek.me](https://bloggeek.me/tweaking-webrtc-video-quality-unpacking-bitrate-resolution-and-frame-rates/)
- [ICE Restart - bloggeek.me](https://bloggeek.me/webrtcglossary/ice-restart/)
- [Playout-Delay header extension - WebRTC](https://webrtc.googlesource.com/src/+/main/docs/native-code/rtp-hdrext/playout-delay/README.md)
- [WebRTC Signaling Servers - antmedia.io](https://antmedia.io/webrtc-signaling-servers-everything-you-need-to-know/)
- [VideoToolbox NAL format - Mobisoft](https://mobisoftinfotech.com/resources/mguide/h264-encode-decode-using-videotoolbox)
