#!/bin/bash
# remote-pair-notify.sh — Claude Code hook command (host side).
# 호스트에서 Claude Code 이벤트(Stop / Notification / SubagentStop / approve)가
# 발생하면 ~/.remote-pair/notifications/queue.jsonl 에 JSON 한 줄을 추가한다.
# 클라이언트(WEB bridge)가 이 파일을 SSH 로 읽어 사용자에게 알린다.
#
# 사용법: remote-pair-notify.sh <EVENT>
#   Claude Code 가 hook command 로 호출하면 stdin 에 JSON 이 주어진다.
#
# 지원 EVENT:
#   Stop            — Claude Code 세션 종료
#   Notification    — 모델이 사용자에게 보내는 알림
#   SubagentStop    — 서브에이전트 종료
#   PermissionDenied / PostToolUseFailure — approve 계열 이벤트 (type=approve)
#
# 큐 로테이션: 500 줄 초과 시 앞쪽을 잘라낸다 (append-only 계약 유지, 크기 바운드).

set -euo pipefail

EVENT="${1:-}"
RP_DIR="${RP_DIR:-$HOME/.remote-pair}"
QUEUE_FILE="$RP_DIR/notifications/queue.jsonl"
CONF_FILE="$RP_DIR/notify.conf"
QUEUE_MAX=500

# ── 이벤트 → 알림 타입 매핑 ──────────────────────────────────────────────────
case "$EVENT" in
  Stop)
    NOTIFY_TYPE="Stop"
    ;;
  Notification)
    NOTIFY_TYPE="Notification"
    ;;
  SubagentStop)
    NOTIFY_TYPE="SubagentStop"
    ;;
  PermissionDenied|PostToolUseFailure)
    NOTIFY_TYPE="approve"
    ;;
  *)
    NOTIFY_TYPE="Notification"
    ;;
esac

# ── notify.conf 로 타입 필터 ──────────────────────────────────────────────────
# ENABLED_TYPES=Stop,Notification,SubagentStop,approve
ENABLED_TYPES="Stop,Notification,SubagentStop,approve"
if [[ -f "$CONF_FILE" ]]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key// }" ]] && continue
    key="${key// /}"
    val="${val// /}"
    if [[ "$key" == "ENABLED_TYPES" ]]; then
      ENABLED_TYPES="$val"
    fi
  done < "$CONF_FILE"
fi

# 타입이 활성화돼 있는지 확인 (쉼표 구분 목록에서 정확한 단어 매칭)
if ! printf '%s' ",$ENABLED_TYPES," | grep -qF ",$NOTIFY_TYPE,"; then
  exit 0
fi

# ── stdin 읽기 ────────────────────────────────────────────────────────────────
INPUT="$(cat)"

# tmux 세션 이름 (없으면 cwd 사용)
SESSION_NAME=""
if [[ -n "${TMUX:-}" ]]; then
  SESSION_NAME="$(tmux display-message -p '#S' 2>/dev/null || true)"
fi
if [[ -z "$SESSION_NAME" ]]; then
  SESSION_NAME="$(pwd)"
fi

# ── 환경변수로 python3 에 전달 (heredoc 중첩 회피) ───────────────────────────
export _RP_EVENT="$EVENT"
export _RP_TYPE="$NOTIFY_TYPE"
export _RP_SESSION="$SESSION_NAME"
export _RP_QUEUE="$QUEUE_FILE"
export _RP_QUEUE_MAX="$QUEUE_MAX"
export _RP_INPUT="$INPUT"

python3 /dev/stdin <<'PYEOF'
import json, os, sys, time, fcntl

event       = os.environ.get("_RP_EVENT", "")
notify_type = os.environ.get("_RP_TYPE", "")
session     = os.environ.get("_RP_SESSION", "")
queue_file  = os.environ.get("_RP_QUEUE", "")
queue_max   = int(os.environ.get("_RP_QUEUE_MAX", "500"))
raw         = os.environ.get("_RP_INPUT", "")

try:
    data = json.loads(raw) if raw.strip() else {}
except (ValueError, TypeError):
    data = {}

def first(*keys):
    for k in keys:
        v = data.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""

# ── title / message 추출 ──────────────────────────────────────────────────────
if notify_type in ("Stop", "SubagentStop"):
    label   = "세션" if notify_type == "Stop" else "서브에이전트"
    title   = f"Claude {label} 종료"
    message = first("message", "transcript_path") or f"{notify_type} (세션: {session})"

elif notify_type == "Notification":
    title   = first("title") or "Claude 알림"
    message = first("message", "content") or "(내용 없음)"

else:  # approve
    tool_name  = first("tool_name", "toolName") or "unknown-tool"
    tool_input = data.get("tool_input") or data.get("toolInput") or {}
    if isinstance(tool_input, dict):
        cmd = (tool_input.get("command") or
               tool_input.get("url") or
               (next(iter(tool_input.values()), "") if tool_input else ""))
        cmd = str(cmd)[:80]
    else:
        cmd = str(tool_input)[:80]
    title   = f"승인 필요: {tool_name}"
    message = cmd or f"도구 {tool_name} 승인이 필요합니다."

approval_type = ""
if notify_type == "approve":
    approval_type = first("approvalType", "approval_type") or event

# ── 큐 디렉터리 보장 ──────────────────────────────────────────────────────────
queue_dir = os.path.dirname(queue_file)
os.makedirs(queue_dir, exist_ok=True)

# ── JSON 레코드 구성 ──────────────────────────────────────────────────────────
record = {
    "ts":      int(time.time()),
    "type":    notify_type,
    "session": session,
    "title":   title,
    "message": message,
}
if approval_type:
    record["approvalType"] = approval_type

line = json.dumps(record, ensure_ascii=False)

# ── 원자적 append + 로테이션 ─────────────────────────────────────────────────
try:
    with open(queue_file, "a+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        lines = f.readlines()
        if len(lines) >= queue_max:
            keep = lines[-(queue_max - 1):]
            f.seek(0)
            f.truncate()
            f.writelines(keep)
        f.seek(0, 2)
        f.write(line + "\n")
        fcntl.flock(f, fcntl.LOCK_UN)
except OSError as e:
    sys.stderr.write(f"remote-pair-notify: queue write failed: {e}\n")
    sys.exit(1)

sys.stderr.write(line + "\n")  # 디버그용 (Claude Code 훅은 stderr 무시)
PYEOF
