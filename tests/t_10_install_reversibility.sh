#!/usr/bin/env bash
# t_10_install_reversibility — white-box: shared/install.sh ↔ uninstall.sh 의 web-asset 가역성 (CLIENT role).
#
# 검증 대상:
#   install.sh --role client  →  web 브리지(remote-pair-web) + static SPA(index/app/style) 설치 +
#                                manifest(.manifest-client) 에 FILE/MKDIR 로 기록.
#   uninstall.sh              →  manifest 역순 원복으로 그 전부를 정확히 제거(--purge 불필요).
#
# 격리: HOME 을 tempdir 로. config.sh 파생 경로(RP_DIR/LOCAL_BIN/WEB_DIR/LOG_DIR/...) 가 전부
#   샌드박스 안으로 떨어진다. 외부 명령(ssh/mosh/pbs/brew/osascript/launchctl)은 MOCKBIN(=PATH)
#   에 깔아 실시스템 무접촉. SERVICES_DIR 를 샌드박스로 덮어 pbs(-flush) 분기 자체를 건너뛴다.
#   REMOTE_HOST=dummy + RP_YES=1 + 비-tty → onboard 프롬프트/실제 접속 없음(doctor 는 mock ssh).
#
# bash 3.2 호환만 사용.

cd "$(dirname "$0")"; . ./lib.sh

INSTALL_SRC="${INSTALL_SRC:-$_REPO_ROOT/shared/install.sh}"
UNINSTALL_SRC="${UNINSTALL_SRC:-$_REPO_ROOT/shared/uninstall.sh}"

# 클라 install 경로가 부를 수 있는 외부 명령 mock (실시스템 무접촉)
make_client_mocks() {
  local m
  for m in ssh mosh pbs brew osascript launchctl open; do make_mock "$m"; done
}

# run_install [args...] — 샌드박스에서 install.sh 실행. MOCKBIN-on-PATH.
#   SERVICES_DIR 를 샌드박스로 덮어 절대경로 pbs(-flush) 분기를 건너뛴다.
run_install() {
  RP_OUT="$(PATH="$MOCKBIN:$PATH" HOME="$HOME" RP_DIR="$RP_DIR" \
            SERVICES_DIR="$SBX/Services" REMOTE_HOST="${SBX_REMOTE_HOST-dummy}" RP_YES=1 \
            bash "$INSTALL_SRC" "$@" </dev/null 2>"$RP_ERRFILE")"; RP_RC=$?
  RP_ERR="$(cat "$RP_ERRFILE" 2>/dev/null)"
}

run_uninstall() {
  RP_OUT="$(PATH="$MOCKBIN:$PATH" HOME="$HOME" RP_DIR="$RP_DIR" \
            SERVICES_DIR="$SBX/Services" \
            bash "$UNINSTALL_SRC" "$@" </dev/null 2>"$RP_ERRFILE")"; RP_RC=$?
  RP_ERR="$(cat "$RP_ERRFILE" 2>/dev/null)"
}

WEB_DIR_SBX() { printf '%s' "$RP_DIR/web"; }
MANIFEST_CLIENT() { printf '%s' "$RP_DIR/.manifest-client"; }

# ────────────────────────────────────────────────────────────────────────────
# INSTALL (role=client)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
make_client_mocks
run_install --role client --no-sync

it "install/rc-ok"
assert_rc "$RP_RC" 0 "install.sh --role client rc=0 :: stderr=[$RP_ERR]"

it "install/web-bridge-installed-executable"
WEB_BRIDGE="$HOME/.local/bin/remote-pair-web"
[ -x "$WEB_BRIDGE" ] && _pass "remote-pair-web 설치됨(executable): $WEB_BRIDGE" \
  || _fail "remote-pair-web 미설치/비실행: $WEB_BRIDGE"

it "install/web-assets-present"
WD="$(WEB_DIR_SBX)"
for asset in index.html app.js style.css; do
  if [ -f "$WD/$asset" ]; then _pass "web asset present: $asset"
  else _fail "web asset missing: $WD/$asset"; fi
done

it "install/cli-installed"
[ -x "$HOME/.local/bin/remote-pair" ] && _pass "remote-pair CLI 설치됨" \
  || _fail "remote-pair CLI 미설치: $HOME/.local/bin/remote-pair"

it "install/launcher-installed"
[ -x "$RP_DIR/bin/remote-pair-launch" ] && _pass "launcher 설치됨" \
  || _fail "launcher 미설치: $RP_DIR/bin/remote-pair-launch"

it "install/manifest-records-web-bridge"
MAN="$(MANIFEST_CLIENT)"
if [ -f "$MAN" ]; then _pass "manifest 존재: $MAN"
else _fail "manifest 없음: $MAN"; fi
MAN_TXT="$(cat "$MAN" 2>/dev/null)"
# 브리지 FILE 기록(신규 설치이므로 BACKUP 아닌 FILE)
assert_contains "$MAN_TXT" "FILE	$HOME/.local/bin/remote-pair-web" "manifest 에 web 브리지 FILE 기록"

it "install/manifest-records-web-assets"
assert_contains "$MAN_TXT" "FILE	$(WEB_DIR_SBX)/index.html" "manifest 에 index.html FILE 기록"
assert_contains "$MAN_TXT" "FILE	$(WEB_DIR_SBX)/app.js"     "manifest 에 app.js FILE 기록"
assert_contains "$MAN_TXT" "FILE	$(WEB_DIR_SBX)/style.css"  "manifest 에 style.css FILE 기록"

it "install/manifest-records-mkdir-webdir"
# WEB_DIR 디렉토리 생성도 MKDIR 로 기록되어 uninstall 이 비었으면 지움
assert_contains "$MAN_TXT" "MKDIR	$(WEB_DIR_SBX)" "manifest 에 WEB_DIR MKDIR 기록"

# ────────────────────────────────────────────────────────────────────────────
# UNINSTALL (no --purge) → manifest 역순 원복
# ────────────────────────────────────────────────────────────────────────────
run_uninstall

it "uninstall/rc-ok"
assert_rc "$RP_RC" 0 "uninstall.sh rc=0 :: stderr=[$RP_ERR]"

it "uninstall/web-bridge-removed"
[ -e "$HOME/.local/bin/remote-pair-web" ] && _fail "web 브리지가 남아있음(원복 실패)" \
  || _pass "web 브리지 제거됨(manifest 역순 원복)"

it "uninstall/web-assets-removed"
WD="$(WEB_DIR_SBX)"
for asset in index.html app.js style.css; do
  if [ -e "$WD/$asset" ]; then _fail "web asset 잔존: $asset"
  else _pass "web asset 제거됨: $asset"; fi
done

it "uninstall/webdir-cleaned"
# MKDIR 원복은 rmdir(비었을 때만) → 자산 제거 후 빈 디렉토리도 정리되어야 함
[ -d "$(WEB_DIR_SBX)" ] && _fail "WEB_DIR 디렉토리 잔존: $(WEB_DIR_SBX)" \
  || _pass "WEB_DIR 디렉토리 정리됨"

it "uninstall/cli-and-launcher-removed"
[ -e "$HOME/.local/bin/remote-pair" ] && _fail "CLI 잔존" || _pass "CLI 제거됨"
[ -e "$RP_DIR/bin/remote-pair-launch" ] && _fail "launcher 잔존" || _pass "launcher 제거됨"

it "uninstall/manifest-consumed"
# uninstall 은 원복 후 manifest 파일 자체를 rm
[ -e "$(MANIFEST_CLIENT)" ] && _fail "manifest 잔존" || _pass "manifest 소비됨(rm)"

cleanup_sandbox

finish
