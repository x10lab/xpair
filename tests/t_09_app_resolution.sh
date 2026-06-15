#!/usr/bin/env bash
# t_09_app_resolution — white-box: client/cli/remote-pair app/identity resolution.
#
# Targets under test (client/cli/remote-pair):
#   app_pid()       Recognizes both the CURRENT (com.x10lab.remote-pair-host) and FORWARD (com.x10lab.remote-pair)
#                   labels in launchctl list (dual-id probing for the 0.5 flip). Falls back to pgrep on miss.
#                   NOTE: the current shipping identity is com.x10lab.remote-pair-host / RemotePairHost. FORWARD is the unified 0.5 id.
#   app_available() Checks existence across two locations (/Applications + ~/Applications) x both app names (CURRENT/FORWARD)
#                   (verifies the fix for Seonjae's ~/Applications-only bug). Also honors pid/status.json/host-session.
#
# Observation method: drop mock launchctl/pgrep/open into MOCKBIN and record argv into MOCKLOG.
#   The CLI (unlike the launcher) does not prepend PATH, so this runner puts MOCKBIN at the front of PATH.
#
# Limitation: the real '/Applications' cannot be changed under the sandbox (requires root, must not pollute the real system). So
#   app_available's NEW/LEGACY '.app exists' case is verified against $HOME/Applications (sandbox-capable), and
#   the /Applications branch is confirmed by code inspection only (see the inspect case below). bash 3.2 compatible.

cd "$(dirname "$0")"; . ./lib.sh

CLI_SRC="${CLI_SRC:-$_REPO_ROOT/client/cli/remote-pair}"

# run_cli [args...] — run the remote-pair CLI with sandbox + MOCKBIN-on-PATH.
# The CLI does not touch PATH, so we prepend MOCKBIN here so the mocks shadow the real commands.
run_cli() {
  RP_OUT="$(PATH="$MOCKBIN:$PATH" RP_DIR="$RP_DIR" HOME="$HOME" bash "$CLI_SRC" "$@" 2>"$RP_ERRFILE")"; RP_RC=$?
  RP_ERR="$(cat "$RP_ERRFILE" 2>/dev/null)"
  MLOG="$(cat "$MOCKLOG" 2>/dev/null)"
}

# make_launchctl_mock LINE... — mock launchctl 'list' so it prints the given lines.
# Each line is in the real launchctl list format "PID\tSTATUS\tLABEL". Other subcommands log argv and exit.
make_launchctl_mock() {
  local f="$MOCKBIN/launchctl"
  _emit_logger > "$f"
  {
    echo 'if [ "$1" = list ]; then'
    local l
    for l in "$@"; do printf '  printf "%%s\\n" %q\n' "$l"; done
    echo '  exit 0'
    echo 'fi'
    echo 'exit 0'
  } >> "$f"
  chmod +x "$f"
}

# make_pgrep_mock [MATCH]  — pgrep -f <pat> prints a PID when it MATCHes (substring match on pat). Default is always empty.
make_pgrep_mock() {
  local f="$MOCKBIN/pgrep" match="${1:-}"
  _emit_logger > "$f"
  if [ -n "$match" ]; then
    cat >> "$f" <<EOS
pat=""
for a in "\$@"; do pat="\$a"; done
case "\$pat" in
  *${match}*) echo "${MOCK_PGREP_PID:-4242}"; exit 0 ;;
esac
exit 1
EOS
  else
    echo 'exit 1' >> "$f"
  fi
  chmod +x "$f"
}

# ────────────────────────────────────────────────────────────────────────────
# Case 1: running under the CURRENT label (com.x10lab.remote-pair-host) → status resolves to running
#   (the current shipping identity. This is the primary BUNDLE_PREFIX.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_launchctl_mock "$(printf '7777\t0\tcom.x10lab.remote-pair-host')"
make_pgrep_mock
make_mock open
run_cli status

it "app/current-label→running"
assert_rc "$RP_RC" 0 "status rc=0"
assert_contains "$RP_OUT" "running (pid 7777)" "CURRENT label → app running pid 7777"
assert_contains "$MLOG" "launchctl|list" "status probes via launchctl list"
# the pgrep fallback must not be called since launchctl already matched
assert_absent "$MLOG" "pgrep|" "pgrep fallback unused on launchctl hit"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# Case 2: only the FORWARD label (com.x10lab.remote-pair, unified 0.5 id) → still resolves via dual-id probing
#   (even if the 0.5 flip moves the host to the unified id, this CLI does not produce a false negative.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_launchctl_mock "$(printf '8888\t0\tcom.x10lab.remote-pair')"
make_pgrep_mock
make_mock open
run_cli status

it "app/forward-label→still-running (dual-id)"
assert_rc "$RP_RC" 0 "status rc=0"
assert_contains "$RP_OUT" "running (pid 8888)" "FORWARD label → still running pid 8888 (dual-id)"
assert_contains "$MLOG" "launchctl|list" "status probes via launchctl list"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# Case 2b: no label → pgrep fallback hits on the FORWARD app name (RemotePair)
#   (the CURRENT pgrep pattern RemotePairHost.app/... differs from 'RemotePair.app/...' so it misses →
#    the FORWARD pgrep pattern RemotePair.app/... hits. Verifies the dual-id pgrep fallback.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_launchctl_mock                 # list prints no labels at all
make_pgrep_mock "RemotePair.app/Contents/MacOS/RemotePair"
make_mock open
run_cli status

it "app/no-label→pgrep-fallback (forward app name)"
assert_contains "$RP_OUT" "running (pid 4242)" "launchctl miss → pgrep fallback hit (4242)"
assert_contains "$MLOG" "pgrep|" "pgrep fallback called on launchctl miss"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# Case 3: the app exists at ~/Applications/RemotePairHost.app (CURRENT) → app_available true.
#   (Seonjae's bug: it used to look at only one location. The current code checks both /Applications + ~/Applications.)
#   /Applications is not sandbox-capable → verified here against ~/Applications. The /Applications branch is inspected in case 3b.
#   Observation: app_available is true → approve does not emit need_app_guidance (install instructions) and proceeds to write the trigger.
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
mkdir -p "$HOME/Applications/RemotePairHost.app"
make_launchctl_mock                 # no label
make_pgrep_mock                     # no pid
make_mock open
# approve: when app_available, write the trigger file and wait for the router log (short timeout).
run_cli approve --timeout 1

it "app/home-applications-current→available (approve proceeds)"
# app_available=true → install instructions (need_app_guidance) must not appear
assert_absent "$RP_OUT$RP_ERR" "this command needs the" "app present → no install instructions printed"
# evidence that it proceeded toward the trigger (the 'approve request →' message)
assert_contains "$RP_OUT" "approve request" "app_available=true → approve proceeds to trigger"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# Case 3b: code inspection of the /Applications branch (not sandbox-capable → static verification).
#   Confirm Seonjae's ~/Applications-only bug is fixed: check in the source that app_available/cmd_host
#   iterate over both "/Applications" and "$HOME/Applications".
# ────────────────────────────────────────────────────────────────────────────
it "app/applications-dual-location-fixed (inspect)"
# the for loops in app_available + cmd_host must both include both locations
av_loop="$(grep -n 'for d in "/Applications" "\$HOME/Applications"' "$CLI_SRC" | wc -l | tr -d ' ')"
assert_eq "$av_loop" "2" "/Applications + ~/Applications dual-location loop appears in 2 places (app_available, cmd_host)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# Case 4: the FORWARD app (RemotePair.app, unified 0.5 id) is in ~/Applications → still detected after the flip
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
mkdir -p "$HOME/Applications/RemotePair.app"
make_launchctl_mock
make_pgrep_mock
make_mock open
run_cli approve --timeout 1

it "app/forward-app-bundle→still-detected"
assert_absent "$RP_OUT$RP_ERR" "this command needs the" "FORWARD .app present → no install instructions printed (dual-id detection)"
assert_contains "$RP_OUT" "approve request" "FORWARD .app → app_available=true → approve proceeds"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# Case 4b: whether cmd_host tries open with the CURRENT id (RemotePairHost) first (app installed + server down).
#   host_up=false (server down), app installed at ~/Applications/RemotePairHost.app → tries open -a RemotePairHost.
#   The server never comes up so it exits non-zero, but open -a RemotePairHost must be recorded in MLOG.
#   (If open succeeds with CURRENT, the FORWARD open is skipped by short-circuit evaluation — only check open -a RemotePairHost is present.
#    Match exactly on 'open|-a|RemotePairHost' to rule out an accidental prefix (RemotePair) match.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
mkdir -p "$HOME/Applications/RemotePairHost.app"
make_launchctl_mock
make_pgrep_mock
make_mock open                      # tmux-aqua absent → host_up=false stays
run_cli host

it "host/open-tries-current-id"
assert_contains "$MLOG" "open|-a|RemotePairHost" "cmd_host tries open -a RemotePairHost (CURRENT id)"

cleanup_sandbox

finish
