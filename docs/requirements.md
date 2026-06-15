# RemotePair Requirements

This document is a single spec synthesizing what the user actually requested and decided, reconstructed by tracing back through **every Claude Code session** in the RemotePair repository (5 on the local laptop + 4 on host gh-mac-m1, 2 of which are automated runs with no human utterances) and the **2026-06-13 product vision brainstorm**. The sources are the human utterances in those sessions; speculation is excluded. The goal is a level of detail at which a new engineer could implement the M1–M6 roadmap from this document alone.

> For how the code works, see [architecture.md](architecture.md); for later/deferred items, see [future.md](future.md); for end-user install/usage, see the [README](../README.md). This document focuses on "what, why, and how it's verified."

---

## 0. Product Vision / Invariants

This section sets the top-level constraints that no subsequent requirement may violate. The invariants below are not decisions but the **design constitution** — new features must first be checked for consistency with this section.

### 0.1 Role Separation (the low-coupling constitution)
- **The app (`RemotePair.app`) = permission daemon only.** Its responsibilities are exactly three: ① hold AX/SR (and FDA when needed) grants against the designated requirement, ② hold the patched tmux server (`tmux-aqua`) as its own child so permissions are inherited, and ③ run InputServer primitives (shot/click/key) one at a time. Any other logic (install/mapping/approve decisions/HTTP) is **not put** in the app.
- **The CLI (`remote-pair`) = the brain and the SSOT.** Folder mapping, session decisions, approve coordinates, retries, and the onboarding flow are all decided by the CLI. The CLI has no TCC/AX code (it delegates that to the app).
- **approve path**: `remote-pair approve` (CLI) → trigger file → the app runs the router (`remote-pair-approve-router.sh`) **as its own child** (inheriting permissions). claude/skills only "trigger when blocked"; the router decides what to allow and how.
- **Onboarding is decided in the CLI layer, surfaced by the Electron onboarding windows.** The first-run onboarding (§1 Onboarding) is presented by two separate Electron windows — host onboarding embedded in RemotePairHost and client onboarding embedded in the RemotePair IDE — that drive the `remote-pair` CLI and read `status.json` for decisions; **an HTTP/WebSocket server is never put in the host app.** Verification: there must be no socket/HTTP listener in `host/app/*.swift` (the current InputServer uses a file channel only).
- Why: separating the permission boundary (app) from the brain (CLI) lets us ① keep the app at minimal privilege and minimal code (smaller attack surface), ② install the CLI in a single README one-liner (the app does not force-install the CLI), and ③ swap or evolve the GUI (Electron onboarding, native shell) without touching the permission daemon.

### 0.2 Single Source of Truth for State
- `~/.remote-pair` is the single source of truth for all runtime state (config/logs/rules/manifest). It does not depend on cross-device `~/.claude` sync. `~/.claude` holds only the agent identity (approve skill, rules, hooks).
- The ground truth for app liveness + AX/SR/FDA grants is `~/.remote-pair/logs/status.json` (written by the app roughly every second). The agent, CLI, and the onboarding windows read this file instead of guessing via pgrep.

### 0.3 GUI Seam Invariant
- The frontend is **web all the way** (HTML/CSS/JS — here, the Electron React UI). An "app" is just a native shell (Electron, or WKWebView) + a native bridge. The web UI talks to the brain through a stable contract, and going from one shell to another **changes only the bridge implementation**, while **the contract and the web UI are invariant**.
- That is, the React UI and its bridge contract are the replaceable seam: the onboarding React UI renders inside Electron and drives the `remote-pair` CLI / `status.json` through the shell's bridge, so the same UI could later be hosted by a different native shell without rewriting it. Verification: swapping the native shell must leave the React UI and its bridge contract unchanged.

### 0.4 Update Boundary = Permission Boundary (the deployment constitution)
- **What goes into the signed `.app` bundle is decided by "does it need a TCC grant?" — not by "interpreted vs. binary."** It splits into three layers:
  - **`.app` (permission daemon, slow updates)** — things that need a grant: the app itself (AX/SR/FDA) + bundled Helpers (`tmux-aqua`, approve-router, ocr-find, cliclick) + **the screen sidecar (`screen` — needs its own SR grant)**. These are signed and auto-updated together with the app via cask/`Updater`.
  - **glue (zero permissions, fast hot-swap)** — things that need no grant: the CLI (`remote-pair`), approve rules, the skill, the onboarding UI assets, hooks, the IDE extension. `remote-pair update` (L1 hot-swap) fetches these from GitHub and replaces them without restarting the app (not bundled in the app → cask-only hosts update without a repo).
- **The exact meaning of "minimal permission daemon"**: it does not mean stripping out even the permission-requiring components; it means **the daemon embraces only the permission-requiring things and exposes them as base primitives**, while all the UI/CLI/skill/frontend running on top is separated out as zero-permission glue that auto-updates independently. A permission daemon embracing permission-requiring components is not a violation but its reason for being (the violation is embracing zero-permission things). The sidecar is not a fourth responsibility added to the "three app responsibilities" of §0.1; like `tmux-aqua`, it is a **bundled Helper the app supervises on-demand within its own process subtree**.
- **The sidecar is on the app side of the permission boundary**: macOS scopes SR grants per binary, so `screen` needs its **own SR grant** → it must be **bundled in the signed .app** so that (a) the grant survives across updates under the same cert/designated requirement and (b) it auto-updates together on cask updates. The current manual deploy of `~/.remote-pair/bin/screen` (`remote-pair-screen-deploy`) is unsigned and in a user directory, which breaks grant survival → demote it to a dev fallback only.
- Why: the host app can rarely be shipped (re-grant and signing costs). Cutting along the permission boundary lets the frequently-changing Fancy layer (glue) hot-swap without touching the app, while only the rarely-changing permission components are bundled into the signed bundle and move slowly.

---

## 1. Functional Requirements

### Distribution / Install
- Resolve the open-source self-signed signing problem with **Homebrew Cask distribution** — a postflight removes the quarantine so the TCC grant works even when self-signed.
- Provide **prebuilt binaries** for Apple Silicon only, eliminating user-side builds. `tmux-aqua` is embedded in the app bundle (removing a separate binary / brew dependency).
- **Single-command bootstrap** (`curl … | bash`) so first-time users can install without building.
- bootstrap installs only the glue (CLI, approve rules, skill), and for a host it **also auto-installs the app via brew cask**. If brew is missing, it instructs and aborts.
- **Source builds are removed from bootstrap** → maintainer-only (`host/build-*.sh`). (Because brew supplies the app.)
- installer **role separation** (host/client/both) + a Finder Service Quick Action for a 1-minute client install.
- Both install and uninstall are **reversible** (manifest-tracked). All glue installed by bootstrap is recorded in the manifest and reversibly removed (verification: `tests/t_10_install_reversibility.sh`).
- **Release via CI (GitHub Actions)**: push a new tag on each branch → build → on success merge to main. Only new code is released. CI performs it directly (not self-hosted); the p12 is a gh secret (`SIGNING_P12_BASE64` / `_PASSWORD`).
- Release ad-hoc-signing rejection guard + automatic cask `version`/`sha256` bump.
- Versioning policy: pre-1.0. **Host and Client identities are separated** (see §Identity Separation — Host keeps `-host` permanently, Client takes the bare). Independent per-component versions (`shared/identity/versions.json`: host/ide/screen-engine); patches bump by +0.0.1.

### Identity Separation — Host ≠ Client (M1 re-decision, 2026-06-15)
- **Host and Client are not unified in identity; they are separated.** The two apps are too different in nature — the Host is a headless permission daemon running 24/7, the Client is an IDE GUI a person sits in front of. They can coexist on the same machine, so identical names would collide. Therefore the bare identity goes to the user-facing app, the Client, and the Host keeps `-host` permanently.
  - **Host**: `RemotePair Host` / `com.x10lab.remote-pair-host` / cask `remote-pair-host` — **keeps `-host` permanently**. The code already has these values (verification: `shared/config.sh` `APP_NAME=RemotePairHost` / `BUNDLE_PREFIX=…remote-pair-host`, `host/app/Config.swift` fallback `RemotePairHost`, `Casks/remote-pair-host.rb`, the host component in `shared/identity/identity.json`). **No separate rename/migration.**
  - **Client (IDE)**: `RemotePair` / `com.x10lab.remote-pair` / cask `remote-pair` — **the Client takes the bare identity.** The current IDE bundle id is `com.x10lab.remotepair-ide` (`identity.json` ide.darwinBundleIdentifier) → **migrate to `com.x10lab.remote-pair`** + create a new Client cask `remote-pair` (when the IDE ships). Separate from the Host cask.
- **Withdrawn**: the prior "unify (`RemotePairHost`→`RemotePair`, host to bare)" decision (§3, 2026-06-13) is **superseded** by this separation. The `shared/config.sh` "0.5 RELEASE FLIP" comment that raises host to bare is unapplied and canceled. (The earlier §4 note that "unification was applied" was an error — the actual code was always `-host`.)
- **The cert transition (33849F → 898E32) is decoupled from the host rename**: since the host bundle id does not change, the rationale of "bundle rename+cert together for a single re-grant" disappears. Release signing is consolidated under CI 898E32 (maintainer manual signing prohibited), but if the host cert actually changes, a **single re-grant** is independently needed at that time due to the change to the designated requirement (identifier+leaf).
- **dual-id probing**: since the host id is stable, the client CLI's `LEGACY_BUNDLE` / `LEGACY_APP` fallbacks remain not for a host-rename transition but as defensive legacy support only (verification: `tests/t_09_app_resolution.sh`).
- **Source directory cleanup complete** (previously deferred): `host/RemotePairHost/`→`host/app/`, `client/*`→`client/cli/`, `rs/`→`host/rd/`, `ide/`→`client/ide/`, rearranged by role × location. No effect on build artifacts or identifiers (verified by swiftc, tests, and SoT checks). The `RemotePairHost` strings in Swift comments are harmless and left in place. → [docs/monorepo-structure.md](monorepo-structure.md).

### Permissions / TCC
- **AX/SR required, FDA recommended** (to prevent headless folder prompts from stalling a session). What actually uses the FDA permission is not RemotePair logic but the `claude` session inside it.
- **The app cannot toggle permissions** (SIP + non-MDM Mac constraint). The app/wizard only `open`s the relevant System Settings pane; the user toggles it directly on the physical screen. Whether it took effect is detected solely via `status.json`.
- TCC grants are tied to a **stable cert's designated requirement (identifier + leaf)** and survive rebuilds and updates.
- Release binaries must be signed with the **same cert** so grants don't break across machines/updates (= the core rationale for cask distribution). cert backup: `~/Library/Application Support/RemotePair/signing.p12`.
- Granting permissions is a one-time manual step on the host screen (not over SSH) → after toggling, `launchctl kickstart`.
- Minimize requests for unnecessary permissions like microphone/media (it's the child session's doing, not the app's).

### Computer Use / Permission Inheritance
- `claude` must be inside the **permission-holding app subtree (patched tmux-aqua)** so it inherits AX/SR and Computer Use works.
- **InputServer primitive channel**: the CLI (the brain, zero permissions) requests and the app (the permission boundary) executes — `shot`=screencapture / `click`=cliclick / `key`=osascript.
- Keystrokes are **unified on osascript (System Events)** — cliclick synthetic keys don't register in web UIs like the Chrome extension popup.
- `cliclick` (the click primitive) is both bundled and ensured via brew on the host.

### approve Router
- The trigger is a **`remote-pair` CLI call** instead of `touch`. The approve logic exists as a **claude skill** (`~/.claude/skills/approve`).
- **Adaptive polling** — even if the window isn't there yet right after the trigger (the agent brings it up a few seconds later), it waits through the wait window.
- **Verification loop** — re-confirm whether it closed after a click/key, and retry on failure. More retries over a short window lower the failure probability.
- **Hybrid vision** — OCR rules first, haiku classification on a miss. **vision must not become a SPOF** (fallback behavior when the claude call fails).
- Pass an approve **type argument** (which kind of approval — `--type key:..|ocr:..`).
- **cmd+enter first** (= always allow → the window doesn't recur), and on failure enter (to handle modals that don't accept cmd+enter).
- **Bypass Claude for Chrome's site-level permission block** — when the agent recognizes a failure, it retries via fallback.
- Agent-centric + **skill-based tool selection** (when the harness fails, it directs to the approve skill).
- **Do not add persist auto-detection logic** (intentional exclusion).
- The 1Password lock prompt is handled via a hook on bash-tool failure. Reflect the existing m1 hook **exactly identically** in the new hook.
- Also handle, in one pass, the windows that appear when attempting record (recording).

### Onboarding (M1 first milestone)
**What**: guided first-run setup that walks a user end to end on first install. Steps: ① role selection (host/client/both) → ② permissions (AX/SR/FDA one at a time, live detection + a Next step) → ③ TCC re-grant guidance (only when needed) → ④ SSH check → ⑤ folder mapping → ⑥ Syncthing health → ⑦ verification (doctor). The onboarding is delivered as **two separate Electron onboarding windows**: **host onboarding** embedded in RemotePairHost (the host Swift app) and **client onboarding** embedded in the RemotePair IDE (the client VSCodium/Electron app), each shown on first install and scoped to that side's setup.
**Why**: the current onboarding is scattered across CLI prompts (`remote-pair onboard`), physical-screen permission toggles, and SSH key setup, so a first-time user doesn't know "what to do next." Tying it into one guided flow per side, showing live state, gives each role a clear first-run path.

> **Implementation status (2026-06-15)**: **not yet built — blank slate.** The onboarding is being redesigned from scratch as two Electron onboarding windows (host onboarding in RemotePairHost, client onboarding in the RemotePair IDE), based on a React/shadcn mockup (`context/remotepair-onboarding`). The prior browser-based web onboarding wizard — a vanilla SPA plus a python HTTP bridge launched by a `remote-pair web` subcommand — was a pre-VSCodium attempt and has been **removed**; only the web *implementation* is gone, the onboarding *requirement* survives and is being rebuilt in Electron. The Host identity keeps `RemotePairHost` / `com.x10lab.remote-pair-host` permanently (separate from the Client — §Identity Separation).

**How / Verification** (target design for the Electron onboarding, not yet built):
- The UI is a **React/shadcn** front end (per the `context/remotepair-onboarding` mockup) rendered inside each Electron shell — the host window inside RemotePairHost, the client window inside the RemotePair IDE. The UI is a **thin presentation layer**: it drives the `remote-pair` CLI and reads `status.json`, and **does not reimplement install/permission/approve logic** (invariant §0.1).
- Since the app can't toggle permissions (SIP), the onboarding **only opens the relevant settings pane**; the user toggles it on the physical screen. Whether it took effect is reflected **within ~2 seconds, without restarting the app**, by polling `status.json` at ~1.5 seconds.
- Whether a re-grant is needed is determined by comparing the current bundle id old vs. new.
- Security invariant carried over: no HTTP/WebSocket listener is added to the host app (§0.1); the onboarding talks to the brain through the Electron shell's bridge to the `remote-pair` CLI / `status.json`, not a network server.
- Because the onboarding UI is the GUI seam (§0.3), it stays invariant across native-shell changes; only the bridge implementation behind it is replaceable.

### Notification Forwarding (M2 follow-up)
**What**: forward the **completion/Stop/Ask-a-question** notifications and the **approve (approval-type)** notifications from Claude Code running on a host (e.g., gh-mac-m1) to a client (e.g., gh-mac-m4). Which notification kinds are forwarded is toggled in settings.
**Why**: the host runs headless 24/7 and the user sits in front of the client. When a session on the host stalls (waiting on a question/approval) or finishes, if the client doesn't know, it's left unattended.
**How / Verification**:
- The host currently has **only** the `remote-pair-approve-reminder` hook and no client forwarding → a **new Notification/Stop hook** must be added (hooks in `~/.claude/settings.json`). Verification: just as `remote-pair doctor` looks at the approve hook, add registration of the new hook to its check items too.
- The delivery channel is handled in the CLI layer per the low-coupling principle (§0.1) (no notification server is put in the app). The concrete transport mechanism (SSH back-channel / push / client polling) is finalized in the M2 design.
- The settings toggle is exposed in client.env or the onboarding/settings screen. The user chooses which notification kinds (completion/Stop/question/approve) to enable.

> **Implementation status (2026-06-15)**: host-side implemented; client delivery being re-exposed via the Electron IDE. `host/hooks/remote-pair-notify.sh` records Stop/Notification events to `~/.remote-pair/notifications/queue.jsonl`, and `ENABLED_TYPES` filtering is configured via `host/hooks/notify.conf.example` — these survive. The prior client delivery path, the web-bridge `/api/notifications` endpoint (a python HTTP bridge in the removed `client/cli/remote-pair-web` that polled the queue over SSH), was **removed**; the queue is now delivered to the client via the Electron IDE (SSH polling unchanged on the host side). → architecture.md §10-3.

### Session / launch
- Support **1:1 connection only** (session sharing/multi-attach withdrawn). On conflict, go 1:1.
- `remote-pair-launch` is a **faithful 1:1 port** of the reference `claude-iterm-launch` (restoring its robustness behavior).
- **Folder mapping**: client path → host path (contents identical via external sync, absolute paths differ). The base root is `~/Spaces`.
- **Deterministic session names** (host-path-based `<HOST>_…`) — identify the machine by the status bar, and block Korean paths from polluting the conversation.
- **`_N` numbering**: if a client is attached to `_1`, open `_2` fresh; for detached, take over via `attach -d`.
- **resume bug fix**: empty conversations attaching after exit — `--resume` fallback was swallowing failures + a stale SID. Base remote-control/resume/tmux on the same id. Add `--dangerously-skip-permissions`.
- Fix the bug where a new session at a different path inherits (pollutes) an existing session.
- Auto-detect and clean up orphan socket sessions.
- Make onboarding fancy, make iTerm2↔terminal switchable via CLI config, reuse the folder-mapping module.
- Provide a non-interactive option (`--yes`/`RP_YES`).

### File Sync (Syncthing)
- **Keep Syncthing** + add a `doctor` health check. RemotePair does not implement sync itself but delegates it to Syncthing (low coupling).
- **e2e auto-configuration of folder mapping** (lower priority): currently the user configures Syncthing folders manually. → RemotePair will **add folders via both (host/client) Syncthing REST APIs + inject `.stignore`** to set up folder mapping end to end. Optionally, `~/.claude` sync via the same mechanism (a replacement/complement for the current git-backbone opt-in).
- **Keep the exclusion rules**: `.git` (the two sides' git states differ, risking erroneous commit/push) and `.claude/projects/` (size/privacy) are excluded from sync. Sync the working tree only; keep `.git` device-local.
- Verification: `remote-pair doctor` includes reachability of the Syncthing daemon (127.0.0.1:8384) in its healthy verdict. License: Syncthing MPL-2.0 (free to consume/bundle).

### Remote Desktop (M5, on hold)
- **On hold**. v0 = reuse the existing screencapture/InputServer channel, or macOS built-in VNC (Screen Sharing). v1 = WebRTC (ScreenCaptureKit + VideoToolbox HW encoding, with an added Input Monitoring permission).
- License: RemotePair is AGPL-3.0-or-later (pure first-party code). Screen sharing uses the first-party `host/rd/screen` engine.

> **Implementation status (2026-06-15)**: scaffold. `client/cli/remote-pair-desktop` implements an arm's-length launcher for macOS Screen Sharing (VNC) (open/check/help subcommands) and survives; it is invoked via the IDE/CLI. The prior web-bridge invocation, the `/api/desktop/open` endpoint on the removed python HTTP bridge (`client/cli/remote-pair-web`), was **removed**. In-browser streaming (WebRTC) is at the spike stage. → architecture.md §10-5.

**Deployment boundary / interface contract (sidecar, §0.4 applied)**:
- The sidecar (`host/rd/screen`) needs its own SR grant, so it is **on the .app side of the permission boundary** — bundle it in the signed app bundle to simultaneously secure per-binary SR grant survival + cask auto-update. The current manual deploy of `~/.remote-pair/bin/screen` (`remote-pair-screen-deploy`) is kept as a dev fallback only. The bundle+signing is transport-agnostic (the same `screen` binary as v1a/v2 below, differing only by subcommand), so it can be done ahead of the v2 implementation.
- **WebRTC (v2) cuts the permission boundary even more cleanly**: WebRTC's control plane (SDP/ICE **signaling** = bridge `/api/screen/signal/*`, zero permissions → glue) / data plane (capture → VideoToolbox H.264 → RTP, SR needed → sidecar) map 1:1 onto the permission boundary. In v1a (`screen serve`, WS+JPEG) the sidecar carries both transport and frames, but in v2 (`screen serve-webrtc`) the signaling moves out to glue and only "the permission-requiring media essence" remains in the sidecar. → [sidecar-webrtc-design.md](sidecar-webrtc-design.md).
- **Version-skew contract (SoT)**: since the sidecar updates slowly with signing+app and the glue updates fast, a "new frontend ↔ old sidecar" skew is structural. Pin the sidecar↔glue signaling/capability handshake as **versioned** in `shared/screen-protocol`, so the frontend gracefully degrades with the sidecar capability as the floor (during the transition, `serve`/`serve-webrtc` coexist; ports 8889/8890 are reserved). The current `constants.json` has transport ports but no version/capability negotiation fields → add them when v2 begins.
- **Security invariant**: v2 also keeps **loopback + `ssh -L`** (no public rendezvous/STUN/TURN; SSH stands in for TURN, ICE→`turn:127.0.0.1`). SRTP is media encryption only, not a tunnel replacement — the sidecar binds to `127.0.0.1` only, all the way through.

### All-in-One Orchestration (lower priority)
**What**: RemotePair becomes a "conductor" that only **installs, configures, and runs** best-of-breed OSS. It doesn't touch the sources; it orchestrates the components (maintaining low coupling §0.1).
- **Syncthing** (file sync, MPL-2.0), **Tailscale/WireGuard** (zero-config reachability, BSD-3/MIT). Remote Desktop uses the first-party `host/rd/screen` engine.
**License**: RemotePair is **AGPL-3.0-or-later** (pure first-party code).
- The consumed OSS (Syncthing MPL-2.0, Tailscale BSD-3, WireGuard MIT): free to bundle.
- Screen sharing uses no external stack — a first-party engine (permissive deps only). Get legal confirmation before commercial distribution.

### client
- `remote-pair ls` (list host sessions), `remote-pair launch <dir>` (resolve folder mapping, then branch on existence).
- Finder Service "Launch Remote Pair" (right-click a folder).
- `remote-pair config` to change the role (host/client/both) + provide an **interactive option**.
- First-run onboarding is presented by the Electron onboarding window embedded in the RemotePair IDE (client side), driving the `remote-pair` CLI (§1 Onboarding). The earlier browser-based `remote-pair web` subcommand has been removed.

### host app
- Menu-bar UI: grant permissions, settings pane, **tmux session list** (a detach/kill modal on click, attached/detached status), Restart tmux host, Repair install.
- The app manages the tmux server lifecycle. It writes **status.json** every tick (ground truth for app liveness + AX/SR/FDA grants).
- **Self-install** (first launch of the downloaded .app) + version-stamp resource refresh (preserving grants, the LaunchAgent, host.env). However, guard so that **a client machine does not self-install as a host and no duplicate instance appears** (preventing a recurrence of the gh-mac-m4 incident — verification: `Installer.swift` legacy-shed boots out the old LaunchAgent + removes the old .app).
- **Remove** self-install of skills/rules/CLI — the single CLI/README install handles that (lower coupling).
- Support **1:N** (one host to multiple clients), but the sessions themselves stay 1:1.
- On install, verify the SSH key connection and guide the user if it's missing.
- `host-gui-access` skill: state the activation conditions in SKILL.md, with a "do not assert" caution.
- **The app has no HTTP/WebSocket server** (invariant §0.1) — the host onboarding is an Electron window embedded in RemotePairHost that drives the `remote-pair` CLI / `status.json`, not a network server in the app.

### Web Shell + Editor (M3·M4)
- **M3 — Web shell + terminal (removed — superseded by M4)**: the original goal was to handle host sessions from the browser (a web SPA whose integrated terminal attaches to host sessions via `tmux-aqua attach`, with a Detach/Attach tab UX). This was built as a pre-VSCodium web SPA (`client/cli/web/`) and has been **removed**; the shell/terminal is now provided by the M4 VSCodium IDE.
- **M4 — IDE frontend (RemotePair IDE)**: **pivot** away from the code-server path to a **VSCodium fork** (`remotepair-ide`, `~/Spaces/Work/Devs/Lang-Swift/remotepair-ide`). Reason: Claude Code / Codex extension compatibility (marketplace, Node API) required an actual VS Code / Electron engine, which code-server's web-only environment can't provide. The backend (M1–M6 tmux-aqua, approve, sync, onboarding) is reused.
  - bundle id: `com.x10lab.remotepair-ide` → the Client will migrate to the bare `com.x10lab.remote-pair` (§Identity Separation; a separate app from the host).
  - Strategy: **"keep the code, hide the UI"** — to lower the cost of upstream rebases, contributed code is not unregistered; it is hidden only via composite-bar allowlists + the `when: ContextKeyExpr.false()` pattern.
  - dev-watch: `nvm node 22.22.1`, `buildConfig.useEsbuildTranspile=true` (dev only); `tsc --noEmit -p src/tsconfig.json --max-old-space-size=8192` is the type-validation baseline.
- Why a web shell: reuse the GUI seam (§0.3) as-is — by layering the shell/editor on the same web-UI / CLI-bridge pattern, the frontend stays invariant when later porting to a native shell.

> **Implementation status (2026-06-15)**:
> - **M3 terminal tab**: **removed — superseded by the M4 VSCodium IDE.** The M3 web shell/terminal was a pre-VSCodium web SPA (an xterm.js SPA in the now-deleted `client/cli/web/`, talking to tmux-aqua sessions via the removed `/api/term/*` bridge over SSH-routed `capture-pane`/`send-keys`); the SPA, the python HTTP bridge, and the `/api/term/*` contract were all **deleted**. The shell/terminal is now the M4 VSCodium IDE (embedded EditorPart sessions). The historical alt-screen limitation of the `capture-pane` approach no longer applies. → architecture.md §10-2.
> - **M4 IDE frontend**: **G001–G008 all implemented and verified**. Pivoted to a VSCodium fork (`remotepair-ide`). Verified via dev-CDP + branded builds (m4, 7 times) + remote E2E (gh-mac-m1 aqua tmux socket → REMOTEPAIR_E2E_OK). The remaining work is only capturing `vscode/src` changes into `patches/` (rebase-safety). See §1 IDE Frontend for details. → `.omc/ultragoal/`

### IDE Frontend (RemotePair IDE) — M4 detailed spec

**Fork repo**: `~/Spaces/Work/Devs/Lang-Swift/remotepair-ide` (VSCodium-based).  
**bundle id**: `com.x10lab.remotepair-ide` (→ will migrate to the bare `com.x10lab.remote-pair` — §Identity Separation, a separate app from the host).  
**Principle**: code preservation (easy rebase) + UI hiding only (composite-bar allowlist / `when=false`). The core terminal behavior code is **invariant — never modify**. An edge-case minefield.

#### Implementation complete (G001–G008 — dev-CDP + branded build + remote E2E verified)

**Left rail (text-only)**
- Containers: only Browser / Sessions / Settings are allowed (native containers are pruned, the code is kept, and they're removed from the rail).
- Implementation: the `ActivityBarCompositeBar.isRailAllowedContainer` pattern + an allowlist in `activitybarPart.ts`.

**Sessions sidebar**
- Sessions are shown as **native VS Code horizontal tabs** in the embedded `EditorPart` (initial iTerm2 rounded pills → changed to native flat tabs per user feedback; the pill override block in `multiEditorTabsControl.css` is removed, the responsive horizontal-scroll block is kept).
- **"+" button**: a custom button inserted directly into the Sessions view header DOM (a ViewTitle action doesn't render in this container, so it's solved by direct DOM insertion). Click → opens an in-tab session-type picker.
- **in-tab New Session picker**: implemented with `SessionPickerInput` (EditorInput) + `SessionPickerPane` (EditorPane). Renders 4 cards (Claude / Shell / Codex / Gemini) inside a tab. Selecting a card → runs that session → closes the picker tab.
  - Shell: `terminalInstanceService.createInstance({}, TerminalLocation.Editor)`.
  - Claude: opens a terminal in the embedded group and sendText `remote-pair launch`.
  - Codex / Gemini: a terminal + each CLI via sendText.
- Terminal focus/input: solved via a `focus()` override in the hosting layer. The core terminal behavior is unmodified.
- The embedded group toolbar (`+ ⌄ ⊟ ⋯`) is hidden via CSS (to avoid duplication with the custom "+").

**Hidden native UI (code preserved)**
- Bottom panel: Problems / Output / Debug / Terminal / Ports — hidden via the `RemotePairPanelCompositeBar` allowlist (only `remotepair*` containers pass). The code stays registered (rebase-safe).
- CHAT / Build-with-Agent (Auxiliary Bar): hidden via the `RemotePairAuxBarCompositeBar` allowlist.
- Outline, Timeline: `when: ContextKeyExpr.false()` — applied only on the view descriptor, the code is kept.

**Bottom Session Manager panel**
- **Three Panel container tabs** (`remotepair.sessions.attached` / `.detached` / `.history`) — shown as bottom horizontal tabs like the native Problems/Output/Terminal (the label is the category; the single "Session Manager" label is dropped). To save space, the panel default height is lowered (`layout.ts` `PANEL_SIZE`=90px + `panelPart` `preferredHeight`/`minimumHeight`).
- The only panel group that passes the G003 allowlist (`remotepair*`).
  - Attached: since embedded sessions bypass `ITerminalService.instances` (created at the Editor location), a separate `AttachedSessionsProvider` is implemented so the sidebar tracks them directly. The card has an **active-session outline highlight** (`.remotepair-session-card-active`) + a **close X button** (`.remotepair-session-card-close`; `AttachedSessionsProvider.close?` / `getActiveId?`).
  - Detached: a tmux-aqua session list based on `remote-pair ls` (dev environment = empty state). Click → reattach: opens a terminal in the embedded group and sendText `remote-pair attach <name>`.
  - History: past session names are retained via IStorageService (workspace scope).

#### Complete (G005–G008, branded build)

| Item | Status | Notes |
|---|---|---|
| G005 Browser multi-root | ✅ complete | Multi-root all clientDir in FOLDER_MAPS; per-folder "+"; [Add Mapping]; Search/Extensions entry points (including `~` expansion, `existsSync`, and handling the `updateWorkspaceFolders` return) |
| G006 Host button | ✅ complete | status bar left: host name + reachability icon; click → quickpick. Native "><" SSH indicator removed. Verified the actual host `gh-mac-m1` is shown in the packaged app (CDP :9444) |
| G008 functional-test gate | ✅ complete | 36-item functional inventory (`G008-functional-test-inventory.md`) click test passed |
| Branded-build verification | ✅ complete | Branded build 7 times on m4; verified the packaged app + remote E2E (gh-mac-m1 aqua tmux socket → REMOTEPAIR_E2E_OK) |

#### future / deferred

| Item | Status | Notes |
|---|---|---|
| patches/ capture (rebase-safety) | ✅ captured and verified | Captured `vscode/src` changes (G001–G008, 23 files +1747/−42) as `patches/zz-remotepair-ide-frontend.patch`. Reconstructed base+42 in a separate worktree → extracted via git diff (excluding undo_telemetry/announcement noise). **gold verification**: applied in the actual prepare_vscode order (json→root patches (zz last)→osx→announcement→telemetry), giving a 0 diff against the working tree. Only the top-repo (remotepair-ide master) commit remains |
| Screen-sharing sidecar (`host/rd/screen`) | implemented | See §1 Remote Desktop |
| Client bare-id migration | deferred | `com.x10lab.remotepair-ide` → `com.x10lab.remote-pair` (the **Client**, not the host, takes the bare — §Identity Separation). Creating the new Client cask `remote-pair` happens when the IDE ships |

#### G009 — Browser UX overhaul (new, in-progress, 2026-06-14)

Authoritative spec: `remotepair-ide/.omc/specs/deep-interview-browser-multiroot-favorites-ux.md`. Four components:

- **C1 — Root/mapping add UX (mount-first)**: an offset "Add Root/Mapping" button *below* the Browser folder list (when there's no map, the same button in the empty space, with an icon distinct from new-folder). Click → designate a host folder → **mount-first**: mount via `remote-pair mount` (SMB by default = macOS built-in, no kernel extension needed; SSHFS as an option — `docs/m-mount.md`, launcher `client/cli/remote-pair-mount` complete) → point the mount point (`~/.remote-pair/mounts/...`) as a FOLDER_MAP to add the root. SMB/SSHFS are real OS mounts, so they're **auto-exposed in Finder too**. Syncthing copy-sync is **legacy** (the `SYNC_BACKEND` default moves syncthing→mount). Remove 'Add Mapping' from the row-1 title (single entry point). Browser roots = only FOLDER_MAPS clientDir (a non-mapped workspace folder opened via launch arguments is not shown).
- **C2 — Favorites view**: a separate view at the bottom of the Browser container (like the existing Explorer's OUTLINE/TIMELINE). Star a folder → register it in Favorites (workspace+global persistence). Clicking an item / '+' → **starts a new Sessions terminal in that folder** (reusing `openSessionInFolder`) = a quick session launcher.
- **C3 — Folder-row inline controls**: on the right of every folder row (root + all subfolders), **on hover**, a star (Favorite toggle) + '+' (new session here). Not on file rows. `MenuId.ExplorerContext` group:'inline' + `ExplorerFolderContext`.
- **C4 — Browser = meta-container + 2-row header**: Browser is a *parent* container, like Sessions, that holds child containers (Explorer/Search/Extensions/…). **Row-1 buttons = child-container router**: clicking swaps only the inner content of Browser (❌ not the current global viewlet move that covers the whole window; it keeps the same Browser frame). Row-2 = controls for the active child container (for Explorer, a dynamic root-label [the root the clicked subfolder belongs to] + native new-file/new-folder/refresh/collapse). **The highest-difficulty item** — the architect finalizes how to nest Explorer/Search/Extensions as internally-routed child views of one container (candidates: register as Views then toggle visibility / host each viewlet pane in the Browser body via a custom router [the Sessions embedded-EditorPart pattern] / a composite-swap that keeps a unified frame).

Parallel fixes (applied, dev-verified, awaiting the next branded build):
- **Terminal key input/focus**: removed `RemotePairTerminalSidebarView.focus()` stealing focus to the container via `super.focus()` → focuses the xterm textarea directly + reconfirms on a microtask (core terminal invariant).
- **Remove the right sidebar (secondary side bar) layout**: force hidden in `layout.ts setAuxiliaryBarHidden` (zero grid space, code/node preserved).
- **Remove the duplicate Sessions '+'**: keep only the row-1 ViewTitle action, remove the body custom button.

**Implementation status (2026-06-15):** C1–C4 all source-implemented, tsc 0 errors. C4 is a dev-CDP **spike PASS** — Browser meta-container Row-1 (Explorer/Search/Extensions) + 2-row header + Explorer↔Search in-frame routing (hosted SearchView, active = stays Browser, 0 errors). The C4 router mechanism avoids the plan's `moveViewsToContainer` (persistence / canToggleVisibility:false blockers) by non-persistently hosting the native SearchView as a RemotePair-owned view (`remotepair.browser.search`) in the Browser container (`remotePairBrowserRouter.ts`). Extensions in-frame is excluded from v1 (spike #2). The only core edits are the marked below-list footer in explorerView.ts (C1) + the Row-2 label (C4.2). Remaining: live verification of the package build (C1 full mount flow, C3 hover) + re-capturing patches/.

#### IDE frontend invariants
1. **Core terminal behavior code is invariant**: core files like `xterm`, `TerminalInstance`, `TerminalProcessManager` are never modified. Only the hosting/embedding layer and new contributor files are touched.
2. **"Keep the code, hide the UI"**: no unregistering native containers. Use only composite-bar allowlists + `when=false` to keep upstream rebases easy.
3. **Single-open contract**: every session open goes through `openSession({kind, cmd, hostDir, sessionName})` into the embedded `part.activeGroup` only; no bypassing the global editorService.
4. **tsc clean**: before every commit, `tsc --noEmit -p src/tsconfig.json --max-old-space-size=8192` (nvm node 22.22.1) with 0 errors.
5. **dev-watch**: `buildConfig.useEsbuildTranspile=true` is dev-only — do not use this setting in production builds.

### README / Docs
- Remove the architecture diagram, problem-based Features, install-centric structure, and deep TCC internals from the main body.
- **⚠️ Security/liability warning**: because it disables all macOS guardrails, any damage from carelessness is entirely the user's responsibility, as-is with no warranty.
- Reflect the new install method, in **both Korean and English versions**.
- **Folder-mapping diagram** (Google Drive/Syncthing/iCloud; parent paths differ but the subpaths are identical).
- Fix translationese (keep proper nouns like Computer Use, headless in English), remove cruft.
- **A Claude Code paste-in install prompt** (the repo URL only — it reads the README itself). The prompt is in English for both Korean and English.
- Guidance for users without brew + a [brew.sh] link.
- Remote Login section: screenshots + an Apple guide link (Remote Login needs setup on both the CLI and host sides).
- SSH-key-based access procedure (condensed to be verification-centric).
- Heading hierarchy: along the host/client axis, with sub-steps at `####`.
- A How-to-Use section (Finder-launch screenshots), a Troubleshooting & Bug-Reporting section.
- **Identity-separation guidance** (README, cask caveats): the Host cask keeps `remote-pair-host` permanently, and the Client (IDE) cask `remote-pair` is a separate app. The existing host-rename migration guidance (cask token transition) is **withdrawn** — §Identity Separation. (README needs re-reconciliation.)
- In `docs/`: the internal-logic doc (architecture.md), later items (future.md), and this requirements.md.

---

## 2. Non-functional Requirements / Constraints

- **Apple Silicon macOS only**, macOS Ventura+ (Sequoia recommended).
- Open source — use GitHub Releases with no separate distribution-infra cost. License **AGPL-3.0-or-later** (not bundled with non-AGPL-compatible components — §All-in-One license matrix).
- **`~/.remote-pair` is the single source of truth for state** — no need for cross-device `~/.claude` sync. RemotePair's own config is in a namespace outside `.claude` (per-device, not synced).
- **Low coupling / high cohesion** (invariant §0.1): app = permission daemon only, CLI = the brain (SSOT and the main interface), onboarding/web/shell = CLI layer. The CLI has no TCC/AX code (delegated to the app). The app does not force-install the CLI. The app has no network server.
- **GUI is web-first, native is a shell** (§0.3) — the web-UI / CLI-bridge seam is fixed, only the bridge implementation is replaceable.
- **`.git` is excluded from Syncthing sync** (`.stignore`) — the two sides' git states differ, risking erroneous commit/push. Sync the working tree only; keep `.git` device-local.
- The `.claude/projects/` folder is `.gitignore`d + removed from git history (size/privacy) + excluded from Syncthing.
- Traceable logging (5MB rotation), pause on failure.
- Security: the onboarding runs inside the native Electron shell and reaches the brain through the shell's bridge to the `remote-pair` CLI / `status.json` — no network server is added to the host app, so there is nothing that binds externally (§0.1).
- This project's conversations are in **Korean**. Avoid translationese and cruft.

---

## 3. Decisions

- **Adopt Homebrew Cask distribution** — sidesteps the self-signed code-signing problem + fundamentally resolves cross-cert grant breakage via same-cert binaries.
- **Remove source builds from bootstrap**, splitting them out as maintainer-only (brew supplies the app).
- **bootstrap auto-installs the brew cask too when it's a host** ("let the cli do it all").
- **1:1 connection only** — session sharing withdrawn. launch is a faithful port of `claude-iterm-launch`.
- **approve keys are osascript** (unified) (cliclick synthetic keys don't register in the Chrome extension popup).
- **Exclude persist auto-detection logic** (intentional).
- approve is agent-centric + skill-based tool selection.
- RemotePair config is in its own namespace (`~/.remote-pair`); `.claude` is dedicated to agent identity (skill/rules/logs).
- **sync defaults off** (works even in environments without sync).
- Delete the `legacy/` folder.
- **Session identification is based on a deterministic id** (blocks Korean-path pollution) — the uuid5/`--session-id` approach is retracted.
- Add `--dangerously-skip-permissions` to the `claude` invocation.
- **(2026-06-13) Identity unification** ~~unify `RemotePairHost`→`RemotePair`~~ — **withdrawn (superseded by the 2026-06-15 separation).** The Host/Client natures are too different, so separate instead of unify. The source-directory renaming (host/app, client/cli, host/rd, client/ide) was completed as separate work.
- **(2026-06-15) Host/Client identity separation (unification withdrawn)** — the two apps' natures are too different (Host = headless permission daemon 24/7, Client = an IDE GUI a person sits in) + name collision when coexisting on the same machine. → **Host** `RemotePair Host`/`com.x10lab.remote-pair-host`/cask `remote-pair-host` (`-host` permanent, the code already matches), **Client** `RemotePair`/`com.x10lab.remote-pair`/cask `remote-pair` (the Client takes the bare). Migrate the IDE bundle id `remotepair-ide`→`remote-pair` + create a new Client cask (when the IDE ships). Cancel `config.sh` "0.5 RELEASE FLIP" (host→bare).
- **(2026-06-13→06-15 revised) Signing cert consolidated under CI 898E32** — release signing is via CI only (release.yml, 898E32, the p12 a gh secret), maintainer manual signing prohibited (blocking 33849F contamination). **Since the host rename was canceled, the "rename+cert together" bundling is released** — if the host cert actually changes, a **single re-grant** is needed at that time due to the designated-requirement (identifier+leaf) change (an independent event).
- **(2026-06-13) GUI is web-first** — the frontend stays web all the way (now realized as the Electron React UI), with the native shell as a replaceable seam. The original "start with a localhost web wizard" approach (a vanilla SPA + python HTTP bridge) was a pre-VSCodium attempt and has been removed; the web-first principle survives in the Electron onboarding (§1 Onboarding). No network server in the app.
- **(2026-06-13) The editor is a vendored code-server fork** — config first, surgical patches only for what config can't do (incremental, Cursor-style). Not from-scratch. The Claude Code extension is from Open VSX.
- **(2026-06-14) Pivot the M4 editor to a VSCodium fork (RemotePair IDE)** — abandon the code-server path. Claude Code / Codex extension compatibility (Node API, marketplace) requires an actual VS Code / Electron engine. The backend (M1–M6) is reused. Strategy: "keep the code, hide the UI" (composite-bar allowlist + `when=false`); the core terminal behavior code is invariant (an edge-case minefield). bundle id `com.x10lab.remotepair-ide` (app-id consolidation deferred). dev-watch: nvm node 22.22.1 + `buildConfig.useEsbuildTranspile=true` (dev only).
- **(2026-06-13→06-15 revised) Onboarding as the first M1 milestone** — role→permissions→re-grant→SSH→mapping→Syncthing→verification. **Redesigned as two Electron onboarding windows** (host onboarding in RemotePairHost, client onboarding in the RemotePair IDE), based on a React/shadcn mockup (`context/remotepair-onboarding`) — **not yet built**. The prior browser-based web wizard (vanilla SPA + python HTTP bridge) was removed; the onboarding stays a thin presentation layer over the `remote-pair` CLI (no reimplementing install logic).
- **(2026-06-13) All-in-One is orchestration only** — just install/configure/run best-of-breed OSS. Screen sharing is the first-party `host/rd/screen` engine (permissive deps). Get legal confirmation before commercial distribution.
- **(2026-06-14) Switch the file-access default to mount-first** — adding a Browser root/mapping by default **mounts** the host folder (`remote-pair mount`, SMB default = macOS built-in, SSHFS option; `docs/m-mount.md`) and points the mount point as a FOLDER_MAP. Single source-of-truth, conflict-free, auto-exposed in Finder. Keep Syncthing copy-sync as **legacy** (the `SYNC_BACKEND` default moves syncthing→mount). The launcher is complete; config/wizard/doctor wiring is follow-up. The screen-sharing sidecar is implemented as the first-party engine (`host/rd/screen`).
- **(2026-06-14) Browser is a meta-container** — symmetric with Sessions. Browser is a parent container that holds child containers (Explorer/Search/Extensions/…), and the 2-row header's Row-1 is the child-view router. Clicking swaps only the inner content of Browser, not a global viewlet move that covers the whole window. The nesting mechanism is finalized by the architect (§1 G009).
- **(2026-06-13) Remote Desktop on hold** — v0 screencapture channel/VNC, v1 WebRTC (ScreenCaptureKit+VideoToolbox, with added Input Monitoring).
- **(2026-06-15) Update boundary = permission boundary (the deployment constitution, §0.4)** — what goes into the signed `.app` bundle is decided by "does it need a TCC grant?" (independent of interpreted/binary). Permission-needing (app, Helpers, the `screen` sidecar) → bundled in the signed bundle, cask auto-update. Zero-permission (CLI, skill, rules, web, hooks, IDE ext = glue) → `remote-pair update` hot-swap (GitHub fetch, not bundled). The sidecar needs its own SR grant, so it's on the app side and the app supervises it in its process subtree (the current manual deploy in `~/.remote-pair/bin` is a dev fallback). WebRTC v2's control/data plane split matches this boundary (signaling=glue, media=sidecar). To prevent skew, pin the signaling/capability contract as versioned in `shared/screen-protocol`. Security: v2 also uses loopback+`ssh -L`.
- Versioning policy: stay pre-1.0. With the host rename canceled, the rationale for a v0.5.0 bundled bump is dissolved — independent per-component versions (`versions.json`: host/ide/screen-engine), patches +0.0.1. The Client (IDE) bare-id migration / new cask is an IDE-ship milestone.

---

## 4. Unresolved / Open Issues

### Resolved
- ~~**brew cask appdir mismatch**~~ — unified on the Homebrew cask default location `/Applications`. Changed `config.sh` `APP_PATH`, the Updater, the Installer fallback, the Permissions guidance, and the README all to `/Applications`. The app self-install LaunchAgent uses the actual `Bundle.main` path, so it was unaffected originally.
- ~~**maintainer-doc version mismatch**~~ — reconciled the README "For maintainers" with the actual release/cask (currently 0.5.0). Matches the single source of `VERSION` in `host/build-host.sh`.
- ~~**Identity unification — applied**~~ ⚠️ **This note was an error.** Bare unification was never applied in the code — host was always `-host` (`config.sh` `APP_NAME=RemotePairHost`/`BUNDLE_PREFIX=…remote-pair-host`, `Config.swift` fallback `RemotePairHost`, `Casks/remote-pair-host.rb`, `identity.json` host component). Re-decided on 2026-06-15 as **separation** (Host `-host` permanent, Client takes bare). For the remaining work see "Client bare-identity migration" below.
- ~~**cert transition (33849F → 898E32)**~~ — release signing consolidated under CI (898E32) (maintainer manual signing prohibited). With the host rename canceled, "bundled with the rename" is released — when the cert actually changes, the single re-grant is an independent event.
- ~~**client-machine host self-install / duplicate instances**~~ — `Installer.swift` legacy-shed blocks two menu-bar instances by booting out the old LaunchAgent + removing the old .app (preventing a recurrence of the gh-mac-m4 incident, commit 1ffb3bd).

### Open Issues
- **4 pre-existing launcher test failures** — `tests/run.sh` results: 159 passed / 4 failed. Failing items: `t_04_target` `target/remote-host+--local→local`, `t_07_resilience` `s1/reach-fail-no-tailscale`·`s2/exit-node-set`, `t_06` (or equivalent) `s4/dir-ssherr`. **Root cause**: when forced `--local` or remote-reach failure takes the local-fallback path, if the machine has no RemotePair host (`ensure_local_host` false), the launcher calls **plain `tmux new`/`tmux attach`** instead of `tmux-aqua new-session` (`client/cli/remote-pair-launch:277-290`). The tests expect `tmux-aqua`/`new-session`, so they fail. By design "no tmux-aqua machine means no computer-use" is intended, but it contradicts the test expectations, so a decision is needed to either (a) fix the launcher so the local fallback also tries tmux-aqua first, or (b) adjust the test expectations to the current design.
- **Client (IDE) bare-identity migration (unimplemented)** — per the Host/Client separation (§Identity Separation) decision, move the IDE to bare: `shared/identity/identity.json` ide.darwinBundleIdentifier and the IDE product.json `com.x10lab.remotepair-ide`→`com.x10lab.remote-pair`, display name `RemotePair`, **create a new Client cask `remote-pair`** (when the IDE ships), remove the `shared/config.sh` "0.5 RELEASE FLIP" (host→bare) comment. Verify consistency via `shared/identity/check-identity.sh`.
- **Host hot-update permission-inheritance conflict spike (M6 prerequisite, ⚠️)** — a zero-downtime update by restarting the app may reparent the tmux parent to launchd, breaking AX inheritance (the premise that `tmux-aqua` prevents reparenting is shaken when the app is swapped). Before implementing M6 hot-update, **first verify via a spike that permission inheritance is preserved**.
- **Dependency license verification** — verify with cargo-deny that the screen-sharing engine (`host/rd/screen`) deps are permissive only (RemotePair = AGPL-3.0). Legal counsel before commercial distribution.
- **code-server fork maintenance cost** — the fork/vendoring + surgical-patch model incurs upstream-tracking cost. Finalize a minimal patch surface + upstream-rebase strategy when M3 begins.
- **Missing notification-forwarding hook** — the host currently has only the approve-reminder hook and no Notification/Stop forwarding hook (added in M2).
- **Deployment-boundary implementation (principle finalized, §0.4)** — "permission boundary = bundle boundary" is decided (§0.4·§3). The remaining implementation set: ① bundle the screen sidecar (`screen`) into the signed .app (`build-host.sh` — per-binary SR grant survival + cask auto-update; demote the current `remote-pair-screen-deploy` manual deploy to a dev fallback), ② auto-trigger glue on app launch (call `remote-pair update` after `Updater` L2 — zero permissions, so independent of the sidecar; closes the gap where cask updated only the .app and the glue didn't follow), ③ when v2 begins, add a version/capability signaling contract to `shared/screen-protocol` (preventing slow-sidecar ↔ fast-glue skew). → [future.md](future.md).
- The menu-bar "no active session" display is inconsistent with the actual session state (a ground-truth gap when the app isn't running / status.json is absent).
- Verify the clean-install test (m1/m4) via a cron schedule.

---

*Sources: sessions 27d757a4 · 318aaabe · a26f7244 · afad7df4 · df30583d (local), 109edb94 · 644df73d (host). 4d6e9677 · a23aa692 (host) are approve/heartbeat automated-run sessions with no human requirements. The **2026-06-13 product vision session** (web UI transition, identity unification, onboarding wizard, notification forwarding, all-in-one orchestration, roadmap M1–M6) is reflected in this revision.*

---

## 5. Roadmap (M1 → M6)

Each milestone is a release unit bundling the requirements above. Listed in dependency order.

| Milestone | Scope | Status (2026-06-13) | Key verification | Reference |
|---|---|---|---|---|
| **M1** | Onboarding (two Electron windows) + Host/Client identity separation | Onboarding **not yet built** (redesigned from scratch as Electron windows; prior web wizard removed); Host `-host` permanent (code matches), Client bare-id migration when the IDE ships | Two Electron onboarding windows (host in RemotePairHost, client in the RemotePair IDE), based on the React/shadcn mockup, guide role→permissions→re-grant→SSH→mapping→Syncthing→verification end to end. After a single re-grant, `status` = AX✓ SR✓. | §1 Onboarding·Identity Separation |
| **M2** | Notification forwarding | implemented | The host's completion/Stop/question/approve notifications are forwarded to the client, with kind toggles. The new Notification/Stop hook is checked by `doctor`. | §1 Notification Forwarding, architecture.md §10-3 |
| **M3** | Web shell + terminal | **removed — superseded by M4 VSCodium IDE** | The pre-VSCodium web SPA (xterm.js in `client/cli/web/`, talking over the removed `/api/term/*` bridge) was deleted; the shell/terminal is now the M4 IDE's embedded EditorPart sessions. | §1 Web Shell, architecture.md §10-2 |
| **M4** | IDE frontend (RemotePair IDE — VSCodium fork) | **G001–G008 complete + branded-build/remote-E2E verified** | Rail (Browser/Sessions/Settings), Sessions embedded EditorPart + native tabs + in-tab picker (Claude/Shell/Codex/Gemini), tabbed Session Manager (Attached/Detached/History, active highlight+X), Host button. Remaining: `patches/` capture (rebase-safety). | §1 IDE Frontend, `.omc/ultragoal/` |
| **M5** | Remote Desktop | scaffold (VNC launcher implemented, WebRTC is a spike) | v0: an arm's-length launcher for macOS Screen Sharing. v1: WebRTC (ScreenCaptureKit+VideoToolbox, Input Monitoring). | §1 Remote Desktop·All-in-One, architecture.md §10-5 |
| **M6** | host hot-update | design finalized, awaiting the AX-inheritance spike | Zero-downtime app update (L1 glue hot-swap + L2 native re-exec). **⚠️ Prerequisite spike required**: first verify whether restarting the app changes the tmux parent to launchd and breaks AX inheritance. | §4 hot-update spike, architecture.md §11 |
