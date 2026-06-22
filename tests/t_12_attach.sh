#!/usr/bin/env bash
cd "$(dirname "$0")"; . ./lib.sh

CLI_SRC="${CLI_SRC:-$_REPO_ROOT/client/cli/xpair}"

run_cli() {
  RP_OUT="$(PATH="$MOCKBIN:$PATH" RP_DIR="$RP_DIR" HOME="$HOME" bash "$CLI_SRC" "$@" 2>"$RP_ERRFILE")"; RP_RC=$?
  RP_ERR="$(cat "$RP_ERRFILE" 2>/dev/null)"
  MLOG="$(cat "$MOCKLOG" 2>/dev/null)"
}

SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
SESSION="gh_proj_1"
MOCK_SESS_EXISTS="$SESSION" run_cli attach --local "$SESSION"

it "attach/local-existing-session"
assert_rc "$RP_RC" 0 "local attach succeeds"
assert_contains "$MLOG" "tmux-aqua|-S|/tmp/aqua-tmux.sock|has-session|-t|=$SESSION" "checks exact local session existence"
assert_contains "$MLOG" "tmux-aqua|-S|/tmp/aqua-tmux.sock|attach|-d|-t|=$SESSION" "attaches exact local session"
cleanup_sandbox

SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
SESSION="missing_1"
MOCK_SESS_EXISTS="" run_cli attach --local "$SESSION"

it "attach/local-missing-session"
assert_rc "$RP_RC" 4 "missing local session returns not-found"
assert_contains "$RP_ERR" "session not found: $SESSION" "missing local session is reported"
assert_absent "$MLOG" "new-session" "attach never creates a session"
cleanup_sandbox

new_sandbox
make_all_mocks
SESSION="test-host_proj_1"
run_cli attach "$SESSION"

it "attach/remote-existing-session"
assert_rc "$RP_RC" 0 "remote attach succeeds"
assert_contains "$MLOG" "ssh|-n|-o|BatchMode=yes|-o|ConnectTimeout=4|test-host" "checks remote session existence over ssh"
assert_contains "$MLOG" "has-session -t '=$SESSION'" "checks exact remote session name"
assert_contains "$MLOG" "mosh|--server=$HOME/.local/bin/mosh-server|test-host" "uses mosh for remote attach"
assert_contains "$MLOG" "attach|-d|-t|=$SESSION" "attaches exact remote session"
cleanup_sandbox

new_sandbox
make_all_mocks
run_cli attach "bad/name"

it "attach/invalid-session-name"
assert_rc "$RP_RC" 2 "invalid session name returns usage error"
assert_contains "$RP_ERR" "invalid session name: bad/name" "invalid name is reported"
assert_absent "$MLOG" "ssh|" "invalid name does not probe ssh"
assert_absent "$MLOG" "tmux-aqua" "invalid name does not invoke tmux-aqua"
cleanup_sandbox

finish
