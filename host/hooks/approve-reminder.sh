#!/bin/bash
# approve-reminder.sh — GUI 승인 다이얼로그에 막혀 도구가 거부/실패했을 때, 모델에게
# approve 스킬 사용을 상기시킨다. (m1 의 chrome-approve-reminder.sh 를 레포로 일반화)
#
# 왜: RemotePair 호스트는 헤드리스(원격 세션, 사람이 화면 앞에 없음)라 GUI 승인창
#   (Claude-for-Chrome 권한 모달 · 1Password 승인/잠금 · macOS 시스템 권한 프롬프트 등)을
#   아무도 클릭할 수 없어 "Permission denied"가 대부분 의도된 거부가 아니라 미클릭 타임아웃이기 때문.
#
# 설치 위치: ~/.claude/settings.json 의 PermissionDenied / PostToolUseFailure 훅.
#   matcher = claude-in-chrome · computer-use · Bash (ssh/git 이 1Password SSH agent 에 막혀 hang→timeout).
#
# 문구는 의도적으로 짧게 — 어떻게 승인할지(키/ocr/명령형태)는 approve 스킬이 다 안내하므로,
# 훅은 '과하게 지시하지 않고' 스킬로 가도록 넛지만 한다.
#
# 사용법: approve-reminder.sh <HookEventName>
EVENT="${1:-PostToolUseFailure}"
INPUT="$(cat)"

if printf '%s' "$INPUT" | grep -qiE 'denied|permission|timed.?out|timeout'; then
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"$EVENT","additionalContext":"If this denial might be an unclicked GUI dialog (remote session) rather than an intentional user denial, consider using the approve skill."}}
EOF
fi
exit 0
