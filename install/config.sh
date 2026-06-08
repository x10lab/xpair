#!/bin/bash
# config.sh — 튜너블의 단일 출처. source 전용.
#
# RemotePair 의 모든 런타임 상태·설정은 ~/.remote-pair 아래 산다 (자기완결 네임스페이스).
# ~/.claude 에는 오직 "클로드 하네스가 보는" 것만 설치한다 (approve 스킬 등) — RemotePair 동작은
# ~/.claude 동기화 여부에 의존하지 않는다.
#
# config 은 role 별로 파일이 분리된다 (client/host 가 서로 덮어쓰지 않도록):
#   ~/.remote-pair/common.env   LOCAL_BIN, AQUA_SOCK            (양쪽 공통 — 값이 일치해야 함)
#   ~/.remote-pair/host.env     BUNDLE_PREFIX, APP_NAME, …       (host 전용 — 앱/approve/업데이트 정체성)
#   ~/.remote-pair/client.env   REMOTE_HOST, FOLDER_MAPS, …      (client 전용 — attach 대상·경로 매핑)
# 각 role install 은 자기 파일만 쓴다 → 다른 role 설정을 침범하지 않음.
#
# 우선순위: 환경변수 > role env 파일 > 파생 기본값. 개인값(호스트명·동기화 경로)은 박지 않는다.

# ── 경로(네임스페이스) ──
RP_DIR="${RP_DIR:-$HOME/.remote-pair}"                  # RemotePair 자기 config·상태·로그·룰·manifest. 기기별, sync 안 함.
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"               # 클로드 하네스(스킬). RemotePair 는 여기에 "설치"만 하고 의존하진 않음.
COMMON_ENV="$RP_DIR/common.env"; HOST_ENV="$RP_DIR/host.env"; CLIENT_ENV="$RP_DIR/client.env"
MANIFEST="$RP_DIR/.install-manifest"; BACKUP_DIR="$RP_DIR/backups"
LOG_DIR="$RP_DIR/logs"

# role 파일 로드 (있는 것만)
for _f in "$COMMON_ENV" "$HOST_ENV" "$CLIENT_ENV"; do
  # shellcheck disable=SC1090
  [ -f "$_f" ] && { set -a; . "$_f"; set +a; }
done

# ── host 정체성 (개인값 없이 조직 기준) ──
RP_ORG="${RP_ORG:-com.x10lab}"
BUNDLE_PREFIX="${BUNDLE_PREFIX:-${RP_ORG}.remote-pair-host}"
APP_NAME="${APP_NAME:-RemotePairHost}"
SIGN_CN="${SIGN_CN:-RemotePair Local Signing}"
GH_REPO="${GH_REPO:-ghyeongl/remote-pair}"             # 업데이터(GitHub Releases) 대상 owner/repo
APP_LABEL="$BUNDLE_PREFIX"; WATCHDOG_LABEL="${BUNDLE_PREFIX}-watchdog"
APP_PATH="$HOME/Applications/${APP_NAME}.app"; APP_EXEC="$APP_PATH/Contents/MacOS/${APP_NAME}"
APPROVE_TRIGGER="${APPROVE_TRIGGER:-/tmp/remote-pair.approve-request}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/remote-pair.log}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$LOG_DIR/remote-pair.heartbeat}"
RULES_FILE="${RULES_FILE:-$RP_DIR/rules.txt}"           # approve 라우터 룰 (구: ~/.claude/auto-approve/rules.txt)

# ── client 설정 (개인 경로 기본값 없음) ──
REMOTE_HOST="${REMOTE_HOST:-}"          # 빈 값 = 로컬 전용
# 두 기기에서 "같은 내용"이지만 절대경로가 다를 수 있는 폴더 매핑 (외부 sync = Google Drive/Syncthing 등).
#   형식: "clientPath::hostPath;clientPath2::hostPath2"  (동일경로면 client==host 로 1개만)
#   기본 없음 — 첫 launch 시 등록. (구 SYNC_ROOTS 를 일반화)
FOLDER_MAPS="${FOLDER_MAPS:-${SYNC_ROOTS:-}}"
LAUNCHER="${LAUNCHER:-$RP_DIR/bin/remote-pair-launch}"

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
HOST_KEYS=(RP_ORG BUNDLE_PREFIX APP_NAME SIGN_CN GH_REPO APPROVE_TRIGGER LOG_FILE HEARTBEAT_FILE RULES_FILE)
CLIENT_KEYS=(REMOTE_HOST FOLDER_MAPS LAUNCHER)
