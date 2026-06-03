#!/usr/bin/env bash
# bootstrap.sh — RemotePair 원샷 설치.  처음 쓰는 사람용.
#
#   curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/bootstrap.sh | bash
#
# 하는 일(순서대로, 멱등):
#   1) prereq 점검 (Apple Silicon macOS / Xcode swiftc / Homebrew+tmux 의존성 / git)
#   2) repo clone 또는 update  → $REMOTE_PAIR_SRC (기본 ~/.local/share/remote-pair)
#   3) 안정 코드서명 cert 생성 (scripts/make-signing-cert.sh)
#   4) patched tmux 빌드      (scripts/build-tmux-aqua.sh → ~/.local/bin/tmux-aqua)
#   5) RemotePair.app 빌드    (scripts/build-native.sh)
#   6) glue+native 설치 + sync (install/install.sh — manifest 가역)
#   7) ⚠ 수동 1회: 손쉬운사용/화면기록 권한 토글 안내 (macOS 가 자동화 불가)
#
# 비대화 환경변수(파이프 설치 시 권장):
#   REMOTE_HOST=my-mac  SYNC_URL=git@github.com:me/claude.git  RP_ORG=com.acme
#   SKIP_BUILD=1 (앱/ tmux 이미 빌드됨)   SKIP_SYNC=1   BRANCH=main
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ghyeongl/remote-pair.git}"
SRC="${REMOTE_PAIR_SRC:-$HOME/.local/share/remote-pair}"
BRANCH="${BRANCH:-main}"

c()    { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# 파이프(curl|bash)에서도 사용자 입력을 받으려면 /dev/tty 사용
ask()  { local q="$1" v=""; { printf '%s' "$q" > /dev/tty; read -r v < /dev/tty; } 2>/dev/null || true; printf '%s' "$v"; }

# ── 1. prereq ──
c "prereq 점검"
[ "$(uname -s)" = "Darwin" ] || die "macOS 전용입니다 (현재: $(uname -s))"
[ "$(uname -m)" = "arm64" ]  || warn "Apple Silicon 가정 (현재: $(uname -m)) — Homebrew 경로가 다를 수 있음"
command -v git >/dev/null   || die "git 없음 — xcode-select --install 후 다시 시도"
xcrun --find swiftc >/dev/null 2>&1 || die "Swift 툴체인 없음 — Xcode 또는 Command Line Tools 설치 필요 (xcode-select --install)"
if ! command -v brew >/dev/null; then
  warn "Homebrew 없음 — tmux 의존성(libevent/ncurses/utf8proc) 빌드에 필요. https://brew.sh"
fi
# tmux 의존성 확보 (brew tmux 가 끌어옴). 이미 있으면 빠르게 통과.
if command -v brew >/dev/null && [ "${SKIP_BUILD:-0}" != "1" ]; then
  if ! brew list tmux >/dev/null 2>&1; then
    c "tmux 의존성 설치 (brew install tmux — libevent/ncurses/utf8proc 확보용)"
    brew install tmux || warn "brew install tmux 실패 — 수동 확인 필요"
  fi
fi
ok "prereq OK"

# ── 2. clone / update ──
if [ -d "$SRC/.git" ]; then
  c "repo update → $SRC"
  git -C "$SRC" fetch -q origin "$BRANCH" && git -C "$SRC" checkout -q "$BRANCH" && git -C "$SRC" pull -q --ff-only origin "$BRANCH" || warn "update 실패 — 기존 소스로 진행"
else
  c "repo clone → $SRC"
  mkdir -p "$(dirname "$SRC")"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$SRC" || die "clone 실패: $REPO_URL"
fi
cd "$SRC"
ok "소스 준비: $SRC ($(git rev-parse --short HEAD))"

# ── 3~5. 빌드 ──
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  warn "SKIP_BUILD=1 — cert/tmux/app 빌드 건너뜀 (이미 빌드됐다고 가정)"
else
  c "안정 코드서명 cert (idempotent)"; ./scripts/make-signing-cert.sh || warn "cert 생성 실패 — ad-hoc 폴백(재빌드 시 재토글 필요)"
  c "patched tmux 빌드";            ./scripts/build-tmux-aqua.sh || die "tmux 빌드 실패"
  c "RemotePair.app 빌드";          ./scripts/build-native.sh    || die "앱 빌드 실패"
fi

# ── 6. 설치 (install.sh 가 prompt/env 처리) ──
#   REMOTE_HOST / SYNC_URL 가 env 에 없고 TTY 면 여기서 먼저 받아 install 에 넘긴다.
if [ -z "${REMOTE_HOST:-}" ]; then REMOTE_HOST="$(ask '원격 host (mosh/ssh 대상, 단일 머신이면 빈칸 Enter): ')"; fi
if [ "${SKIP_SYNC:-0}" != "1" ] && [ -z "${SYNC_URL:-}" ]; then
  SYNC_URL="$(ask '~/.claude sync 용 GitHub repo URL (sync 불필요면 빈칸): ')"
fi
export REMOTE_HOST SYNC_URL
INSTALL_ARGS=(); [ "${SKIP_SYNC:-0}" = "1" ] && INSTALL_ARGS+=(--no-sync)
c "설치 (install.sh)"
./install/install.sh "${INSTALL_ARGS[@]}"

# ── 7. 수동 권한 단계 안내 (자동화 불가) ──
echo
ok "빌드·설치 완료."
warn "마지막 1회 수동 단계 — macOS 가 자동화 못 하는 부분 (SIP+non-MDM):"
cat <<EOF
   System Settings → 개인정보 보호 및 보안 에서 RemotePair 를 켜라:
     • 손쉬운 사용 (Accessibility)  : RemotePair ON
     • 화면 기록 (Screen Recording) : RemotePair ON
   (목록에 없으면 + 로  ~/Applications/RemotePair.app  추가)
   토글 후:  launchctl kickstart -k gui/\$(id -u)/${BUNDLE_PREFIX:-${RP_ORG:-com.x10lab}.remote-pair}
EOF
# 권한 창 바로 열어주기 (있으면)
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
echo
ok "이후: 'remote-pair status' 로 상태 확인, 'remote-pair host' 로 host 서버 기동."
