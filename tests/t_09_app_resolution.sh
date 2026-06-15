#!/usr/bin/env bash
# t_09_app_resolution — white-box: client/cli/remote-pair app/identity resolution + web wiring.
#
# 검증 대상 (client/cli/remote-pair):
#   app_pid()       launchctl list 에서 CURRENT(com.x10lab.remote-pair-host) 와 FORWARD(com.x10lab.remote-pair)
#                   라벨을 둘 다 인식(0.5 flip 대비 dual-id probing). 실패 시 pgrep 폴백.
#                   ※ 현재 출하 정체성은 com.x10lab.remote-pair-host / RemotePairHost. FORWARD 는 0.5 통일 id.
#   app_available() /Applications + ~/Applications 두 위치 × CURRENT/FORWARD 두 앱이름 모두 존재 검사
#                   (선재 ~/Applications-only 버그 수정 검증). pid/status.json/host-session 도 인정.
#   cmd_web         설치된 remote-pair-web 브리지를 exec. argv 에 토큰을 절대 싣지 않음(히스토리 누출 방지).
#                   브리지 부재 시 graceful 메시지.
#
# 관측 방법: mock launchctl/pgrep/open/remote-pair-web 를 MOCKBIN 에 깔고 argv 를 MOCKLOG 에 기록.
#   CLI 는 (런처와 달리) PATH 를 prepend 하지 않으므로, 이 러너가 MOCKBIN 을 PATH 앞에 둔다.
#
# 한계: 실제 '/Applications' 는 샌드박스로 못 바꾼다(루트 권한 필요·실시스템 오염 금지). 따라서
#   app_available 의 NEW/LEGACY '.app 존재' 케이스는 $HOME/Applications(샌드박스 가능) 로 검증하고,
#   /Applications 분기는 코드 인스펙션으로만 확인한다(아래 inspect 케이스 참조). bash 3.2 호환.

cd "$(dirname "$0")"; . ./lib.sh

CLI_SRC="${CLI_SRC:-$_REPO_ROOT/client/cli/remote-pair}"

# run_cli [args...] — 샌드박스 + MOCKBIN-on-PATH 로 remote-pair CLI 실행.
# CLI 는 PATH 를 손대지 않으므로 여기서 MOCKBIN 을 prepend 해 mock 이 실 명령을 가린다.
run_cli() {
  RP_OUT="$(PATH="$MOCKBIN:$PATH" RP_DIR="$RP_DIR" HOME="$HOME" bash "$CLI_SRC" "$@" 2>"$RP_ERRFILE")"; RP_RC=$?
  RP_ERR="$(cat "$RP_ERRFILE" 2>/dev/null)"
  MLOG="$(cat "$MOCKLOG" 2>/dev/null)"
}

# make_launchctl_mock LINE... — launchctl 'list' 가 주어진 라인들을 출력하도록 mock.
# 각 라인은 실제 launchctl list 포맷 "PID\tSTATUS\tLABEL". 그 외 서브커맨드는 argv 로깅 후 종료.
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

# make_pgrep_mock [MATCH]  — pgrep -f <pat> 가 MATCH(pat 부분일치)면 PID 출력. 기본은 항상 빈값.
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
# 케이스 1: CURRENT 라벨(com.x10lab.remote-pair-host) 로 실행 중 → status 가 running 으로 해석
#   (현재 출하 정체성. 이게 primary BUNDLE_PREFIX.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_launchctl_mock "$(printf '7777\t0\tcom.x10lab.remote-pair-host')"
make_pgrep_mock
make_mock open
run_cli status

it "app/current-label→running"
assert_rc "$RP_RC" 0 "status rc=0"
assert_contains "$RP_OUT" "running (pid 7777)" "CURRENT 라벨 → app running pid 7777"
assert_contains "$MLOG" "launchctl|list" "status 가 launchctl list 로 probe"
# pgrep 폴백은 launchctl 가 이미 맞췄으니 불려선 안 됨
assert_absent "$MLOG" "pgrep|" "launchctl 히트 시 pgrep 폴백 미사용"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 2: FORWARD 라벨만(com.x10lab.remote-pair, 0.5 통일 id) → dual-id probing 으로 여전히 해석
#   (0.5 flip 으로 호스트가 통일 id 로 가도 이 CLI 가 false-negative 안 냄.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_launchctl_mock "$(printf '8888\t0\tcom.x10lab.remote-pair')"
make_pgrep_mock
make_mock open
run_cli status

it "app/forward-label→still-running (dual-id)"
assert_rc "$RP_RC" 0 "status rc=0"
assert_contains "$RP_OUT" "running (pid 8888)" "FORWARD 라벨 → 여전히 running pid 8888 (dual-id)"
assert_contains "$MLOG" "launchctl|list" "status 가 launchctl list 로 probe"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 2b: 라벨 없음 → pgrep 폴백이 FORWARD 앱이름(RemotePair)으로 히트
#   (CURRENT pgrep 패턴 RemotePairHost.app/... 은 'RemotePair.app/...' 와 다르므로 미스 →
#    FORWARD pgrep 패턴 RemotePair.app/... 가 히트. dual-id pgrep 폴백 검증.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_launchctl_mock                 # list 가 아무 라벨도 출력 안 함
make_pgrep_mock "RemotePair.app/Contents/MacOS/RemotePair"
make_mock open
run_cli status

it "app/no-label→pgrep-fallback (forward app name)"
assert_contains "$RP_OUT" "running (pid 4242)" "launchctl 미스 → pgrep 폴백 히트(4242)"
assert_contains "$MLOG" "pgrep|" "launchctl 미스 시 pgrep 폴백 호출"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 3: 앱이 ~/Applications/RemotePairHost.app (CURRENT) 에 존재 → app_available true.
#   (선재 버그: 과거엔 한 위치만 봤음. 현재 코드는 /Applications + ~/Applications 둘 다 검사.)
#   /Applications 는 샌드박스 불가 → 여기선 ~/Applications 로 검증. /Applications 분기는 케이스 3b 인스펙션.
#   관측: app_available 이 true → approve 가 need_app_guidance(설치안내) 를 내지 않고 트리거 작성으로 진행.
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
mkdir -p "$HOME/Applications/RemotePairHost.app"
make_launchctl_mock                 # 라벨 없음
make_pgrep_mock                     # pid 없음
make_mock open
# approve: app_available 이면 트리거 파일을 쓰고 라우터 로그를 기다린다(타임아웃 짧게).
run_cli approve --timeout 1

it "app/home-applications-current→available (approve proceeds)"
# app_available=true → 설치 안내(need_app_guidance) 가 나오면 안 됨
assert_absent "$RP_OUT$RP_ERR" "this command needs the" "앱 존재 → 설치 안내 미출력"
# 트리거를 향해 진행했다는 증거 ('approve request →' 메시지)
assert_contains "$RP_OUT" "approve request" "app_available=true → approve 트리거 진행"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 3b: /Applications 분기 코드 인스펙션 (샌드박스 불가 → 정적 검증).
#   선재 ~/Applications-only 버그가 고쳐졌음을: app_available/cmd_host 가 "/Applications" 와
#   "$HOME/Applications" 를 모두 순회하는지 소스에서 확인.
# ────────────────────────────────────────────────────────────────────────────
it "app/applications-dual-location-fixed (inspect)"
# app_available + cmd_host 의 for 루프가 두 위치를 모두 포함해야 함
av_loop="$(grep -n 'for d in "/Applications" "\$HOME/Applications"' "$CLI_SRC" | wc -l | tr -d ' ')"
assert_eq "$av_loop" "2" "/Applications + ~/Applications 이중 위치 루프가 2곳(app_available, cmd_host)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 4: FORWARD 앱(RemotePair.app, 0.5 통일 id) 이 ~/Applications 에 → flip 후에도 감지
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
mkdir -p "$HOME/Applications/RemotePair.app"
make_launchctl_mock
make_pgrep_mock
make_mock open
run_cli approve --timeout 1

it "app/forward-app-bundle→still-detected"
assert_absent "$RP_OUT$RP_ERR" "this command needs the" "FORWARD .app 존재 → 설치 안내 미출력(dual-id 감지)"
assert_contains "$RP_OUT" "approve request" "FORWARD .app → app_available=true → approve 진행"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 4b: cmd_host 가 CURRENT id(RemotePairHost) 로 먼저 open 을 시도하는지 (앱 설치 + 서버 down).
#   host_up=false(서버 down), 앱은 ~/Applications/RemotePairHost.app 설치 → open -a RemotePairHost 시도.
#   서버는 끝내 안 올라오므로 비0 종료하지만, MLOG 에 open -a RemotePairHost 가 찍혀야 한다.
#   (open 이 CURRENT 로 성공하면 FORWARD open 은 단축평가로 생략 — open -a RemotePairHost 존재만 확인.
#    'open|-a|RemotePairHost' 로 정확 매칭해 prefix(RemotePair) 우연일치를 배제.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
mkdir -p "$HOME/Applications/RemotePairHost.app"
make_launchctl_mock
make_pgrep_mock
make_mock open                      # tmux-aqua 부재 → host_up=false 유지
run_cli host

it "host/open-tries-current-id"
assert_contains "$MLOG" "open|-a|RemotePairHost" "cmd_host 가 open -a RemotePairHost(CURRENT id) 시도"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 5: cmd_web — 설치된 브리지를 exec, argv 에 토큰 미포함.
#   remote-pair-web mock 을 MOCKBIN(=PATH) 에 깔면 'command -v remote-pair-web' 가 그걸 찾는다.
#   'remote-pair web' 는 인자 없이 브리지를 exec → 브리지 argv 는 토큰 없이 비어야 한다.
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_mock remote-pair-web           # argv 로깅 후 종료(서버 안 띄움)
run_cli web

it "web/execs-bridge-no-token"
assert_contains "$MLOG" "remote-pair-web" "cmd_web 가 브리지를 exec"
# 토큰류 인자가 argv 에 없어야 한다: 'token=' 도, 24자+ urlsafe 슬러그도 없음
assert_absent "$MLOG" "token=" "argv 에 'token=' 미포함"
# 브리지 호출 라인에 어떤 추가 인자도 없어야(=정확히 'remote-pair-web' 만)
WEB_LINE="$(printf '%s\n' "$MLOG" | grep 'remote-pair-web' | head -1)"
assert_eq "$WEB_LINE" "remote-pair-web" "브리지 argv 가 비어있음(토큰/포트 등 미전달)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 케이스 5b: cmd_web — 브리지 부재 시 graceful 메시지 + 비0 종료.
#   (브리지를 어디에도 깔지 않음. CLI 는 repo fallback 도 못 찾도록 RP_DIR/LOCAL_BIN 만 샌드박스.)
#   NOTE: cmd_web 은 python3 존재를 직접 검사하지 않는다(브리지 shebang 에 위임). 브리지가
#   '발견되지 않는' 경로의 graceful 메시지만 여기서 검증. (python3-absent 갭은 notes 참조.)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
# 브리지를 PATH/LOCAL_BIN/RP_DIR 어디에도 두지 않는다. 단, repo 옆 fallback 을 막기 위해
# CLI 를 샌드박스 내 복사본으로 실행한다(그 옆엔 remote-pair-web 가 없음).
CLI_COPY="$SBX/remote-pair"
cp "$CLI_SRC" "$CLI_COPY"; chmod +x "$CLI_COPY"
RP_OUT="$(PATH="$MOCKBIN:$PATH" RP_DIR="$RP_DIR" LOCAL_BIN="$SBX/.local/bin" HOME="$HOME" bash "$CLI_COPY" web 2>"$RP_ERRFILE")"; RP_RC=$?
RP_ERR="$(cat "$RP_ERRFILE" 2>/dev/null)"

it "web/no-bridge→graceful"
assert_rc "$RP_RC" 1 "브리지 부재 → 비0 종료"
assert_contains "$RP_ERR" "bridge not found" "브리지 부재 시 안내 메시지"

cleanup_sandbox

finish
