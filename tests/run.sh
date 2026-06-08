#!/usr/bin/env bash
# tests/run.sh — 모든 tests/t_*.sh 실행, PASS/FAIL 집계. 실패 시 비0 종료.
cd "$(dirname "$0")"
export HOME_REAL="$HOME"
TOTP=0; TOTF=0; FILES=0
for t in t_*.sh; do
  [ -f "$t" ] || continue
  FILES=$((FILES+1))
  printf '\n=== %s ===\n' "$t"
  out="$(bash "$t" 2>&1)"; rc=$?
  printf '%s\n' "$out" | grep -v '^__SUMMARY__'
  s="$(printf '%s\n' "$out" | grep '^__SUMMARY__' | tail -1)"
  p="$(printf '%s' "$s" | sed -n 's/.*pass=\([0-9]*\).*/\1/p')"
  f="$(printf '%s' "$s" | sed -n 's/.*fail=\([0-9]*\).*/\1/p')"
  [ -z "$p" ] && p=0; [ -z "$f" ] && f=0
  # 요약 라인이 없고 rc!=0 이면 파일 자체가 비정상 종료 → 1 fail 로 계상
  if [ -z "$s" ] && [ "$rc" != 0 ]; then f=$((f+1)); printf '  (no summary, rc=%s — counted as fail)\n' "$rc"; fi
  TOTP=$((TOTP+p)); TOTF=$((TOTF+f))
done
printf '\n========================================\n'
printf 'TOTAL: %s passed, %s failed across %s files\n' "$TOTP" "$TOTF" "$FILES"
[ "$TOTF" = 0 ]
