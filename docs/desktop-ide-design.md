# RemotePair Desktop IDE — Design Document

A desktop IDE like Cursor. The core driver is **Claude Code + OpenAI Codex VS Code extension compatibility**, and this constraint forces the entire architecture.

> Extension compatibility ⟹ a real VS Code architecture (extension host + web workbench) ⟹ **Electron is mandatory** (Tauri / native WebView cannot bring up the workbench — Cursor, Windsurf, and VSCodium are all Electron) ⟹ **desktop VS Code OSS = a VSCodium fork** (not a browser code-server web-attach).

We embed an "remote access = screen share" tab (the host macOS screen) **inside** that app. The previous custom vanilla-JS SPA shell is discarded. **The M1–M6 backend is reused as-is** — the IDE is the "face" and the brain is the `remote-pair` CLI + python bridge, permissions are the host `RemotePairHost.app` daemon, and approve is the CLI path.

## Confirmed Facts
- Claude Code = Open VSX `Anthropic/claude-code` 2.1.177 ✓
- OpenAI (including Codex) = Open VSX `openai/chatgpt` 26.5609.30741 ✓
- open Remote-SSH = Open VSX `jeanp413/open-remote-ssh` 0.1.2 ✓
- noVNC MPL-2.0 · websockify LGPL/BSD (bundling OK) · screen share = in-house `host/rd/screen` (AGPL-3.0, permissive Rust crates only)
- RemotePair = AGPL-3.0-or-later · the build **requires the node 22.22.1 nvm pin** (not system node 25)

## Invariants
- The host `.app` = permission daemon only (no server inside). CLI/bridge = the brain. approve = CLI→router (a child of the app). The IDE shells out to the CLI when needed.
- The IDE is a **separate app with a separate bundle id `com.x10lab.remotepair-ide`** (unrelated to the host daemon `com.x10lab.remote-pair-host`). Unifying the bundle id remains deferred to v0.5.0.

## Locked Decisions
- **Base**: a VSCodium fork → a separate repo `ghyeongl/remotepair-ide` (not vendored into remote-pair, an upstream remote).
- **Toolchain**: nvm node 22.22.1 + brew (python3.11, rustup, jq, imagemagick, png2icns, librsvg). arm64-only.
- **Branding**: VSCodium env (`APP_NAME=RemotePair`, `BINARY_NAME=remotepair`, `ORG_NAME=x10lab`, `darwinBundleIdentifier=com.x10lab.remotepair-ide`, `GH_REPO_PATH=ghyeongl/remotepair-ide`). product.json overlay → `extensionsGallery`=Open VSX + `linkProtectionTrustedDomains`.
- **Bundled extensions (built-in)**: claude-code, openai/chatgpt, Remote Desktop noVNC webview. (Fall back to first-run installation if brittle.)
- **Files/terminal**: `open-remote-ssh` primary (direct host fs + terminal = host tmux-aqua = claude session). Syncthing/Mount are the fallback.
- **Remote Desktop tab**: an Electron BrowserView (the workbench webview's CSP blocks localhost iframes). v0 = noVNC+websockify (SSH -L) for macOS screen sharing (vnc://host:5900). v1 = a Rust sidecar.
- **RemotePair built-in extension**: bridge spawn + Remote Desktop tab + notifications + commands + walkthrough.
- **Mandatory onboarding steps**: permissions (AX/SR) guidance + role + SSH/host + **file access setup** — the backend choice (open-remote-ssh / Syncthing / Mount) **and the mount target or mapped folder must be configured in onboarding**. Onboarding is to be implemented as two separate Electron windows (one embedded in the host `RemotePairHost.app`, one in the RemotePair IDE), shown on first install, based on the React/shadcn mockup — not yet built; the prior browser-based web wizard was removed. The folder-mapping + sync-backend (syncthing/mount) steps are part of this onboarding/walkthrough.
- The custom SPA shell is discarded.

### Rust Screen Share (v1, license-clean)
- **Sidecar** (not a napi addon): a new Rust workspace `screen` (a separate directory, out-of-band). Low coupling + avoids the Electron Node ABI pin + crash isolation + an AGPL process-boundary firewall.
- capture `screencapturekit` (MIT) → encode `videotoolbox` (H.264 by default) → `webrtc-rs` (MIT/Apache; SDP/ICE via the token bridge `/api/screen/*`+SSH) → client `<video>` native decode.
- Input back-channel = **reuses the existing InputServer** (click/key, only adding coordinate scaling; does not use CGEventTap).
- The sidecar has its own Screen Recording TCC grant + a stable cert signature. **cargo-deny CI** proves no AGPL contamination.

## Build Phases
0. nvm node22 + brew prereqs, VSCodium fork, **vanilla build green** (the highest-risk gate) — 1–3 days
1. Branding (env) + Open VSX gallery — 1–2 days
2. The 3 extensions bundled as built-in — 2–4 days
3. RemotePair built-in extension (Remote Desktop BrowserView, notifications, commands, walkthrough) + open-remote-ssh (host workspace, tmux-aqua terminal) — 1 week
4. Remote Desktop v0 (noVNC+websockify) + `/api/screen/*` bridge (reuse remote-pair-desktop) — 3–5 days
5. Layout (settings-first) + defaults + **discard the SPA shell** — 1–3 days
6. Packaging/signing (ad-hoc→Developer-ID/notarize) + dmg + cask — 2–4 days
7. (Follow-up) Rust v1 sidecar — 3–5 weeks

> Layout favors settings/saved-workspace/auxiliary-bar, with a minimal `layout.ts` patch only for what cannot be done otherwise.

## Reuse Map (M1–M6 → IDE)
bridge (+ the new `/api/screen/*`) · CLI (editor/desktop/mount/notify/update) · host daemon (tmux-aqua permission inheritance) · InputServer (v1 input) · approve (unchanged) · notification forwarding · Syncthing/Mount (fallback) · stable cert/TCC model (sidecar SR grant) · Tailscale/WireGuard (WebRTC reachability). **Discarded**: the custom SPA shell.

## Needs Confirmation (non-blocking)
- Apple Developer ID now vs later · file backend default (open-remote-ssh vs Mount) · Remote Desktop webview (google/vscode-vnc vs in-house noVNC).

## Verification
Phase0 vanilla .app launch → per-phase launch smoke + **Playwright visual verification** + clean-profile extension check → Claude/Codex Open VSX running → screen share tab renders → terminal tmux-aqua attach → `cargo-deny` green · bundle id separation confirmed → keep the existing run.sh 159/4.

## Risks / Scope
The first vanilla build (600MB–1GB, 20–60 min) is the highest risk → get green before branding. node pin (25 vs 22). Rebase burden = the number of source patches. noVNC×screen-share glitches (v0 is for monitoring, v1 is interactive). The whole thing = **Cursor scale**: v0 ~1.5–3 weeks, v1 Rust +3–5 weeks.

## Implementation Status (2026-06-14)
Fork repo `ghyeongl/remotepair-ide` (VSCodium fork, vscode 1.121), build node 22.22.1 (nvm).
- **Phase 0 ✅** vanilla build + launch verified.
- **Phase 1 ✅** RemotePair branding (dev/build.sh env + root product.json: nameLong=RemotePair, darwinBundleIdentifier=com.x10lab.remotepair-ide). The Open VSX gallery is the VSCodium default. Launch capture confirmed.
- **Phase 2 ✅** Claude Code (anthropic.claude-code 2.1.177) + Codex (openai.chatgpt 26.609.30741) + open-remote-ssh (jeanp413 0.1.2) installed into the .app from Open VSX (`bin/remotepair --install-extension`, without a rebuild). On IDE launch, the CLAUDE CODE · CODEX tabs load and a working capture is confirmed.
- **Phase 3 ✅** RemotePair built-in extension `remotepair-ide/remotepair-ext/` (.vsix 18.97KB): Remote Desktop webview (v0 = existing InputServer `shot` screenshot polling ~1.2s, coordinate-scaled png dims=1344x1008), auto-reveal on startup, first-run AI extension guarantee, open-remote-ssh connect (`openremotessh.openEmptyWindow`), host notification poller, walkthrough 3. Host-verified (injection rejected).
- **Phase 6 ✅** `RemotePair-0.1.0-arm64.dmg` (291MB) packaging + mount verification (ad-hoc, internal distribution).
- **Phase 5 ✅ (wireframe layout)** Reworked the shell layout to match the user's wireframe — achieved with settings + extension (without source patches):
  - **Remote Desktop = a pinned tab ("RD") in the right-hand editor area**. Left activity-bar WebviewView → `createWebviewPanel` (viewType `remotepair.remoteDesktop`) + `pinEditor`. It opens on par with a normal file tab, alongside normal files. Input/streaming (v0·v1) are unchanged.
  - **Left = terminal-centric minimal**: a one-time `setupLayout` (globalState v2 guard) moves the panel to the left (`positionPanelLeft`), closes the default sidebar and auxiliary bar, and opens a terminal → "left terminal (multi-tab) / right editor (RD pin + files)".
  - `configurationDefaults`: native title bar, status bar shown, `startupEditor=none`, panel defaults to left, terminal tabs on the left.
  - Verification: re-launch `.app` screencapture — confirmed the RD pinned editor tab (rendering the host screen) · left zsh terminal tab · sidebar closed · no right auxiliary bar · native top/bottom bars.
  - **Remaining source patch (not started, last-resort)**: change the left rail from the default activity-bar icons → **a "Terminal / Browser / Settings" text-only** rail. This requires modifying the workbench source (higher rebase cost), so it is deferred. A "Browser" (Simple Browser/claude-in-chrome) item is also designed alongside.
- **Phase 7 (scaffold)** Rust sidecar `rs/screen` (formerly `native/screen` — moved to rs/ for monorepo integration) (scap/screencapturekit capture + cargo-deny AGPL firewall). The v1 webrtc transport remains multi-week away. **v1a WS server complete** (tungstenite, JPEG frames ~10fps, locally verified 483KB frames). **Extension v1 WS client complete** (ssh -L tunnel → webview WebSocket → canvas, v0 screenshot-polling fallback, auto-mode 4s watchdog). Host deployment via `client/cli/remote-pair-screen-deploy` (+ the host Screen Recording grant is a manual one-time step).
- **Limitations / user steps**: Remote Desktop in-IDE rendering of the host screen works after the client ssh's **1Password "Approve for all applications" one-time step** (a TCC-grant-like manual step — not auto-approved). Input v0 is coarse (click + key). Precise placement of the left-terminal/right-desktop layout is a polish item. The CLI tunnel is optional (the cargo shim was fixed).
- **Verification method**: since this is an Electron app, visual verification uses `screencapture`+Read instead of Playwright (computer-use request_access does not recognize a freshly-built app). The host uses ssh gh-mac-m1 + InputServer.
