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
#   5) RemotePairHost.app 빌드 (scripts/build-host.sh)
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
ROLE="${ROLE:-both}"     # host | client | both. client 는 빌드/Xcode 불필요.
needs_build() { [ "$ROLE" != client ] && [ "${SKIP_BUILD:-0}" != "1" ]; }

c()    { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# 파이프(curl|bash)에서도 사용자 입력을 받으려면 /dev/tty 사용
ask()  { local q="$1" v=""; { printf '%s' "$q" > /dev/tty; read -r v < /dev/tty; } 2>/dev/null || true; printf '%s' "$v"; }

# ── 1. prereq ──
c "prereq 점검 (role=$ROLE)"
[ "$(uname -s)" = "Darwin" ] || die "macOS 전용입니다 (현재: $(uname -s))"
command -v git >/dev/null   || die "git 없음 — xcode-select --install 후 다시 시도"
if needs_build; then
  # host/both: 앱·tmux 빌드에 Xcode + brew 의존성 필요
  [ "$(uname -m)" = "arm64" ]  || warn "Apple Silicon 가정 (현재: $(uname -m)) — Homebrew 경로가 다를 수 있음"
  xcrun --find swiftc >/dev/null 2>&1 || die "Swift 툴체인 없음 — Xcode/CLT 설치 (xcode-select --install)"
  command -v brew >/dev/null || warn "Homebrew 없음 — tmux 정적 빌드 의존성에 필요. https://brew.sh"
else
  # client: 빌드 없음. mosh 만 있으면 좋음(없어도 ssh 폴백)
  command -v mosh >/dev/null || warn "mosh 없음 — 원격 attach 시 ssh 로 폴백됨 (brew install mosh 권장)"
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

# ── 3~5. 빌드 (host/both 만; client 는 생략) ──
if needs_build; then
  c "안정 코드서명 cert (idempotent)"; ./scripts/make-signing-cert.sh || warn "cert 생성 실패 — ad-hoc 폴백(재빌드 시 재토글 필요)"
  c "patched tmux 빌드 (static, self-contained)"; ./scripts/build-tmux-aqua.sh || die "tmux 빌드 실패"
  c "RemotePairHost.app 빌드 (tmux-aqua 임베드)";  ./scripts/build-host.sh      || die "앱 빌드 실패"
else
  c "role=$ROLE — 빌드 생략 (client 는 Service+런처만)"
fi

# ── 6. 설치 ──
# client/both 는 attach 대상 REMOTE_HOST 가 필요. sync 는 opt-in(SYNC_URL 줄 때만).
if [ "$ROLE" != host ] && [ -z "${REMOTE_HOST:-}" ]; then
  REMOTE_HOST="$(ask '원격 host (mosh/ssh 대상, 단일 머신이면 빈칸 Enter): ')"
fi
export REMOTE_HOST SYNC_URL="${SYNC_URL:-}"
INSTALL_ARGS=(--role "$ROLE")
[ -n "$SYNC_URL" ] && INSTALL_ARGS+=(--with-sync)
c "설치 (install.sh --role $ROLE$([ -n "$SYNC_URL" ] && echo ' --with-sync'))"
./install/install.sh "${INSTALL_ARGS[@]}"

# ── 7. 수동 권한 단계 안내 (host/both 에서 앱을 깐 경우만; macOS 자동화 불가) ──
echo
ok "설치 완료."
if [ "$ROLE" != client ]; then
  warn "마지막 1회 수동 단계 — macOS 가 자동화 못 하는 부분 (SIP+non-MDM):"
  cat <<EOF
   System Settings → 개인정보 보호 및 보안 에서 RemotePairHost 를 켜라:
     • 손쉬운 사용 (Accessibility)  : RemotePairHost ON
     • 화면 기록 (Screen Recording) : RemotePairHost ON
   (목록에 없으면 + 로  ~/Applications/RemotePairHost.app  추가)
   토글 후:  launchctl kickstart -k gui/\$(id -u)/${BUNDLE_PREFIX:-${RP_ORG:-com.x10lab}.remote-pair-host}
EOF
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
  echo
  ok "이후: 'remote-pair status' / 'remote-pair host'."
else
  ok "client 설치 완료 — Finder 폴더 우클릭 → 빠른 동작 → Launch Remote Pair. ('remote-pair doctor' 로 SSH 점검)"
fi
