# RemotePair

Run Claude Code on an always-on Mac, with full macOS **computer-use** (screenshot, click, type), and attach to it from your laptop or phone — over mosh/SSH.

![RemotePair architecture](assets/architecture.png)

- **Host Mac** — runs `claude` inside persistent tmux sessions, 24/7, with computer-use working.
- **Client Mac** — attach (and detach) from your laptop with a Finder right-click.
- **Mobile** — reach the same sessions from Claude Code on your phone.

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

### A permission grant that sticks
**Problem:** macOS ties TCC grants to a code signature, so every rebuild or auto-update normally re-triggers the permission prompts.
**Solution:** A stable self-signed cert ties the grant to the app's designated requirement, so it survives rebuilds and in-app updates. No Apple Developer account or notarization needed.

### Permission dialogs answered for you
**Problem:** A blocking "Allow?" dialog (or a 1Password unlock prompt) on a headless host stalls the whole session.
**Solution:** An on-demand approve router (OCR + click) detects and clicks the right button, so headless sessions don't hang.

### Zero-build client
**Problem:** Onboarding a new laptop usually means Xcode, builds, and toggling permissions.
**Solution:** The client install needs none of that — just a Finder Quick Action plus the `remote-pair` CLI. A guided `onboard` configures the host, terminal app, and folder mappings.

### Folder path mapping
**Problem:** The same project lives at different paths on each machine (Google Drive, Syncthing, etc.).
**Solution:** Register a mapping once. Launching an unmapped folder runs an interactive probe — it checks whether the host path exists and offers to register it, create it, or cancel. No blind guesses.

---

## Requirements

- Apple Silicon Mac (host and client)
- macOS Sequoia or later recommended
- SSH key authentication between client and host
- `mosh` on both machines (plain SSH works, but a disconnect kills the live attach)
- **Host only:** Xcode Command Line Tools (or full Xcode) and Homebrew, for the tmux static build

---

## Installation

### Host — the always-on Mac (pick one)

**Option A — Download the app (GUI, no build).** Easiest. The app self-installs on first launch (LaunchAgent, `~/.remote-pair`, embedded tmux-aqua + approve skill — no `install.sh` needed).

1. Download the signed app: **[latest release → `RemotePairHost.zip`](https://github.com/ghyeongl/remote-pair/releases/latest/download/RemotePairHost.zip)**
2. Unzip into `~/Applications` and open it once:
   ```bash
   cd ~/Applications && ditto -x -k ~/Downloads/RemotePairHost.zip . && open RemotePairHost.app
   ```
   It's self-signed (not notarized), so the **first** open is Gatekeeper-blocked — approve it once: **System Settings → Privacy & Security → "RemotePairHost.app was blocked" → Open Anyway** (or, headless: `xattr -dr com.apple.quarantine ~/Applications/RemotePairHost.app`). Downloading via `curl`/`gh` instead of a browser skips this entirely.

**Option B — CLI bootstrap (build from source).** For those who'd rather compile than trust a binary. Needs Xcode CLT + Homebrew.
```bash
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=host bash
```

Either way, finish with the [one-time permission grant](#one-time-permission-grant-host--needs-a-physical-screen-or-vnc) below.

### Client — the laptop you sit at (no build, no Xcode)

```bash
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=client bash
```

Installs the Finder Quick Action + `remote-pair` CLI, then auto-runs `remote-pair onboard` (host address, terminal app, folder mappings). No permissions, no build.

### One-time permission grant (host) — needs a physical screen or VNC

This is the one manual step, and it can only be done at the host's screen (TCC cannot be granted over SSH on SIP-enabled, non-MDM Macs). Open **System Settings → Privacy & Security** and turn `RemotePairHost` ON for three grants (if it isn't listed in a pane, click `+` and add `~/Applications/RemotePairHost.app`):

| Grant | Why | Needed? |
|---|---|---|
| **Accessibility** | Synthetic input (click/type) for computer-use | **Required** |
| **Screen Recording** | Screenshots for computer-use | **Required** |
| **Full Disk Access** | Silences macOS folder prompts that a *headless* host can't answer remotely (an unanswered prompt stalls the session). Trade-off: every session can then silently read the whole disk (Mail/Messages/browser included) — fine for a personal box, your call. | **Recommended** for an always-on host |

The in-app **Grant Permissions…** menu item opens all three panes and shows live ✓/✗ status for each. After toggling, pick up the grants with:

```bash
launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host   # or: menu bar → Restart tmux host
```

> Prefer not to grant Full Disk Access? Keep your project folders under a **non-protected root** (e.g. `~/Spaces`, not `~/Desktop`/`~/Documents`/`~/Downloads`) — then sessions never hit a protected folder and never prompt, without opening the whole disk.

### Reversible uninstall

```bash
~/.local/share/remote-pair/shared/uninstall.sh          # remove installed files (manifest-tracked)
~/.local/share/remote-pair/shared/uninstall.sh --purge  # also remove ~/.remote-pair state
```

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

Other commands:

```bash
remote-pair onboard          # re-runnable client setup (host, terminal, mappings, doctor)
remote-pair open-gui <dir>   # open the configured terminal app and launch <dir> in a new tab/window
remote-pair ls               # host sessions + folder mappings
remote-pair status           # app PID, host server, heartbeat age
remote-pair doctor           # check SSH auth, host app, tmux-aqua on host
remote-pair config set host my-mac-mini
remote-pair config set terminal iterm2     # or: terminal
```

---

## Notes & caveats

> ⚠️ **Security & responsibility — read this.** RemotePair intentionally lowers macOS's safety guardrails on the host: it holds Accessibility + Screen Recording (and, if you enable it, **Full Disk Access**) and keeps an autonomous `claude` agent running *inside* that privileged process subtree, reachable remotely 24/7. In effect, an agent on the host can see the screen, synthesize clicks/keystrokes, and — with Full Disk Access — silently read and write your entire disk (Mail, Messages, browser data, SSH keys, everything). That is the whole point of the tool, and it is a deliberate trade-off you are opting into. **You are solely responsible for what runs on the host.** Any data loss, leakage, or damage caused by misconfiguration, a careless instruction, a prompt-injection, or an unattended session is entirely the operator's responsibility. Run this only on a personal machine you own, grant the minimum permissions you actually need (prefer a non-protected project root over Full Disk Access), and don't point it at anything you can't afford to lose. The software is provided **as-is, without warranty** (see [LICENSE](LICENSE)).

- **Grant is one-time but host-local.** It must be granted at the host screen once; after that, rebuilds and updates keep it (stable cert). Back up the cert at `~/Library/Application Support/RemotePair/signing.p12` — losing it means re-granting.
- **Updates restart the host.** Applying an update or "Restart tmux host" relaunches the server and disconnects active sessions; RemotePair warns first when sessions are live.
- **mosh strongly recommended.** Plain SSH works, but a network drop ends the attach (the host session itself survives — just reattach).
- **`~/.remote-pair` is the single source of state.** RemotePair does not require `~/.claude` to be synced between machines. The only installed file outside `~/.remote-pair` is `~/.claude/skills/approve/` (required by the Claude harness).
- **`computer use not granted` after a `claude` update:** toggle the MCP server — `/mcp disable computer-use` then `/mcp enable computer-use`.
- **1Password SSH agent** can gate git push and the SSH unlock prompt; `remote-pair approve` can auto-click the unlock.
- **Self-signed, not notarized.** This is a personal-device tool. Building from source is recommended over trusting pre-built binaries from forks. macOS TCC behavior can change across OS versions.

---

## For maintainers

```bash
./host/build-tmux-aqua.sh              # patched tmux → ~/.local/bin/tmux-aqua (tmux 3.6)
./host/make-signing-cert.sh            # stable self-signed cert "RemotePair Local Signing" (idempotent)
./host/build-host.sh                   # → build/RemotePairHost.app (signed + verified)
./host/build-host.sh --deploy [host]   # build + rsync + install on host
RP_VERSION=0.4.7 ./host/build-host.sh --release   # sign, zip, create gh release v0.4.7
```

Release assets **must** be signed with the same stable cert as the running install — the in-app Updater verifies the leaf CN and blocks a mismatched swap. Current version: **0.4.7** (pre-1.0).

Repo layout: `host/` (app, build scripts, approve router, skills), `client/` (CLI, launcher, Finder service), `shared/` (install lib, config SSOT, bootstrap).

---

## License

Apache-2.0. See [LICENSE](LICENSE).

Personal tool, tested on macOS (Apple Silicon). Not endorsed by Apple. Contributions welcome — please open an issue before large changes.
