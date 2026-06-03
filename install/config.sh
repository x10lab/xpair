#!/bin/bash
# config.sh — 모든 튜너블의 단일 출처(single source of truth). source 전용.
#
# 우선순위:  환경변수  >  $RP_DIR/config.env(설치 시 확정)  >  파생 기본값
#   → 개인 호스트명·계정을 코드에 박지 않는다. 설치가 값을 확정해 config.env 로 영속하고,
#     런처·watchdog·build-native 모두 이 파일을 source 해 같은 값을 쓴다(중복 0).

# ── 경로 (다른 값에 의존 안 함 — 먼저 확정) ──
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
RP_DIR="${RP_DIR:-$CLAUDE_DIR/remote-pair}"            # 네임스페이스: manifest·config·backup (gitignore 됨)
CONFIG_ENV="$RP_DIR/config.env"

# 설치가 확정한 값 로드(있으면). 환경변수가 이미 있으면 그게 우선이라 덮지 않음.
if [ -f "$CONFIG_ENV" ]; then
  # shellcheck disable=SC1090
  set -a; . "$CONFIG_ENV"; set +a
fi

# ── 식별자 (개인값 없이 조직 기준) ──
RP_ORG="${RP_ORG:-com.x10lab}"                                 # 조직 reverse-DNS 접두
BUNDLE_PREFIX="${BUNDLE_PREFIX:-${RP_ORG}.remote-pair}"        # 앱 + watchdog LaunchAgent label 접두
APP_NAME="${APP_NAME:-RemotePair}"                             # ~/Applications/<APP_NAME>.app
SIGN_CN="${SIGN_CN:-RemotePair Local Signing}"                 # 안정 self-signed cert CN

# 파생 라벨/경로 (식별자에서 한 번만 유도)
APP_LABEL="$BUNDLE_PREFIX"
WATCHDOG_LABEL="${BUNDLE_PREFIX}-watchdog"
APP_PATH="$HOME/Applications/${APP_NAME}.app"
APP_EXEC="$APP_PATH/Contents/MacOS/${APP_NAME}"

# ── 원격 호스트 (기본값 없음 — 설치가 prompt 해 config.env 에 기록) ──
#   비어 있으면 로컬 전용 모드. 단일 머신 사용자는 그대로 둬도 됨.
REMOTE_HOST="${REMOTE_HOST:-}"

# ── 디렉토리/소켓 ──
MANIFEST="$RP_DIR/.install-manifest"
BACKUP_DIR="$RP_DIR/backups"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOCAL_BIN="${LOCAL_BIN:-$HOME/.local/bin}"
AQUA_SOCK="${AQUA_SOCK:-/tmp/aqua-tmux.sock}"

# ── approve IPC (앱 Swift 상수와 동일해야 함 — remote-pair CLI·스킬이 이 값을 읽음) ──
APPROVE_TRIGGER="${APPROVE_TRIGGER:-/tmp/remote-pair.approve-request}"
LOG_FILE="${LOG_FILE:-$CLAUDE_DIR/logs/remote-pair.log}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$CLAUDE_DIR/logs/remote-pair.heartbeat}"

# ── 저장소 루트 (이 스크립트 기준) ──
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLUE_DIR="$REPO_ROOT/install/glue"

# config.env 로 영속할 키 목록 (install 이 확정값을 write_config 로 기록)
RP_PERSIST_KEYS=(REMOTE_HOST RP_ORG BUNDLE_PREFIX APP_NAME SIGN_CN LOCAL_BIN AQUA_SOCK APPROVE_TRIGGER LOG_FILE HEARTBEAT_FILE)
