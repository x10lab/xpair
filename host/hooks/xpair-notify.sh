#!/bin/bash
# xpair-notify.sh — Claude Code hook command (host side).
# When a Claude Code event (Stop / Notification / SubagentStop / approve) fires on
# the host, append a single JSON line to ~/.xpair/host/notifications/queue.jsonl.
# The client (WEB bridge) reads this file over SSH and notifies the user.
#
# Usage: xpair-notify.sh <EVENT>
#   When Claude Code invokes this as a hook command, JSON is provided on stdin.
#
# Supported EVENTs:
#   Stop            — Claude Code session ended
#   Notification    — notification the model sends to the user
#   SubagentStop    — subagent ended
#   PermissionRequest — manual approval wait (type=approve-wait)
#   PermissionDenied / PostToolUseFailure — approve-family events (type=approve)
#
# Queue rotation: when it exceeds 500 lines, the front is trimmed (keeps the
# append-only contract, bounds the size).

set -euo pipefail

EVENT="${1:-}"
RP_DIR="${RP_DIR:-$HOME/.xpair/host}"
QUEUE_FILE="$RP_DIR/notifications/queue.jsonl"
CONF_FILE="$RP_DIR/notify.conf"
QUEUE_MAX=500

# ── event → notification type mapping ───────────────────────────────────────
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
  PermissionRequest)
    NOTIFY_TYPE="approve-wait"
    ;;
  PermissionDenied|PostToolUseFailure)
    NOTIFY_TYPE="approve"
    ;;
  *)
    NOTIFY_TYPE="Notification"
    ;;
esac

# ── type filter from notify.conf ────────────────────────────────────────────
# ENABLED_TYPES=Stop,Notification,SubagentStop,approve-wait,approve
ENABLED_TYPES="Stop,Notification,SubagentStop,approve-wait,approve"
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

# ── read stdin ──────────────────────────────────────────────────────────────
INPUT="$(cat)"

# tmux session name (fall back to cwd if absent)
SESSION_NAME=""
if [[ -n "${TMUX:-}" ]]; then
  SESSION_NAME="$(tmux display-message -p '#S' 2>/dev/null || true)"
fi
if [[ -z "$SESSION_NAME" ]]; then
  SESSION_NAME="$(pwd)"
fi

# ── pass to python3 via environment variables (avoid nested heredocs) ───────
export _RP_EVENT="$EVENT"
export _RP_TYPE="$NOTIFY_TYPE"
export _RP_SESSION="$SESSION_NAME"
export _RP_QUEUE="$QUEUE_FILE"
export _RP_QUEUE_MAX="$QUEUE_MAX"
export _RP_INPUT="$INPUT"
export _RP_ENABLED_TYPES="$ENABLED_TYPES"

python3 /dev/stdin <<'PYEOF'
import json, os, sys, time, fcntl

event       = os.environ.get("_RP_EVENT", "")
notify_type = os.environ.get("_RP_TYPE", "")
session     = os.environ.get("_RP_SESSION", "")
queue_file  = os.environ.get("_RP_QUEUE", "")
queue_max   = int(os.environ.get("_RP_QUEUE_MAX", "500"))
raw         = os.environ.get("_RP_INPUT", "")
enabled_raw = os.environ.get("_RP_ENABLED_TYPES", "")

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

notification_type = first("notification_type", "notificationType")
if event == "PermissionRequest" or (event == "Notification" and notification_type == "permission_prompt"):
    notify_type = "approve-wait"

enabled_types = [t for t in enabled_raw.replace(" ", "").split(",") if t]
if notify_type not in enabled_types:
    sys.exit(0)

def tool_summary():
    tool_name = first("tool_name", "toolName") or "unknown-tool"
    tool_input = data.get("tool_input") or data.get("toolInput") or {}
    if isinstance(tool_input, dict):
        cmd = (tool_input.get("command") or
               tool_input.get("url") or
               tool_input.get("description") or
               (next(iter(tool_input.values()), "") if tool_input else ""))
        cmd = str(cmd)[:80]
    else:
        cmd = str(tool_input)[:80]
    return tool_name, cmd

# ── extract title / message ───────────────────────────────────────────────────
if notify_type in ("Stop", "SubagentStop"):
    label   = "session" if notify_type == "Stop" else "subagent"
    title   = f"Claude {label} ended"
    message = first("message", "transcript_path") or f"{notify_type} (session: {session})"

elif notify_type == "Notification":
    title   = first("title") or "Claude notification"
    message = first("message", "content") or "(no content)"

elif notify_type == "approve-wait":
    tool_name, cmd = tool_summary()
    title   = first("title") or f"Approval waiting: {tool_name}"
    message = first("message", "content") or cmd or "Claude is waiting for manual approval."

else:  # approve
    tool_name, cmd = tool_summary()
    title   = f"Approval required: {tool_name}"
    message = cmd or f"Tool {tool_name} requires approval."

approval_type = ""
if notify_type in ("approve", "approve-wait"):
    approval_type = first("approvalType", "approval_type") or ("approve-wait" if notify_type == "approve-wait" else event)

# ── ensure the queue directory exists ─────────────────────────────────────────
queue_dir = os.path.dirname(queue_file)
os.makedirs(queue_dir, exist_ok=True)

# ── build the JSON record ─────────────────────────────────────────────────────
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

# ── atomic append + rotation ──────────────────────────────────────────────────
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
    sys.stderr.write(f"xpair-notify: queue write failed: {e}\n")
    sys.exit(1)

sys.stderr.write(line + "\n")  # for debugging (Claude Code hooks ignore stderr)
PYEOF
