#!/bin/bash
# sync-setup.sh — ~/.claude 를 git 백본으로 만들어 두 머신이 에이전트 정체성을 공유.
#   - 입력받은 GitHub URL 을 origin 으로 설정 (이미 있으면 유지)
#   - 로컬 인증 확인 (ssh / https), 안 되면 안내 (gh auth login / SSH key)
#   - 원격(REMOTE_HOST) 머신의 GitHub 인증 점검 — 미인증이면 그 머신에서 할 일 안내
#
# install.sh 가 source 한 config 환경에서 호출되거나, 단독 실행도 가능.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"
[ -f "$MANIFEST" ] || manifest_init   # 단독 실행 대비

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }

# git 인증 가능 여부 (URL 종류별)
auth_ok() { # $1=url  $2=host(ssh test용, 옵션)
  local url="$1"
  case "$url" in
    git@*|ssh://*)
      local h; h="$(printf '%s' "$url" | sed -E 's#^(ssh://)?git@([^:/]+).*#\2#')"
      ssh -o BatchMode=yes -o ConnectTimeout=5 -T "git@$h" 2>&1 | grep -qiE 'success|authenticat' ;;
    https://*)
      git ls-remote "$url" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# ── 1. URL 수집 ──
SYNC_URL="${SYNC_URL:-}"
if [ -z "$SYNC_URL" ]; then
  if [ -d "$CLAUDE_DIR/.git" ] && git -C "$CLAUDE_DIR" remote get-url origin >/dev/null 2>&1; then
    SYNC_URL="$(git -C "$CLAUDE_DIR" remote get-url origin)"
    say "기존 origin 사용: $SYNC_URL"
  elif [ -t 0 ]; then
    read -r -p "~/.claude sync 용 GitHub repo URL (비우면 sync 건너뜀): " SYNC_URL || true
  fi
fi
[ -z "$SYNC_URL" ] && { warn "sync URL 없음 — git 백본 설정 건너뜀."; exit 0; }

# ── 2. 로컬 repo + origin ──
if [ ! -d "$CLAUDE_DIR/.git" ]; then
  say "git init → $CLAUDE_DIR"
  ( cd "$CLAUDE_DIR" && git init -q -b main )
  record NOTE "git init $CLAUDE_DIR (uninstall 은 .git 을 지우지 않음 — 데이터 보호)"
fi
cd "$CLAUDE_DIR"
if git remote get-url origin >/dev/null 2>&1; then
  [ "$(git remote get-url origin)" = "$SYNC_URL" ] || warn "origin 이 이미 다름: $(git remote get-url origin) (유지)"
else
  git remote add origin "$SYNC_URL"
  record GITREMOTE origin
  say "origin 추가: $SYNC_URL"
fi

# ── 3. 로컬 인증 ──
if auth_ok "$SYNC_URL"; then
  say "로컬 GitHub 인증 OK"
  git fetch -q origin 2>/dev/null || true
else
  warn "로컬 GitHub 인증 안 됨 — 아래 중 하나 후 다시 push:"
  case "$SYNC_URL" in
    git@*|ssh://*) printf '   • SSH 키 등록:  ssh-keygen -t ed25519 → ~/.ssh/id_ed25519.pub 를 GitHub Settings→SSH keys 에 추가\n' ;;
    https://*)     printf '   • gh auth login   (또는 PAT 를 git credential 에 저장)\n' ;;
  esac
fi

# ── 4. 원격 머신 인증 점검 (REMOTE_HOST) ──
if [ -n "${REMOTE_HOST:-}" ]; then
  say "원격($REMOTE_HOST) GitHub 인증 점검"
  if ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE_HOST" "git ls-remote '$SYNC_URL' >/dev/null 2>&1"; then
    say "  원격 인증 OK — 그 머신도 같은 repo pull/push 가능"
  else
    warn "  원격($REMOTE_HOST)에서 GitHub 인증 안 됨. 그 머신에 ssh 접속해 아래 실행:"
    case "$SYNC_URL" in
      git@*|ssh://*) printf '     ssh %s\n     ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519\n     # 출력된 ~/.ssh/id_ed25519.pub 를 GitHub→SSH keys 에 추가\n' "$REMOTE_HOST" ;;
      https://*)     printf '     ssh %s\n     gh auth login   # 또는 PAT 저장\n' "$REMOTE_HOST" ;;
    esac
    printf '     그 뒤:  ssh %s "cd ~/.claude && git pull --rebase origin main"\n' "$REMOTE_HOST"
  fi
fi
say "sync 백본 설정 완료"
