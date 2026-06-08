#!/usr/bin/env bash
# t_08 — 에러 로깅 / die / stderr tee / 좀비정리 안전성 (US-8).
cd "$(dirname "$0")"; . ./lib.sh

# ── s1: LAUNCH_LOG 헤더 기록 ──
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
MOCK_HASSESSION=0 run_launcher --local "$SBX"
it "s1/launch-log-header"
LOGTXT="$(cat "$RP_DIR/logs/claude-launch.err.log" 2>/dev/null)"
assert_contains "$LOGTXT" "launch" "LAUNCH_LOG 에 launch 헤더 기록됨"
assert_contains "$LOGTXT" "=====" "헤더 구분선 존재"
cleanup_sandbox

# ── s2: die — 존재하지 않는 프로젝트 폴더 → rc=1 ──
new_sandbox
make_all_mocks
RP_YES=1 run_launcher --local "$SBX/does-not-exist-xyz"
it "s2/die-missing-dir"
assert_rc "$RP_RC" 1 "없는 폴더 → die rc=1"
assert_contains "$RP_ERR$(cat "$RP_DIR/logs/claude-launch.err.log" 2>/dev/null)" "directory not found" "die message printed"
cleanup_sandbox

# ── s3: stderr tee → LAUNCH_LOG 에 stderr 경고가 들어감 ──
# reach 실패 + tailscale 부재 → stderr 경고 → tee 로 LAUNCH_LOG 에도 남아야 함.
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude hangul-romanize launchctl open tput
MOCK_REACH=fail MOCK_HASSESSION=0 run_launcher --remote "$SBX"
it "s3/stderr-tee-to-log"
LOGTXT="$(cat "$RP_DIR/logs/claude-launch.err.log" 2>/dev/null)"
assert_contains "$LOGTXT" "tailscale" "stderr 경고가 LAUNCH_LOG 로 tee 됨"
cleanup_sandbox

# ── s4: 좀비정리 안전성 — mosh-client 없음 → no-op, 원격 진행 ──
# (실제 kill 경로는 매칭되는 mosh-client 프로세스가 필요해 헤드리스로 미검증 — 한계 명시)
new_sandbox
make_all_mocks
MOCK_REACH=ok MOCK_DIRCHECK=__YES__ run_launcher --remote "$SBX"
it "s4/zombie-cleanup-noop-safe"
assert_contains "$MLOG" "list-sessions" "좀비정리: host attach 목록 질의(ssh list-sessions) 수행"
assert_contains "$MLOG" "mosh|" "매칭 mosh-client 없음 → 정상적으로 원격 attach 진행"
cleanup_sandbox

finish
