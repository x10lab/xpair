# RemotePair

Let Claude Code running inside a remote persistent tmux session use macOS built-in **computer-use** (screenshot, click, type) — from a laptop, over mosh/SSH.

---

## What it is

Running `claude` remotely breaks computer-use: the process loses the Accessibility (AX) and Screen Recording (SR) grants that macOS requires. RemotePair solves this by keeping `claude` inside the process subtree of a privileged menu-bar app on the host machine, so grants persist regardless of which client attaches.

Four requirements satisfied simultaneously:

| Requirement | How |
|---|---|
| Terminal | mosh/SSH + tmux session |
| Remote | client laptop attaches to headless host |
| Persistent | tmux-aqua survives disconnects |
| computer-use | claude inherits AX+SR from RemotePairHost.app |

**Two components:**

- **RemotePairHost.app** — menu-bar app installed on the host (the always-on Mac). Hosts the tmux daemon, manages permissions, sessions, approval routing, and updates.
- **`remote-pair` CLI** — installed on the client laptop. No build, no Xcode, no permission toggles required. Finder right-click → **Quick Actions → Launch Remote Pair** or `remote-pair launch <dir>` to attach.

---

## Why it is hard: macOS TCC 2-gate

Built-in computer-use requires the `claude` process to hold two grants simultaneously:

- **SR (Screen Recording)** — evaluated through the responsible-process chain; inherited through daemons.
- **AX (Accessibility)** — evaluated against the host `.app`'s activation policy and Aqua graphic session; not inherited through a standard daemon fork.

Key constraints:

- `claude-code` CLI is a versioned non-`.app` binary — it does not appear in System Settings and cannot be granted directly.
- Therefore a privileged `.app` (RemotePairHost) must be the parent, and `claude` must stay inside its process subtree.
- **Stock tmux is blocked**: `proc_fork_and_daemon()` in `proc.c` calls `daemon(3)`, which reparents the server to launchd — ejecting `claude` from the RemotePairHost subtree and breaking AX.
- On SIP-enabled non-MDM machines, `sudo`/`tccutil`/PPPC cannot grant TCC — only the System Settings user toggle works.

---

## How it works

```
[host: gh-mac-m1]
  login → LaunchAgent (KeepAlive) → RemotePairHost.app  (menu bar, AX+SR granted)
    └─ script(pty) → tmux-aqua server (/tmp/aqua-tmux.sock, _keeper session)
         └─ (client-launched claude session) → computer-use ✅

[client: gh-mac-m4]
  Finder Service / remote-pair launch <dir>
    → path mapping (client→host) → SSH session setup → mosh attach
```

**patched tmux (`tmux-aqua`)**: replaces `daemon(1,0)` with `setsid()` + stdio redirect. The reparent fork is removed, so the server stays in the RemotePairHost process subtree.

**RemotePairHost.app** (native Swift, menu bar):
1. Spawns tmux-aqua as a child via `posix_spawn`.
2. Runs an on-demand approve router (OCR + AppleScript click) for permission dialogs.
3. Shows a dynamic session list with attach state, permissions, settings, and update check.
4. Holds an `NSStatusItem` to maintain an Aqua graphic session.

Because `claude` is a descendant of the tmux-aqua **server**, it inherits RemotePairHost's grants regardless of which mosh/SSH client is attached.

**1:1 session model**: each `launch` derives a deterministic session name from the host working directory. A **detached** session is reattached via `attach -d` (taking over any stale client); a session **already held by a live client** gets a fresh `_N`-suffixed session instead. Multiple clients do **not** share one session.

---

## Requirements

- Apple Silicon Mac (host and client; macOS tested on Apple Silicon)
- macOS — Sequoia or later recommended
- SSH key authentication between client and host
- `mosh` on both machines (SSH fallback works but disconnects kill the session)
- **Host only**: Xcode Command Line Tools or full Xcode, Homebrew (for tmux static-build dependencies)

---

## Installation

```bash
# Host — the always-on Mac where claude runs with computer-use
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=host bash

# Client — the laptop you sit at (no build, no Xcode)
curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | ROLE=client bash
```

| Role | What gets installed | Build required | Permission toggles |
|---|---|---|---|
| **host** | `RemotePairHost.app` (embeds tmux-aqua, approve router, OCR finder) + LaunchAgent + watchdog + approve skill/rules | Yes | Yes — once, in System Settings |
| **client** | Finder Quick Action "Launch Remote Pair" + launcher + `remote-pair` CLI | No | No |

After a client install, `remote-pair onboard` runs automatically to configure the host address, terminal app, and folder mappings.

**Reversible uninstall:**

```bash
~/.local/share/remote-pair/shared/uninstall.sh          # removes installed files (manifest-tracked)
~/.local/share/remote-pair/shared/uninstall.sh --purge  # also removes ~/.remote-pair state
```

---

## Usage

### 1. Map folders

Client and host paths often differ (Google Drive, Syncthing, etc.). Register the mapping once:

```bash
remote-pair map add ~/Drive/proj /Users/ghyeong/proj
remote-pair map list
```

Launching an unmapped folder triggers an interactive probe: RemotePair SSH-checks whether the candidate host path exists, then offers to register it, create it on the host, or cancel. No blind warnings.

### 2. Launch a session

```bash
remote-pair launch ~/Drive/proj
```

Or right-click the folder in Finder → **Quick Actions → Launch Remote Pair**.

Options:

```bash
remote-pair launch ~/Drive/proj --fresh   # always open a new session
remote-pair launch ~/Drive/proj --yes     # non-interactive (RP_YES=1)
RP_YES=1 remote-pair launch ~/Drive/proj  # same via env var
```

The only per-session interaction is claude's own built-in **"Allow for this session"** prompt (press Enter once).

### 3. Other commands

```bash
remote-pair onboard               # interactive, re-runnable client setup (host, terminal, mappings, doctor)
remote-pair config list           # show host, terminal app, mapping count
remote-pair config get host       # print current REMOTE_HOST
remote-pair config set host my-mac-mini   # set SSH host
remote-pair config set terminal iterm2    # or: terminal
remote-pair open-gui ~/Drive/proj # open configured terminal app, run launch <dir> in new tab/window
remote-pair ls                    # list host tmux-aqua sessions + folder mappings
remote-pair status                # app PID, host server, heartbeat age, remote host
remote-pair doctor                # check SSH key auth, host app, tmux-aqua on host
remote-pair approve [--for "<hint>"] [--timeout N]  # trigger approve router for a permission dialog
remote-pair host                  # ensure tmux-aqua host server is up (local mode)
```

---

## Host menu bar (RemotePairHost.app)

| Menu item | Function |
|---|---|
| Permission status + **Grant Permissions…** | Shows AX/SR state; opens System Settings |
| **Sessions (N)** | Live session list with attach state. Click → modal: Detach all / Kill session |
| **Restart tmux host** | Restarts the tmux-aqua server |
| **Approve now** | Manually triggers the approve router |
| **Settings…** | Socket path, version, session cwd, auto-update toggle |
| **Check for Updates…** | Fetches GitHub Releases, downloads, verifies, swaps |
| **About / Quit** | — |

---

## Configuration

All runtime state and settings live under `~/.remote-pair`. RemotePair does not depend on `~/.claude` being synced between machines.

| Path | Contents |
|---|---|
| `~/.remote-pair/common.env` | Shared config (socket path, app name, etc.) |
| `~/.remote-pair/host.env` | Host-side config |
| `~/.remote-pair/client.env` | Client config: `REMOTE_HOST`, `TERMINAL_APP`, `FOLDER_MAPS` |
| `~/.remote-pair/logs/` | `remote-pair.log`, `remote-pair.heartbeat` |
| `~/.remote-pair/rules.txt` | Approve router rules (hot-reloaded) |
| `~/.remote-pair/bin/` | Launcher, watchdog, hangul-romanize |
| `~/.remote-pair/.manifest-*`, `backups/` | Reversible install records |
| `~/.claude/skills/approve/` | The only file outside `~/.remote-pair` — required by the Claude harness |

`~/.claude` git-sync (shared agent identity across machines) is an optional convenience (`--with-sync`). RemotePair works without it.

### Terminal app

`open-gui` and `onboard` use the configured terminal app. Default: iTerm2 if `/Applications/iTerm.app` is present, otherwise Terminal.app.

```bash
remote-pair config set terminal iterm2    # iTerm2
remote-pair config set terminal terminal  # Terminal.app
```

For iTerm2, `open-gui` opens a new tab in the current window (or a new window if none is open). For Terminal.app it opens a new window.

---

## Permission grant (one-time, requires physical screen or VNC)

After installing on the host, run RemotePairHost and trigger any computer-use call from claude. When the prompt appears, open **System Settings → Privacy & Security**:

- **Accessibility**: toggle `RemotePairHost` ON. (If not listed, click `+` and add `~/Applications/RemotePairHost.app`.)
- **Screen Recording**: toggle `RemotePairHost` ON.

After toggling, restart the tmux host:

```bash
# from the menu bar: Restart tmux host
# or from the terminal:
launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair-host
```

---

## Building (maintainers)

Requirements: Apple Silicon, Xcode or CLT (Swift 5.10+), Homebrew.

```bash
./host/build-tmux-aqua.sh          # patched tmux → ~/.local/bin/tmux-aqua  (tmux 3.6)
./host/make-signing-cert.sh        # create stable self-signed cert "RemotePair Local Signing" (idempotent)
./host/build-host.sh               # → build/RemotePairHost.app (signed + verified)
./host/build-host.sh --deploy [host]   # build + rsync to host + install.sh --role host
```

**Why a stable cert matters**: ad-hoc signing changes the `cdhash` on every rebuild, invalidating TCC grants. A stable self-signed cert ties the TCC grant to the designated requirement, so it survives rebuilds and updates. No Apple Developer account or notarization required — this is a personal-device tool. Back up the cert: `~/Library/Application Support/RemotePair/signing.p12`.

If CLT (Swift 5.10) + the latest SDK combination is broken, `build-host.sh` automatically falls back to a compatible SDK (14.x).

---

## Releasing

```bash
RP_VERSION=0.4.2 ./host/build-host.sh --release   # signs app, zips, creates gh release v0.4.2
```

Release assets **must** be signed with the same stable cert as the running installation. The app's Updater verifies the leaf CN; a mismatch produces a warning and blocks the swap. The update flow: **Check for Updates…** → download → `codesign --verify` → swap → restart.

Current version: **0.4.2** (pre-1.0). Release tag: `v0.4.2`.

---

## Troubleshooting

**`computer use not granted` after a `claude` update**
```
/mcp disable computer-use
/mcp enable computer-use
```

**SSH key auth fails**
Run `remote-pair doctor` for step-by-step guidance:
1. Create a key if needed: `ssh-keygen -t ed25519`
2. Register it on the host: `ssh-copy-id $REMOTE_HOST`
3. Check `~/.ssh/config` for correct `HostName`, `User`, `IdentityFile`
4. Using 1Password SSH agent? Use `remote-pair approve` to auto-click the unlock prompt.

**After host reboot**
The LaunchAgent starts RemotePairHost automatically, which starts tmux-aqua. Verify:
```bash
tmux-aqua -S /tmp/aqua-tmux.sock ls   # should show _keeper
```

---

## Project layout

| Path | Role |
|---|---|
| `host/RemotePairHost/*.swift` | Host app (AppDelegate, HostManager, ApproveManager, Sessions, Permissions, SettingsWindow, Updater, Config, Installer, main) |
| `host/build-tmux-aqua.sh` | Builds patched tmux → `~/.local/bin/tmux-aqua` |
| `host/make-signing-cert.sh` | Creates stable self-signed signing cert (idempotent) |
| `host/build-host.sh` | Builds, signs, optionally deploys or releases RemotePairHost.app |
| `shared/install.sh` / `uninstall.sh` | Reversible manifest-based install and rollback |
| `client/remote-pair` | Client CLI (launch, ls, map, config, onboard, open-gui, doctor, approve, status, host) |
| `client/remote-pair-launch` | Launcher (path mapping, session setup, non-interactive) |
| `client/Launch Remote Pair.workflow` | Finder Quick Action |
| `host/skills/approve/SKILL.md` | On-demand approve skill (claude requests → RemotePairHost clicks) |
| `shared/bootstrap.sh` | One-shot `curl \| bash` installer (role-aware) |

---

## Contributing

This project is an open-source personal tool. Contributions are welcome — bug reports, fixes, and improvements. Please open an issue before starting large changes to check alignment.

---

## License

Apache-2.0. See [LICENSE](LICENSE).

---

## Disclaimer

Personal tool, tested on macOS (Apple Silicon). Signed with a self-signed/ad-hoc certificate — not notarized, not endorsed by Apple. Building from source is recommended over trusting pre-built binaries from forks. macOS TCC behavior may change across OS versions.
