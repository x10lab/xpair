# RemotePair → RemotePairHost Refactor & Cutover — Comprehensive Handoff

> This document captures the full context, decisions, and procedures accumulated so far, so that **an agent/person seeing this for the first time can take over from m4 (client) and execute/verify the host (m1) cutover**. (Branch `refactor/host-client-split`)

---

## 0. Where we are right now
- Refactor splitting a single `RemotePair.app` → **2 products (RemotePairHost.app + remote-pair CLI)** + approve subsystem
  improvements + 2 skills, **code & local verification complete**. 7 commits on branch `refactor/host-client-split` (see §9), **not merged to main**.
- **What remains = 1 host (m1) cutover** (replace old app → new app + re-grant permissions + real-GUI verification). This is risky and
  needs human/GUI hands, so it is on hold. Procedure in §7~§8.
- Who does the work: **operate m1 from m4 via `ssh gh-mac-m1`.** m4 has no physical-GUI access to m1 → GUI is done via the computer-use of
  the claude running under RemotePair (§6).

---

## 1. What this project is and why it's hard (background)
A system that lets **Claude Code, running inside a persistent tmux session attached remotely (mosh/ssh), use macOS built-in computer-use
(screenshot/click/type)**. You attach from a laptop (**client=gh-mac-m4**) to a headless 24h Mac (**host=gh-mac-m1**) and run claude there,
but that claude sees and operates the host's screen.

It's hard because of the **macOS TCC 2-gate**:
- **SR (Screen Recording)** = screenshot. Evaluated via the responsible-process chain (inherited even through a daemon).
- **AX (Accessibility)** = synthetic input (click/type). Evaluated by the host **.app's activation policy + Aqua graphic-session**.
- The `claude` CLI is a non-.app + versioned path, so it isn't even registered in the permission list → **a permission-holding .app (RemotePairHost) must become the host**
  and place claude in its own subtree so permissions are inherited.
- Default tmux uses `daemon(3)` to reparent the server to launchd → claude leaves the host subtree → AX fails.
  So we use **patched tmux (`tmux-aqua`: daemon→setsid, no reparent)** to keep the server in the host app's subtree.
- SIP + non-MDM means permissions can't be granted via `tccutil`/PPPC → **only the System Settings user toggle** works (the cutover hurdle, §8).

**Solution structure**:
```
login → LaunchAgent(KeepAlive) → RemotePairHost.app (menu bar, AX+SR granted)
  └ posix_spawn → /usr/bin/script(pty) → tmux-aqua server(/tmp/aqua-tmux.sock, _keeper)  ← app subtree
       └ claude session added by client → computer-use ✅
[client] remote-pair launch <dir> → path mapping → ssh setup(create/share session) → mosh attach
```

---

## 2. What this refactor changed (everything)
1. **App split/expansion**: `RemotePairNative/main.swift` (a single 150 lines) → `host/app/*.swift` 8 files
   (Config / HostManager(tmux child) / ApproveManager(router child) / Sessions(query·detach·kill) /
   Permissions(AX·SR state + settings window) / SettingsWindow / Updater(GitHub Releases) / AppDelegate / main).
   Menu bar: dynamic session list → clicking a session opens a **Detach all / Kill modal**, Grant Permissions, Settings, Check
   for Updates, About, Quit. Keeps accessory (LSUIElement).
2. **Namespace `~/.remote-pair`**: all runtime state (config·logs·rules·bin·manifest) moved here.
   Under `~/.claude` **only skills** are installed → **no dependency on `~/.claude` sync** (works even without it). git-sync is optional personal convenience.
3. **Client**: `remote-pair` CLI (`launch/ls/map/doctor/approve/status/host`) +
   launcher `remote-pair-launch`. **Path mapping** (handles client↔host absolute-path differences; external sync = Google Drive/Syncthing),
   **1:1 connection** (deterministic session name based on host path + `_N` number; detached → `attach -d` take-over, attached → `_N` fresh — multi-attach session sharing dropped, identical to the reference claude-iterm-launch), **non-interactive** (`RP_YES`/`--yes`).
4. **approve improvements** (§5).
5. **Skills**: `approve` (request to pass a blocked approval dialog), `host-gui-access` (determine whether GUI + computer-use is possible when running under RemotePair).
6. **Cleanup**: deleted `CLAUDE.command` (gh-mac-m4 hard-lock), Service "Launch Remote Pair", `build-native.sh`→`build-host.sh`,
   removed legacy approve glue (wrong-format rules.txt · dead engine.applescript).

---

## 3. Environment facts (must-know)
- **The session this work runs in is itself a tmux child of the old RemotePair.app**:
  `claude → bash → tmux-aqua(/tmp/aqua-tmux.sock) → /usr/bin/script → RemotePair.app(old)`.
  Detection: `case "$TMUX" in *aqua-tmux.sock*) ...` → RemotePair-hosted (skill host-gui-access).
- Both m1/m4 are **CLT (Swift 5.10) without Xcode** + a newer SDK → default swiftc breaks. `build-host.sh`
  **auto-falls back** to the MacOSX14.5 SDK (resolved).
- Old app: `~/Applications/RemotePair.app`, bundle `com.ghyeong.remote-pair`, LaunchAgent same name (+watchdog).
- New app: `build/RemotePairHost.app`, bundle **`com.x10lab.remote-pair-host`**, v4.0.0. (Currently ad-hoc signed — no cert.)

### cert backstory (important)
- The old app is signed with self-signed **"RemotePair Local Signing"**, but the **private key/identity exists
  nowhere on m1·m4** (`security find-identity -v -p codesigning` = 0, no p12 backup).
- Being self-signed, **regenerate rather than recover**: `host/make-signing-cert.sh` (idempotent, no Apple account needed).
- Because the bundle id changes, **one re-grant is unavoidable**. But once signed with the regenerated cert, subsequent rebuilds/updates
  keep the grant (the app's Updater verifies the leaf CN; warns on mismatch).

---

## 4. Verification status (what's confirmed and what isn't)
- ✅ Local: `build-host.sh` build + `codesign --verify --strict`, `bash -n` on all shell scripts,
  sandbox client install→doctor→**uninstall reversibility**, path-mapping unit tests, approve router graceful
  degradation · exit codes · hint interpretation, haiku-call correction (`vision → NONE` rc=0), host-gui-access detection.
- ⛔ Unverified (needs cutover + real GUI): menu-bar GUI behavior (session list · modal · settings window · About · update), actual permission-dialog click /
  haiku classification accuracy, real attach of a shared session, computer-use regression, GitHub Releases update.

---

## 5. approve subsystem (current design)
Files: `host/remote-pair-approve-router.sh` (embedded in the app bundle's `Contents/Helpers/`), CLI `remote-pair approve`, skill `host/skills/approve`.
- **Adaptive polling** (`RP_WAIT_SECS` default ~18s): catches the dialog even if it appears late after the trigger.
- **Verification loop**: after click/key, re-capture to confirm "did the marker disappear" · retry → `exit 0` (success) / `1` (failure).
- **Hybrid detection**: OCR rules (marker) first → on miss, **haiku classifies only "which known dialog is this"** (it can't give coordinates —
  coordinates always come from OCR `ocr-find`). If UNKNOWN, fall back to a generic approval label.
  - haiku = subscription claude CLI: `claude -p "$prompt" --model claude-haiku-4-5 --allowed-tools Read`
    (prompt positional **first** — `--allowed-tools` is variadic, so placing prompt after it swallows it: a past bug).
    best-effort + timeout (12s) + cycle gate; on consecutive failures, vision is auto-disabled for that run. If absent, OCR rules only.
- **`--for "<what>"` hint**: if the agent tells you which approval it is, prioritize the matching rule + haiku prior.
  (The old `--label` was a dead arg the router never read → now actually wired up.)
- **On failure, don't self-recover — report via log**: `remote-pair approve` outputs this request's router log for both success and failure
  → the calling agent reads it and chooses among **re-trigger / add-rule / report-to-user**. (Branching guide in SKILL.md.)
- Rules: `~/.remote-pair/rules.txt` (`id<TAB>marker<TAB>action`; action = `ocr:label|..` or `key:combo`).

---

## 6. How to do GUI work on the headless m1
m4 has no physical GUI on m1. GUI is done via **the computer-use of the claude in the tmux under RemotePair** (SR+AX inherited).
- ⛔ `ssh gh-mac-m1 claude -p "..."` alone = no computer-use (the sshd child = outside RemotePair → can't inherit AX).
- ✅ Launch it under RemotePair:
  ```bash
  ssh gh-mac-m1 'tmux-aqua -S /tmp/aqua-tmux.sock new-session -d -s gui "claude -p \"<GUI task>\""'
  ```
- View/operate: computer-use screenshot (or `screencapture -x f.png` then Read) + `cliclick` when needed.
  For approval dialogs, don't click directly — use `remote-pair approve --for "..."`.

---

## 7. Cutover procedure (from m4)
> Read the §8 pitfalls first. Run install from **plain ssh (outside RemotePair)**, **at a point where it's OK to be disconnected**.

```bash
# 1) Regenerate cert + build (session doesn't die)
ssh gh-mac-m1 '
  cd ~/Spaces/Work/Devs/Lang-Swift/remote-pair &&
  git checkout refactor/host-client-split &&
  ./host/make-signing-cert.sh &&     # stable cert (idempotent)
  ./host/build-tmux-aqua.sh &&       # tmux-aqua (fast if already present)
  ./host/build-host.sh               # → build/RemotePairHost.app, verify OK ✓ at the end
'

# 2) Re-grant the new app (§8 — after the new app is signed, before cutover)

# 3) Cutover — old app + all RemotePair sessions on m1 are terminated
ssh gh-mac-m1 'cd ~/Spaces/Work/Devs/Lang-Swift/remote-pair && ./shared/install.sh --role host'

# 4) Confirm startup
ssh gh-mac-m1 'launchctl list | grep remote-pair-host; ~/.local/bin/tmux-aqua -S /tmp/aqua-tmux.sock ls'
```

---

## 8. Two pitfalls (the cutover crux)
1. **Session suicide**: per §3 above, since this work is a tmux child of the old RemotePair, `install.sh --role host` (or
   `pkill RemotePair*`, or a new same-socket instance's `reapStrays`) **terminates the current session + all RemotePair
   tmux sessions on m1**. → From plain ssh, at a point where it's OK to be disconnected.
2. **Bootstrap paradox (re-grant)**: after cutover, the new bundle id means grant=0. The headless m1 has no GUI subject
   to grant that new app (after cutover, every claude is under the un-granted new app → no computer-use).
   → **Secure one of these *before* cutover**:
   - **(A)** Using the computer-use of the still-alive session (which holds the old app's grant), go to System Settings → Privacy & Security
     → Accessibility / Screen Recording and add `~/Applications/RemotePairHost.app` via `+` and turn it ON.
     (The grant is bound to bundle id + cert leaf, so pre-granting the new app signed with the regenerated cert keeps it after cutover.)
   - **(B)** Have a human toggle it via VNC/Screen Sharing.
   If neither is possible, computer-use is permanently blocked after cutover.

---

## 9. Branch commits
```
65e5da2 docs: cutover runbook
8480b0e docs(skill): host-gui-access — detect RemotePair subtree + GUI/computer-use
fdb117d feat(approve): --for hint to convey which approval it is
9e0f54d fix(approve): correct claude -p invocation + expose failure log
07af4b4 feat(approve): adaptive polling + verification + haiku classification fallback
0afe548 feat: ~/.remote-pair namespace + path-mapping·session-sharing·doctor + .claude decouple
36a46a2 feat: RemotePairHost app split·expansion + build-host.sh
```

## 10. Verification checklist (after re-grant)
`remote-pair status && remote-pair doctor` → menu bar ⌗⌘ (session list · Detach/Kill modal · permissions ✓✓ · Settings · About · Check
for Updates) → `launch` the same folder twice (session sharing, attached 2) → `approve --for "1Password"` → computer-use screenshot/click.

## 11. Rollback
`ssh gh-mac-m1 '~/.local/share/remote-pair/shared/uninstall.sh'` (reverse manifest order; `--purge` to also remove `~/.remote-pair`).
Preserves `~/.claude` user data. Returning to the old app requires rebuilding the old build from the `main` branch (no old cert key, so re-grant).

## 12. References
- SSOT: `shared/config.sh`. Reversible engine: `shared/lib.sh` (manifest).
- Original plan: `~/.claude/plans/bubbly-purring-bubble.md` (on m4, `/plans/` syncs but `/projects/`
  (memos) is gitignored so it doesn't → for context, this document is the single source).
