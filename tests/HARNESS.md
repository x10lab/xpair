# Test Harness Contract (tests/lib.sh)

Target launcher: `client/cli/xpair-launch` (new). Reference: `~/.claude/bin/claude-iterm-launch`.
Does not touch real m1/network/GUI — installing a mock under `.local/bin` in a temporary HOME lets the mock win over the real binary thanks to the launcher's PATH-prepend. bash 3.2 compatible only.

## Test File Format
```bash
#!/usr/bin/env bash
cd "$(dirname "$0")"; . ./lib.sh
new_sandbox            # call per scenario (isolation). Prefix with SBX_REMOTE_HOST=/SBX_FOLDER_MAPS= to tweak config
make_all_mocks         # install the full mock set. To leave out a specific mock: make_all_mocks ssh tmux tmux-aqua ... (e.g. excluding claude)
MOCK_X=.. MOCK_Y=.. run_launcher --remote "$SOMEDIR"   # MOCK_* go in as prefixes
it "case name"
assert_rc "$RP_RC" 0 "description"
assert_contains "$MLOG" "pattern" "description"
assert_absent  "$MLOG" "pattern" "description"
assert_eq "$got" "$exp" "description"
cleanup_sandbox
# ... the next scenario calls new_sandbox again ...
finish                 # end of file. Prints __SUMMARY__ + non-zero on failure
```

## Helpers/Variables
- `new_sandbox` : creates a temporary HOME/RP_DIR/MOCKBIN/MOCKLOG/SSH_CAPTURE. Prefix env:
  - `SBX_REMOTE_HOST` : REMOTE_HOST in client.env. `""` means empty value (force local); if unset, `test-host`.
  - `SBX_FOLDER_MAPS` : FOLDER_MAPS in client.env (format `client::host;client2::host2`).
- `make_all_mocks [name...]` : default full set (ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput). If arguments are given, only that list is installed (lets you test the absence of the rest).
- `make_mock NAME` : a single mock.
- If you need custom behavior, **do not modify lib.sh**. After make_all_mocks, overwrite the executable directly at `$MOCKBIN/NAME` (chmod +x). If you want argv logging on the first line, add `{ printf '%s' "$(basename "$0")"; for a in "$@"; do printf '|%s' "$a"; done; echo; } >> "$MOCKLOG"`.
- `run_launcher [args]` : runs the new launcher. Values set: `$RP_OUT` (stdout) `$RP_ERR` (stderr) `$RP_RC` (exit code) `$MLOG` (mock call log, `name|arg|arg` per line).
- `run_reference [args]` : runs the reference (for parity comparison). The reference uses the `~/.claude` path / old names (open -a Xpair, com.ghyeong.xpair) — you must prepare the matching mocks/directories.
- Variables: `$SBX` (sandbox root = HOME) `$RP_DIR` `$MOCKBIN` `$MOCKLOG` `$SSH_CAPTURE` (file storing the body of the remote setup script that the mock ssh received).

## MOCK_* Knobs (run_launcher prefixes)
- `MOCK_REACH` = `ok` (default) | `fail` | `fail-then-ok` (+`MOCK_REACH_OKAT=N`, ok from the Nth reach onward)
- `MOCK_DIRCHECK` = `__YES__` (default) | `__NO__` | `ssherr` (255 without a marker)
- `MOCK_HASSESSION` = `0` (default, server present) | `1` (server absent) — the rc of `has-session` with no arguments
- `MOCK_SESS_EXISTS` = "name1 name2" — sessions for which `has-session -t =name` succeeds (exists) (= prefix excluded)
- `MOCK_CLIENTS` = "name1" — sessions for which `list-clients -t =name` answers that a client is present (x)
- `MOCK_CLAUDE_SLUG` = the slug emitted by the claude `-p` mock (default translated-slug)
- `MOCK_HROMANIZE` = the hangul-romanize mock output (default romanized)
- `MOCK_TS_JSON` = the `tailscale status --json` output JSON
- `MOCK_COLS` / `MOCK_LINES` = tput output (default 200/50)
- `MOCK_ATT` = the `list-sessions` output (for zombie cleanup, "session-name attached" lines)
- `MOCK_REMOTE_SESSION` = the `__SESSION__:<value>` that the mock ssh gives as its setup response (default rp_remote_1)

## Observation Tips
- Confirm the local/remote session name via `new-session -s <NAME>` (MLOG) or `SESSION='<NAME>'` in SSH_CAPTURE.
- For the injected respawn temp file, extract the `bash /…/claude-respawn.XXX` path from MLOG and `cat` it to check `CL_CONTINUE=` / `CLAUDE_WARP_RC=` (the launcher does not delete it).
- To verify the remote setup script, use `$(cat "$SSH_CAPTURE")`.

## Rules
- **Do not modify** `tests/lib.sh`, `tests/run.sh`, or the launcher body. Only create `tests/t_NN_<area>.sh`.
- If a test reveals a **real bug** in the launcher, leave that assert failing and report the bug (file:line + symptom). Do not fix the launcher directly (serial fixes are the main agent's job).
- The interactive `ask()` reads from /dev/tty — with no tty, the response is empty. In tests without a pty, only verify the "non-interactive default branch" (e.g., empty response → remote default).
