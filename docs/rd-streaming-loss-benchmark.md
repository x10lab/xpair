# RD Streaming Loss Benchmark (autoresearch harness)

Design doc for a **deterministic, scriptable benchmark** that reproduces and
scores Remote Desktop (RD) frame-rate degradation, intended to drive an
autoresearch optimization loop.

## Problem under test

RD streams fine for the first few minutes, then frame rate degrades severely and
progressively while **host CPU climbs**. The transport is WebRTC (H.264, HW
VideoToolbox encode on the macOS host, native Chromium decode in the IDE
webview).

### Leading hypothesis: keyframe feedback spiral

1. An H.264 IDR keyframe is ~76 KB → fragments into **~64 RTP packets** at a
   ~1200 B MTU.
2. An IDR is **atomic**: losing any single one of those packets makes the whole
   frame undecodable. `P(keyframe unusable) = 1 - (1-p)^64` — at p=0.5% per-packet
   that is already ~27%, at p=1% ~47%.
3. On loss the client sends RTCP **PLI/FIR**; the host responds by forcing a
   fresh IDR (`serve_webrtc.rs` RTCP reader → `control.keyframe_noack`), with
   **no debounce / rate limit**.
4. Each forced IDR is large → likely to lose a packet again → another PLI →
   another IDR. Positive feedback. Bitrate is fixed (no adaptation), so the loop
   never self-corrects; it ratchets up until CPU saturates and FPS collapses.
5. Forced IDRs are expensive to encode (intra-only) and to packetize/SRTP-encrypt
   → **CPU climbs** as keyframe frequency rises.

Big atomic keyframes defeat UDP's "lose a packet, drop the frame, move on"
model — the proper fix is **packet-level recovery (NACK/RTX)** plus **adaptive
bitrate** plus a **PLI cooldown**, not re-sending whole frames.

> **Critical caveat:** the benchmark must be able to *falsify* this hypothesis,
> not just confirm it. See Axis A (no-loss control) below.

## Benchmark structure

Do **not** wait 3–5 min for organic loss — it is slow and non-deterministic.
Force the failure condition and keep runs short, reproducible, and machine-scored.

### Two measurement axes (run both, compare)

- **Axis A — no-loss control (10+ min long run).** No injected impairment.
  Isolates *time-dependent* causes from *loss-dependent* ones. If CPU /
  encode-time / RSS climb here **with zero injected loss**, the root cause is
  time-based (thermal throttling, memory leak, controller windup), **not** the
  keyframe spiral. This axis is what makes the benchmark falsifiable.
- **Axis B — loss injection (60–90 s).** Force packet loss / latency so the
  spiral (if it exists) develops in seconds.

### Impairment injection (Axis B)

- macOS: `dnctl` + `pfctl` (dummynet) pipe on loopback.
- Profiles (at minimum): `1% loss / 50 ms RTT`, `3% loss / 100 ms RTT`.
- Include both **steady** (continuous mild loss) and **burst** (periodic spikes)
  profiles — they exercise different mechanisms (NACK helps steady; PLI-cooldown
  helps burst recovery).
- Real loss is **bursty (Gilbert-Elliott)**; dummynet default is uniform random.
  Bursty loss hurts keyframes far more — note the model gap, prefer a
  Gilbert-Elliott profile where feasible.
- Verify the WebRTC packetizer's configured MTU: loopback MTU is ~16 KB, but
  webrtc enforces its own ~1200 B chunking, so the "~64 packets/keyframe"
  reasoning still holds. Confirm, don't assume.

### Deterministic content source

HW-encoder output is content-dependent; randomness ruins comparability.

- Drive a **fixed, deterministic screen source** (test pattern with known,
  repeatable motion).
- Test at least two content profiles: **static (mostly text)** and
  **high-motion** — bitrate shape differs drastically, and SCK skips idle frames.

### Determinism guards (or autoresearch chases noise)

- **Cooldown between runs** — HW-encoder thermal state contaminates the next run.
- **Baseline variance first** — run the baseline 3× and compute stddev. Any
  improvement smaller than that stddev is noise, not signal.
- Pin / record background machine load.

## Metrics

Optimize the **mechanism**, not just the symptom — and guard against reward
hacking.

### Primary (perceptual + anti-reward-hack)

- **Freeze ratio** — `totalFreezesDuration / wall-clock` (receiver `getStats`).
  Average FPS can look fine while the viewer suffers 2 s freezes; for
  pair-programming, freezes matter more than mean FPS.
- **Time-to-recover** — after a forced loss burst, time until a clean image
  returns (black/corrupt duration).

> Why not "keyframe bytes/sec" as the sole primary? Optimizing it alone teaches
> the degenerate solution **"ignore all PLI, never send keyframes"** → keyframe
> rate 0, viewer permanently black/corrupt. Recovery + correctness metrics must
> anchor the objective.

### Mechanism (diagnostic)

- **PLI / FIR rate** and **keyframe bytes/sec** — direct probes of the spiral.
- **`qualityLimitationReason` / `qualityLimitationDurations`** (sender stats) —
  `cpu` vs `bandwidth` vs `none`. Directly disambiguates the core ambiguity
  (CPU-bound vs network-bound). Free from `getStats`; should be a top diagnostic.

### Correctness

- **Image fidelity** — SSIM/PSNR of the decoded frame against the known
  deterministic source (or at minimum decode-error counts). None of the
  throughput/timing metrics check "is the picture actually right."

### Guardrails (must not regress)

- **Per-process CPU** slope — attribute to **rp-screencap** (encode/thermal) vs
  **serve-webrtc** (SRTP / retransmit packetizing) vs **browser decoder**. Each
  implies a different fix; "CPU climbs" is meaningless without the process split.
- **Encode time / frame** slope (`totalEncodeTime`/`framesEncoded`) — thermal
  throttling signal.
- **Host process RSS** slope — leak signal (relevant to Axis A).
- **Thermal pressure** — `pmset -g therm` / thermal state, sampled over time.
- **QP** (`qpSum`/frames) — bitrate starvation blurs the image; "FPS retained"
  ≠ "quality retained."
- **E2E latency p95** — ensure NACK retransmission doesn't trade FPS for latency.
- **FPS retention** = `fps(last 30s) / fps(first 30s)` — downstream symptom,
  kept as a guardrail not the primary.

### Composite score (illustrative)

```
score = w1 * (1 - freeze_ratio)
      + w2 * recovery_speed
      - w3 * pli_rate
      - w4 * cpu_slope            # per-process, encode side
      - w5 * max(0, qp - qp_base)
      - w6 * max(0, e2e_p95 - e2e_base)
constraint: image_fidelity (SSIM) >= floor   # hard gate; kills "never send keyframe"
```

Average across loss profiles × content profiles. Lead with freeze/recovery so the
loop cannot escape into a black screen.

## Instrumentation status

Partial scaffolding already exists:

- `client/ide/remotepair/ext/media/remote-desktop.js` — `getStats` polling
  (~5 s cadence). Extend to emit the receiver metrics above at 1 s cadence.
- Host side (`host/rd/screen/src/serve_webrtc.rs`) — tracing counters for
  dropped / forwarded AUs (every 30th). Add keyframe-bytes and PLI counters.

## autoresearch evaluator contract

- One harness invocation → one JSON blob → one scalar score (strict contract).
- Fixed loss profiles + seeds for reproducibility.
- Record the **baseline (current code) score with stddev** first; each iteration
  is gated on beating baseline beyond that stddev.

## Candidate fixes this benchmark should discriminate

1. **NACK / RTX** (packet-level retransmission) — the structural answer; recover
   the lost packet instead of re-sending the whole 76 KB IDR. webrtc-rs
   interceptor + codec `nack` feedback + SDP negotiation.
2. **Adaptive bitrate** — drive `AverageBitRate` from RTCP receiver-report loss;
   smaller keyframes → fewer packets → lower loss probability.
3. **PLI cooldown** — debounce forced keyframes (e.g. ignore PLI within N ms of
   the last forced IDR); safety net for genuine, unrecoverable loss.
4. *(stretch)* **Periodic intra-refresh** — spread intra macroblocks across
   frames to eliminate the big atomic IDR. Feasibility gated on VideoToolbox
   exposing the knob (uncertain).

## Open question (informs Axis weighting)

When degradation is observed live: does the image **blur (QP)**, **freeze**, or
just go **sparse (FPS)**? And does the **Mac get hot / fans spin up**? These two
observations largely separate the thermal hypothesis from the spiral hypothesis
and should set the initial weight between Axis A and Axis B.
