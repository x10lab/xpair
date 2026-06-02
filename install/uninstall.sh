#!/bin/bash
# uninstall.sh — install.sh 가 한 모든 동작을 manifest 역순으로 되돌린다.
#
#   생성 파일 삭제 · 백업 복원 · gitignore 줄 제거 · LaunchAgent bootout+삭제 · git remote 제거.
#   ※ ~/.claude/.git 자체와 사용자 데이터(skills/settings/memory)는 건드리지 않는다 — 데이터 보호.
#
# 사용:  ./uninstall.sh           (manifest 기반 정확한 역연산)
#        ./uninstall.sh --purge   (위 + RemotePair 네임스페이스 ~/.claude/remote-pair 까지 삭제)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

PURGE=0; for a in "$@"; do [ "$a" = "--purge" ] && PURGE=1; done

[ -f "$MANIFEST" ] || { say "manifest 없음 ($MANIFEST) — 설치된 적 없거나 이미 제거됨."; exit 0; }

say "RemotePair 제거 (manifest 역순)"
manifest_revert

# manifest 자체 + 네임스페이스
if [ "$PURGE" = 1 ]; then
  say "--purge: $RP_DIR 삭제"
  rm -rf "$RP_DIR"
else
  rm -f "$MANIFEST"
  say "manifest 제거. ($RP_DIR 의 config.env/backups 는 유지 — --purge 로 완전 삭제)"
fi

say "완료. (~/.claude/.git 과 사용자 설정은 보존됨)"
