#!/usr/bin/env bash
# t_00_smoke — harness self-check (US-1) + minimal verification of the local-create path.
cd "$(dirname "$0")"; . ./lib.sh

# Scenario: force --local -> local path. Server up, no session/clients -> new-session + attach -d.
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
MOCK_HASSESSION=0 MOCK_CLIENTS="" MOCK_SESS_EXISTS="" \
  run_launcher --local "$SBX"

it "harness/local-create"
assert_rc "$RP_RC" 0 "exec attach succeeds after local create"
assert_contains "$MLOG" "tmux-aqua|-S|/tmp/aqua-tmux.sock|new-session" "tmux-aqua new-session invoked"
assert_contains "$MLOG" "new-session|-d" "detached session created"
assert_contains "$MLOG" "attach|-d" "attach -d take-over invoked"
assert_absent "$MLOG" "ssh|" "ssh not invoked on the local path"
assert_absent "$MLOG" "mosh|" "mosh not invoked on the local path"

cleanup_sandbox
finish
