#!/bin/bash
# config.sh — Single source of tunables. Source-only (do not execute directly).
#
# All RemotePair runtime state lives under ~/.remote-pair (self-contained namespace).
# ~/.claude holds only what the Claude harness needs (approve skill, etc.) — RemotePair
# behavior does not depend on whether ~/.claude is synced.
#
# Config is split by role so client and host files never overwrite each other:
#   ~/.remote-pair/common.env   LOCAL_BIN, AQUA_SOCK            (shared — values must match on both sides)
#   ~/.remote-pair/host.env     BUNDLE_PREFIX, APP_NAME, …       (host-only — app/approve/update identity)
#   ~/.remote-pair/client.env   REMOTE_HOST, FOLDER_MAPS, …      (client-only — attach target, path mappings)
# Each role install writes only its own file → no cross-role contamination.
#
# Priority: environment variable > role env file > derived default.
# Personal values (hostname, sync paths) are not hard-coded here.

# ── Paths (namespace) ──
RP_DIR="${RP_DIR:-$HOME/.remote-pair}"                  # RemotePair config/state/logs/rules/manifest. Per-machine, not synced.
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"               # Claude harness (skills). RemotePair only installs here; does not depend on it.
COMMON_ENV="$RP_DIR/common.env"; HOST_ENV="$RP_DIR/host.env"; CLIENT_ENV="$RP_DIR/client.env"
MANIFEST="$RP_DIR/.install-manifest"; BACKUP_DIR="$RP_DIR/backups"
LOG_DIR="$RP_DIR/logs"

# Load role files (only those that exist)
for _f in "$COMMON_ENV" "$HOST_ENV" "$CLIENT_ENV"; do
  # shellcheck disable=SC1090
  [ -f "$_f" ] && { set -a; . "$_f"; set +a; }
done

# ── Host identity (org-level defaults, no personal values) ──
#
# ## 0.5 RELEASE FLIP (번들 id 통일)
# v0.5.0에서 호스트 앱 정체성을 -host 접미사 없는 통일 id로 바꾼다.
# 이 블록의 두 줄만 아래처럼 바꾸는 것이 핵심 한-스텝이다:
#     BUNDLE_PREFIX="${BUNDLE_PREFIX:-${RP_ORG}.remote-pair}"
#     APP_NAME="${APP_NAME:-RemotePair}"
# 단, config.sh 단독 변경으로는 부족하다. 다음이 반드시 함께 flip 되어야 한다:
#   1) shared/install.sh  : legacy-label bootout 목록 + /Applications/RemotePairHost.app 처리
#                           (구 id를 LIVE가 아니라 legacy 로 내려서 정리) + migrate_host_env 재도입
#   2) Casks/*.rb         : cask token (remote-pair-host → remote-pair), app "RemotePair.app", version
#   3) .github/workflows/release.yml : 릴리스 에셋 이름(RemotePairHost* → RemotePair*)
#   4) Swift fallbacks    : host/RemotePairHost/*.swift 의 bundle-id/앱이름 fallback
#   5) client/remote-pair : APP_NAME/BUNDLE_PREFIX fallback (현재는 dual-id 프로브로 양쪽 다 인식)
# 전체 레시피는 docs/future.md(올인원 섹션) / docs/requirements.md 참조.
RP_ORG="${RP_ORG:-com.x10lab}"
BUNDLE_PREFIX="${BUNDLE_PREFIX:-${RP_ORG}.remote-pair-host}"
APP_NAME="${APP_NAME:-RemotePairHost}"
SIGN_CN="${SIGN_CN:-RemotePair Local Signing}"
GH_REPO="${GH_REPO:-ghyeongl/remote-pair}"             # Updater (GitHub Releases) target owner/repo
APP_LABEL="$BUNDLE_PREFIX"; WATCHDOG_LABEL="${BUNDLE_PREFIX}-watchdog"
APP_PATH="/Applications/${APP_NAME}.app"; APP_EXEC="$APP_PATH/Contents/MacOS/${APP_NAME}"   # Homebrew cask 기본 위치(/Applications)에 맞춤
APPROVE_TRIGGER="${APPROVE_TRIGGER:-/tmp/remote-pair.approve-request}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/remote-pair.log}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$LOG_DIR/remote-pair.heartbeat}"
RULES_FILE="${RULES_FILE:-$RP_DIR/rules.txt}"           # approve router rules (formerly ~/.claude/auto-approve/rules.txt)

# ── Client config (no personal path defaults) ──
REMOTE_HOST="${REMOTE_HOST:-}"          # Empty = local-only mode
# Folder mappings for directories whose content is the same on both machines
# but may live at different absolute paths (synced via Google Drive / Syncthing / etc.).
#   Format: "clientPath::hostPath;clientPath2::hostPath2"  (identical path → use clientPath==hostPath)
#   No default — registered on first launch. (generalises legacy SYNC_ROOTS)
FOLDER_MAPS="${FOLDER_MAPS:-${SYNC_ROOTS:-}}"
LAUNCHER="${LAUNCHER:-$RP_DIR/bin/remote-pair-launch}"

# Terminal app used by the Quick Action / open-gui subcommand.
# Derived default: iterm2 if iTerm.app is installed, otherwise terminal.
TERMINAL_APP="${TERMINAL_APP:-$( [ -d /Applications/iTerm.app ] && echo iterm2 || echo terminal )}"

# ── Web onboarding wizard (localhost bridge — remote-pair web) ──
WEB_DIR="${WEB_DIR:-$RP_DIR/web}"        # static SPA assets (served by the local bridge)
WEB_BIND="${WEB_BIND:-127.0.0.1}"        # loopback only — never expose
WEB_PORT="${WEB_PORT:-0}"                # 0 = ephemeral (bridge picks a free port)
EDITOR_PORT="${EDITOR_PORT:-8080}"       # code-server (remote-pair editor / M4) loopback port — matches the bridge default

# ── File-access backend (Syncthing vs Mount — see docs/m-mount.md) ──
# How the client sees host files: syncthing (local synced copy, default) or mount (single
# source of truth on the host, no sync daemon). Wired into remote-pair doctor + the wizard.
SYNC_BACKEND="${SYNC_BACKEND:-syncthing}"   # syncthing | mount
# Mount transport when SYNC_BACKEND=mount: smb (macOS-native, no kext, default) or sshfs (needs macFUSE).
MOUNT_BACKEND="${MOUNT_BACKEND:-smb}"        # smb | sshfs

# ── Common ──
LOCAL_BIN="${LOCAL_BIN:-$HOME/.local/bin}"
AQUA_SOCK="${AQUA_SOCK:-/tmp/aqua-tmux.sock}"
LAUNCH_AGENTS="${LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}"
SERVICES_DIR="${SERVICES_DIR:-$HOME/Library/Services}"

# ── Repository root + role dirs (host/ client/ shared/ layout) ──
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$REPO_ROOT/client"   # laptop-side artifacts: remote-pair CLI, launcher, Service, hangul-romanize
HOST_DIR="$REPO_ROOT/host"       # computer-use machine: app sources, build scripts, approve rules, skills

# Per-role persistence key groups (install writes only to its own file)
COMMON_KEYS=(LOCAL_BIN AQUA_SOCK)
HOST_KEYS=(RP_ORG BUNDLE_PREFIX APP_NAME SIGN_CN GH_REPO APPROVE_TRIGGER LOG_FILE HEARTBEAT_FILE RULES_FILE)
CLIENT_KEYS=(REMOTE_HOST FOLDER_MAPS LAUNCHER TERMINAL_APP WEB_DIR WEB_BIND WEB_PORT EDITOR_PORT SYNC_BACKEND MOUNT_BACKEND)
