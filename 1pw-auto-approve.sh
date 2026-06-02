#!/usr/bin/env bash
# 1pw-auto-approve.sh — 1Password 의 SSH agent Authorize 모달을 자동 클릭한다.
# 사용: 백그라운드로 띄워두면 max 초 동안(기본 5) 200ms 간격으로 모달을 폴링하다가,
# 발견 즉시 'Authorize' 또는 'Allow' 버튼을 클릭하고 종료한다.
#   ~/.claude/bin/1pw-auto-approve.sh 5 &
#   WD=$!
#   git push ...
#   kill $WD 2>/dev/null
#
# 필요 권한: macOS → 시스템 설정 → 개인정보보호 및 보안 → 손쉬운 사용 → osascript(또는 호출 프로세스) 허용.
# 안전장치: SSH agent 외 다른 1Password 모달까지 클릭하지 않도록, "Authorize"/"Allow" 라벨만 매칭하고
#   가능하면 window 이름에 'SSH' 가 포함되는지도 함께 본다(1Password 버전마다 다를 수 있어 best-effort).
set +e
MAX="${1:-5}"
END=$(( $(date +%s) + MAX ))

while [ "$(date +%s)" -lt "$END" ]; do
  RES="$(/usr/bin/osascript <<'APPLESCRIPT' 2>/dev/null
on run
  -- 1Password 프로세스 이름은 버전마다 다를 수 있어 후보 여러 개 시도
  set procNames to {"1Password", "1Password 7", "1Password 8"}
  tell application "System Events"
    repeat with pn in procNames
      try
        tell process pn
          repeat with w in windows
            -- 가능하면 SSH 관련 창만 (이름에 'SSH' 포함). 못 가져오면 모든 창에서 버튼 매칭.
            set okWindow to true
            try
              set wn to name of w
              if wn does not contain "SSH" and wn is not "" then set okWindow to false
            end try
            if okWindow then
              repeat with btnName in {"Authorize", "Allow", "Authorize once"}
                try
                  set b to (first button of w whose name is btnName)
                  click b
                  return "clicked:" & btnName
                end try
              end repeat
            end if
          end repeat
        end tell
      end try
    end repeat
  end tell
  return ""
end run
APPLESCRIPT
)"
  # 클릭해도 종료하지 않음 — git push/fetch가 연달아 여러 번 인증을 요구할 수 있어
  # MAX 시간 동안 계속 폴링한다. 부모가 작업 끝나면 kill 로 종료시킴.
  sleep 0.2
done
exit 0
