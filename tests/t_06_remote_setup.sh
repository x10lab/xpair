#!/usr/bin/env bash
# t_06_remote_setup — remote setup script, presize, base64 respawn, mosh attach, session-name scenarios.
cd "$(dirname "$0")"; . ./lib.sh

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 1: verify basic composition of SSH_CAPTURE contents
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok \
  run_launcher --remote "$SBX"

it "ssh-capture/RESPAWN_B64-present"
assert_contains "$(cat "$SSH_CAPTURE")" "RESPAWN_B64=" "setup script contains RESPAWN_B64="

it "ssh-capture/base64-decode-cmd"
assert_contains "$(cat "$SSH_CAPTURE")" "base64 -d" "setup script contains base64 -d"

it "ssh-capture/SESSION-line"
assert_contains "$(cat "$SSH_CAPTURE")" "SESSION='" "setup script contains SESSION='<name>'"

it "ssh-capture/open-RemotePairHost"
assert_contains "$(cat "$SSH_CAPTURE")" 'open -a "RemotePairHost"' "contains RemotePairHost app open command"

it "ssh-capture/bundle-prefix"
assert_contains "$(cat "$SSH_CAPTURE")" "com.x10lab.remote-pair-host" "contains bundle prefix"

it "ssh-capture/SOCK-aqua"
assert_contains "$(cat "$SSH_CAPTURE")" 'SOCK="/tmp/aqua-tmux.sock"' "contains SOCK variable assignment"

it "ssh-capture/computer-use-comment"
assert_contains "$(cat "$SSH_CAPTURE")" "RemotePairHost" "mentions RemotePairHost in the computer-use context"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 2: presize — whether MOCK_COLS/MOCK_LINES are reflected in new-session -x/-y
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok MOCK_COLS=123 MOCK_LINES=45 \
  run_launcher --remote "$SBX"

it "presize/cols-in-new-session"
assert_contains "$(cat "$SSH_CAPTURE")" "-x 123" "new-session contains -x 123"

it "presize/lines-in-new-session"
assert_contains "$(cat "$SSH_CAPTURE")" "-y 45" "new-session contains -y 45"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 3: base64 round-trip — extract the RESPAWN_B64 value, decode it, and verify the contents
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok \
  run_launcher --remote "$SBX"

it "base64-roundtrip/claude-remote-control"
# extract the value from the RESPAWN_B64='...' line → base64 decode
_b64="$(grep "^RESPAWN_B64='" "$SSH_CAPTURE" | sed "s/^RESPAWN_B64='//;s/'$//")"
_decoded="$(printf '%s' "$_b64" | base64 -d 2>/dev/null)"
assert_contains "$_decoded" "claude --remote-control" "decoded result contains claude --remote-control"

it "base64-roundtrip/crash-restart-loop"
assert_contains "$_decoded" "restarting in 3s" "decoded result contains crash-restart loop"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 4: mosh line — guard against the $HOME expansion bug regression (CRITICAL)
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok \
  run_launcher --remote "$SBX"

it "mosh-line/present-in-mlog"
mline="$(printf '%s\n' "$MLOG" | grep '^mosh|')"
assert_contains "$mline" "mosh" "MLOG contains a mosh invocation"

it "mosh-line/no-literal-HOME"
# $HOME must not remain as a literal — it must be an expanded absolute path
assert_absent "$mline" '$HOME' "mosh line has no literal \$HOME (guards against bug regression)"

it "mosh-line/absolute-tmux-aqua"
assert_contains "$mline" "/.local/bin/tmux-aqua" "mosh line contains absolute-path tmux-aqua"

it "mosh-line/mosh-server-path"
assert_contains "$mline" "--server=/opt/homebrew/bin/mosh-server" "contains mosh --server absolute path"

it "mosh-line/attach-d"
assert_contains "$mline" "attach" "mosh line contains attach"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 5a: session name — MOCK_REMOTE_SESSION unset → default rp_remote_1
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok \
  run_launcher --remote "$SBX"

it "session-name/default-rp_remote_1"
mline="$(printf '%s\n' "$MLOG" | grep '^mosh|')"
assert_contains "$mline" "=rp_remote_1" "mosh attach target is =rp_remote_1"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 5b: session name — MOCK_REMOTE_SESSION=foo_2 → attach -t =foo_2
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok MOCK_REMOTE_SESSION=foo_2 \
  run_launcher --remote "$SBX"

it "session-name/custom-foo_2"
mline="$(printf '%s\n' "$MLOG" | grep '^mosh|')"
assert_contains "$mline" "=foo_2" "mosh attach target is =foo_2"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 6: RemotePairHost server-ensure — has-session block + launchctl kickstart
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_DIRCHECK=__YES__ MOCK_REACH=ok \
  run_launcher --remote "$SBX"

it "server-ensure/has-session-block"
assert_contains "$(cat "$SSH_CAPTURE")" "tm has-session" "setup script contains tm has-session block"

it "server-ensure/launchctl-kickstart"
assert_contains "$(cat "$SSH_CAPTURE")" 'launchctl kickstart "gui/$(id -u)/com.x10lab.remote-pair-host"' "contains launchctl kickstart line"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Record the on_tab_close coverage limitation (headless cannot trigger HUP/TERM)
# — only verify the trap declaration in the launcher source (read-only grep)
# ─────────────────────────────────────────────────────────────────────────────
it "on-tab-close/trap-defined-in-launcher"
_trap_line="$(grep 'trap on_tab_close HUP TERM' "$LAUNCHER_SRC" || true)"
assert_contains "$_trap_line" "trap on_tab_close HUP TERM" "launcher source has trap on_tab_close HUP TERM declaration"

finish
