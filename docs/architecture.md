# RemotePair Internal Architecture

This document explains, at the code level, how RemotePair makes a remotely attached `claude` keep using macOS Computer Use (screenshot, click, typing). The file-path:line references point to the actual implementation locations.

> For user-facing installation/usage, see the [README](../README.md). This document focuses on operating principles and internal contracts.

---

## 1. Components

| Area | Artifact | Responsibility |
|---|---|---|
| **host** | `RemotePairHost.app` (menu bar app) | Permission boundary. Holds AX/SR (and FDA when needed), and keeps the patched tmux server bound as its own child so that permissions are inherited by `claude`. |
| **client** | `remote-pair` CLI + `remote-pair-launch` + Finder Service | The brain (zero permissions). Resolves folder mappings and attaches/creates sessions by connecting to the host over SSH/mosh. |
| **shared** | `install.sh` · `config.sh` · `bootstrap.sh` | Role-based reversible install, configuration SSOT, one-shot bootstrap. |

The host app is self-signed (no notarization). It bundles `tmux-aqua`, `remote-pair-approve-router.sh`, `ocr-find`, and `cliclick` in the app bundle's `Contents/Helpers`, falling back to external paths when they are absent (`host/app/Config.swift:13`).

---

## 2. Permission Inheritance Mechanism (core)

When you launch `claude` over SSH, macOS does not grant AX/SR to that process. RemotePair **places the tmux server inside the process subtree of a permission-holding app** and attaches sessions to that server so they inherit the permissions.

```
launchd (LaunchAgent: com.x10lab.remote-pair-host.plist)
  └─ RemotePairHost.app          ← TCC binds the AX/SR/FDA grants here
       └─ /usr/bin/script -q /dev/null   ← acquires a pty (posix_spawn)
            └─ tmux-aqua -S /tmp/aqua-tmux.sock  (server, _keeper session)
                 └─ [remotely attached claude sessions]  ← AX/SR inherited → Computer Use works
```

- `HostManager.spawn()` launches `/usr/bin/script -q /dev/null tmux-aqua -S <sock> new-session -s _keeper "sleep 2147483647"` via `posix_spawn` (`host/app/HostManager.swift:48-71`).
- `_keeper` is a dummy session that keeps the server from ever going empty. The server socket is `/tmp/aqua-tmux.sock` (`Config.swift:20`).
- **The patched tmux (`tmux-aqua`) is the key**: normally tmux daemonizes the server, which gets reparented to launchd and thus leaves the app chain. `tmux-aqua` only does `daemon→setsid` and does not reparent, so the server PPID stays in the app chain (`HostManager.swift:1-4`).
- `AppDelegate` checks server liveness every 5 seconds via `host.ensureServer()` and restarts it if it has died (`AppDelegate.swift:41`).
- Avoiding zombie (defunct) misjudgment: after `posix_spawn`, you must reap zombies with `waitpid(WNOHANG)` and judge them as dead to avoid a permanent failure-to-start (`HostManager.swift:20-26`).

TCC binds grants to a **stable code-signing identity (designated requirement), not to notarization**. Signing with a stable self-signed cert keeps grants intact across rebuilds and updates. → [Installation/Status Model](#6-installationstatus-model).

---

## 3. CLI↔App Primitive Channel (InputServer)

The app is the "permission boundary" while the CLI (the agent's brain) has zero permissions. The CLI decides all of the coordinates/timing/retries/OCR and requests **only a single atomic permission primitive** from the app. The app executes only one primitive per request, so permissions are used only within that scope (`host/app/InputServer.swift:1-7`).

**Channel = two files** (`Config.swift:30-31`):

| File | Direction | Content (tab-separated) |
|---|---|---|
| `/tmp/remote-pair.input-req` | CLI → app | `shot\t<outpath>` · `click\t<x>\t<y>` · `key\t<combo>` |
| `/tmp/remote-pair.input-res` | app → CLI | `ok` · `ok\t<path>` · `err\t<msg>` |

- `AppDelegate`'s `inputTimer` calls `InputServer.tick()` every 0.1 seconds → if a request file exists, it consumes it (1 request = 1 response) and writes the response (`AppDelegate.swift:44`, `InputServer.swift:16-24`).
- Primitive mapping (`InputServer.swift:26-41`):
  - `shot` → `/usr/sbin/screencapture -x` (uses **SR**)
  - `click` → `cliclick c:<x>,<y>` (uses **AX**)
  - `key` → `osascript` with System Events `key code`/`keystroke`
- **Why osascript for keys**: `cliclick`'s CGEvent synthetic keys don't work on web UIs like Chrome extension popups (measured). The System Events path does work (`InputServer.swift:43-44`). `cmd+return`→`key code 36 using {command down}`, regular keys→`keystroke "x"` (`InputServer.swift:46-69`).
- `screencapture` and `cliclick` run as children of the (granted) app and inherit permissions → permission use happens only inside the app.

---

## 4. Session Flow (client → host)

`remote-pair launch <folder>` (or the Finder Service) → handled by `remote-pair-launch` (`client/cli/remote-pair-launch`).

1. **Load config** — source `~/.remote-pair/{common,host,client}.env`. `REMOTE_HOST`, `FOLDER_MAPS`, `AQUA_SOCK`, etc. (`remote-pair-launch:20-34`).
2. **Folder mapping** — translate client path → host path. The same project may exist on both sides via external sync (Google Drive/Syncthing/iCloud) but with different absolute paths, so `FOLDER_MAPS` maps them (`remote-pair-launch:4-6`). → [Folder Mapping](../README.md#folder-mapping-do-this-first).
3. **Deterministic session name** — `<HOST>_…` based on the host path. The status bar alone tells you which machine you're on (`remote-pair-launch:7-8`).
4. **Connect** — connect to the host over mosh (recommended)/ssh and attach to or create a session on `tmux-aqua -S /tmp/aqua-tmux.sock`. Because this socket is the **permission-inheriting server from §2**, a `claude` attached here uses Computer Use (`remote-pair-launch:10-12`).
5. **`_N` numbering** — only 1:1 connections are supported (no session sharing). If a client (tab) is already attached to `_1`, it opens a new `_2`, and a detached session is reclaimed via `attach -d` (`remote-pair-launch:9`).

Non-interactive mode: `RP_YES=1` / `--yes` skips all prompts (auto-creating directories, etc.) (`remote-pair-launch:13`).

---

## 5. approve Router (auto-clicking approval dialogs)

On a headless host, when an "Allow?" dialog or a 1Password lock prompt appears, the session stalls. The router detects this and clicks it.

- **Trigger** — when `AppDelegate.poll()` (1-second tick) finds that `/tmp/remote-pair.approve-request` exists, it runs `ApproveManager.run()` → executes the router **as a child of the app** (inheriting permissions) (`AppDelegate.swift:140-144`, `Config.swift:26`).
- **All routing is in the router** — claude/the skill only does the "trigger when blocked" part; which window to allow and how is decided by `remote-pair-approve-router.sh` (`host/remote-pair-approve-router.sh:4-5`).
- **3-stage operation** (`approve-router.sh:7-11`):
  1. Adaptive polling — even if the window isn't there yet right after the trigger, wait for it to appear for `WAIT_SECS` (default 18s).
  2. Hybrid vision — `ocr-find` rules first (fast); on a miss, haiku (`claude-haiku-4-5`) performs only "classification of known windows" (the coordinates come from the rules).
  3. Verification loop — after a click/key, recapture and confirm the marker has disappeared; if not closed, retry. `exit 0`=success / `1`=failure.
- **rules.txt** (tab-separated: `id <TAB> marker <TAB> action`) — `marker`=OCR text for detection/verification, `action`=`ocr:<label>` (find the button text and click) or `key:<combo>` (`approve-router.sh:13-15`).
- Key transmission uses osascript (System Events) just like InputServer — for web UI popup compatibility.

---

## 6. Installation/Status Model

### Namespace — `~/.remote-pair`

All runtime state is gathered here (no dependence on `~/.claude` sync) (`Config.swift:3`). Per-role env separation: `common.env` (shared) / `host.env` / `client.env` — each role's install writes only its own file, preventing cross-contamination (`shared/config.sh`).

### status.json — the ground truth the agent reads

`AppDelegate.poll()` (1 second) updates `~/.remote-pair/logs/status.json` via `writeStatus()` (`AppDelegate.swift:139`, `Config.swift:45-52`):

```json
{"ts":..,"pid":..,"version":"..","bundle_id":"..","socket":"/tmp/aqua-tmux.sock","ax":true,"sr":true,"fda":false}
```

`remote-pair status`/`doctor` read "app liveness + grant facts" from this file instead of guessing via pgrep. Liveness is judged by `ts` freshness. The same loop also touches `remote-pair.heartbeat` (read by the watchdog) (`Config.swift:23`).

### Self-install — Installer

So that an `.app` obtained from GitHub Releases can become a host even without `install.sh`, `Installer.ensureInstalled()` is called on every run (`AppDelegate.swift:22`, `Installer.swift:33-45`):

- Installed + same version → a **true no-op** (does not touch the running tmux server).
- Version bumped → refreshes only resources (rules/skill/tmux-aqua); **grants, LaunchAgent, and host.env (user settings) are preserved**.
- Not installed → full install. The LaunchAgent plist shape/label/path must match the `is_host` section of `shared/config.sh`/`install.sh` character-for-character (SSOT) (`Installer.swift:5-7`).

LaunchAgent labels: `com.x10lab.remote-pair-host` (app) / `…-watchdog` (watchdog) (`Installer.swift:13-15`).

### TCC grant persistence

A stable self-signed cert binds grants to the app's designated requirement, so they persist across rebuilds and in-app updates. The **release binary must be signed with the same cert** so grants don't break across machines/updates → which is why we use a same-signature cask distribution instead of each person building their own.

---

## 7. Host App File Map

| File | Responsibility |
|---|---|
| `main.swift` | Entry point (launches NSApplication) |
| `AppDelegate.swift` | Menu bar (NSStatusItem), dynamic session list, three timers (host 5s / poll 1s / input 0.1s), routing for permissions/settings/updates/About |
| `Config.swift` | Path/constant SSOT, `status.json`/heartbeat/log (5MB rotation), `runCapture` helper |
| `HostManager.swift` | Spawn/keep/reap the patched tmux server as a child of the app |
| `InputServer.swift` | Executor for the CLI↔app primitive channel (shot/click/key) |
| `Installer.swift` | Self-install of the downloaded .app, version-stamped resource refresh |
| `Permissions.swift` | AX/SR/FDA grant checks + open System Settings |
| `Sessions.swift` | Query/detach/kill tmux sessions |
| `ApproveManager.swift` | Wrapper that runs the approve router |
| `Updater.swift` | In-app updates based on GitHub Releases (leaf CN verification) |
| `SettingsWindow.swift` | Settings window (auto-update toggle, etc.) |

---

## 8. Summary of Key Paths/Identifiers

| Kind | Value |
|---|---|
| tmux server socket | `/tmp/aqua-tmux.sock` |
| primitive request/response | `/tmp/remote-pair.input-req` / `…input-res` |
| approve trigger | `/tmp/remote-pair.approve-request` (+`.label`, `.type`) |
| status ground truth | `~/.remote-pair/logs/status.json` |
| heartbeat (watchdog) | `~/.remote-pair/logs/remote-pair.heartbeat` |
| log | `~/.remote-pair/logs/remote-pair.log` (5MB→`.1` rotation) |
| approve rules | `~/.remote-pair/rules.txt` |
| bundle id / LaunchAgent | `com.x10lab.remote-pair-host` (+`-watchdog`) |

---

## 9. Onboarding (Electron-in-apps) — REMOVED web bridge, to be reimplemented

**Status: the prior browser-based web wizard was removed; the onboarding feature itself survives and is being redesigned from scratch.** Onboarding is being redesigned as **two separate Electron onboarding windows** — one embedded in `RemotePairHost` (the host Swift app) and one in `RemotePair` (the client VSCodium/Electron IDE) — shown on first install, based on the React/shadcn mockup (`context/remotepair-onboarding`). It is currently a **blank slate (not yet built)**.

> **REMOVED — do not use.** The localhost onboarding wizard described here previously (a `remote-pair web` subcommand that launched a thin python3 HTTP bridge `client/cli/remote-pair-web` serving a vanilla SPA from `client/cli/web/`, with a `/api/*` JSON contract: `/api/status`, `/api/permissions/open`, `/api/role`, `/api/config`, `/api/ssh-check`, `/api/map`, `/api/syncthing`, `/api/regrant`) has been **deleted**. The python bridge, the SPA, the `remote-pair web` CLI subcommand, and the `shared/onboarding/` SoT (`steps.json` + `check-onboarding.sh`) no longer exist. That web-bridge `/api/*` JSON contract is no longer part of the architecture.

**Design intent that survives the removal** (to be re-realized in the new Electron windows):
- The onboarding requirement persists: guide a fresh install through role selection, permission grants, SSH/host config, folder mapping, and re-grant detection.
- The `.app` should still gain no resident HTTP server. The host onboarding window is Electron embedded in `RemotePairHost`; the client onboarding window is Electron embedded in the `RemotePair` IDE. Both drive state through in-app/IPC paths rather than a localhost web bridge.
- `AppDelegate.poll()`'s existing 1-second `writeStatus()` loop continues to update `status.json`, which the onboarding windows can observe so permission toggles are reflected without an app restart.
- Permission, role, config, SSH-check, mapping, and re-grant logic is re-exposed via Electron onboarding/IDE IPC (shelling out to the existing `remote-pair` CLI + reading `status.json`), not via the removed `/api/*` HTTP endpoints.

---

## 10. UI Shell + Extension API (M2–M5)

The resident shell historically rode on top of the same web bridge/SPA as §9 and exposed **Terminal, Remote Desktop, Editor, and Notifications** functionality. **The web-bridge `/api/*` HTTP endpoints listed in this section belonged to the now-removed python bridge (§9) and no longer exist; the functionality itself survives and will be re-exposed via the new Electron onboarding/IDE IPC** (host onboarding in `RemotePairHost`, client surfaces in the `RemotePair` IDE). The underlying host-side mechanics (tmux capture/send, notification queue, code-server launcher, Screen Sharing trigger) are unchanged — only the transport (web bridge → Electron IPC) changes.

### 10-1. Shell Layout

The shell historically rendered as a single SPA (`client/cli/web/index.html` + `app.js`/`style.css`, no build toolchain), which has been **removed** along with the bridge. The same Terminal / Remote Desktop / Editor split is to be re-realized in the `RemotePair` IDE.

```
┌───────────────────────────────────────────────────────────┐
│  Left: Terminal tab           │  Right: Desktop / Editor   │
│  (xterm.js, tmux attach)      │  tabs (Remote Desktop·code) │
└───────────────────────────────────────────────────────────┘
```

The endpoints below were the **removed** web-bridge `/api/*` contract (§9); each row's functionality is to be re-exposed through Electron IDE/onboarding IPC against the same host-side mechanics:

| Endpoint (REMOVED — was web bridge) | Direction | Description |
|---|---|---|
| `GET/POST /api/term/*` (removed) | bridge ↔ SSH/tmux | Terminal session control — removed; superseded by the M4 IDE (§10-2) |
| `POST /api/desktop/open` (removed) | bridge → CLI | Triggered macOS Screen Sharing launch — removed; now invoked via IDE/CLI (§10-4) |
| `GET /api/editor/status` (removed) | bridge → CLI | Checked whether code-server is running — removed |
| `POST /api/editor/start` (removed) | bridge → CLI | Triggered code-server start — removed |
| `GET /api/notifications` (removed) | bridge → queue file | Polled the notification queue — removed; now delivered via the IDE (§10-3) |
| `GET/POST /api/notify/settings` (removed) | bridge → conf file | Read/wrote the ENABLED_TYPES filter — removed |

---

### 10-2. M3 — Terminal Tab

**Purpose**: A terminal tab that connects directly to the host tmux session.

> The browser/bridge transport described below (`/api/term/*` over the removed web bridge) is gone with §9; the terminal functionality is to be re-exposed via the Electron IDE. The host-side tmux mechanics are unchanged.

**Operation**:
- The UI loads xterm.js and historically communicated with the bridge via the `/api/term/*` WebSocket (or polling); this transport will be re-realized over Electron IDE IPC.
- The host-side step runs `capture-pane` (read) and `send-keys` (write) on `tmux-aqua -S /tmp/aqua-tmux.sock` on the host over SSH.
- Provides a session-list query and Attach/Detach tab UX.

**Constraint (alt-screen limitation)**: `capture-pane` reads only the normal buffer, so the current screen of programs that take over the alt-screen (like vim/htop) is not captured as-is. Full pseudo-pty streaming is planned to be resolved after the v0.5+ WebSocket upgrade.

---

### 10-3. M2 — Notification Forwarding

**Purpose**: Forward Claude Code notifications (completion, Stop, Ask, approve) that occur on the host to the client.

> The client-side consumer below (`remote-pair-web GET /api/notifications` → SPA banner) belonged to the removed web bridge (§9); it is to be re-exposed via the Electron IDE/onboarding IPC. The host-side hook and queue mechanics are unchanged.

```
host(gh-mac-m1)
  └─ ~/.claude/settings.json hooks
       └─ remote-pair-notify.sh   ← receives Stop/Notification events
            └─ ~/.remote-pair/notifications/queue.jsonl  ← accumulates events
                 ↑ SSH polling (client side)
client(gh-mac-m4)
  └─ [REMOVED web bridge: remote-pair-web GET /api/notifications]
       └─ notification banner display (to be re-exposed via Electron IDE)
```

- Hook script: `host/hooks/remote-pair-notify.sh`. Appends events to `~/.remote-pair/notifications/queue.jsonl` one JSON line at a time.
- Filter: the `ENABLED_TYPES` in `host/hooks/notify.conf` (see `notify.conf.example`) selects which notification kinds to forward (default: `notification,stop`).
- The client side polls the host's queue.jsonl over SSH and delivers it to the UI — formerly the bridge's `/api/notifications`, to be re-realized over Electron IDE IPC.
- Low-coupling principle: no notification server is put into the app. Delivery is handled in the CLI layer.

---

### 10-4. M4 — Editor (scaffold)

**Purpose**: Run code-server on localhost and connect to it as a browser editor tab.

- `client/cli/remote-pair-editor`: the code-server launcher script. Subcommands `start [<folder>]` / `status` / `stop`. Default port `EDITOR_PORT=8080`, `127.0.0.1` binding (`--auth none` — safe because it's loopback-only).
- code-server is maintained in a fork repo (`ghyeongl/code-server`) and follows a config-first, surgical minimal-patch strategy (Electron layout patches, etc., are WIP).
- The Claude Code extension is installed via **Open VSX** (code-server does not use the MS Marketplace).
- The status/start control formerly went through the removed web bridge's `/api/editor/{status,start}` (§9), which shelled out to `remote-pair-editor`; this control is to be re-exposed via Electron IDE IPC. If code-server is not installed, the editor surface shows only a guidance message.
- **Current status: scaffold** — the launcher exists; the prior bridge wiring/UI tab was removed with §9. Electron layout patches and Claude Code extension integration are in progress (spike).

---

### 10-5. M5 — Remote Desktop (scaffold)

**Purpose**: A Remote Desktop that views and inputs to the host screen from a client tab.

- `client/cli/remote-pair-desktop`: the macOS Screen Sharing (VNC) launcher. Subcommands `open [<host>]` / `check` / `help`. It triggers the default macOS Screen Sharing app at arm's length via an `open vnc://` URL.
- The launch trigger formerly went through the removed web bridge's `POST /api/desktop/open` (§9), which shelled out to `remote-pair-desktop open`; this trigger is to be re-exposed via Electron IDE IPC.
- **v0.5 plan**: a low-latency capture-streaming spike that reuses the Screen Recording primitive (`InputServer.shot`).
- **v1 plan**: WebRTC based on ScreenCaptureKit + VideoToolbox HW encoding. Requires adding the Input Monitoring permission.
- The screen-sharing engine is pure first-party code (`host/rd/screen`, AGPL-3.0-or-later, permissive deps only).
- **Current status: scaffold** — implemented up to the VNC launcher trigger. In-browser streaming (WebRTC) is at the spike stage.

---

## 11. M6 — 2-Level hot-update (design finalized, awaiting spike)

A two-stage model for performing app updates without interrupting sessions.

| Level | Target | Method | Session impact |
|---|---|---|---|
| **L1** | glue (CLI / approve skill·hooks) | File replacement only, no restart needed | None (CodePush-style hot-swap) |
| **L2** | native app (`RemotePairHost.app`) | Session check + restart after user consent | Brief restart |

**L1 hot-swap**: glue files like `remote-pair-editor` and `remote-pair-notify.sh` take effect immediately by just replacing the file, with no process restart. Replacing the bundled file (and restarting any owning process, e.g. the Electron IDE surface) is sufficient.

**L2 native restart procedure**:
1. Check the number of active `claude` sessions — if a session is attached, ask the user for consent.
2. On consent, restart the app with `launchctl kickstart -k`.
3. `HostManager.spawn()` reconnects the tmux server after the restart.

**⚠️ Open spike**: We must first verify whether, on app restart, the `tmux-aqua` parent gets reparented to launchd and AX permission inheritance breaks. Do not proceed with the L2 implementation before confirming that the premise of `tmux-aqua` preventing reparenting holds throughout the app-replacement process.
