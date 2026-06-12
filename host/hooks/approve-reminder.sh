#!/bin/bash
# approve-reminder.sh — 권한 GUI 다이얼로그에 막혀 도구가 거부/실패했을 때, 모델에게
# approve 스킬(remote-pair approve) 사용을 상기시킨다.
#
# 왜: RemotePair 호스트는 헤드리스(사람이 화면 앞에 없음)라, GUI 승인창
#   (Claude-for-Chrome 권한 모달 · 1Password 승인/잠금 · macOS 시스템 권한 프롬프트 등)이
#   뜨면 아무도 못 누른다 → "permission denied" 대부분이 '의도된 거부'가 아니라 '미클릭 타임아웃'.
#   이 훅이 그 상황에서 모델을 approve 스킬로 결정적으로 유도한다(스킬 설명만 믿지 않게).
#
# 설치 위치: ~/.claude/settings.json 의 PermissionDenied / PostToolUseFailure 훅으로,
#   matcher = GUI 다이얼로그를 띄우는 도구(claude-in-chrome · computer-use)에 한정.
#   (Bash 등 일반 도구의 거부는 보통 '의도된 거부'라 제외 — 노이즈 방지.)
#
# 계약(Claude Code hooks): stdin = JSON 이벤트, exit 0 + stdout JSON 의 additionalContext 가 모델에 주입.
# 사용법: approve-reminder.sh <HookEventName>
set -u
EVENT="${1:-PermissionDenied}"
INPUT="$(cat 2>/dev/null || true)"

# '의도된 사용자 거부'와 '미클릭 GUI 타임아웃'을 이벤트만으로 구별할 수 없으므로,
# 입력에 권한/거부 신호가 있을 때만 — 그리고 판단은 모델에 맡기는 '제안' 문구로 — 주입한다.
if printf '%s' "$INPUT" | grep -qiE 'denied|permission|timeout|not.?clicked|no.?response'; then
  MSG='이 거부가 (의도된 거부가 아니라) 헤드리스 호스트에서 아무도 못 누른 GUI 승인창 때문일 수 있습니다. 그렇다면 approve 스킬을 쓰세요: 화면을 보고(computer-use) 어떤 창인지 판단한 뒤 `remote-pair approve --for "<무엇>" --type "key:..."|"ocr:<버튼텍스트>"` 로 요청하면 권한 가진 RemotePair 앱이 대신 눌러줍니다. (1Password·시스템 권한창·Claude-for-Chrome 모달 모두 대응)'
  # jq 없이도 안전하도록 python3 로 JSON 직렬화(따옴표/유니코드 이스케이프).
  python3 - "$EVENT" "$MSG" <<'PY' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"이 거부가 헤드리스 호스트의 미클릭 GUI 승인창 때문일 수 있습니다 — approve 스킬(remote-pair approve)을 고려하세요."}}\n' "$EVENT"
import json,sys
print(json.dumps({"hookSpecificOutput":{"hookEventName":sys.argv[1],"additionalContext":sys.argv[2]}}, ensure_ascii=False))
PY
fi
exit 0
