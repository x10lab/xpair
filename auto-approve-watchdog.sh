#!/bin/bash
# auto-approve-watchdog.sh — restart AutoApprove.app if its heartbeat goes stale.
# The applet is single-threaded; a hung AX call can wedge it. We touch a heartbeat file
# every loop iteration; if it stops updating, kickstart the daemon. Needs no special
# permissions (only reads a file mtime and calls launchctl).
set -u
HB="$HOME/.claude/logs/auto-approve.heartbeat"
LOG="$HOME/.claude/logs/auto-approve.log"
STALE=90   # seconds without a heartbeat = considered wedged
LABEL="gui/501/com.ghyeong.auto-approve"

now=$(date +%s)
if [ -f "$HB" ]; then
  mtime=$(stat -f %m "$HB" 2>/dev/null || echo 0)
  age=$(( now - mtime ))
  if [ "$age" -gt "$STALE" ]; then
    launchctl kickstart -k "$LABEL" >/dev/null 2>&1
    printf '%s watchdog: heartbeat stale %ss -> kickstart\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$age" >> "$LOG"
  fi
else
  # no heartbeat yet — make sure the daemon is at least loaded
  launchctl kickstart -k "$LABEL" >/dev/null 2>&1
fi
