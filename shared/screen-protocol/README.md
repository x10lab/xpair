# shared/screen-protocol — Screen Protocol Single Source of Truth (SoT)

Declares the **Host↔IDE wire contract** for Xpair Remote Desktop in one place.
The implementation is split across two locations (rs = host engine, ide = client webview), and this SoT
fixes the constants and formats the two must agree on. Drift is caught by `check-screen-protocol.sh`.

## Data Flow
```
[host/rd/ host]                          [client/ide/ client (webview)]
screen serve  ──JPEG──▶   remote-desktop.js
  ws 127.0.0.1:8889        (binary)   WS→Blob(jpeg)→createImageBitmap→canvas
        ▲ ssh -L 8889 tunnel
serve-webrtc :8890 (v2)   ──H.264──▶  v2 peer connection (WebRTC)

[the input up-channel is separate — not WS]
webview {type:click,rx,ry / key,combo}  ──postMessage──▶  extension.js
extension → host InputServer file channel: /tmp/xpair.input-req|-res
  click\t<x>\t<y> (host pixels) · key\t<combo> · shot\t<path>(v0)
```

## Contract (`constants.json`)
| Area | Value |
|------|-----|
| v1a frame | `ws://127.0.0.1:8889`, binary whole-frame JPEG, `ssh -L` tunnel |
| v2 WebRTC | signaling `127.0.0.1:8890`, H.264/WebRTC |
| v0 fallback | ssh screenshot polling, switches in auto after ~4s with no frame |
| Capture parameters | fps 1–120 · quality 1–100 · scale 0.1–1.0 |
| Input channel | InputServer `/tmp/xpair.input-req`/`-res`, `<verb>\t<args>` |
| Input verb | `shot` · `click\t<x>\t<y>`(pixels) · `key\t<combo>`, throttle 120ms |
| Coordinates | webview-relative 0..1 → extension converts to pixels |
| webview→ext message | click·key·ready·v1Dimensions·v1Error·v1FirstFrame·v2Error·v2FirstFrame |

## Consumers
| Consumer | Implementation |
|--------|------|
| `host/rd/screen/src/serve.rs` | v1a WS+JPEG server (port 8889 default) |
| `host/rd/screen/src/serve_webrtc.rs` | v2 WebRTC (signaling 8890) |
| `client/ide/remotepair-ext/extension.js` | tunnel · InputServer forwarding · port constants (SIDECAR/SIGNAL) |
| `client/ide/remotepair-ext/media/remote-desktop.js` | webview rendering · input capture · message vocabulary |

## Usage
```bash
shared/screen-protocol/check-screen-protocol.sh   # verify rs↔ide consistency
```
When changing ports, verbs, or throttles, fix this file first, then align both consumers.

## Future
Using build-time codegen to **generate and inject** these constants into rs (Rust const) / ext (JS const)
would go beyond declare-and-verify and make this a true single source (covered in G004 IdeSelfContainment).
