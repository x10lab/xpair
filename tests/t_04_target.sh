#!/usr/bin/env bash
# t_04_target — verifies the target-decision logic (local vs remote).
#
# Observation method: judged from MLOG's mock call log.
#   local path → tmux-aqua|…|has-session / new-session calls, no ssh|
#   remote path → ssh|…|true (reach) and mosh| calls
#
# Limitation: the interactive '2'→local choice cannot be exercised without a pty in an
# environment lacking /dev/tty — not verified.
cd "$(dirname "$0")"; . ./lib.sh

# ────────────────────────────────────────────────────────────
# Scenario 1: REMOTE_HOST="" (empty value) → forced local
# ────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
MOCK_HASSESSION=0 MOCK_CLIENTS="" MOCK_SESS_EXISTS="" \
  run_launcher "$SBX"

it "target/empty-remote-host→local"
assert_contains "$MLOG" "tmux-aqua" "tmux-aqua called (local path)"
assert_absent   "$MLOG" "ssh|"      "ssh not called (local path)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────
# Scenario 2: REMOTE_HOST set + --local forced → local
# ────────────────────────────────────────────────────────────
SBX_ROLE=both new_sandbox   # default test-host; both-role → --local uses the local tmux-aqua path
make_all_mocks
MOCK_HASSESSION=0 MOCK_CLIENTS="" MOCK_SESS_EXISTS="" \
  run_launcher --local "$SBX"

it "target/remote-host+--local→local"
assert_contains "$MLOG" "tmux-aqua" "tmux-aqua called (--local forced)"
assert_absent   "$MLOG" "ssh|"      "ssh not called (--local forced)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────
# Scenario 3: REMOTE_HOST set + --remote + MOCK_DIRCHECK=__YES__ → remote
# ────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_REACH=ok MOCK_DIRCHECK=__YES__ \
  run_launcher --remote "$SBX"

it "target/remote-host+--remote→remote"
assert_contains "$MLOG" "ssh|"  "ssh reach called (remote path)"
assert_contains "$MLOG" "mosh|" "mosh attach called (remote path)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────
# Scenario 4: REMOTE_HOST set + RP_YES=1 (no --local/--remote) → remote, no prompt
# ────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_REACH=ok MOCK_DIRCHECK=__YES__ RP_YES=1 \
  run_launcher "$SBX"

it "target/rp-yes→remote-no-prompt"
assert_contains "$MLOG" "ssh|"  "ssh reach called (RP_YES remote)"
assert_contains "$MLOG" "mosh|" "mosh attach called (RP_YES remote)"
assert_absent   "$RP_OUT" "select" "no prompt emitted when RP_YES=1"

cleanup_sandbox

# ────────────────────────────────────────────────────────────
# Scenario 5: REMOTE_HOST set + no flags + no tty → ask()=""→remote default
# (the test environment has no tty → read </dev/tty fails → ans="" → defaults to remote)
# New prompt format: "Launch claude for "<proj>":" with "session _N  (state)" annotation.
# ────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_REACH=ok MOCK_DIRCHECK=__YES__ \
  run_launcher "$SBX"

it "target/no-tty-no-flags→remote-default"
assert_contains "$MLOG" "ssh|"  "ssh reach called (no-tty remote default)"
assert_contains "$MLOG" "mosh|" "mosh attach called (no-tty remote default)"

it "target/prompt-contains-session-annotation"
# The interactive prompt is printed to stdout before ask() reads /dev/tty.
# With no tty, prompt is still emitted to stdout — check it contains "session _" and a state word.
assert_contains "$RP_OUT" "session _" "prompt contains 'session _' annotation"

it "target/prompt-contains-state-word"
# State is one of: new, reattach, fresh, new/reattach
case "$RP_OUT" in
  *"(new)"*|*"(reattach)"*|*"(fresh)"*|*"(new/reattach)"*)
    _pass "prompt contains state word" ;;
  *)
    _fail "prompt missing state word :: RP_OUT=[$RP_OUT]" ;;
esac

cleanup_sandbox

# ────────────────────────────────────────────────────────────
# Scenario 6: _remote_next_n via MLOG — _remote_next_n reused in RN loop
# No live mosh-clients → RN=1 → remote session created as _1
# ────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks
MOCK_REACH=ok MOCK_DIRCHECK=__YES__ RP_YES=1 \
  run_launcher "$SBX"

it "target/remote-rn-1-no-mosh-clients"
# With no live mosh-clients, _remote_next_n returns 1 → SESSION ends with _1
assert_contains "$MLOG" "mosh|" "mosh invoked (remote path)"
# The SSH setup script contains SESSION=..._1 (RN=1)
SSH_SCRIPT="$(cat "$SSH_CAPTURE" 2>/dev/null)"
assert_contains "$SSH_SCRIPT" "_1" "remote setup script targets session _1"

cleanup_sandbox

# ────────────────────────────────────────────────────────────
# Scenario 7: _local_next_n reused in launch_local — _N=2 when _1 has client
# (mirrors t_05 scenario 3 but verifies the refactored helper path)
# ────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks

# First run: discover _1 session name
MOCK_HASSESSION=0 MOCK_SESS_EXISTS="" MOCK_CLIENTS="" \
  run_launcher --local "$SBX"
SESS7_1="$(printf '%s\n' "$MLOG" | grep 'new-session' | sed 's/.*|-s|\([^|]*\)|.*/\1/' | head -1)"
: > "$MOCKLOG"

# Second run: _1 has a client → helper must pick _2
MOCK_HASSESSION=0 MOCK_SESS_EXISTS="" MOCK_CLIENTS="$SESS7_1" \
  run_launcher --local "$SBX"

it "target/local-helper-_N2-when-_1-attached"
SESS7_2="${SESS7_1%_1}_2"
assert_contains "$MLOG" "new-session|-d|-s|$SESS7_2" "_local_next_n helper picks _2 when _1 attached"

cleanup_sandbox

finish
