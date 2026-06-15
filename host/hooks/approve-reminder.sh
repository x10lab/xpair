#!/bin/bash
# approve-reminder.sh — when a tool is denied/fails because it is blocked by a GUI
# approval dialog, reminds the model to use the approve skill. (Generalizes m1's
# chrome-approve-reminder.sh to the repo.)
#
# Why: the RemotePair host is headless (remote session, no human in front of the screen),
#   so GUI approval windows (Claude-for-Chrome permission modal, 1Password approval/unlock,
#   macOS system permission prompts, etc.) cannot be clicked by anyone, which means a
#   "Permission denied" is usually an unclicked timeout rather than an intentional denial.
#
# Install location: the PermissionDenied / PostToolUseFailure hooks in ~/.claude/settings.json.
#   matcher = claude-in-chrome · computer-use · Bash (ssh/git blocked by the 1Password SSH agent, hang→timeout).
#
# The wording is intentionally short — since the approve skill explains the whole approval
# flow (key/ocr/command form), the hook only nudges toward the skill instead of over-instructing.
#
# Usage: approve-reminder.sh <HookEventName>
EVENT="${1:-PostToolUseFailure}"
INPUT="$(cat)"

if printf '%s' "$INPUT" | grep -qiE 'denied|permission|timed.?out|timeout'; then
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"$EVENT","additionalContext":"If this denial might be an unclicked GUI dialog (remote session) rather than an intentional user denial, consider using the approve skill."}}
EOF
fi
exit 0
