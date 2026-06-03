#!/bin/bash
# config.sh — 튜너블의 단일 출처. source 전용.
#
# config 은 role 별로 파일이 분리된다 (client/host 가 서로 덮어쓰지 않도록):
#   ~/.config/remote-pair/common.env   LOCAL_BIN, AQUA_SOCK            (양쪽 공통 — 값이 일치해야 함)
#   ~/.config/remote-pair/host.env     BUNDLE_PREFIX, APP_NAME, …       (host 전용 — 앱/approve 정체성)
#   ~/.config/remote-pair/client.env   REMOTE_HOST, SYNC_ROOTS, …       (client 전용 — attach 대상·등록 루트)
# 각 role install 은 자기 파일만 쓴다 → 다른 role 설정을 침범하지 않음.
#
# 우선순위: 환경변수 > role env 파일 > 파생 기본값. 개인값(호스트명·동기화 경로)은 박지 않는다.

# ── 경로 ──
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"               # 에이전트 정체성(skill·rules·logs). host, sync 대상.
RP_DIR="${RP_DIR:-$HOME/.config/remote-pair}"           # RemotePair 자기 config·manifest. 기기별, sync 안 함.
COMMON_ENV="$RP_DIR/common.env"; HOST_ENV="$RP_DIR/host.env"; CLIENT_ENV="$RP_DIR/client.env"
MANIFEST="$RP_DIR/.install-manifest"; BACKUP_DIR="$RP_DIR/backups"

# role 파일 로드 (있는 것만)
for _f in "$COMMON_ENV" "$HOST_ENV" "$CLIENT_ENV"; do
  # shellcheck disable=SC1090
  [ -f "$_f" ] && { set -a; . "$_f"; set +a; }
done

# ── host 정체성 (개인값 없이 조직 기준) ──
RP_ORG="${RP_ORG:-com.x10lab}"
BUNDLE_PREFIX="${BUNDLE_PREFIX:-${RP_ORG}.remote-pair}"
APP_NAME="${APP_NAME:-RemotePair}"
SIGN_CN="${SIGN_CN:-RemotePair Local Signing}"
APP_LABEL="$BUNDLE_PREFIX"; WATCHDOG_LABEL="${BUNDLE_PREFIX}-watchdog"
APP_PATH="$HOME/Applications/${APP_NAME}.app"; APP_EXEC="$APP_PATH/Contents/MacOS/${APP_NAME}"
APPROVE_TRIGGER="${APPROVE_TRIGGER:-/tmp/remote-pair.approve-request}"
LOG_FILE="${LOG_FILE:-$CLAUDE_DIR/logs/remote-pair.log}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$CLAUDE_DIR/logs/remote-pair.heartbeat}"

# ── client 설정 (개인 경로 기본값 없음) ──
REMOTE_HOST="${REMOTE_HOST:-}"          # 빈 값 = 로컬 전용
SYNC_ROOTS="${SYNC_ROOTS:-}"            # 두 기기에 같은 경로로 존재(동기화)하는 루트들(:구분). 기본 없음 — 첫 실행 시 등록.
LAUNCHER="${LAUNCHER:-$CLAUDE_DIR/bin/claude-iterm-launch}"

# ── 공통 ──
LOCAL_BIN="${LOCAL_BIN:-$HOME/.local/bin}"
AQUA_SOCK="${AQUA_SOCK:-/tmp/aqua-tmux.sock}"
LAUNCH_AGENTS="${LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}"
SERVICES_DIR="${SERVICES_DIR:-$HOME/Library/Services}"

# ── 저장소 루트 ──
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLUE_DIR="$REPO_ROOT/install/glue"

# role 별 영속 키 그룹 (install 이 자기 파일에만 기록)
COMMON_KEYS=(LOCAL_BIN AQUA_SOCK)
HOST_KEYS=(RP_ORG BUNDLE_PREFIX APP_NAME SIGN_CN APPROVE_TRIGGER LOG_FILE HEARTBEAT_FILE)
CLIENT_KEYS=(REMOTE_HOST SYNC_ROOTS LAUNCHER)
