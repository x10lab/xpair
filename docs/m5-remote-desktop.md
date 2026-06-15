# M5 Remote Desktop — Staged Plan

Remote Desktop lets the operator view (and eventually control) the host Mac's screen from the client
browser tab labelled "Remote Desktop". This document records the staged rollout, license rationale,
and integration contracts.

---

## License rationale: why not bundle RustDesk

RustDesk is AGPL-3.0. Linking or bundling it into an Apache-2.0 project would require the combined
work to be released under AGPL. We avoid this by keeping any RustDesk usage strictly arm's-length:
the user installs RustDesk independently; our code never ships, invokes, or depends on it.

The macOS-native path (Screen Sharing / `vnc://`) carries zero licensing risk — it is an OS-provided
client and server, not third-party software.

---

## v0 — macOS Screen Sharing (current, arm's-length)

**Script:** `client/cli/remote-pair-desktop`

The script opens `vnc://<REMOTE_HOST>` via macOS's built-in Screen Sharing app
(`/System/Library/CoreServices/Screen Sharing.app`). No extra software is installed on either side.

### Host prerequisite (manual step — like TCC grants)

On the host Mac: **System Settings > General > Sharing > Screen Sharing** (or Remote Management).
This exposes port 5900 (VNC). Optionally set a VNC password in the same panel.

This is a one-time host-side step analogous to granting Accessibility / Screen Recording to
RemotePairHost — it cannot be automated from the client.

### Client usage

```
remote-pair-desktop          # open Screen Sharing to $REMOTE_HOST
remote-pair-desktop check    # verify reachability + port 5900
remote-pair desktop          # via the main CLI (registers 'desktop' subcommand)
```

### Web integration

The "Remote Desktop" tab in the web UI calls `POST /api/desktop/open`.
The web bridge runs `remote-pair-desktop open` on the client machine, which opens macOS Screen
Sharing. The response is fire-and-forget (HTTP 200 + `{"status":"launched"}`).

### Install

`install.sh --role client` copies `client/cli/remote-pair-desktop` to `$LOCAL_BIN/remote-pair-desktop`
(mode 755) alongside `remote-pair` and `remote-pair-launch`.

---

## v0.5 — In-web low-fps screencapture feed (feasibility)

**Requires:** no new permission grant on the host — Screen Recording (SR) is already granted to
RemotePairHost by the TCC onboarding step.

**Mechanism:** the existing `InputServer` inside the `.app` already has SR permission and uses
`screencapture` / ScreenCaptureKit to capture screenshots for computer-use. We can expose a thin
endpoint (in the host-side Python bridge, not the .app — see INVARIANT) that:

1. Runs `screencapture -x -t png -` (or a short AVFoundation snippet) to grab a frame.
2. Returns the PNG as a base64 data URL over SSH stdout, piped through the existing web bridge.
3. The web SPA polls this endpoint at ~1 fps and updates an `<img>` tag.

**Feasibility:** high. `screencapture -x` is stdlib-level (ships with macOS), needs no new binary,
and SR is already granted. The bottleneck is SSH round-trip latency (~50-200 ms), which is
acceptable for a status/monitoring view. For interactive control, v1 is needed.

**Constraint:** this is view-only. No input forwarding at this tier.

---

## v1 — WebRTC / ScreenCaptureKit + VideoToolbox

**Requires:**
- Input Monitoring permission on the host (for keyboard/mouse injection).
- A native host-side component using ScreenCaptureKit (macOS 12.3+) + VideoToolbox H.264 encode.
- WebRTC signalling server (or a direct SSH-tunnelled WebRTC data channel).

**Scope:** out of scope until v1.0. Tracked in `docs/future.md`.

---

## Integration contracts

| Layer | Contract |
|---|---|
| `install.sh --role client` | Copies `client/cli/remote-pair-desktop` → `$LOCAL_BIN/remote-pair-desktop` (755) |
| `remote-pair` CLI | `desktop` subcommand delegates to `remote-pair-desktop "$@"` |
| Web bridge (`remote-pair-web`) | `POST /api/desktop/open` → runs `remote-pair-desktop open` |
| Web SPA | "Remote Desktop" tab button calls the above endpoint |
| Host prerequisite | Screen Sharing enabled in System Settings (documented in onboard + doctor) |
