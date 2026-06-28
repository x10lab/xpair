# rd-enhance — Phase 2 build plan (autoresearch on the loss benchmark)

Design (Claude) → implementation (codex). Runs on **this MacBook Air M1**, which
has the deployed host at `~/.xpair/host/bin/screen` (+ `/Applications/XpairHost.app`).
Host **fix rebuilds go through CI pre-release** (`gh workflow run release.yml -f
version=0.5.1aN` → signed prerelease → install on M1), not local rustup/Xcode.

Spec source of truth: `docs/rd-streaming-loss-benchmark.md` (merged on develop).

## Run target / constraints
- Loopback on M1. `screen serve-webrtc --port 8890 --token @TOKENFILE --fps 30
  --bitrate 4000000 --scale 1`. Standalone mode spawns `rp-screencap` (SCK +
  VideoToolbox) → needs a **Screen Recording TCC grant** for the CLI binary
  (one-time, interactive). gh-mac-m4 (M4) is an alternative when online.
- Media is WebRTC UDP/RTP H.264; signaling is JSON `{offer,answer,candidate}` on
  `ws://127.0.0.1:8890/?token=…`. Host creates the **offer**; client answers
  recvonly.

## Slices (each independently runnable/verifiable)

### Slice 1 — measurement spine (no host rebuild) ← START HERE
Establish: launch host → programmatic client receives H.264 → dump getStats JSON.
- `bench/run-baseline.sh`: write a random token file, launch the deployed
  `screen serve-webrtc`, run the client for N seconds, tear down.
- Client = **headless Chromium via Playwright (node)** (real H.264 decode path):
  connect signaling, setRemoteDescription(offer), addTransceiver video recvonly,
  createAnswer, trickle candidates, then poll `getStats()` at 1 s.
- Emit one JSON per run with: framesDecoded, framesDropped, framesPerSecond,
  **totalFreezesDuration, freezeCount, pauseCount/totalPausesDuration**, jitter,
  bytesReceived/bitrate, **packetsLost / fractionLost**, frameWidth/Height,
  keyFramesDecoded, plus the run config (fps/bitrate/scale, duration, seed).
- PASS = framesDecoded grows > 0 over loopback and the JSON has the freeze +
  packetsLost fields (the doc-required telemetry the production webview lacks).

### Slice 2 — seedable UDP impairment proxy on the media path
- Insert a controlled UDP relay between host and client; force ICE through it by
  making the client offer/accept only the relay candidate (or rewrite SDP/cands).
- Impairment keyed to **normalized RTP seq + transmission attempt** (drop first
  send, pass retransmits); profiles: latency+jitter, Gilbert-Elliott burst,
  large-packet/keyframe-fragment (size-based unless a pre-SRTP tap is added);
  impair RTCP too. Seed → reproducible schedule. Pass-through mode = Axis A.

### Slice 3 — scorer + evaluator contract
- One run → one JSON → one scalar. Normalize per-metric by baseline stddev/epsilon
  (no div-by-zero). SSIM with frame-coverage gate (needs decoded-frame capture vs
  deterministic source). Axis A = falsification gate (assert observed loss ~0).
  Record baseline 3× with stddev.

### Slice 4 — candidate fixes (host, via CI pre-release) + autoresearch loop
- PLI cooldown → NACK/RTX → adaptive bitrate (serve_webrtc.rs / CaptureEngine).
- Loop: codex implements fix → CI prerelease → install on M1 → score vs baseline
  beyond stddev, SSIM gate satisfied. Plus qualitative blind-A/B on top-N.

## Telemetry note
`collectVideoStats` in the production webview emits only
decoded/dropped/fps/jitter/bitrate — the bench client must collect the fuller set
above itself (it is a separate client, so no production code change needed for
Slice 1).
