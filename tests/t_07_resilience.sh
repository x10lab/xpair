#!/usr/bin/env bash
# t_07_resilience — reach failure / tailscale exit-node / local fallback + dir-check robustness.
cd "$(dirname "$0")"; . ./lib.sh

# ── Common helper: sleep mock (shortens dir-check retry sleep 1 / tailscale sleep 2) ──
_install_sleep_mock() {
  printf '#!/bin/bash\nexit 0\n' > "$MOCKBIN/sleep"
  chmod +x "$MOCKBIN/sleep"
}

# Replace the tailscale mock — the default mock in lib.sh has a bash parsing bug where the `}`
# inside the default value closes `${...}` prematurely, appending `}}` after the MOCK_TS_JSON value. Fixed by overriding it.
# Behavior: status → print contents of $MOCKBIN/ts_json.txt (or '{"Peer":{}}'); set → log then noop.
_install_tailscale_mock() {
  local ts_json="${1:-}"
  # Save the JSON to a file — completely sidesteps shell variable expansion / quoting issues
  if [ -n "$ts_json" ]; then
    printf '%s' "$ts_json" > "$MOCKBIN/ts_json.txt"
  else
    printf '{"Peer":{}}' > "$MOCKBIN/ts_json.txt"
  fi
  local ts_file="$MOCKBIN/ts_json.txt"
  cat > "$MOCKBIN/tailscale" <<TSMOCK
#!/bin/bash
{ printf '%s' "\$(basename "\$0")"; for a in "\$@"; do printf '|%s' "\$a"; done; printf '\\n'; } >> "\$MOCKLOG"
case "\$1" in
  status) cat "$ts_file" ;;
  set) : ;;
esac
exit 0
TSMOCK
  chmod +x "$MOCKBIN/tailscale"
}

# sudo mock — runs the first argument as-is (PATH=$MOCKBIN included). Handles the launcher's `sudo tailscale set`.
_install_sudo_mock() {
  cat > "$MOCKBIN/sudo" <<'SUDO'
#!/bin/bash
{ printf '%s' "sudo"; for a in "$@"; do printf '|%s' "$a"; done; printf '\n'; } >> "$MOCKLOG"
# Include MOCKBIN in PATH so mock binaries are found
export PATH="$MOCKBIN:$PATH"
exec "$@"
SUDO
  chmod +x "$MOCKBIN/sudo"
}

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 1: reach failure + tailscale absent → stderr warning + local fallback
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
# Exclude tailscale — so command -v tailscale fails
make_all_mocks ssh mosh tmux tmux-aqua claude hangul-romanize launchctl open tput
_install_sleep_mock
# Create the project directory under SBX
mkdir -p "$SBX/myproject"
MOCK_REACH=fail MOCK_HASSESSION=0 \
  run_launcher --remote "$SBX/myproject"

it "s1/reach-fail-no-tailscale: warns that tailscale CLI is missing"
assert_contains "$RP_ERR" "tailscale" "stderr mentions tailscale"

it "s1/reach-fail-no-tailscale: local fallback (tmux-aqua new-session)"
assert_contains "$MLOG" "new-session" "local new-session was called"

it "s1/reach-fail-no-tailscale: mosh not called"
assert_absent "$MLOG" "mosh|" "confirm mosh not called"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 2: reach failure + tailscale present + online exit-node → still fails after set → local fallback
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
_install_sudo_mock
TS_JSON='{"Peer":{"k":{"ExitNodeOption":true,"Online":true,"DNSName":"exit.example.ts.net."}}}'
_install_tailscale_mock "$TS_JSON"
mkdir -p "$SBX/myproject"

MOCK_REACH=fail MOCK_HASSESSION=0 \
  run_launcher --remote "$SBX/myproject"

it "s2/exit-node-set: tailscale set --exit-node was called"
assert_contains "$MLOG" "tailscale|set|--exit-node=exit.example.ts.net" "exit-node configuration call"

it "s2/exit-node-set: local fallback (tmux-aqua new-session)"
assert_contains "$MLOG" "new-session" "local new-session was called"

it "s2/exit-node-set: mosh not called"
assert_absent "$MLOG" "mosh|" "confirm mosh not called"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 3: reach fail-then-ok (recovers after tailscale) + dir-check ok → proceed remotely (mosh)
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
_install_sudo_mock
TS_JSON='{"Peer":{"k":{"ExitNodeOption":true,"Online":true,"DNSName":"exit.example.ts.net."}}}'
_install_tailscale_mock "$TS_JSON"
mkdir -p "$SBX/myproject"

# reach ok from the 2nd attempt → retry succeeds after tailscale set → proceed remotely
MOCK_REACH=fail-then-ok MOCK_REACH_OKAT=2 MOCK_DIRCHECK=__YES__ \
  run_launcher --remote "$SBX/myproject"

it "s3/fail-then-ok: proceeds remotely (mosh call)"
assert_contains "$MLOG" "mosh|" "confirm mosh call (remote attach)"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 4: dir-check ssherr (3 failures) → local fallback + stderr mentions 3-retry
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
mkdir -p "$SBX/myproject"

MOCK_REACH=ok MOCK_DIRCHECK=ssherr MOCK_HASSESSION=0 \
  run_launcher --remote "$SBX/myproject"

it "s4/dir-ssherr: local fallback (tmux-aqua new-session)"
assert_contains "$MLOG" "new-session" "local new-session was called"

it "s4/dir-ssherr: mosh not called"
assert_absent "$MLOG" "mosh|" "confirm mosh not called"

it "s4/dir-ssherr: stderr mentions 3 retries"
assert_contains "$RP_ERR" "3" "confirm 3-retry mention"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 5: dir missing + RP_YES=1 → ssh mkdir then proceed remotely
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
mkdir -p "$SBX/myproject"

MOCK_REACH=ok MOCK_DIRCHECK=__NO__ RP_YES=1 \
  run_launcher --remote "$SBX/myproject"

it "s5/dir-missing-yes: ssh mkdir call"
assert_contains "$MLOG" "mkdir" "confirm ssh mkdir call"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# Scenario 6: dir missing + non-interactive (no tty, no RP_YES) → ask="" → n → die rc=5
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
mkdir -p "$SBX/myproject"

MOCK_REACH=ok MOCK_DIRCHECK=__NO__ \
  run_launcher --remote "$SBX/myproject"

it "s6/dir-missing-decline: rc=5 (directory creation declined)"
assert_rc "$RP_RC" 5 "decline → exit 5"

cleanup_sandbox

finish
