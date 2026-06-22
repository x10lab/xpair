# RemotePair Sidecar WebRTC Design Document

> Status: IMPLEMENTED (updated 2026-06-17)
> Shipped: v2 — `rp-screencap` (ScreenCaptureKit + VideoToolbox HW H.264) +
>   webrtc-rs transport (DTLS/SRTP over UDP/ICE). Shipping in 0.5.0; verified
>   end-to-end from the IDE Remote Desktop panel (loopback peer "connected", 30fps).
>   Product RD is view-only: no `rp-ctl`/`rp-move` input channel is opened, and
>   the IDE closes/ignores host-created DataChannels.
> v1a (xcap + tungstenite WS, JPEG ~10fps) remains a license-clean fallback (`serve`).
> Still future: TWCC/GCC bitrate adaptation, HEVC/AV1, ICE-restart (sections d/e below).
> License: AGPL-3.0-or-later (no AGPL contamination allowed)

---

## (a) Protocol Design References (Summary)

This is an independent (clean-room) design that does not reference any external code.
The following organizes only the **architectural design reference points** extracted from public documents, wikis, and discussions.

### a-1. Server Composition — Control Plane / Data Plane Separation

| Component | Role | Port (default) |
|---------|------|-----------|
| **hbbs** (Rendezvous/ID server) | Peer registration/discovery, NAT traversal coordination, signaling | TCP 21115/21116, UDP 21116, WS 21118 |
| **hbbr** (Relay server) | Data forwarding when direct P2P fails | TCP 21117, WS 21119 |

Separating the control plane (hbbs) from the data plane (hbbr) allows each to be scaled out independently.
Multiple hbbr instances are deployed and selected round-robin via an atomic counter.


### a-2. Three-Stage Connection Establishment Flow

```
1. Registration stage
   Client → hbbs : RegisterPeer (ID + Ed25519 public key)
   hbbs : PeerMap(in-memory) + SQLite storage

2. NAT traversal (UDP Hole Punching preferred)
   Client A → hbbs : PunchHoleRequest(target_id)
   hbbs → Client B : UDP forwarding
   On success → direct P2P (hbbs no longer involved afterward)
   On same-LAN detection → local optimal path

3. Relay fallback (when direct connection is impossible, e.g. Symmetric NAT)
   Client A → hbbs : RequestRelay
   hbbs → Client B : UDP forwarding
   Client B → hbbs : RelayResponse (selected hbbr)
   hbbs : Ed25519 signs then forwards to A
   A and B each connect to hbbr with a shared UUID → bidirectional forwarding
```


### a-3. Security Model

- Peer public key: Ed25519 signature
- Session key exchange: Curve25519 ECDH
- Stream encryption: XSalsa20/Poly1305 (NaCl)
- Message serialization: Protocol Buffers (`rendezvous.proto`)
- Optional shared key (`-k` flag) to establish server-client trust

### a-4. Codec Support and Quality Adaptation

- Software codecs: VP8, VP9, AV1
- Hardware codecs: H.264, H.265 (when platform-supported)
- "Auto Codec" mode: automatic selection based on hardware support (AV1 > H265 > H264 > VP9 > VP8)
- Bitrate and quantization (QP) can be controlled manually, but as of v1.2.3 full ABR is not implemented
  (RTCP-based ABR planned after the TCP→UDP/RTP transition)
- UDP hole punching is supported as an option starting from v1.4.1


### a-5. Key Lessons to Apply to Our Design

| Reference Approach | RemotePair Application Direction |
|-------------|-------------------|
| Control/data plane separation | Bridge (`/api/screen/*`) = signaling, webrtc-rs P2P = data |
| Ed25519 peer authentication | Reuse existing session token + SSH keypair |
| P2P first, relay fallback | SSH tunnel = built-in relay (no separate hbbr needed) |
| Hardware codec first | VideoToolbox H.264/HEVC HW encoder |
| Guaranteed via relay even with Symmetric NAT | SSH port forwarding fully bypasses Symmetric NAT |

---

## (b) Our Sidecar Signaling Design (Bridge + SSH, No Public Rendezvous Needed)

### b-1. Design Principles

RemotePair already has an SSH connection between host and client.
A public rendezvous server is **unnecessary**,
and the existing `/api/screen/*` bridge is sufficient as a signaling channel.

### b-2. Signaling Channel Composition

```
Client (viewer)                  Host (screen sharing)
     │                                │
     │  HTTPS WebSocket               │
     │  /api/screen/signal/{token}    │
     └──────────── Bridge ────────────┘
                   │
          Token verification (existing session auth)
          SDP offer/answer relay
          ICE candidate relay
```

- **WebSocket endpoint**: extension of the existing `GET /api/screen/stream/:token` pattern
  → `GET /api/screen/signal/:token` (JSON message relay)
- **Message types**: `{ "type": "offer"|"answer"|"candidate", "payload": "..." }`
- **Authentication**: existing Bearer token or SSH public key signature verification
- The signaling channel carries only SDP/ICE metadata; the media stream is P2P

### b-3. ICE Configuration — Connecting Without Public STUN/TURN

**Case A: Same LAN (the most common pair scenario)**
```
ICE config: { iceServers: [] }  // empty array
ICE connects using host candidates (link-local/LAN IP) only
→ no external dependencies, lowest latency
```

**Case B: Remote (behind different NATs)**
```
Option 1: SSH port forwarding relay (recommended)
  ssh -L 4001:localhost:4001 host_machine
  ICE config: { iceServers: [{ urls: "turn:127.0.0.1:4001", ... }] }
  → SSH acts as the TURN role, no public TURN server needed

Option 2: Tailscale/WireGuard overlay (optional)
  Direct P2P via MagicDNS or WireGuard virtual IP
  ICE collects the Tailscale 100.x.x.x address as a host candidate
```

**Case C: Future — Lightweight Self-Hosted TURN**
- Run coturn (MIT) or the Rust implementation `turn-rs` (Apache-2.0) embedded on the host machine
- A self-provisioned relay without a public server

### b-4. Session Establishment Sequence (Detailed)

```
1. Host sidecar startup
   screen serve-webrtc --token <SESSION_TOKEN> --port 4000
   → RTCPeerConnection ready, waiting for signaling WebSocket connection

2. Client connects
   Connect via WebSocket to Bridge /api/screen/signal/:token
   → Bridge also connects to the Host sidecar's WS (or Host registers with the Bridge)

3. SDP exchange
   Host : createOffer() → SDP (including H.264 codec)
   Host → Bridge → Client : { type:"offer", payload: sdp }
   Client : createAnswer()
   Client → Bridge → Host : { type:"answer", payload: sdp }

4. ICE Candidate Trickle
   Each side sends ICE candidates immediately upon collection
   Bridge relays (simple JSON forwarding)

5. DTLS handshake + SRTP activation (handled automatically by webrtc-rs)

6. Media flow begins
   Host : ScreenCaptureKit → VideoToolbox H.264 → RTP → webrtc-rs → Client
```

### b-5. Rationale for Choosing the webrtc-rs/rtc Crate

- **webrtc** (crates.io, MIT/Apache-2.0): stable async API, abundant examples
- **webrtc-rs/rtc** (sans-I/O): reached feature-complete in 2026-01, allows direct control of the I/O loop
  - Built-in TWCC Sender/Receiver interceptors
  - H.264, VP8/VP9 codec negotiation
  - ICE (host/srflx/relay), DTLS 1.2, SRTP AES-GCM
  - Direct injection of external RTP packets via TrackLocalStaticRTP
- License: MIT — compatible with an AGPL-3.0 project

Source: [webrtc-rs feature-complete blog](https://webrtc.rs/blog/2026/01/18/rtc-feature-complete-whats-next.html)
Source: [webrtc crates.io](https://crates.io/crates/webrtc)
Source: [TrackLocalStaticRTP docs](https://docs.rs/webrtc/latest/webrtc/track/track_local/track_local_static_rtp/struct.TrackLocalStaticRTP.html)

---

## (c) Encoding — VideoToolbox Low-Latency Tuning → webrtc-rs RTP

### c-1. ScreenCaptureKit Capture (Rust FFI)

The current v1a uses xcap (synchronous one-shot). In v1b it is replaced with the `screencapturekit` crate.

```rust
// screencapturekit crate (MIT, macOS 12.3+)
// crates.io: screencapturekit
// GitHub: svtlabs/screencapturekit-rs

// Key characteristics:
// - CMTime::new(1, 30)  → 30fps stream
// - CMTime::new(1, 60)  → 60fps stream
// - Direct IOSurface access → zero-copy Metal/GPU path
// - async (tokio/async-std/smol all supported)
// - SCShareableContent::snapshot() batch API minimizes FFI overhead
```

Source: [screencapturekit crates.io](https://crates.io/crates/screencapturekit)
Source: [screencapturekit-rs GitHub](https://github.com/svtlabs/screencapturekit-rs)

### c-2. VideoToolbox H.264 Low-Latency Encoder Settings (Swift FFI → Rust)

The Rust sidecar creates a VT session via a Swift/ObjC bridge or `core-foundation` FFI.

**Session creation — enabling low-latency rate control**

```c
// Enable low-latency rate control in the encoder spec (WWDC21 recommended)
CFMutableDictionaryRef encoderSpec = CFDictionaryCreateMutable(...);
CFDictionarySetValue(encoderSpec,
    kVTVideoEncoderSpecification_EnableLowLatencyRateControl,
    kCFBooleanTrue);

// Force HW acceleration (Apple Silicon is always HW)
CFDictionarySetValue(encoderSpec,
    kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder,
    kCFBooleanTrue);

OSStatus err = VTCompressionSessionCreate(
    kCFAllocatorDefault,
    width, height,
    kCMVideoCodecType_H264,
    encoderSpec,          // low-latency rate control
    NULL, NULL,
    outputCallback, NULL,
    &compressionSession);
```

**Required properties after session creation**

| Property | Value | Reason |
|---------|---|------|
| `kVTCompressionPropertyKey_RealTime` | `kCFBooleanTrue` | latency priority, sacrificing throughput |
| `kVTCompressionPropertyKey_AllowFrameReordering` | `kCFBooleanFalse` | no B-frames → 1-in-1-out |
| `kVTCompressionPropertyKey_MaxKeyFrameInterval` | `60` (2 sec at 30fps) | periodic IDR, leverage LTR |
| `kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration` | `2.0` sec | time-based IDR supplement |
| `kVTCompressionPropertyKey_AverageBitRate` | initial `2_000_000` (2Mbps) | dynamically adjusted via TWCC feedback |
| `kVTCompressionPropertyKey_ProfileLevel` | `kVTProfileLevel_H264_ConstrainedHigh_AutoLevel` | balance of compatibility + compression efficiency |
| `kVTCompressionPropertyKey_MaxAllowedFrameQP` | `36` (appropriate value for screen sharing) | lower bound to maintain text legibility |

**LTR (Long-Term Reference) activation — optional**

```c
// On PLI/FIR reception, recover with a small LTR-P frame instead of an IDR
VTSessionSetProperty(compressionSession,
    kVTCompressionPropertyKey_EnableLTR,
    kCFBooleanTrue);

// In the encoder output callback:
//   RequireLTRAcknowledgementToken → receiver confirmation via RTP RTCP RPSI
//   AcknowledgedLTRTokens → pass the array of acknowledged tokens
//   ForceLTRRefresh → called on PLI reception
```

Low-latency mode savings measured at WWDC21: **up to 100ms** latency reduction at 720p 30fps.

Source: [WWDC21 - Explore low-latency video encoding with VideoToolbox](https://developer.apple.com/videos/play/wwdc2021/10158/)
Source: [Apple Developer Forums - H264 low-latency rate control](https://developer.apple.com/forums/thread/799459/)

### c-3. NAL Unit → RTP Packetization Pipeline

The VideoToolbox output (CMSampleBuffer) is in **AVCC format** (4-byte length prefix).
The RTP H.264 payload (RFC 6184) requires the **Annex B or direct NALU** format.

```
VTCompressionSession output callback
        │
        ▼
CMSampleBuffer (AVCC: [4-byte len | NALU data])
        │
  AVCC → Annex B conversion
  [0x00 0x00 0x00 0x01 | NALU data]
  (SPS/PPS are prepended before the IDR)
        │
        ▼
webrtc-rs H264Payloader (rtp crate)
  - FU-A fragmentation based on 1500-byte MTU
  - a single NALU becomes a Single NAL Unit Packet
        │
        ▼
TrackLocalStaticRTP::write_rtp()
  → SRTP encryption → DTLS → UDP/ICE
```

**Rust implementation sketch**

```rust
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTPCodecType};

// Create H.264 track
let video_track = Arc::new(TrackLocalStaticRTP::new(
    RTCRtpCodecCapability {
        mime_type: "video/H264".to_string(),
        clock_rate: 90000,
        // profile-level-id=42e01f: Constrained Baseline, Level 3.1
        // (use 640c1f if ConstrainedHigh is desired)
        sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;\
                         profile-level-id=42e01f".to_string(),
        ..Default::default()
    },
    "video".to_string(),
    "screen".to_string(),
));

// After receiving NAL units in the VT callback:
// 1. AVCC → Annex B conversion
// 2. FU-A fragmentation using rtp::packetizer
// 3. video_track.write_rtp(&packet).await
```

Source: [webrtc-rs examples README](https://github.com/webrtc-rs/webrtc/blob/master/examples/examples/README.md)
Source: [TrackLocalStaticRTP docs.rs](https://docs.rs/webrtc/latest/webrtc/track/track_local/track_local_static_rtp/struct.TrackLocalStaticRTP.html)
Source: [VideoToolbox NAL format - Mobisoft](https://mobisoftinfotech.com/resources/mguide/h264-encode-decode-using-videotoolbox)

---

## (d) Adaptation — Bandwidth/fps/Resolution/keyframe

### d-1. TWCC-Based Bandwidth Estimation

Enabling webrtc-rs's TWCC interceptor makes the receiver feed back per-packet arrival timestamps.
The sender runs the GCC (Google Congestion Control) algorithm with this data.

```
GCC dual controller:
1. Loss-based: packet loss > 10% → decrease bitrate
              loss 2~10% → hold
              loss < 2%  → gradual increase
2. Delay-based: Kalman filtering of inter-packet arrival delay
             → early detection of queue buildup, preemptive decrease before loss
```

### d-2. Screen-Sharing-Specific Adaptation Strategy

Screen sharing has the **opposite** priority of camera video:
- **resolution > fps** (text/UI sharpness is the top priority)
- Multi.app research: adjusting the QP range (4-36) has the largest impact on text legibility
- H.264 HW encoder vs. VP9: full-resolution transmission immediately (software ramps up over 15-45 seconds)

**Adaptation Step Table**

| Estimated Bandwidth | Resolution | fps | Bitrate | Notes |
|------------|-------|-----|----------|------|
| > 8 Mbps   | original (Retina/4K) | 30 | 6 Mbps | high quality |
| 4~8 Mbps   | original | 15~30 | 3 Mbps | normal |
| 2~4 Mbps   | 1080p | 15 | 2 Mbps | downscaled |
| 1~2 Mbps   | 720p  | 10 | 1 Mbps | major savings |
| < 1 Mbps   | 720p  | 5  | 700Kbps | lowest |

**Retina note**: a MacBook's default resolution (e.g. 2560×1600) has ~6× the pixel count of 1080p.
Set the scale factor to 0.5 when capturing, or use SCStreamConfiguration.scaleFactor.

### d-3. Jitter Buffer Tuning — Low-Latency Priority

Since real-time interaction (mouse/keyboard responsiveness) matters for screen sharing, the jitter buffer is minimized.

Multi.app measurement: disabling the jitter buffer alone yields a **~90ms latency reduction**.

In webrtc-rs, the receiver buffer hint is passed via the playout-delay header extension:
```
Playout-Delay: min=0, max=0  // request immediate rendering
```
Source: [Playout Delay RFC](https://webrtc.googlesource.com/src/+/main/docs/native-code/rtp-hdrext/playout-delay/README.md)

### d-4. PLI/FIR keyframe Handling

When the receiver detects frame loss, it sends an RTCP PLI.
- **On PLI reception**: if LTR is enabled, `ForceLTRRefresh` → LTR-P frame (several times smaller than an IDR)
  Without LTR, force IDR generation via VTCompressionSessionCompleteFrames
- **On FIR reception**: when a new receiver joins. Force immediate IDR emission
- **Excessive PLI prevention**: minimum 500ms cooldown between PLI occurrences (prevents IDR explosion from rapid consecutive PLIs)

Source: [PLI - bloggeek.me](https://bloggeek.me/webrtcglossary/pli/)
Source: [WebRTC Media Communication](https://webrtcforthecurious.com/docs/06-media-communication/)

### d-5. VBR/CBR Mode Selection

- **Static content** (slides, code editor): VBR — bitrate automatically decreases when there is no motion
- **Dynamic content** (scrolling, video playback): CBR or CBR+burst — respond to rapid changes
- Control the peak with `kVTCompressionPropertyKey_AverageBitRate` + `DataRateLimits`

---

## (e) Reconnection and Robustness

### e-1. ICE Restart

After a network switch (Wi-Fi → LTE, NAT binding expiration), **ICE Restart** is the fastest recovery method.

- The DTLS handshake and SRTP keys are **preserved** (full renegotiation not needed)
- Call `restartIce()` in webrtc-rs → new ICE credentials in a new offer
- Timeout trigger: `connectionState == failed`, or within 2~3 seconds after disconnected

```rust
// Monitor connection state
peer_connection.on_connection_state_change(Box::new(|state| {
    Box::pin(async move {
        match state {
            RTCPeerConnectionState::Failed |
            RTCPeerConnectionState::Disconnected => {
                // ICE Restart signaling → send new offer to the bridge
                trigger_ice_restart().await;
            }
            _ => {}
        }
    })
}));
```

### e-2. Session Reconnection (Full Reconnect)

If ICE Restart fails, recreate the entire PeerConnection through the signaling channel (WebSocket).

```
1. Send a reconnect request message to the bridge { "type": "reconnect" }
2. Host sidecar: terminate the previous PC, create a new RTCPeerConnection
3. Re-exchange SDP → re-collect ICE
4. The capture stream is maintained without interruption (ScreenCaptureKit stream reused)
```

### e-3. Sidecar Process Monitoring

- Monitor the sidecar process with `launchctl` or `supervisord`
- Crash restart: re-launch within 5 seconds
- The session token is re-delivered via file or socket (same token reused after re-launch)

### e-4. Signaling Channel (WebSocket) Reconnection

```
Bridge WebSocket disconnect detected → exponential backoff reconnect
  initial wait: 1s → 2s → 4s → 8s → (max 30s)
On successful bridge reconnect, check the media session state
  → active: continue streaming
  → expired: new ICE Restart or Full Reconnect
```

### e-5. Capture Stream Robustness

- Handle `stream(_:didStopWithError:)` in the ScreenCaptureKit `SCStream` delegate
- Automatically reconfigure on display addition/removal (Core Display Link change)
- When the captured target window closes → switch to the full screen or a standby frame

---

## (f) License Safety Notes (Basis for No AGPL Contamination)

### f-1. RemotePair License Policy

```
RemotePair: AGPL-3.0-or-later
sidecar (screen): AGPL-3.0-or-later (declared in Cargo.toml)
```

This sidecar is a purely independent implementation — a clean-room design referencing only public protocol documents without copying any external code.
Because AGPL triggers the source-disclosure obligation even for providing a network service, it is incompatible with a commercial Apache-2.0 product.

### f-2. Dependency License Verification

Enforced at build time via `cargo-deny check licenses` in `deny.toml`:

```toml
# deny.toml (conforms to current settings)
[licenses]
allow = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unicode-DFS-2016"]
deny = ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.0", "LGPL-2.1", "LGPL-3.0"]
```

**Pre-verification of v1b additional dependencies**

| Crate | License | Status |
|---------|---------|------|
| `webrtc` | MIT / Apache-2.0 | allowed |
| `webrtc-rs/rtc` | MIT | allowed |
| `screencapturekit` | MIT | allowed |
| `tokio` | MIT | allowed |
| `bytes` | MIT | allowed |

VideoToolbox: Apple system framework (Apple EULA, no linking obligation). No conflict with Apache-2.0.
ScreenCaptureKit: same (Apple EULA).

### f-3. Implementation Principles

This design is an **independent (clean-room) implementation** referencing only public standard documents and general WebRTC/NAT-traversal knowledge.
No external copyleft (GPL/AGPL) code is referenced whatsoever.


---

## Implementation Roadmap Summary

```
v1a (current): xcap + tungstenite + JPEG ~10fps
     + change-detection frame skip (static screen ~0 bandwidth, raw memcmp) ← implemented and measured 2026-06-15
     + opt-in --scale downscale (Retina 0.5 → frame ~71%↓) ← implemented and measured 2026-06-15
     ↓
v1b-1: screencapturekit + VideoToolbox H.264 low-latency → replaces WebSocket JPEG
       (validate the HW encoder first, without webrtc)
     ↓
v1b-2: webrtc-rs PeerConnection + TrackLocalStaticRTP
       add the bridge signaling WebSocket endpoint
       ICE host-only (LAN first)
     ↓
v1b-3: TWCC interceptor + GCC bitrate adaptation
       PLI/LTR handling
       ICE Restart reconnection logic
     ↓
v1c (future): HEVC/AV1 HW codec, Simulcast, SVC
```

---

## Full Reference List

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
