---
name: host-gui-access
description: Use when you need to view or operate the host's macOS GUI — screenshots/clicks, checking the menu bar/windows/dialogs, or when you're unsure "can computer-use work in this session?". Explains how to determine whether the current session is under RemotePair(Host) (whether the $TMUX socket is aqua-tmux.sock), and if so, that the host GUI and computer-use (screenshots/clicks/typing) are available.
---

# Detecting a RemotePair child session → host GUI + computer-use available

## Activation condition (this is the key — determine it first)
Is the current claude running inside the tmux launched by RemotePair(Host)?
```bash
case "${TMUX:-}" in *aqua-tmux.sock*) echo yes;; *) echo no;; esac
```
- `yes` → the following holds. (Additional check: it's certain if the process ancestry has the `RemotePairHost.app` (formerly `RemotePair.app`) → `/usr/bin/script` → `tmux-aqua` chain.)
- `no` → a regular remote/local shell. No guarantee of host GUI access.

## When the condition is met (RemotePair-hosted)
This session inherits the host's Screen Recording (SR) + Accessibility (AX) grants.
→ **The host GUI exists and computer-use (screenshots/clicks/typing) is available.**
Do not skip GUI checks/verification as "impossible in this environment".

- Viewing the screen: computer-use screenshot (or `screencapture -x file.png` then check).
- Don't click approval/permission dialogs yourself; use the `approve` skill (`remote-pair approve --for "..."`).

## Is the host app alive / granted? (avoiding misdiagnosis)
- The menu bar app (RemotePairHost) **runs even without permissions** — permissions only gate computer-use *actions*.
  If it doesn't appear in the menu bar immediately after `open` from the CLI, that doesn't mean it's "dead".
- Don't guess at liveness/permissions; check with one line:  `remote-pair status`
  (App liveness = per launchctl; AX/SR/FDA grants = per the `~/.remote-pair/logs/status.json` the app writes every second.)
- ⚠ `pgrep` often fails to catch `.app` bundle processes, causing the false impression that "the app didn't launch". Don't use it to judge liveness.
