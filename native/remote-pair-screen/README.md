# remote-pair-screen

License-clean screen-capture sidecar for **RemotePair Remote Desktop** — the v1
high-performance path that replaces the v0 `ssh` + InputServer screenshot polling.

> **Status: HONEST SCAFFOLD / foundation.**
> The capture path is real, builds, and runs. The WebRTC transport is a stub.
> This is the v1 *capture foundation + license firewall*, **not** the finished
> WebRTC screen-share product (that is multi-week work — see the roadmap below).

---

## What this is (and is not)

| | v0 (shipped today) | v1 (this crate) |
|---|---|---|
| Path | `ssh` + InputServer **screenshot polling** | Native capture → HW encode → WebRTC |
| Lives in | the IDE extension | this Rust sidecar (`remote-pair-screen`) |
| Latency | high (poll + PNG over ssh per frame) | low (continuous stream, HW codec) |
| Client | renders polled PNGs | renders a live `<video>` element |
| Status | **done** | capture **scaffolded + building**; transport **TODO** |

The v0 path (already in production in the IDE extension) takes a screenshot on the
host, ships it over `ssh`, and the client repaints — simple but high-latency and
bandwidth-heavy. v1 keeps a persistent capture stream on the host, encodes it with
the platform hardware codec, and pushes it to the client over WebRTC so the client
just renders a `<video>`.

### v1 pipeline (target)

```
  ┌──────────────────────── host (remote-pair-screen serve) ────────────────────────┐
  │                                                                                   │
  │   xcap / ScreenCaptureKit  ──▶  VideoToolbox HW encode  ──▶  webrtc-rs transport  │
  │   (capture frames)              (H.264/HEVC, low-lat)        (SRTP / DTLS)        │
  │        ▲                                                          │               │
  │   needs its OWN Screen                                            │               │
  │   Recording TCC grant                                            ─┼─ signaling    │
  └──────────────────────────────────────────────────────────────────┼──────────────┘
                                                                       ▼
                                                          client renders <video>
```

Today, **only the leftmost box (capture) is implemented.** `serve` is a stub.

---

## What works right now

```sh
# Capture ONE frame of the primary display and write a PNG (proves the path).
remote-pair-screen capture --out /tmp/frame.png
#  -> captured 3024x1964 frame -> /tmp/frame.png

# Print the dimensions + metadata of every connected display.
remote-pair-screen info
#  -> 1 display(s):
#  ->   [0] Display #41057: 1512x982 @ 2x (primary)

# Stub for the v1 transport (not implemented):
remote-pair-screen serve
#  -> v1 webrtc transport: TODO (see README)
#  (exits 0)
```

`capture` and `info` are real and exercise the live capture backend. `serve`
prints a TODO pointer and exits 0 — the streaming/encode/transport pipeline is
the remaining work.

---

## Build

```sh
export PATH="$HOME/.cargo/bin:$PATH"   # cargo 1.96+
cd native/remote-pair-screen
cargo build --release
./target/release/remote-pair-screen info
```

Built and verified on **macOS arm64** (Apple Silicon), Rust 1.96.

### Capture backend choice

| crate | license | verdict |
|---|---|---|
| `scap` | MIT | **rejected on this toolchain** — its ScreenCaptureKit backend (`cidre`) runs `xcodebuild` in `build.rs`, which fails on broken/partial Xcode installs. Tried first per plan. |
| `screencapturekit` | MIT | viable alternative, stream-oriented API. |
| **`xcap`** | **Apache-2.0** | **chosen** — simple synchronous one-shot API (`Monitor::all()` → `monitor.capture_image()` → `image::RgbaImage`), no `xcodebuild` dependency, builds cleanly on macOS arm64, and is Apache-2.0 (same license as RemotePair). |

All three are permissive; the decision was driven by **build reliability**, not
license. `xcap` re-exports the `image` crate, so the captured frame encodes to
PNG with no version skew.

---

## License rationale — the AGPL firewall

RemotePair is **Apache-2.0**. The obvious "just use RustDesk" shortcut is a
**license trap**: RustDesk (and its capture crate `scrap`, server, and
`hbb_common`) are **AGPL-3.0**. Linking AGPL code into an Apache-2.0 product, or
shipping it as a network service, would force the whole product under AGPL. So:

- **No RustDesk. No AGPL. No GPL. No LGPL-only crates.** Ever.
- Every dependency is **MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode / MPL-2.0**.
- The policy is enforced mechanically by **`cargo-deny`** (`deny.toml`):
  - `[licenses] allow = [...]` — permissive allow-list; anything else fails.
  - `[bans] deny = [...]` — explicitly bans `rustdesk`, `rustdesk-server`,
    `scrap`, `hbb_common` by name as belt-and-suspenders.

```sh
cargo install cargo-deny    # one-time (slow)
cargo-deny check licenses   # the AGPL gate
cargo-deny check            # licenses + bans + sources + advisories
```

> **Note:** `cargo-deny` is **not** required to build. It is the CI gate. A manual
> audit of the locked 289-crate tree (via `cargo metadata`) confirms: zero
> viral-GPL-only deps, zero RustDesk-family crates, zero unlicensed crates. The
> only GPL token in the tree is `r-efi`'s `MIT OR Apache-2.0 OR LGPL-2.1-or-later`,
> which resolves to a permissive option.

Do **not** confuse `scap` (MIT, the crate we evaluated) with `scrap` (AGPL,
RustDesk's capture crate). The latter is banned in `deny.toml`.

---

## Integration with RemotePair

1. **Host** ships and runs `remote-pair-screen serve` (once implemented). The
   sidecar binary needs its **own Screen Recording TCC grant** — macOS scopes the
   permission per-binary, so the host app's grant does not cover this binary. It
   must be a **signed** binary so the grant survives updates (RemotePair already
   distributes via Homebrew cask for exactly this reason).
2. The sidecar captures the display, hardware-encodes, and serves a WebRTC stream.
3. **Client** renders the stream in a `<video>` element (replacing the v0
   poll-and-repaint loop).

The capture step is what this scaffold proves works license-clean. Wiring up
encode + transport + signaling + the client `<video>` integration is the v1
build-out.

---

## Roadmap (remaining v1 work — multi-week)

- [x] License-clean capture foundation (`capture`, `info`) building on macOS arm64.
- [x] `cargo-deny` AGPL firewall (`deny.toml`).
- [ ] Continuous capture stream (not single-shot) with frame pacing.
- [ ] VideoToolbox hardware H.264/HEVC encode.
- [ ] **WebRTC transport via `webrtc-rs`** (MIT/Apache-2.0) behind the existing
      `webrtc` feature flag in `Cargo.toml`. Signaling, ICE, SRTP.
- [ ] Client `<video>` rendering + the v0 → v1 cutover in the IDE extension.
- [ ] Input forwarding parity with the v0 InputServer path.
- [ ] Per-binary Screen Recording TCC grant + code signing in the release flow.

---

## License

Apache-2.0. See the repository root `LICENSE`.
