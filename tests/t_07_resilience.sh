#!/usr/bin/env bash
# t_07_resilience — reach 실패/tailscale exit-node/로컬 폴백 + dir-check 강건성.
cd "$(dirname "$0")"; . ./lib.sh

# ── 공통 헬퍼: sleep mock (dir-check 재시도 sleep 1 / tailscale sleep 2 단축) ──
_install_sleep_mock() {
  printf '#!/bin/bash\nexit 0\n' > "$MOCKBIN/sleep"
  chmod +x "$MOCKBIN/sleep"
}

# tailscale mock 교체 — lib.sh 의 기본 mock 은 default value 안의 `}` 가 `${...}` 를 조기 닫아
# MOCK_TS_JSON 값 뒤에 `}}` 가 붙는 bash 파싱 버그가 있다. 덮어쓰기로 수정.
# 동작: status → $MOCKBIN/ts_json.txt 내용(또는 '{"Peer":{}}') 출력; set → 로깅 후 noop.
_install_tailscale_mock() {
  local ts_json="${1:-}"
  # JSON 을 파일에 저장 — 쉘 변수 확장/따옴표 문제 완전 우회
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

# sudo mock — 첫 인자를 그대로 실행(PATH=$MOCKBIN 포함). 런처의 `sudo tailscale set` 대응.
_install_sudo_mock() {
  cat > "$MOCKBIN/sudo" <<'SUDO'
#!/bin/bash
{ printf '%s' "sudo"; for a in "$@"; do printf '|%s' "$a"; done; printf '\n'; } >> "$MOCKLOG"
# PATH 에 MOCKBIN 포함해 mock 바이너리를 찾도록
export PATH="$MOCKBIN:$PATH"
exec "$@"
SUDO
  chmod +x "$MOCKBIN/sudo"
}

# ─────────────────────────────────────────────────────────────────────────────
# 시나리오 1: reach 실패 + tailscale 부재 → stderr 경고 + 로컬 폴백
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
# tailscale 제외 — command -v tailscale 가 실패하도록
make_all_mocks ssh mosh tmux tmux-aqua claude hangul-romanize launchctl open tput
_install_sleep_mock
# 프로젝트 디렉터리를 SBX 아래 생성
mkdir -p "$SBX/myproject"
MOCK_REACH=fail MOCK_HASSESSION=0 \
  run_launcher --remote "$SBX/myproject"

it "s1/reach-fail-no-tailscale: tailscale CLI 없음 경고"
assert_contains "$RP_ERR" "tailscale" "stderr 에 tailscale 언급"

it "s1/reach-fail-no-tailscale: 로컬 폴백 (tmux-aqua new-session)"
assert_contains "$MLOG" "new-session" "로컬 new-session 호출됨"

it "s1/reach-fail-no-tailscale: mosh 미호출"
assert_absent "$MLOG" "mosh|" "mosh 미호출 확인"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# 시나리오 2: reach 실패 + tailscale 있음 + online exit-node → set 후 여전히 실패 → 로컬 폴백
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

it "s2/exit-node-set: tailscale set --exit-node 호출됨"
assert_contains "$MLOG" "tailscale|set|--exit-node=exit.example.ts.net" "exit-node 설정 호출"

it "s2/exit-node-set: 로컬 폴백 (tmux-aqua new-session)"
assert_contains "$MLOG" "new-session" "로컬 new-session 호출됨"

it "s2/exit-node-set: mosh 미호출"
assert_absent "$MLOG" "mosh|" "mosh 미호출 확인"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# 시나리오 3: reach fail-then-ok (tailscale 후 복구) + dir-check ok → 원격(mosh) 진행
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
_install_sudo_mock
TS_JSON='{"Peer":{"k":{"ExitNodeOption":true,"Online":true,"DNSName":"exit.example.ts.net."}}}'
_install_tailscale_mock "$TS_JSON"
mkdir -p "$SBX/myproject"

# 2번째 reach 부터 ok → tailscale set 후 재시도 성공 → 원격 진행
MOCK_REACH=fail-then-ok MOCK_REACH_OKAT=2 MOCK_DIRCHECK=__YES__ \
  run_launcher --remote "$SBX/myproject"

it "s3/fail-then-ok: 원격 진행 (mosh 호출)"
assert_contains "$MLOG" "mosh|" "mosh 호출 확인 (원격 attach)"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# 시나리오 4: dir-check ssherr (3회 실패) → 로컬 폴백 + stderr 에 3-retry 언급
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
mkdir -p "$SBX/myproject"

MOCK_REACH=ok MOCK_DIRCHECK=ssherr MOCK_HASSESSION=0 \
  run_launcher --remote "$SBX/myproject"

it "s4/dir-ssherr: 로컬 폴백 (tmux-aqua new-session)"
assert_contains "$MLOG" "new-session" "로컬 new-session 호출됨"

it "s4/dir-ssherr: mosh 미호출"
assert_absent "$MLOG" "mosh|" "mosh 미호출 확인"

it "s4/dir-ssherr: stderr 에 3회 재시도 언급"
assert_contains "$RP_ERR" "3" "3-retry 언급 확인"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# 시나리오 5: dir missing + RP_YES=1 → ssh mkdir 후 원격 진행
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
mkdir -p "$SBX/myproject"

MOCK_REACH=ok MOCK_DIRCHECK=__NO__ RP_YES=1 \
  run_launcher --remote "$SBX/myproject"

it "s5/dir-missing-yes: ssh mkdir 호출"
assert_contains "$MLOG" "mkdir" "ssh mkdir 호출 확인"

cleanup_sandbox

# ─────────────────────────────────────────────────────────────────────────────
# 시나리오 6: dir missing + 비대화(no tty, no RP_YES) → ask="" → n → die rc=5
# ─────────────────────────────────────────────────────────────────────────────
new_sandbox
make_all_mocks ssh mosh tmux tmux-aqua claude tailscale hangul-romanize launchctl open tput
_install_sleep_mock
mkdir -p "$SBX/myproject"

MOCK_REACH=ok MOCK_DIRCHECK=__NO__ \
  run_launcher --remote "$SBX/myproject"

it "s6/dir-missing-decline: rc=5 (디렉터리 생성 거부)"
assert_rc "$RP_RC" 5 "취소 → exit 5"

cleanup_sandbox

finish
