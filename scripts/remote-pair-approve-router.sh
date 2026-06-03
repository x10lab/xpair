#!/bin/bash
# remote-pair-approve-router.sh — 떠있는 승인창을 감지 → 알맞은 액션으로 허용.
#
# RemotePair(메뉴바앱, AX+화면기록+PostEvent granted)가 트리거 시 자식으로 호출 → 권한 상속.
# claude/스킬은 "막히면 트리거"만 하고, 어떤 창을 어떻게 허용할지는 전부 여기(rules)가 라우팅.
#
# rules.txt v2 (탭 구분):  id <TAB> marker <TAB> action
#   marker = 감지용 OCR 텍스트(부분일치, 소문자무관)
#   action = ocr:<라벨|라벨..>  (그 버튼 텍스트 찾아 cliclick)  |  key:<콤보>  (cmd+return, return, esc ...)
set -u
export PATH="/usr/sbin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"   # screencapture=/usr/sbin (RemotePair 직접스폰 PATH엔 없음)
SCAP=/usr/sbin/screencapture
BIN="$HOME/.claude/bin"; OCR="$BIN/ocr-find"; CLICK=/opt/homebrew/bin/cliclick
RULES="$HOME/.claude/auto-approve/rules.txt"; LOG="$HOME/.claude/logs/remote-pair.log"
SHOT="${RP_SHOT:-/tmp/rp-router.png}"     # RP_SHOT 지정 시 캡처 대신 그 이미지 사용(테스트)
DRY="${RP_DRY:-0}"                        # RP_DRY=1 이면 실제 클릭/키 안 하고 의도만 출력(테스트)
TRIES="${1:-6}"; [ -n "${RP_SHOT:-}" ] && TRIES=1
log(){ printf '%s router: %s\n' "$(date '+%H:%M:%S')" "$1" >> "$LOG"; }

# "cmd+return" → cliclick kd:cmd kp:return ku:cmd  /  "return" → cliclick kp:return
sendkey(){
  local combo="$1" key mods kd="" ku="" m; key="${combo##*+}"; mods=""
  [ "$combo" != "$key" ] && mods="${combo%+*}"
  IFS='+' read -ra M <<< "$mods"
  for m in "${M[@]}"; do [ -n "$m" ] && { kd="$kd kd:$m"; ku="ku:$m $ku"; }; done
  # shellcheck disable=SC2086
  $CLICK $kd kp:"$key" $ku
}

for attempt in $(seq 1 "$TRIES"); do
  [ -n "${RP_SHOT:-}" ] || $SCAP -x "$SHOT" 2>/tmp/rp-scap.err
  [ -f "$SHOT" ] || { log "screencapture 실패: $(cat /tmp/rp-scap.err 2>/dev/null|tr '\n' ' ')"; sleep 1; continue; }
  acted=0
  while IFS=$'\t' read -r id marker action; do
    case "$id" in ''|\#*) continue;; esac
    { [ -z "${marker:-}" ] || [ -z "${action:-}" ]; } && continue
    "$OCR" "$SHOT" --has "$marker" 2>/dev/null || continue     # 이 창 아님
    case "$action" in
      ocr:*) labels="${action#ocr:}"; C=$("$OCR" "$SHOT" "$labels" 2>/dev/null)
             if [ -n "$C" ]; then
               if [ "$DRY" = 1 ]; then echo "WOULD click ($C) [$id]"; else "$CLICK" c:"$C" >/dev/null 2>&1; fi
               log "[$id] click $C"; acted=1
             else log "[$id] marker감지했으나 버튼 못찾음 (labels=$labels)"; fi ;;
      key:*) combo="${action#key:}"
             if [ "$DRY" = 1 ]; then echo "WOULD key '$combo' [$id]"; else sendkey "$combo" >/dev/null 2>&1; fi
             log "[$id] key $combo"; acted=1 ;;
      *)     log "[$id] unknown action: $action" ;;
    esac
  done < "$RULES"
  if [ "$acted" = 1 ]; then exit 0; fi
  sleep 1.2
done
log "no known dialog up (after $TRIES tries)"
exit 0
