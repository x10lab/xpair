#!/bin/bash
# install.sh — RemotePair 설치 (역할 기반, 가역적).
#
# 역할(--role):
#   host    claude 가 computer-use 로 도는 머신. RemotePair.app + LaunchAgent + approve(skill/rules) + watchdog.
#   client  앉아서 띄우는 머신. Service "Launch Remote Claude" + 런처 + mosh. (앱·권한·빌드 없음)
#   both    한 머신에서 둘 다 (기본값).
#
# sync 는 기본 OFF (opt-in). --with-sync 또는 SYNC_URL 환경변수가 있을 때만 ~/.claude git 백본 설정.
#
# 모든 동작은 manifest 기록 → uninstall.sh 가 정확히 역으로 되돌린다.
# 식별자·호스트는 config.sh(단일 출처) + prompt → config.env 영속. 하드코딩 없음.
#
# 사용:
#   ./install.sh                      # role=both, sync off (대화형으로 REMOTE_HOST prompt)
#   ./install.sh --role client        # 노트북: Service+런처만 (빌드/권한 불필요)
#   ./install.sh --role host          # 서버: 앱+approve (빌드된 build/RemotePair.app 필요)
#   ./install.sh --with-sync          # + ~/.claude git 백본 (SYNC_URL prompt)
#   REMOTE_HOST=my-mac ./install.sh --role client      # 비대화
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"

ROLE=both; DO_NATIVE=1; DO_SYNC=0
[ -n "${SYNC_URL:-}" ] && DO_SYNC=1     # URL 주어지면 sync 자동 on
while [ $# -gt 0 ]; do case "$1" in
  --role) ROLE="${2:-both}"; shift 2 ;;
  --role=*) ROLE="${1#*=}"; shift ;;
  --with-sync) DO_SYNC=1; shift ;;
  --no-sync) DO_SYNC=0; shift ;;
  --no-native) DO_NATIVE=0; shift ;;
  -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac; done
case "$ROLE" in host|client|both) : ;; *) echo "잘못된 --role: $ROLE (host|client|both)" >&2; exit 2 ;; esac

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
is_host()   { [ "$ROLE" = host ] || [ "$ROLE" = both ]; }
is_client() { [ "$ROLE" = client ] || [ "$ROLE" = both ]; }

write_config() {
  mk_dir "$RP_DIR"
  [ -e "$CONFIG_ENV" ] || record FILE "$CONFIG_ENV"
  { echo "# RemotePair 설치 확정 설정 — install.sh 생성. 손수 고쳐도 됨."
    for k in "${RP_PERSIST_KEYS[@]}"; do printf '%s=%q\n' "$k" "${!k}"; done
  } > "$CONFIG_ENV"
}

# ── 0. 입력 ──
say "RemotePair 설치 — role=$ROLE, sync=$([ "$DO_SYNC" = 1 ] && echo on || echo off) (bundle=$BUNDLE_PREFIX)"
# client 는 REMOTE_HOST 가 핵심(어디로 attach). host-only 면 불필요.
if is_client && [ -z "${REMOTE_HOST:-}" ] && [ -t 0 ]; then
  read -r -p "원격 host (mosh/ssh 대상, 단일 머신이면 빈칸 Enter): " REMOTE_HOST || true
fi
[ -n "${REMOTE_HOST:-}" ] && say "원격 host = $REMOTE_HOST" || say "REMOTE_HOST 미설정 (로컬 전용)"

# ── 기존 설치 원복 (재설치 멱등) ──
if [ -f "$MANIFEST" ]; then say "기존 설치 감지 → 원복 후 재설치"; manifest_revert >/dev/null 2>&1 || true; fi
manifest_init
write_config
record NOTE "installed role=$ROLE at $(date '+%F %T') on $(hostname -s)"

# ── 공통: 엄브렐러 CLI → PATH ──
say "remote-pair CLI → $LOCAL_BIN"
install_file "$GLUE_DIR/bin/remote-pair" "$LOCAL_BIN/remote-pair" 755
case ":$PATH:" in *":$LOCAL_BIN:"*) : ;; *) warn "$LOCAL_BIN 가 PATH 에 없음 — 셸 rc 에 추가 권장" ;; esac
mk_dir "$CLAUDE_DIR/logs"

# ── HOST: 앱 + approve(skill/rules) + watchdog + LaunchAgent ──
if is_host; then
  say "[host] approve 정책 (rules + skill)"
  install_file "$GLUE_DIR/auto-approve/rules.txt" "$CLAUDE_DIR/auto-approve/rules.txt"
  if [ -d "$REPO_ROOT/skills" ]; then
    while IFS= read -r src; do
      rel="${src#"$REPO_ROOT/skills/"}"; install_file "$src" "$CLAUDE_DIR/skills/$rel"
    done < <(find "$REPO_ROOT/skills" -type f)
  fi
  # watchdog
  write_file "$CLAUDE_DIR/bin/remote-pair-watchdog.sh" 755 <<W
#!/bin/bash
# remote-pair-watchdog.sh — RemotePair.app heartbeat 정지 시 재기동. (install.sh 생성)
set -u
HB="\$HOME/.claude/logs/remote-pair.heartbeat"; LOG="\$HOME/.claude/logs/remote-pair.log"
STALE=90; LABEL="gui/\$(id -u)/${APP_LABEL}"; now=\$(date +%s)
if [ -f "\$HB" ]; then
  age=\$(( now - \$(stat -f %m "\$HB" 2>/dev/null || echo 0) ))
  [ "\$age" -gt "\$STALE" ] && { launchctl kickstart -k "\$LABEL" >/dev/null 2>&1; printf '%s watchdog: stale %ss\n' "\$(date '+%F %T')" "\$age" >> "\$LOG"; }
else launchctl kickstart -k "\$LABEL" >/dev/null 2>&1; fi
W

  if [ "$DO_NATIVE" = 1 ]; then
    if [ -d "$REPO_ROOT/build/${APP_NAME}.app" ]; then
      say "[host] 앱 설치 → $APP_PATH"
      [ -e "$APP_PATH" ] && rm -rf "$APP_PATH"   # 재설치: manifest 원복이 이미 처리, 잔존 시 대비
      mk_dir "$(dirname "$APP_PATH")"; record TREE "$APP_PATH"
      cp -R "$REPO_ROOT/build/${APP_NAME}.app" "$APP_PATH"
      xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
      app_plist="$LAUNCH_AGENTS/${APP_LABEL}.plist"; wd_plist="$LAUNCH_AGENTS/${WATCHDOG_LABEL}.plist"
      write_file "$app_plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array><string>${APP_EXEC}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${CLAUDE_DIR}/logs/remote-pair.out.log</string>
  <key>StandardErrorPath</key><string>${CLAUDE_DIR}/logs/remote-pair.err.log</string>
</dict></plist>
P
      write_file "$wd_plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${WATCHDOG_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${CLAUDE_DIR}/bin/remote-pair-watchdog.sh</string></array>
  <key>RunAtLoad</key><true/><key>StartInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>${CLAUDE_DIR}/logs/remote-pair-watchdog.err.log</string>
</dict></plist>
P
      U=$(id -u)
      launchctl bootstrap "gui/$U" "$app_plist" 2>/dev/null || launchctl kickstart -k "gui/$U/${APP_LABEL}" 2>/dev/null || true
      record LAUNCHCTL "$APP_LABEL" "$app_plist"
      launchctl bootstrap "gui/$U" "$wd_plist" 2>/dev/null || true
      record LAUNCHCTL "$WATCHDOG_LABEL" "$wd_plist"
      warn "1회 권한 부여: System Settings → 개인정보 보호 및 보안 → 손쉬운 사용 / 화면 기록 → $APP_NAME ON"
    else
      warn "빌드 산출물 없음: $REPO_ROOT/build/${APP_NAME}.app — scripts/build-native.sh 먼저 실행 (앱 설치 건너뜀)"
    fi
  fi
fi

# ── CLIENT: 런처 + Service "Launch Remote Claude" ──
if is_client; then
  say "[client] 런처 + Service"
  [ -f "$GLUE_DIR/bin/hangul-romanize" ] && install_file "$GLUE_DIR/bin/hangul-romanize" "$CLAUDE_DIR/bin/hangul-romanize" 755
  install_file "$GLUE_DIR/bin/claude-iterm-launch" "$CLAUDE_DIR/bin/claude-iterm-launch" 755
  svc_src="$GLUE_DIR/services/Launch Remote Claude.workflow"
  svc_dst="$SERVICES_DIR/Launch Remote Claude.workflow"
  if [ -d "$svc_src" ]; then
    [ -e "$svc_dst" ] && rm -rf "$svc_dst"
    mk_dir "$SERVICES_DIR"; record TREE "$svc_dst"
    cp -R "$svc_src" "$svc_dst"
    [ "$SERVICES_DIR" = "$HOME/Library/Services" ] && /System/Library/CoreServices/pbs -flush 2>/dev/null || true
    say "  Service 등록 — Finder 폴더 우클릭 → 빠른 동작 → Launch Remote Claude"
  else
    warn "Service 템플릿 없음: $svc_src (Service 건너뜀)"
  fi
fi

# ── SYNC (opt-in): ~/.claude git 백본 + gitignore 화이트리스트 ──
if [ "$DO_SYNC" = 1 ]; then
  say "[sync] gitignore 화이트리스트 + git 백본"
  while IFS= read -r line; do
    [ -z "$line" ] && continue; case "$line" in \#*) continue ;; esac
    add_gitignore "$line"
  done < "$HERE/claude.gitignore"
  "$HERE/sync-setup.sh"
else
  say "sync off — ~/.claude 동기화 안 함 (--with-sync 로 켤 수 있음)"
fi

say "완료. 되돌리려면:  $HERE/uninstall.sh"
record NOTE "install finished"
