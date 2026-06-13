#!/bin/bash
# install.sh — RemotePair installer (role-based, reversible).
#
# Roles (--role):
#   host    Machine where claude runs with computer-use. RemotePairHost.app + LaunchAgent + approve (skill/rules) + watchdog.
#   client  Machine you sit at. Service "Launch Remote Pair" + launcher + remote-pair CLI. (No app/permissions/build needed.)
#   both    Both roles on one machine (default).
#
# All runtime state lives under ~/.remote-pair (self-contained). ~/.claude only receives the
# Claude harness (approve skill) — RemotePair behavior does not depend on ~/.claude being synced.
#
# Sync is OFF by default (opt-in). ~/.claude git backbone is set up only with --with-sync or SYNC_URL set.
# Every action is recorded in the manifest so uninstall.sh can precisely reverse it.
#
# Usage:
#   ./install.sh                      # role=both (interactive REMOTE_HOST prompt)
#   ./install.sh --role client        # Laptop: Service + launcher only (no build/permissions needed)
#   ./install.sh --role host          # Server: app + approve (requires a built build/RemotePairHost.app)
#   ./install.sh --with-sync          # + ~/.claude git backbone
#   REMOTE_HOST=my-mac ./install.sh --role client      # Non-interactive
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"

ROLE=both; DO_NATIVE=1; DO_SYNC=0
[ -n "${SYNC_URL:-}" ] && DO_SYNC=1
while [ $# -gt 0 ]; do case "$1" in
  --role) ROLE="${2:-both}"; shift 2 ;;
  --role=*) ROLE="${1#*=}"; shift ;;
  --with-sync) DO_SYNC=1; shift ;;
  --no-sync) DO_SYNC=0; shift ;;
  --no-native) DO_NATIVE=0; shift ;;
  -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac; done
case "$ROLE" in host|client|both) : ;; *) echo "invalid --role: $ROLE (host|client|both)" >&2; exit 2 ;; esac
MANIFEST="$RP_DIR/.manifest-$ROLE"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
is_host()   { [ "$ROLE" = host ] || [ "$ROLE" = both ]; }
is_client() { [ "$ROLE" = client ] || [ "$ROLE" = both ]; }

_write_env() {
  local f="$1"; shift
  [ -e "$f" ] || record FILE "$f"
  { echo "# RemotePair config ($(basename "$f")) — written by install.sh. Safe to edit manually."
    local k; for k in "$@"; do printf '%s=%q\n' "$k" "${!k}"; done
  } > "$f"
}
write_config() {
  mk_dir "$RP_DIR"
  _write_env "$COMMON_ENV" "${COMMON_KEYS[@]}"
  if is_host;   then _write_env "$HOST_ENV"   "${HOST_KEYS[@]}"; fi
  if is_client; then _write_env "$CLIENT_ENV" "${CLIENT_KEYS[@]}"; fi
  # role 마커 — 앱 Installer 가 클라 머신에서 호스트 자기설치를 거부할 때 SSOT 로 읽음.
  [ -e "$RP_DIR/role" ] || record FILE "$RP_DIR/role"
  printf '%s\n' "$ROLE" > "$RP_DIR/role"
}

# ── 0. Input ──
say "RemotePair install — role=$ROLE, sync=$([ "$DO_SYNC" = 1 ] && echo on || echo off) (bundle=$BUNDLE_PREFIX, app=$APP_NAME)"
if is_client && [ -z "${REMOTE_HOST:-}" ] && [ -t 0 ]; then
  read -r -p "Remote host (mosh/ssh target; leave blank for local-only): " REMOTE_HOST || true
fi
[ -n "${REMOTE_HOST:-}" ] && say "Remote host = $REMOTE_HOST" || say "REMOTE_HOST not set (local-only mode)"

# ── Revert existing install before re-installing (idempotent) ──
if [ -f "$MANIFEST" ]; then say "Existing install detected — reverting before reinstall"; manifest_revert >/dev/null 2>&1 || true; fi
manifest_init
write_config
record NOTE "installed role=$ROLE at $(date '+%F %T') on $(hostname -s)"

# ── Common: umbrella CLI → PATH + log directory ──
say "remote-pair CLI → $LOCAL_BIN"
install_file "$CLIENT_DIR/remote-pair" "$LOCAL_BIN/remote-pair" 755
case ":$PATH:" in *":$LOCAL_BIN:"*) : ;; *) warn "$LOCAL_BIN is not in PATH — add it to your shell rc" ;; esac
mk_dir "$LOG_DIR"

# ── HOST: app + approve (skill/rules) + watchdog + LaunchAgent ──
if is_host; then
  say "[host] approve rules → $RULES_FILE"
  install_file "$HOST_DIR/rules.txt" "$RULES_FILE"
  if [ -d "$HOST_DIR/skills" ]; then
    say "[host] approve skill → $CLAUDE_DIR/skills (Claude harness location)"
    while IFS= read -r src; do
      rel="${src#"$HOST_DIR/skills/"}"; install_file "$src" "$CLAUDE_DIR/skills/$rel"
    done < <(find "$HOST_DIR/skills" -type f)
  fi

  # approve 리마인더 훅 → ~/.claude/settings.json (PermissionDenied/PostToolUseFailure).
  # 헤드리스 호스트에서 GUI 승인창(Chrome 권한·1Password·시스템 프롬프트)에 막혀 도구가 거부되면
  # 모델에게 approve 스킬을 결정적으로 상기시킨다(스킬 설명에만 의존하지 않게). 멱등 머지 — 기존 훅 보존.
  if [ -f "$HOST_DIR/hooks/approve-reminder.sh" ] && [ -f "$HOST_DIR/hooks/manage-claude-hooks.py" ]; then
    if command -v python3 >/dev/null 2>&1; then
      install_file "$HOST_DIR/hooks/manage-claude-hooks.py" "$RP_DIR/bin/manage-claude-hooks.py" 755
      install_file "$HOST_DIR/hooks/approve-reminder.sh"    "$CLAUDE_DIR/hooks/remote-pair-approve-reminder.sh" 755
      settings="$CLAUDE_DIR/settings.json"
      hookcmd='$HOME/.claude/hooks/remote-pair-approve-reminder.sh'
      existed=0; [ -f "$settings" ] && existed=1
      say "[host] approve 훅 → $settings (멱등 머지)"
      python3 "$RP_DIR/bin/manage-claude-hooks.py" add "$settings" "$hookcmd" || warn "approve 훅 머지 실패 — 수동 확인 필요"
      if [ "$existed" = 1 ]; then record HOOKS "$settings" "$hookcmd"   # 기존 파일 → surgical 제거로 원복
      else record FILE "$settings"; fi                                  # 우리가 새로 만든 파일 → 통째 삭제로 원복
    else
      warn "python3 없음 — approve 훅 설치 건너뜀(스킬은 설치됨). CLT 설치 후 install.sh --role host 재실행 권장"
    fi
  fi

  # Remove legacy label names — idempotent, best-effort
  U=$(id -u)
  for L in com.ghyeong.remote-pair com.ghyeong.remote-pair-watchdog com.ghyeong.auto-approve com.ghyeong.auto-approve-watchdog com.x10lab.remote-pair com.x10lab.remote-pair-watchdog; do
    launchctl bootout "gui/$U/$L" 2>/dev/null || true
  done
  rm -rf "$HOME/Applications/RemotePair.app" "$HOME/Applications/AutoApprove.app" 2>/dev/null || true

  # watchdog
  install -d "$RP_DIR/bin" 2>/dev/null || mkdir -p "$RP_DIR/bin"
  write_file "$RP_DIR/bin/remote-pair-watchdog.sh" 755 <<W
#!/bin/bash
# remote-pair-watchdog.sh — Restart $APP_NAME when heartbeat goes stale. (generated by install.sh)
set -u
HB="$HEARTBEAT_FILE"; LOG="$LOG_FILE"
STALE=90; LABEL="gui/\$(id -u)/${APP_LABEL}"; now=\$(date +%s)
if [ -f "\$HB" ]; then
  age=\$(( now - \$(stat -f %m "\$HB" 2>/dev/null || echo 0) ))
  [ "\$age" -gt "\$STALE" ] && { launchctl kickstart -k "\$LABEL" >/dev/null 2>&1; printf '%s watchdog: stale %ss\n' "\$(date '+%F %T')" "\$age" >> "\$LOG"; }
else launchctl kickstart -k "\$LABEL" >/dev/null 2>&1; fi
W

  if [ "$DO_NATIVE" = 1 ]; then
    if [ -d "$REPO_ROOT/build/${APP_NAME}.app" ]; then
      say "[host] Installing app → $APP_PATH"
      [ -e "$APP_PATH" ] && rm -rf "$APP_PATH"
      mk_dir "$(dirname "$APP_PATH")"; record TREE "$APP_PATH"
      cp -R "$REPO_ROOT/build/${APP_NAME}.app" "$APP_PATH"
      xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
      if [ -x "$APP_PATH/Contents/Helpers/tmux-aqua" ]; then
        mk_dir "$LOCAL_BIN"; record FILE "$LOCAL_BIN/tmux-aqua"
        ln -sf "$APP_PATH/Contents/Helpers/tmux-aqua" "$LOCAL_BIN/tmux-aqua"
      fi
      app_plist="$LAUNCH_AGENTS/${APP_LABEL}.plist"; wd_plist="$LAUNCH_AGENTS/${WATCHDOG_LABEL}.plist"
      write_file "$app_plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array><string>${APP_EXEC}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${LOG_DIR}/remote-pair.out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/remote-pair.err.log</string>
</dict></plist>
P
      write_file "$wd_plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${WATCHDOG_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${RP_DIR}/bin/remote-pair-watchdog.sh</string></array>
  <key>RunAtLoad</key><true/><key>StartInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>${LOG_DIR}/remote-pair-watchdog.err.log</string>
</dict></plist>
P
      U=$(id -u)
      launchctl bootstrap "gui/$U" "$app_plist" 2>/dev/null || launchctl kickstart -k "gui/$U/${APP_LABEL}" 2>/dev/null || true
      record LAUNCHCTL "$APP_LABEL" "$app_plist"
      launchctl bootstrap "gui/$U" "$wd_plist" 2>/dev/null || true
      record LAUNCHCTL "$WATCHDOG_LABEL" "$wd_plist"
      warn "One-time permission grant: System Settings → Privacy & Security → turn $APP_NAME ON for Accessibility + Screen Recording (required), and Full Disk Access (recommended for a headless host — silences unanswerable folder prompts). Then 'Restart tmux host'."
    else
      warn "No build artifact: $REPO_ROOT/build/${APP_NAME}.app — run host/build-host.sh first (skipping app install)"
    fi
  fi
fi

# ── CLIENT: launcher + Service "Launch Remote Pair" ──
if is_client; then
  say "[client] launcher + Service"
  install -d "$RP_DIR/bin" 2>/dev/null || mkdir -p "$RP_DIR/bin"
  [ -f "$CLIENT_DIR/hangul-romanize" ] && install_file "$CLIENT_DIR/hangul-romanize" "$RP_DIR/bin/hangul-romanize" 755
  install_file "$CLIENT_DIR/remote-pair-launch" "$LAUNCHER" 755
  svc_src="$CLIENT_DIR/Launch Remote Pair.workflow"
  svc_dst="$SERVICES_DIR/Launch Remote Pair.workflow"
  if [ -d "$svc_src" ]; then
    [ -e "$svc_dst" ] && rm -rf "$svc_dst"
    mk_dir "$SERVICES_DIR"; record TREE "$svc_dst"
    cp -R "$svc_src" "$svc_dst"
    [ "$SERVICES_DIR" = "$HOME/Library/Services" ] && /System/Library/CoreServices/pbs -flush 2>/dev/null || true
    say "  Service registered — Finder: right-click folder → Quick Actions → Launch Remote Pair"
  else
    warn "Service template not found: $svc_src (skipping Service install)"
  fi
fi

# ── SYNC (opt-in): ~/.claude git backbone (personal convenience — unrelated to RemotePair behavior) ──
if [ "$DO_SYNC" = 1 ]; then
  say "[sync] gitignore whitelist + git backbone"
  while IFS= read -r line; do
    [ -z "$line" ] && continue; case "$line" in \#*) continue ;; esac
    add_gitignore "$line"
  done < "$HERE/claude.gitignore"
  "$HERE/sync-setup.sh"
else
  say "sync off — ~/.claude not synced (enable with --with-sync)"
fi

say "Done. To uninstall:  $HERE/uninstall.sh"
record NOTE "install finished"

# ── client: SSH connectivity check (non-blocking advisory) ──
if is_client && [ -n "${REMOTE_HOST:-}" ]; then
  echo; say "[client] SSH connectivity check (remote-pair doctor)"
  "$LOCAL_BIN/remote-pair" doctor || warn "doctor reported issues — see above (install itself succeeded)"
fi

# ── client: interactive onboarding (tty only) ──
if is_client && [ -t 0 ]; then
  echo
  "$LOCAL_BIN/remote-pair" onboard || true
fi
