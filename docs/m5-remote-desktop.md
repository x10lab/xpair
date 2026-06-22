# M5 Remote Desktop — Staged Plan

Remote Desktop lets the operator view the host Mac's screen from the client tab
labelled "Remote Desktop". It is view-only: no pointer, wheel, text, or keyboard
input is forwarded to the host. This document records the staged rollout,
license rationale, and integration contracts.

---

## License: AGPL-3.0, first-party engine

RemotePair is AGPL-3.0-or-later. Remote Desktop is powered by our own engine
(`host/rd/screen` — Rust/Swift, permissive dependencies only), not any third-party
screen-share stack.

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

### Client UI integration

The "Remote Desktop" entry point launches `remote-pair-desktop open` on the client machine, which
opens macOS Screen Sharing. The action is fire-and-forget (launch-and-forget; success is reported
back as soon as Screen Sharing is invoked).

### Install

`install.sh --role client` copies `client/cli/remote-pair-desktop` to `$LOCAL_BIN/remote-pair-desktop`
(mode 755) alongside `remote-pair` and `remote-pair-launch`.

---

## v0.5 — In-web low-fps screencapture feed (feasibility)

**Requires:** no new permission grant on the host — Screen Recording (SR) is already granted to
RemotePairHost by the TCC onboarding step.

**Mechanism:** the existing `InputServer` inside the `.app` already has SR permission and uses
`screencapture` / ScreenCaptureKit to capture screenshots for computer-use. We can expose a thin
host-side endpoint (outside the .app — see INVARIANT) that:

1. Runs `screencapture -x -t png -` (or a short AVFoundation snippet) to grab a frame.
2. Returns the PNG as a base64 data URL over SSH stdout, piped back to the client.
3. The client renders the feed, polling at ~1 fps and updating an `<img>` tag.

**Feasibility:** high. `screencapture -x` is stdlib-level (ships with macOS), needs no new binary,
and SR is already granted. The bottleneck is SSH round-trip latency (~50-200 ms), which is
acceptable for a status/monitoring view.

**Constraint:** this is view-only. No input forwarding at this tier.

---

## v1 — WebRTC / ScreenCaptureKit + VideoToolbox

**Requires:**
- A native host-side component using ScreenCaptureKit (macOS 12.3+) + VideoToolbox H.264 encode.
- WebRTC signalling server over an SSH-tunnelled loopback WebSocket.
- Receive-only media in the client webview. The client creates no `rp-ctl` /
  `rp-move` DataChannels and closes/ignores any host-created DataChannel.

Remote control is out of scope unless a later product decision explicitly reopens it.

---

## Integration contracts

| Layer | Contract |
|---|---|
| `install.sh --role client` | Copies `client/cli/remote-pair-desktop` → `$LOCAL_BIN/remote-pair-desktop` (755) |
| `remote-pair` CLI | `desktop` subcommand delegates to `remote-pair-desktop "$@"` |
| Client UI | "Remote Desktop" entry point launches `remote-pair-desktop open` |
| Host prerequisite | Screen Sharing enabled in System Settings (surfaced in onboarding + doctor) |
