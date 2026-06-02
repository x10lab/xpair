#!/bin/bash
# install.sh — RemotePair glue + 네이티브 배치 설치 (가역적).
#
#   glue:    런처·auto-approve(engine/rules)·CLAUDE.command·watchdog → ~/.claude
#   native:  RemotePair.app + LaunchAgent(앱/watchdog) bootstrap (로컬)
#   sync:    ~/.claude 를 git 백본으로, 입력받은 GitHub URL 을 origin 으로 (인증 폴백 안내)
#   gitignore: 에이전트 정체성만 sync 하도록 화이트리스트 적용
#
# 모든 동작은 manifest 에 기록 → uninstall.sh 가 정확히 역으로 되돌린다.
# 하드코딩 없음: 식별자·호스트는 config.sh(단일 출처) + 설치 시 prompt → config.env 영속.
#
# 사용:  ./install.sh                  (대화형: REMOTE_HOST·GitHub URL prompt)
#        REMOTE_HOST=my-mac SYNC_URL=git@github.com:me/claude.git ./install.sh   (비대화)
#        ./install.sh --no-native      (glue+sync 만, 앱 배치 건너뜀)
#        ./install.sh --no-sync        (git 백본 설정 건너뜀)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"

DO_NATIVE=1; DO_SYNC=1
for a in "$@"; do case "$a" in
  --no-native) DO_NATIVE=0 ;; --no-sync) DO_SYNC=0 ;;
  -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
esac; done

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }

# ── config.env 영속 (확정값 기록) ──
write_config() {
  mk_dir "$RP_DIR"
  [ -e "$CONFIG_ENV" ] || record FILE "$CONFIG_ENV"
  { echo "# RemotePair 설치 확정 설정 — install.sh 생성. 손수 고쳐도 됨."
    for k in "${RP_PERSIST_KEYS[@]}"; do printf '%s=%q\n' "$k" "${!k}"; done
  } > "$CONFIG_ENV"
}

# ── 0. 입력 수집 ──
say "RemotePair 설치 (bundle=$BUNDLE_PREFIX)"
if [ -z "${REMOTE_HOST:-}" ] && [ -t 0 ]; then
  read -r -p "원격 host (mosh/ssh 대상, 단일 머신이면 빈칸 Enter): " REMOTE_HOST || true
fi
[ -n "${REMOTE_HOST:-}" ] && say "원격 host = $REMOTE_HOST" || say "로컬 전용 모드 (REMOTE_HOST 미설정)"

# ── manifest 시작 ──
manifest_init
write_config
record NOTE "installed at $(date '+%F %T') on $(hostname -s)"

# ── 1. gitignore 화이트리스트 ──
say "gitignore 화이트리스트 적용 → $CLAUDE_DIR/.gitignore"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  add_gitignore "$line"
done < "$HERE/claude.gitignore"

# ── 2. glue 설치 ──
say "glue 설치"
install_file "$GLUE_DIR/auto-approve/engine.applescript" "$CLAUDE_DIR/auto-approve/engine.applescript"
install_file "$GLUE_DIR/auto-approve/rules.txt"          "$CLAUDE_DIR/auto-approve/rules.txt"
[ -f "$GLUE_DIR/bin/hangul-romanize" ] && install_file "$GLUE_DIR/bin/hangul-romanize" "$CLAUDE_DIR/bin/hangul-romanize" 755
install_file "$GLUE_DIR/bin/claude-iterm-launch" "$CLAUDE_DIR/bin/claude-iterm-launch" 755

# 스킬 원본 → ~/.claude/skills (있는 모든 SKILL.md 트리 복사). 에이전트 정체성으로 sync.
if [ -d "$GLUE_DIR/skills" ]; then
  while IFS= read -r src; do
    rel="${src#"$GLUE_DIR/skills/"}"
    install_file "$src" "$CLAUDE_DIR/skills/$rel"
  done < <(find "$GLUE_DIR/skills" -type f)
fi

# watchdog (config 주도, 식별자는 install 시점 값으로 박힘 — 생성 파일이라 uninstall 이 삭제)
write_file "$CLAUDE_DIR/bin/remote-pair-watchdog.sh" 755 <<W
#!/bin/bash
# remote-pair-watchdog.sh — RemotePair.app heartbeat 정지 시 재기동. (install.sh 생성)
set -u
HB="\$HOME/.claude/logs/remote-pair.heartbeat"
LOG="\$HOME/.claude/logs/remote-pair.log"
STALE=90
LABEL="gui/\$(id -u)/${APP_LABEL}"
now=\$(date +%s)
if [ -f "\$HB" ]; then
  age=\$(( now - \$(stat -f %m "\$HB" 2>/dev/null || echo 0) ))
  if [ "\$age" -gt "\$STALE" ]; then
    launchctl kickstart -k "\$LABEL" >/dev/null 2>&1
    printf '%s watchdog: stale %ss -> kickstart\n' "\$(date '+%F %T')" "\$age" >> "\$LOG"
  fi
else
  launchctl kickstart -k "\$LABEL" >/dev/null 2>&1
fi
W

mk_dir "$CLAUDE_DIR/logs"

# ── 3. 네이티브 배치 (로컬: 앱 + LaunchAgent bootstrap) ──
if [ "$DO_NATIVE" = 1 ]; then
  if [ ! -d "$APP_PATH" ]; then
    if [ -d "$REPO_ROOT/build/${APP_NAME}.app" ]; then
      say "앱 설치 → $APP_PATH"
      mk_dir "$(dirname "$APP_PATH")"; record FILE "$APP_PATH"
      cp -R "$REPO_ROOT/build/${APP_NAME}.app" "$APP_PATH"
      xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
    else
      warn "빌드 산출물 없음: $REPO_ROOT/build/${APP_NAME}.app — 먼저 ./build-native.sh 실행. (앱 배치 건너뜀)"
      DO_NATIVE=0
    fi
  fi
fi
if [ "$DO_NATIVE" = 1 ]; then
  say "LaunchAgent bootstrap"
  app_plist="$LAUNCH_AGENTS/${APP_LABEL}.plist"
  wd_plist="$LAUNCH_AGENTS/${WATCHDOG_LABEL}.plist"
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
  warn "1회 권한 부여 필요: System Settings → 개인정보 보호 및 보안 → 손쉬운 사용 / 화면 기록 → $APP_NAME ON"
fi

# ── 4. git sync 백본 ──
if [ "$DO_SYNC" = 1 ]; then "$HERE/sync-setup.sh"; fi

say "완료. 되돌리려면:  $HERE/uninstall.sh"
record NOTE "install finished"
