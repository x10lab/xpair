#!/bin/bash
# uninstall.sh — install.sh 가 한 모든 동작을 manifest 역순으로 되돌린다.
#
#   생성 파일 삭제 · 백업 복원 · gitignore 줄 제거 · LaunchAgent bootout+삭제 · git remote 제거.
#   ※ ~/.claude/.git 자체와 사용자 데이터(skills/settings/memory)는 건드리지 않는다 — 데이터 보호.
#
# 사용:  ./uninstall.sh           (설치된 모든 role manifest 를 역순 원복)
#        ./uninstall.sh --purge   (위 + ~/.remote-pair 네임스페이스까지 삭제)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

PURGE=0; for a in "$@"; do [ "$a" = "--purge" ] && PURGE=1; done

# 설치된 모든 role manifest 수집 (.manifest-host/client/both + 레거시 .install-manifest)
shopt -s nullglob 2>/dev/null || true
mans=("$RP_DIR"/.manifest-* "$RP_DIR/.install-manifest")
found=0
for m in "${mans[@]}"; do
  [ -f "$m" ] || continue
  found=1
  say "제거: $(basename "$m") (역순 원복)"
  MANIFEST="$m"; manifest_revert
  rm -f "$m"
done
[ "$found" = 0 ] && { say "설치된 manifest 없음 ($RP_DIR) — 이미 제거됨."; }

if [ "$PURGE" = 1 ]; then
  say "--purge: $RP_DIR 삭제"; rm -rf "$RP_DIR"
else
  # notify.conf is intentionally preserved here alongside *.env files and backups.
  # It holds user-edited ENABLED_TYPES and must survive non-purge uninstall/reinstall
  # cycles (install.sh stash/restore keeps user edits, but the manifest 'create only
  # if absent' guard means notify.conf is NOT re-recorded on reinstall, so uninstall
  # would otherwise leak it). Matching this comment to that behavior makes it explicit.
  say "완료. ($RP_DIR 의 config(common/host/client).env·notify.conf·backups 는 유지 — --purge 로 완전 삭제)"
fi
say "(~/.claude/.git 과 사용자 설정은 보존됨)"
