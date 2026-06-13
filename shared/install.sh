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
if is_client && [ -z "${REMOTE_HOST:-}" ] && [ -t 0 ] && [ "${RP_YES:-0}" != 1 ]; then
  read -r -p "Remote host (mosh/ssh target; leave blank for local-only): " REMOTE_HOST || true
fi
[ -n "${REMOTE_HOST:-}" ] && say "Remote host = $REMOTE_HOST" || say "REMOTE_HOST not set (local-only mode)"

# ── Revert existing install before re-installing (idempotent) ──
# notify.conf 는 사용자 편집(ENABLED_TYPES)을 담을 수 있는 설정파일이다. 첫 설치 때 우리가
# FILE 로 기록했으므로 revert 가 지워버려 재설치 시 기본값으로 되돌아간다 → 사용자 편집 유실.
# revert 직전 임시 보관했다가 직후 복원해, 아래 "없을 때만 생성" 가드가 보존본을 보게 한다.
_RP_NOTIFY_STASH=""
if [ -f "$MANIFEST" ]; then
  say "Existing install detected — reverting before reinstall"
  if [ -f "$RP_DIR/notify.conf" ]; then _RP_NOTIFY_STASH="$(mktemp)" && cp -p "$RP_DIR/notify.conf" "$_RP_NOTIFY_STASH"; fi
  manifest_revert >/dev/null 2>&1 || true
  if [ -n "$_RP_NOTIFY_STASH" ] && [ ! -e "$RP_DIR/notify.conf" ]; then
    mkdir -p "$RP_DIR" && cp -p "$_RP_NOTIFY_STASH" "$RP_DIR/notify.conf"
  fi
  [ -n "$_RP_NOTIFY_STASH" ] && rm -f "$_RP_NOTIFY_STASH"
fi
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

  # notify 훅 → ~/.remote-pair/bin/remote-pair-notify.sh (Claude Code 이벤트 → 큐 append).
  # approve 훅과 함께 manage-claude-hooks.py(4-arg) 가 settings.json 에 멱등 머지한다.
  # notify.conf 기본값은 첫 설치 때만 깔고(사용자 편집 보존), manifest 로 가역 기록.
  notify_cmd="$RP_DIR/bin/remote-pair-notify.sh"
  if [ -f "$HOST_DIR/hooks/remote-pair-notify.sh" ]; then
    say "[host] notify 훅 → $notify_cmd"
    install_file "$HOST_DIR/hooks/remote-pair-notify.sh" "$notify_cmd" 755
    # notify.conf — 첫 실행 기본값(없을 때만 생성, 사용자 편집 보존). 생성 시 manifest-record.
    if [ ! -e "$RP_DIR/notify.conf" ] && [ -f "$HOST_DIR/hooks/notify.conf.example" ]; then
      mk_dir "$RP_DIR"; record FILE "$RP_DIR/notify.conf"
      cp "$HOST_DIR/hooks/notify.conf.example" "$RP_DIR/notify.conf"
      say "  notify.conf 기본값 생성 (편집 가능: $RP_DIR/notify.conf)"
    fi
  else
    warn "host/hooks/remote-pair-notify.sh not found — skipping notify hook (notifications unavailable)"
  fi

  # approve 리마인더 훅 → ~/.claude/settings.json (PermissionDenied/PostToolUseFailure).
  # 헤드리스 호스트에서 GUI 승인창(Chrome 권한·1Password·시스템 프롬프트)에 막혀 도구가 거부되면
  # 모델에게 approve 스킬을 결정적으로 상기시킨다(스킬 설명에만 의존하지 않게). 멱등 머지 — 기존 훅 보존.
  # manage-claude-hooks.py 는 4-arg: add <settings> <approve_cmd> <notify_cmd>. approve+notify 를
  # 한 번에 머지하므로 위에서 notify 훅 파일을 먼저 깐 뒤 호출한다.
  if [ -f "$HOST_DIR/hooks/approve-reminder.sh" ] && [ -f "$HOST_DIR/hooks/manage-claude-hooks.py" ]; then
    if command -v python3 >/dev/null 2>&1; then
      install_file "$HOST_DIR/hooks/manage-claude-hooks.py" "$RP_DIR/bin/manage-claude-hooks.py" 755
      install_file "$HOST_DIR/hooks/approve-reminder.sh"    "$CLAUDE_DIR/hooks/remote-pair-approve-reminder.sh" 755
      settings="$CLAUDE_DIR/settings.json"
      approve_cmd='$HOME/.claude/hooks/remote-pair-approve-reminder.sh'
      existed=0; [ -f "$settings" ] && existed=1
      say "[host] approve+notify 훅 → $settings (멱등 머지)"
      python3 "$RP_DIR/bin/manage-claude-hooks.py" add "$settings" "$approve_cmd" "$notify_cmd" || warn "approve/notify 훅 머지 실패 — 수동 확인 필요"
      # HOOKS 원복은 approve_cmd / notify_cmd 두 식별자를 각각 제거해야 함 → 두 줄 기록.
      if [ "$existed" = 1 ]; then
        record HOOKS "$settings" "$approve_cmd"   # 기존 파일 → surgical 제거로 원복(approve)
        record HOOKS "$settings" "$notify_cmd"    # 기존 파일 → surgical 제거로 원복(notify)
      else
        record FILE "$settings"                   # 우리가 새로 만든 파일 → 통째 삭제로 원복
      fi
    else
      warn "python3 없음 — approve/notify 훅 설치 건너뜀(스킬은 설치됨). CLT 설치 후 install.sh --role host 재실행 권장"
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

  # ── Web onboarding wizard: bridge → PATH, static SPA → $WEB_DIR. Both manifest-recorded → uninstall 가역. ──
  if [ -f "$CLIENT_DIR/remote-pair-web" ]; then
    say "[client] web bridge → $LOCAL_BIN/remote-pair-web"
    install_file "$CLIENT_DIR/remote-pair-web" "$LOCAL_BIN/remote-pair-web" 755
  else
    warn "client/remote-pair-web not found — skipping web bridge install ('remote-pair web' unavailable)"
  fi
  if [ -d "$CLIENT_DIR/web" ]; then
    say "[client] web assets → $WEB_DIR"
    mk_dir "$WEB_DIR"
    while IFS= read -r src; do
      rel="${src#"$CLIENT_DIR/web/"}"; install_file "$src" "$WEB_DIR/$rel"
    done < <(find "$CLIENT_DIR/web" -type f)
  else
    warn "client/web not found — skipping web assets install (wizard UI unavailable)"
  fi

  # ── Web-tab launchers: editor (M4 code-server) + desktop (M5 Screen Sharing). manifest-recorded → 가역. ──
  if [ -f "$CLIENT_DIR/remote-pair-editor" ]; then
    say "[client] editor launcher → $LOCAL_BIN/remote-pair-editor"
    install_file "$CLIENT_DIR/remote-pair-editor" "$LOCAL_BIN/remote-pair-editor" 755
  else
    warn "client/remote-pair-editor not found — skipping ('remote-pair editor' unavailable)"
  fi
  if [ -f "$CLIENT_DIR/remote-pair-desktop" ]; then
    say "[client] desktop launcher → $LOCAL_BIN/remote-pair-desktop"
    install_file "$CLIENT_DIR/remote-pair-desktop" "$LOCAL_BIN/remote-pair-desktop" 755
  else
    warn "client/remote-pair-desktop not found — skipping ('remote-pair desktop' unavailable)"
  fi
  # ── Mount-based file access (alternative to Syncthing — see docs/m-mount.md). manifest-recorded → 가역. ──
  if [ -f "$CLIENT_DIR/remote-pair-mount" ]; then
    say "[client] mount launcher → $LOCAL_BIN/remote-pair-mount"
    install_file "$CLIENT_DIR/remote-pair-mount" "$LOCAL_BIN/remote-pair-mount" 755
  else
    warn "client/remote-pair-mount not found — skipping ('remote-pair mount' unavailable)"
  fi
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

# ── client: host handshake poll (best-effort, non-fatal, max 30s) ──
# Confirms the host side is alive and its status.json is fresh (age ≤ 15s = app is heartbeating).
if is_client && [ -n "${REMOTE_HOST:-}" ]; then
  echo; say "[client] host handshake poll (max 30s)"
  _hs_ok=0
  for _hs_i in 1 2 3 4 5 6 7 8 9 10; do
    printf '  attempt %d/10 — ' "$_hs_i"
    if ssh -o BatchMode=yes -o ConnectTimeout=4 "$REMOTE_HOST" true 2>/dev/null; then
      _sj="$(ssh -o BatchMode=yes -o ConnectTimeout=4 "$REMOTE_HOST" 'cat ~/.remote-pair/logs/status.json 2>/dev/null' 2>/dev/null || true)"
      if [ -n "$_sj" ]; then
        # Check freshness: status.json mtime age ≤ 15s means app is heartbeating
        _fresh="$(ssh -o BatchMode=yes -o ConnectTimeout=4 "$REMOTE_HOST" \
          'python3 -c "import os,time; f=os.path.expanduser(\"~/.remote-pair/logs/status.json\"); print(\"fresh\" if os.path.exists(f) and (time.time()-os.path.getmtime(f))<=15 else \"stale\")" 2>/dev/null' 2>/dev/null || true)"
        if [ "$_fresh" = "fresh" ]; then
          echo "host reachable + status.json fresh — handshake OK"; _hs_ok=1; break
        else
          echo "host reachable, status.json stale or absent (app may be starting)"
        fi
      else
        echo "host reachable, no status.json yet (host app not running?)"
      fi
    else
      echo "SSH not yet reachable"
    fi
    [ "$_hs_i" -lt 10 ] && sleep 3
  done
  if [ "$_hs_ok" = 0 ]; then
    warn "handshake timed out — host may not be running RemotePairHost.app yet (install succeeded; start the app on the host)"
  fi
fi

# ── client: interactive onboarding (tty only) ──
if is_client && [ -t 0 ]; then
  echo
  "$LOCAL_BIN/remote-pair" onboard || true
fi
