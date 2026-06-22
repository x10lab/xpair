<p align="center">
  <img src="assets/icon/AppIcon-1024.png" alt="Xpair" width="128">
</p>

<h1 align="center">Xpair</h1>

<p align="center"><b>English</b> · <a href="README.ko.md">Korean</a></p>

Run the agent you already subscribe to — **Claude**, **Codex**, or **OpenCode** — on an always-on Mac, with full macOS **computer-use** (screenshot, click, type) intact, and attach to it from your laptop or phone over mosh/SSH. Your work keeps running while you're away; you bring your own subscription, so there are no extra AI credits.

> **Naming:** The product is **Xpair** end to end — app, CLI, and bundle identifiers all use it (`XpairHost.app`, the `Xpair` IDE, the `xpair` CLI, `com.x10lab.xpair*`). The repo is [`x10lab/xpair`](https://github.com/x10lab/xpair). (Older builds shipped as *RemotePair*; if you have one installed, uninstall it before moving to Xpair — the bundle id changed, so macOS permissions don't carry over.)

![Xpair architecture](assets/architecture.png)

- **Host Mac** — runs your agent inside persistent tmux sessions, 24/7, with computer-use working.
- **Client** — the Xpair IDE (a VSCodium fork) or the `xpair` CLI; attach with a Finder right-click.
- **Mobile** — reach the same sessions from any SSH/mosh client, including Claude Code on your phone.

---

## Quick start — let Claude Code install it

Already have Claude Code? Paste the block below into a session **on the Mac you're setting up** and it drives the whole install end-to-end — figuring out the role, installing, wiring SSH, and walking you through the one manual permission step.

```text
Set up Xpair (https://github.com/x10lab/xpair) on this Mac. Fetch and read its README, then follow it. Figure out whether this Mac is the host or the client, explain each command before you run it, and stop for anything that needs my input or my physical screen (like the one-time permission grant). Finish with xpair doctor and a summary of what's left for me to do.
```

Prefer to do it by hand? See [Installation](#installation) below. Either way, first launch drops you into a guided **onboarding** flow (below) that walks the rest.

---

## Features

### Computer-use that survives going remote
Run your agent over SSH and macOS strips its Accessibility (AX) and Screen Recording (SR) grants, so screenshot/click/type silently stop. A privileged menu-bar app (`XpairHost.app`) owns the grants and keeps the agent inside its process subtree, so computer-use keeps working no matter which client is attached.

### Sessions that survive disconnects
Close the laptop or drop Wi-Fi and a normal agent session dies with the connection. A patched tmux (`tmux-aqua`) keeps every session alive on the host — `Attached` while you're there, `Detached` while you're gone, running 24/7 either way.

### Pick your engine
Bring whichever subscription you have: `claude` (with its unique `--remote-control`), `codex`, or `opencode`. The agent runs on the host, so it must be installed there. Switch with `xpair config set engine <claude|codex|opencode>`, or override per launch with `xpair launch --engine <e>`.

### Onboarding that resolves, not just blocks
First run on each side opens a guided setup — a WKWebView on the host, an IDE webview on the client. Each step is a **hard gate that actively resolves itself**: it installs the CLI, `brew install`s the engine, sets the API key, and verifies SSH key-auth — it never dead-ends on "you're missing X." Secrets go over stdin, never argv or disk.

### Attach from your laptop or your phone
Attach from a client Mac (Finder → right-click → *Launch Remote Pair*), the Xpair IDE's Sessions sidebar, or any SSH/mosh client including Claude Code on mobile. Same sessions, same state, wherever you are.

### Remote Desktop, in the IDE
View and drive the host screen from the Xpair IDE's Remote Desktop tab — a native H.264/WebRTC pipeline (ScreenCaptureKit → VideoToolbox → webrtc-rs → the browser's `<video>`), decoded cross-platform by the client's native WebRTC. `xpair desktop` still opens macOS Screen Sharing as a fallback.

### Permission dialogs answered for you
A blocking "Allow?" dialog (or a 1Password unlock prompt) on a headless host stalls the whole session. An on-demand approve router (OCR + click, with a Claude fallback classifier) detects and clicks the right button, so unattended sessions don't hang.

---

## Requirements

- Apple Silicon Mac (host and client)
- macOS Sequoia or later recommended
- SSH key authentication between client and host
- `mosh` on both machines (plain SSH works, but a disconnect kills the live attach)
- **Host:** Homebrew (for the app cask) + git, plus your chosen engine CLI (`claude` / `codex` / `opencode`) installed. No build needed.

---

## Installation

### Host — the always-on Mac

```bash
curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/bootstrap.sh | ROLE=host bash
```

This installs the `xpair` CLI + approve glue, then the app (`XpairHost.app`) via Homebrew Cask. On first launch the app self-installs its daemon (LaunchAgent, `~/.xpair/host`, tmux-aqua, watchdog) and opens host onboarding. The app is self-signed but Homebrew strips the quarantine flag, so it launches normally and its grants stick to the stable signing identity. (App only, no CLI: `brew tap x10lab/xpair https://github.com/x10lab/xpair && brew install --cask xpair-host`.)

#### One-time permission grant — needs a physical screen or VNC

This is the one manual step; it can't be done over SSH (TCC on SIP-enabled, non-MDM Macs). In **System Settings → Privacy & Security**, turn `XpairHost` ON for:

| Grant | Why | Needed? |
|---|---|---|
| **Accessibility** | Synthetic input (click/type) for computer-use | **Required** |
| **Screen Recording** | Screenshots for computer-use | **Required** |
| **Full Disk Access** | Prevents macOS folder prompts a headless host can't answer (an unanswered prompt stalls the session). The grant is exercised by the agent session running inside the app, which can then read the whole disk — prefer a non-protected project root instead if you can. | **Recommended** |

Then pick up the grants: `launchctl kickstart -k gui/$(id -u)/com.x10lab.xpair-host` (or menu bar → Restart tmux host).

> Prefer not to grant Full Disk Access? Keep project folders under a non-protected root (e.g. `~/Spaces`, not `~/Desktop`/`~/Documents`/`~/Downloads`) — then sessions never hit a protected folder and never prompt.

### Client — the laptop you sit at

The client runs as the **Xpair IDE** (a VSCodium app with a Sessions sidebar) or as the **CLI + Finder Quick Action**. Both share the same `xpair` config.

First, key-based SSH login to the host must work (`ssh <host>` with no password prompt). If not: enable **Remote Login** on the host (System Settings → General → Sharing), then `ssh-copy-id user@host` from the client and give the host a short `~/.ssh/config` alias. Outside your LAN, a mesh VPN like [Tailscale](https://tailscale.com) gives the host a stable name. (The onboarding flow can help wire this up for you.)

```bash
# Xpair IDE (cask):
brew tap x10lab/xpair https://github.com/x10lab/xpair && brew install --cask xpair

# CLI + Finder Quick Action only:
curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/bootstrap.sh | ROLE=client bash
```

The CLI install auto-runs `xpair onboard` (host address, terminal app, folder mappings).

Uninstall: `~/.local/share/xpair/shared/uninstall.sh [--purge]`, or `brew uninstall --cask xpair-host` for the app.

---

## Folder mapping

Xpair runs your agent on the **host**, against files **on the host** — it attaches to a host path, it doesn't copy files. So the project must already exist on the host. Keep both sides in sync with Google Drive / Syncthing / iCloud (or mount the host folder with `xpair mount`, see [docs/m-mount.md](docs/m-mount.md)). A **mapping** tells Xpair which host path a client path corresponds to — the parent may differ per machine, but everything below it must be identical.

<p align="center">
  <img src="assets/folder-mapping.png" alt="Folder mapping: host and client sync roots differ in parent path but share identical subfolders" width="640">
</p>

```bash
xpair map add ~/Drive/proj /Users/me/proj   # register once (skip if the path is identical on both)
xpair launch ~/Drive/proj                   # → attaches to /Users/me/proj on the host
```

The Finder Quick Action needs the mapping up front (a GUI can't prompt for it); `xpair launch` will offer to register an unmapped folder interactively.

> Sync the working tree only, not `.git` — syncing a live `.git` across machines corrupts the repo.

---

## Usage

```bash
xpair launch <dir>     # launch / attach a session for a folder (--engine to override)
xpair attach <name>    # attach an existing tmux-aqua session by exact name
xpair ls               # host sessions + folder mappings
xpair map add|rm|list  # client path ↔ host path mappings
xpair onboard          # re-runnable client setup (host, terminal, mappings, doctor)
xpair discover         # find Xpair/SSH hosts (LAN Bonjour + Tailscale)
xpair status           # app PID, host server, heartbeat age
xpair doctor           # check SSH auth, host app, tmux-aqua on host
xpair desktop open     # open the host screen via macOS Screen Sharing (vnc://)
xpair editor start     # launch the in-IDE code-server editor (loopback)
xpair mount            # mount a host folder directly (smb/sshfs)
xpair notify           # pull recent host notifications (Stop / approve / …)
xpair logs [--host -f] # tail launcher/app logs (or host logs over ssh)
xpair config set host my-mac-mini
xpair config set engine codex
```

Host-side / install helpers: `xpair install-host` (idempotent, integrity-verified remote install), `xpair update` / `xpair self-update` (hot-swap the glue layer without touching the signed `.app`), `xpair approve` (handle a blocked dialog), `xpair host` (ensure the tmux-aqua server is up).

`xpair launch <dir>` (or Finder → right-click → Quick Actions → *Launch Remote Pair*) starts/attaches the session; the only per-session prompt is the agent's own "Allow for this session" — press Enter once.

<p align="center">
  <img src="assets/usage-finder-launch.png" alt="Finder right-click → Services → Launch Remote Claude" width="380">
</p>

---

## The Xpair IDE (the client)

The client ships as a **VSCodium fork** (`xpair` cask) reshaped around remote pairing, on top of stock VSCodium:

- **Sessions sidebar** — lists your host sessions (Attached / Detached) with a session picker; the home base of the IDE.
- **Browser container** — folder / Search / Extensions with per-folder favorites.
- **Remote Desktop** — view and drive the host screen in-IDE over the native H.264/WebRTC pipeline (`host/rd`); view-only by design, with `xpair desktop` as a macOS Screen Sharing fallback.
- **First-run onboarding** — a guided, hard-gated webview that resolves each prerequisite (CLI install, engine, API key, SSH) before handing you the IDE.
- **Editor (code-server)** *(scaffold)* — an in-IDE editor over `xpair editor`, still being wired in.

Stock VSCodium stays inviolable — Xpair changes live only in `client/ide/remotepair/`, so upstream pulls stay conflict-free. See [`client/ide/remotepair/REMOTEPAIR.md`](client/ide/remotepair/REMOTEPAIR.md).

**Notifications:** the host hook (`host/hooks/xpair-notify.sh`, installed by bootstrap) appends Claude Code Stop/Notification events to `~/.xpair/host/notifications/queue.jsonl`; the client polls it over SSH (`xpair notify`).

---

## Security & responsibility

> ⚠️ Xpair deliberately lowers macOS's safety guardrails on the host: it holds Accessibility + Screen Recording (and optionally Full Disk Access) and keeps an autonomous agent running inside that privileged subtree, reachable remotely 24/7. That agent can see the screen, synthesize input, and — with Full Disk Access — read and write your entire disk. That is the point of the tool, and a trade-off you opt into. **You are solely responsible for what runs on the host.** Run it only on a personal machine you own, grant the minimum permissions you need, and don't point it at anything you can't afford to lose. Provided as-is, without warranty (see [LICENSE](LICENSE)).

**Telemetry is off by default.** Two independent opt-in switches (PostHog product analytics, Sentry crash reports) stay silent unless you turn them on, and never carry repo names, paths, command contents, or personal data. See [docs/logging.md §11](docs/logging.md) for the full event catalog.

---

## Troubleshooting

1. **`xpair doctor`** — checks SSH auth, the host app, and tmux-aqua; catches most setup problems.
2. **`xpair status`** + logs at `~/.xpair/host/logs/xpair.log` (or `xpair logs --host -f`).
3. **Computer-use stopped after an agent update?** Toggle the MCP server: `/mcp disable computer-use` then `/mcp enable computer-use`.
4. **Permissions look granted but computer-use fails?** Re-pick up the grants with the `launchctl kickstart` command above.

Still stuck? [Open an issue](https://github.com/x10lab/xpair/issues) with your version (`xpair status`), macOS version, `xpair doctor` output, and repro steps. Scrub secrets from logs first.

---

## For maintainers

Single monorepo (`host/` + `client/` + `shared/`), built in lockstep. Versions are declared once in `shared/identity/versions.json` (host **0.5.0**, IDE **0.1.0**, screen-engine **0.1.0**) and verified across consumers; release assets must be signed with the same stable cert as the running install (the in-app Updater verifies the leaf CN). Host app + IDE are released together via `.github/workflows/release.yml`.

```bash
./host/build-host.sh                   # → build/XpairHost.app (signed + verified)
./client/ide/build.sh                  # → the Xpair IDE (VSCodium fork)
shared/identity/check-identity.sh      # brand/version consistency
```

See [docs/monorepo-structure.md](docs/monorepo-structure.md) for the full layout.

---

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE). (Commercial/dual licensing inquiries welcome.) Not endorsed by Apple. Contributions welcome — please open an issue before large changes.
