<p align="center">
  <img src="assets/icon/AppIcon-1024.png" alt="RemotePair" width="128">
</p>

<h1 align="center">RemotePair</h1>

<p align="center"><b>English</b> · <a href="README.ko.md">Korean</a></p>

Run Claude Code on an always-on Mac, with full macOS **computer-use** (screenshot, click, type), and attach to it from your laptop or phone — over mosh/SSH.

![RemotePair architecture](assets/architecture.png)

- **Host Mac** — runs `claude` inside persistent tmux sessions, 24/7, with computer-use working.
- **Client Mac** — attach (and detach) from your laptop with a Finder right-click.
- **Mobile** — reach the same sessions from Claude Code on your phone.

---

## Quick start — let Claude Code install it

Already have Claude Code? Paste the block below into a session **on the Mac you're setting up** and it drives the whole install end-to-end — figuring out the role, installing, wiring SSH, and walking you through the one manual permission step.

```text
Set up RemotePair (https://github.com/ghyeongl/remote-pair) on this Mac. Fetch and read its README, then follow it. Figure out whether this Mac is the host or the client, explain each command before you run it, and stop for anything that needs my input or my physical screen (like the one-time permission grant). Finish with remote-pair doctor and a summary of what's left for me to do.
```

Prefer to do it by hand? See [Installation](#installation) below.

---

## Features

Each feature exists to solve a concrete problem.

### Computer-use that survives going remote
**Problem:** Run `claude` over SSH and macOS strips its Accessibility (AX) and Screen Recording (SR) grants — so screenshot/click/type silently stop working.
**Solution:** A privileged menu-bar app (`RemotePairHost.app`) owns the grants and keeps `claude` inside its process subtree, so computer-use keeps working no matter which client is attached.

### Sessions that survive disconnects
**Problem:** Close the laptop or drop Wi-Fi and your long-running `claude` session dies with the connection.
**Solution:** A patched tmux (`tmux-aqua`) keeps every session alive on the host. Reattach anytime — `Attached` while you're there, `Detached` while you're gone, sessions running 24/7 either way.

### Attach from your laptop or your phone
**Problem:** You're not sitting at the host Mac.
**Solution:** Attach from a client Mac (Finder → right-click → Launch Remote Pair) or from Claude Code on mobile. Same sessions, same state, wherever you are.

### Permission dialogs answered for you
**Problem:** A blocking "Allow?" dialog (or a 1Password unlock prompt) on a headless host stalls the whole session.
**Solution:** An on-demand approve router (OCR + click) detects and clicks the right button, so headless sessions don't hang.

---

## Requirements

- Apple Silicon Mac (host and client)
- macOS Sequoia or later recommended
- SSH key authentication between client and host
- `mosh` on both machines (plain SSH works, but a disconnect kills the live attach)
- **Host:** Homebrew (for the app cask) + git. No build — tmux-aqua ships embedded in the app, so no Xcode needed. (Source build is maintainers-only.)

---

## Installation

### Host — the always-on Mac

One command sets up the host. It installs the `remote-pair` CLI + the approve rules/skill (the daemon glue), then installs the app (`RemotePairHost.app`) via Homebrew Cask:

```bash
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=host bash
```

On first launch the app self-installs its **daemon** (LaunchAgent, `~/.remote-pair`, tmux-aqua link, watchdog). The app is self-signed, not notarized — Homebrew strips the quarantine flag so it launches normally *and* its Accessibility / Screen Recording grants stick to the stable signing identity (TCC needs no notarization, only a quarantine-free, stably-signed app).

> No Homebrew? The script tells you and stops — install it ([brew.sh](https://brew.sh)) and re-run; it'll handle the cask. Homebrew supplies the app binary; the script does the rest.

> Just want the app, no CLI? `brew tap ghyeongl/remote-pair https://github.com/ghyeongl/remote-pair && brew install --cask remote-pair-host`. (Building from source instead is in [For maintainers](#for-maintainers).)

Once installed, finish with the **one-time permission grant** below.

#### One-time permission grant — needs a physical screen or VNC

This is the one manual step, and it can only be done at the host's screen (TCC cannot be granted over SSH on SIP-enabled, non-MDM Macs). Open **System Settings → Privacy & Security** and turn `RemotePairHost` ON for three grants (if it isn't listed in a pane, click `+` and add `/Applications/RemotePairHost.app`):

| Grant | Why | Needed? |
|---|---|---|
| **Accessibility** | Synthetic input (click/type) for computer-use | **Required** |
| **Screen Recording** | Screenshots for computer-use | **Required** |
| **Full Disk Access** | Prevents macOS folder prompts that a *headless* host can't answer remotely (an unanswered prompt stalls the session). Trade-off: the grant is exercised not by RemotePair's own logic but by the **Claude Code session running inside it** (RemotePair itself touches the disk only at install) — so that session can silently read the whole disk (Mail/Messages/browser included). | **Recommended** |

The in-app **Grant Permissions…** menu item opens all three panes and shows live ✓/✗ status for each. After toggling, pick up the grants with:

```bash
launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host   # or: menu bar → Restart tmux host
```

> Prefer not to grant Full Disk Access? Keep your project folders under a **non-protected root** (e.g. `~/Spaces`, not `~/Desktop`/`~/Documents`/`~/Downloads`) — then sessions never hit a protected folder and never prompt, without opening the whole disk.

### Client — the laptop you sit at

#### SSH access — key-based login to the host

RemotePair drives the host over SSH, so all you need is passwordless login working. Check it:

```bash
ssh gh-mac-m1   # logs into the host shell with no password prompt → you're set
```

Not there yet? Turn on **Remote Login** on the host (System Settings → General → Sharing — [Apple's how-to](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)), then set up key auth from the client the usual way (`ssh-keygen` if you have no key, then `ssh-copy-id user@host`). Give the host a short `~/.ssh/config` alias like `gh-mac-m1` — that alias is the value you pass to `remote-pair config set host` later.

> Reaching the host from outside your LAN? A mesh VPN like **[Tailscale](https://tailscale.com)** gives the host a stable name that works anywhere. Pair with `mosh` so the attach survives network drops.

#### Install the client

```bash
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=client bash
```

Installs the Finder Quick Action + `remote-pair` CLI, then auto-runs `remote-pair onboard` (host address, terminal app, folder mappings).

### Reversible uninstall

```bash
~/.local/share/remote-pair/shared/uninstall.sh          # remove installed files (manifest-tracked)
~/.local/share/remote-pair/shared/uninstall.sh --purge  # also remove ~/.remote-pair state
```

---

## Folder mapping (do this first)

RemotePair runs `claude` **on the host**, against files **on the host**. So the project you launch from your laptop has to already exist on the host — RemotePair doesn't copy files, it attaches to a host path. You keep both sides in sync yourself with **Google Drive, Syncthing, iCloud, or any file-sync tool**; the same project then lives at a (possibly different) absolute path on each machine.

A **mapping** tells RemotePair which host path a given client path corresponds to. The sync root sits at a different parent path on each machine (`ghyeong` vs `rpi/Desktop`), but **everything below it must be identical** — RemotePair attaches to the same subfolder structure on the host:

<p align="center">
  <img src="assets/folder-mapping.png" alt="Folder mapping: host and client sync roots differ in parent path but share identical subfolders" width="720">
</p>

```bash
remote-pair map add ~/Drive/proj /Users/me/proj   # register once
remote-pair launch ~/Drive/proj                   # → attaches to /Users/me/proj on the host
```

- **Same path on both machines?** (e.g. `~/Spaces/proj` exists identically) — no mapping needed; launch resolves it directly.
- **Different paths?** Register the mapping once. After that, both the CLI and the Finder Quick Action resolve it automatically.
- **Not mapped + different paths?** `remote-pair launch` runs an interactive probe (checks whether the host path exists, offers to register / create / cancel). The Finder GUI can't prompt, so it needs the mapping up front.

> Sync only the **working tree**, not `.git` — syncing a live `.git` across machines corrupts the repo. Each machine keeps its own `.git`; share source files only.

---

## Usage

```bash
# Map a folder once (client path → host path), if they differ
remote-pair map add ~/Drive/proj /Users/me/proj

# Launch / attach a session
remote-pair launch ~/Drive/proj
remote-pair launch ~/Drive/proj --fresh   # always a new session
remote-pair launch ~/Drive/proj --yes     # non-interactive

# Or: Finder → right-click the folder → Quick Actions → Launch Remote Pair
```

The only per-session interaction is claude's own **"Allow for this session"** prompt — press Enter once.

### Launch from Finder (GUI) — requires a folder mapping

Right-click a folder → **Services → "Launch Remote Claude"** to attach that folder's host session.

<p align="center">
  <img src="assets/usage-finder-launch.png" alt="Finder right-click → Services → Launch Remote Claude" width="420">
</p>

**The folder must be mapped** first (the GUI can't prompt you for the host path interactively):
- **Mapped** (registered via `remote-pair map add`, or client==host same path) → attaches/creates directly.
- **Not mapped** → the GUI can't resolve the host path and does nothing. Register it once first:
  `remote-pair map add <folder> <host-path>` or `remote-pair launch <folder>` (prompts to register when unmapped). After that the GUI works for that folder.

Other commands:

```bash
remote-pair onboard          # re-runnable client setup (host, terminal, mappings, doctor)
remote-pair open-gui <dir>   # open the configured terminal app and launch <dir> in a new tab/window
remote-pair ls               # host sessions + folder mappings
remote-pair status           # app PID, host server, heartbeat age
remote-pair doctor           # check SSH auth, host app, tmux-aqua on host
remote-pair self-update      # update client (launcher/CLI) to latest from GitHub — keep in sync with host
remote-pair config set host my-mac-mini
remote-pair config set terminal iterm2     # or: terminal
```

---

## Web UI (experimental)

`remote-pair web` starts a token-gated localhost web bridge that serves two things in one:

1. **Onboarding wizard** — walks through role selection, permission grants, SSH check, folder mapping, Syncthing health, and doctor in a live browser UI.
2. **Shell** — after onboarding, the same page becomes a persistent shell with tabs for Terminal, Remote Desktop, Editor, and Notifications.

```bash
remote-pair web          # opens 127.0.0.1:<port>?token=<run-token> in your browser
```

The bridge is a thin `python3` adapter (~150 lines, no external dependencies) that shells out to the existing `remote-pair` CLI and reads `status.json`. The `.app` gains no new server — it keeps writing `status.json` every second as usual, and the browser polls `/api/status` every 1.5 s so permission changes reflect within ~2 s without restarting the app.

### Notification forwarding (host → client)

Install the notify hook on the **host** to forward Claude Code Stop/Notification events to the client:

```bash
# on the host — the bootstrap already does this; manual re-install if needed:
~/.local/share/remote-pair/host/hooks/manage-claude-hooks.py install
```

The hook (`host/hooks/remote-pair-notify.sh`) appends events to `~/.remote-pair/notifications/queue.jsonl`. The client bridge polls this file over SSH and surfaces alerts in the Notifications tab. Edit `~/.remote-pair/notify.conf` (see `host/hooks/notify.conf.example`) to choose which event types to forward (`ENABLED_TYPES`).

### Editor tab (requires code-server)

The Editor tab launches `code-server` bound to `127.0.0.1` via `remote-pair-editor start`. If `code-server` is not installed, the tab shows an install prompt instead.

```bash
remote-pair-editor start [<folder>]   # start code-server on EDITOR_PORT (default 8080)
remote-pair-editor status             # check whether it is running
remote-pair-editor stop               # stop it
```

> **Scaffold note:** The editor tab and code-server launcher are wired up but the in-browser editor layout and Claude Code extension integration are still in progress (spike). Expect rough edges.

### Identity note

The current shipping identity is **`RemotePairHost`** / `com.x10lab.remote-pair-host`. A rename to `RemotePair` / `com.x10lab.remote-pair` (with a one-time TCC re-grant) is planned for **v0.5.0** — not live yet. Do not grant permissions to a `RemotePair.app` unless you have explicitly installed v0.5.0 or later.

---

## Notes & caveats

> ⚠️ **Security & responsibility — read this.** RemotePair intentionally lowers macOS's safety guardrails on the host: it holds Accessibility + Screen Recording (and, if you enable it, **Full Disk Access**) and keeps an autonomous `claude` agent running *inside* that privileged process subtree, reachable remotely 24/7. In effect, an agent on the host can see the screen, synthesize clicks/keystrokes, and — with Full Disk Access — silently read and write your entire disk (Mail, Messages, browser data, SSH keys, everything). (What actually exercises these grants is the `claude` session running inside RemotePair, not RemotePair's own logic — RemotePair itself never touches the disk except at install.) That is the whole point of the tool, and it is a deliberate trade-off you are opting into. **You are solely responsible for what runs on the host.** Any data loss, leakage, or damage caused by misconfiguration, a careless instruction, a prompt-injection, or an unattended session is entirely the operator's responsibility. Run this only on a personal machine you own, grant the minimum permissions you actually need (prefer a non-protected project root over Full Disk Access), and don't point it at anything you can't afford to lose. The software is provided **as-is, without warranty** (see [LICENSE](LICENSE)).


---

## Telemetry — opt-in, off by default

RemotePair ships **no telemetry that is on by default**. Both reporting channels below are
**opt-in** — they stay completely silent unless you explicitly turn them on, and even then they
never carry anything that could identify you or your work. The code is open; audit it yourself.

**Two independent switches, both default OFF:**

| Switch | What it does | When ON |
|---|---|---|
| Product analytics (`telemetry_consent` → PostHog) | anonymous activation-funnel events, so we can see where setup breaks | sends 7 anonymous events (e.g. "onboarding started", "host connected", "first session started") with timing |
| Crash reports (`crash_report_consent` → Sentry) | uploads scrubbed crash/error reports | sends a redacted stack trace when something crashes (local crash dumps are written either way) |

Each can be on without the other. You choose at first run (two unchecked checkboxes) and can flip
either later in settings.

**What is collected (only when you opt in):** an anonymous random install id (a UUID generated
once on this machine — not tied to any account), app version, OS version, CPU architecture, and a
small set of funnel events with timings. Failures are reported as a fixed set of reason codes
(`timeout`, `auth_denied`, `host_unreachable`, …), never raw error text.

**What is NEVER collected:** repository names, file paths, command contents, IP addresses, your
hostnames or ssh aliases, or any personal data. Every payload is run through the same `redact()`
filter used for local logs before it leaves the machine, and crash reports have Apple/Sentry PII
collection disabled.

**Default OFF means zero network calls** — with both switches off, RemotePair makes no connection
to any analytics or crash endpoint. Analytics currently routes to PostHog Cloud (EU region);
crash reports to Sentry. The endpoint is configurable and we plan to move analytics to self-hosted
infrastructure later. See [docs/logging.md §11](docs/logging.md) for the full event catalog and
privacy contract.

---

## Troubleshooting & reporting bugs

Hit something broken? Work through this before filing:

1. **Run the doctor.** `remote-pair doctor` checks SSH auth, the host app, and tmux-aqua on the host — it catches most setup problems and tells you which side is wrong.
2. **Check status + logs.** `remote-pair status` shows the app PID, host server, and heartbeat age. Logs live at `~/.remote-pair/logs/` (`remote-pair.log` is the main one).
3. **Computer-use stopped after a `claude` update?** Toggle the MCP server: `/mcp disable computer-use` then `/mcp enable computer-use`. (No need to re-grant TCC.)
4. **Permissions look granted but computer-use fails?** Re-pick up the grants: `launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host`.

Still stuck? **[Open an issue](https://github.com/ghyeongl/remote-pair/issues)** and include:

- Version (`remote-pair status`, or the app's menu-bar **About**) and your macOS version.
- `remote-pair doctor` output, and the relevant tail of `~/.remote-pair/logs/remote-pair.log`.
- What you expected vs. what happened, and the exact steps to reproduce.

> Please don't paste secrets — scrub SSH hostnames, keys, and tokens from logs before attaching.

---

## For maintainers

```bash
./host/build-tmux-aqua.sh              # patched tmux → ~/.local/bin/tmux-aqua (tmux 3.6)
./host/make-signing-cert.sh            # stable self-signed cert "RemotePair Local Signing" (idempotent)
./host/build-host.sh                   # → build/RemotePairHost.app (signed + verified)
./host/build-host.sh --deploy [host]   # build + rsync + install on host
RP_VERSION=0.4.12 ./host/build-host.sh --release  # sign, zip, gh release, bump cask
```

Release assets **must** be signed with the same stable cert as the running install — the in-app Updater verifies the leaf CN and blocks a mismatched swap. Current version: **0.4.12** (pre-1.0).

Repo layout: `host/` (app, build scripts, approve router, skills), `client/` (CLI, launcher, Finder service), `shared/` (install lib, config SSOT, bootstrap).

---

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE). (Commercial/dual licensing inquiries welcome)

Personal tool, tested on macOS (Apple Silicon). Not endorsed by Apple. Contributions welcome — please open an issue before large changes.
