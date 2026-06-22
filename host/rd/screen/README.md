# screen

License-clean screen-capture sidecar for **Xpair Remote Desktop** — the v1
high-performance path that replaces the v0 `ssh` + InputServer screenshot polling.

> **Status: v2 (WebRTC) SHIPPED — `serve-webrtc` is the product path.**
> `serve-webrtc` captures the primary display via `rp-screencap` (ScreenCaptureKit
> + VideoToolbox **hardware** H.264, one process, IOSurface zero-copy, GPU-scaled,
> on-change), streams it over **webrtc-rs** (DTLS/SRTP, UDP/ICE host candidates —
> loopback/LAN/VPN) into the IDE's `<video>`. Remote Desktop is view-only and
> does not open `rp-ctl` or `rp-move`; the IDE closes/ignores any host-created
> DataChannel and never forwards pointer, wheel, text, or keyboard input.
> Verified end-to-end from the real IDE (RD panel → peer "connected" → 30fps H.264).
>
> `serve` (v1a: WS + JPEG continuous capture) remains as a license-clean fallback
> and capture-foundation proof, but the shipping Remote Desktop is **v2**.
> Still future (see roadmap): TWCC/GCC bitrate adaptation, HEVC/AV1, ICE-restart
> reconnection.

---

## What this is (and is not)

| | v0 (legacy) | v1a (fallback) | **v2 (SHIPPED — product path)** |
|---|---|---|---|
| Path | `ssh` + InputServer **screenshot polling** | WebSocket + JPEG, continuous capture | **Native capture → HW encode → WebRTC** |
| Lives in | the IDE extension | this Rust sidecar (`screen serve`) | this sidecar (`screen serve-webrtc`, `webrtc` feature) |
| Encode | per-frame PNG | per-frame JPEG (software, quality knob) | **VideoToolbox H.264 (hardware), `rp-screencap`** |
| Transport | poll over `ssh` | WS binary frames over `ssh -L` tunnel | **WebRTC (SRTP/DTLS, UDP/ICE); signaling WS over `ssh -L`** |
| Input | InputServer (legacy only) | — | **None — view-only; no remote input DataChannels** |
| Latency | high (poll + PNG per frame) | medium (~10fps continuous stream) | **low (HW codec, continuous, ~30fps)** |
| Client renders | polled PNGs | JPEG frames into a `<canvas>`/`<img>` | **a live `<video>` element (native H.264 decode)** |
| Status | superseded | **done** (fallback) | **done — shipping in 0.5.0** |

The v0 path (in production in the IDE extension) takes a screenshot on the host,
ships it over `ssh`, and the client repaints — simple but high-latency and
bandwidth-heavy. **v1a** keeps a persistent capture loop on the host, JPEG-encodes
each frame, and streams the bytes over a WebSocket so the client paints a steady
~10fps feed into a `<canvas>`/`<img>`. **v1b** will swap the software JPEG path for
hardware H.264/HEVC over WebRTC so the client just renders a `<video>`.

### Pipeline: v1a (now) → v1b (planned)

```
  ┌──────────────────── host (screen serve) — v1a SHIPPED ───────────────────┐
  │                                                                                        │
  │   xcap (capture frames)  ──▶  image crate: JPEG encode  ──▶  tungstenite WS server     │
  │        ▲                       (software, --quality)         (binary frames, 127.0.0.1)│
  │   needs its OWN Screen                                                  │               │
  │   Recording TCC grant                                                   │               │
  └────────────────────────────────────────────────────────────────────────┼─────────────┘
                                                   ssh -L <localport>:127.0.0.1:<port>      │
                                                                            ▼
                                            IDE webview: ws://127.0.0.1:<localport>
                                            paints JPEG into <canvas>/<img>

  ── v1b (planned upgrade) ───────────────────────────────────────────────────────────────
     xcap/ScreenCaptureKit  ──▶  VideoToolbox HW encode (H.264/HEVC)  ──▶  webrtc-rs (SRTP)
                                                                            ▼  client <video>
```

---

## What works right now

```sh
# Capture ONE frame of the primary display and write a PNG (proves the path).
screen capture --out /tmp/frame.png
#  -> captured 3024x1964 frame -> /tmp/frame.png

# Print the dimensions + metadata of every connected display.
screen info
#  -> 1 display(s):
#  ->   [0] Display #41057: 1512x982 @ 2x (primary)

# v1a: continuous-capture WebSocket JPEG frame server (loopback only).
screen serve --port 8889 --fps 10 --quality 60
#  -> screen serve: listening on ws://127.0.0.1:8889 (fps=10, jpeg quality=60, ...)
#  (binds 127.0.0.1:8889; at 10fps captures + JPEG-encodes the primary display
#   and sends each frame as a binary WS message to connected clients; skips
#   capture entirely when no client is connected. Ctrl-C to stop.)
```

`serve` flags: `--port` (default **8889**), `--fps` (default **10**), `--quality`
(JPEG 1-100, default **60**). All three of `capture`, `info`, `serve` exercise the
live capture backend and need the binary's own Screen Recording grant.

### How the IDE client renders v1a frames

The server sends each JPEG as a single **binary** WebSocket message. A minimal
browser/webview client:

```js
const ws = new WebSocket("ws://127.0.0.1:8889");
ws.binaryType = "arraybuffer";
const img = document.querySelector("img#remote");      // or draw to a <canvas>
let url;
ws.onmessage = (ev) => {
  if (!(ev.data instanceof ArrayBuffer)) return;
  if (url) URL.revokeObjectURL(url);                   // free the previous frame
  url = URL.createObjectURL(new Blob([ev.data], { type: "image/jpeg" }));
  img.src = url;
};
```

---

## Build

```sh
export PATH="$HOME/.cargo/bin:$PATH"   # cargo 1.96+
cd native/screen
cargo build --release
./target/release/screen info
```

Built and verified on **macOS arm64** (Apple Silicon), Rust 1.96.

### Capture backend choice

| crate | license | verdict |
|---|---|---|
| `scap` | MIT | **rejected on this toolchain** — its ScreenCaptureKit backend (`cidre`) runs `xcodebuild` in `build.rs`, which fails on broken/partial Xcode installs. Tried first per plan. |
| `screencapturekit` | MIT | viable alternative, stream-oriented API. |
| **`xcap`** | **Apache-2.0** | **chosen** — simple synchronous one-shot API (`Monitor::all()` → `monitor.capture_image()` → `image::RgbaImage`), no `xcodebuild` dependency, builds cleanly on macOS arm64, and is Apache-2.0 (same license as Xpair). |

All three are permissive; the decision was driven by **build reliability**, not
license. `xcap` re-exports the `image` crate, so the captured frame encodes to
PNG with no version skew.

---

## License — first-party engine, permissive deps only

Xpair is **AGPL-3.0-or-later** (dual-licensable — we own the copyright).
This is pure first-party code. To keep the dual-licensing option, every
dependency stays **permissive** (MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode /
MPL-2.0); AGPL is allowed only for our own crate. The policy is enforced
mechanically by **`cargo-deny`** (`deny.toml`):

```sh
cargo install cargo-deny    # one-time (slow)
cargo-deny check licenses   # permissive-only allow-list (own crate excepted)
cargo-deny check            # licenses + bans + sources + advisories
```

> **Note:** `cargo-deny` is **not** required to build — it is the CI gate. A manual
> audit of the locked crate tree (via `cargo metadata`) confirms permissive-only
> dependencies; the only GPL token is `r-efi`'s `MIT OR Apache-2.0 OR
> LGPL-2.1-or-later`, which resolves to a permissive option. Capture uses
> `scap` (MIT).

---

## Integration with Xpair (v1a deployment)

The intended topology for v1a:

1. **Host** runs `screen serve` (it binds **127.0.0.1 only** — never
   a routable interface). The sidecar binary needs its **own Screen Recording
   TCC grant** — macOS scopes the permission per-binary, so the host app's grant
   does not cover this binary. It must be a **signed** binary so the grant
   survives updates (Xpair already distributes via Homebrew cask for exactly
   this reason). If the grant is missing, the WS transport still serves clients
   but captured frames come back **black/empty**.
2. **Client** opens an `ssh -L` tunnel that forwards a local port to the host's
   loopback port:

   ```sh
   #          local      host-side (loopback on the host)
   ssh -L 8889:127.0.0.1:8889 <host>
   ```

   The tunnel provides the transport encryption — that is why the sidecar itself
   ships **no TLS** and binds loopback only.
3. The **IDE webview** connects `ws://127.0.0.1:8889` through the tunnel and
   paints each binary JPEG message into a `<canvas>`/`<img>` (see the snippet in
   *What works right now*), replacing the v0 poll-and-repaint loop.

This is the v1a path. v1b swaps the software JPEG encode + WS transport for
VideoToolbox HW encode + WebRTC (`<video>` client), but keeps the same
loopback + `ssh -L` deployment shape.

---

## Roadmap

### v1a — WS + JPEG continuous capture (DONE, this crate)

- [x] License-clean capture foundation (`capture`, `info`) building on macOS arm64.
- [x] `cargo-deny` AGPL firewall (`deny.toml`).
- [x] Continuous capture loop with frame pacing (`--fps`).
- [x] Software JPEG encode (`image` crate, `--quality`).
- [x] WebSocket transport (`tungstenite`, MIT) over std `TcpListener`/threads,
      loopback bind, binary frames, skip-when-idle, clean connect/disconnect.

### v2 — HW encode + WebRTC (SHIPPED in 0.5.0)

- [x] VideoToolbox hardware H.264 encode via `rp-screencap` (SCK + VT, one process).
- [x] **WebRTC transport via `webrtc-rs`** (MIT/Apache-2.0) behind the `webrtc`
      feature flag in `Cargo.toml`. Signaling WS, ICE (host candidates), DTLS/SRTP.
- [x] Client `<video>` rendering in the IDE extension (`media/remote-desktop.js`).
- [x] On-change capture / GPU scale in `rp-screencap` to cut bandwidth.
- [x] View-only policy enforced in the IDE: no client pointer, wheel, text, or
      keyboard capture; legacy host-created input DataChannels are closed/ignored.
- [x] Per-binary Screen Recording TCC grant on the signed capture helper
      (`rp-screencap`), preserved across cask updates.

### v2.x — robustness / quality (future)

- [ ] TWCC/GCC bitrate adaptation; HEVC/AV1 codecs.
- [ ] ICE-restart + full-reconnect on network change.

---

## License

Apache-2.0. See the repository root `LICENSE`.
