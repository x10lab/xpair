#!/usr/bin/env bash
# bootstrap.sh — RemotePair 원샷 설치.  처음 쓰는 사람용.
#
#   curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | bash
#
# 하는 일(순서대로, 멱등) — glue(CLI/approve/Service/런처) 설치만. 앱 바이너리는 Homebrew 가 공급:
#   1) prereq 점검 (macOS / git)
#   2) repo clone 또는 update  → $REMOTE_PAIR_SRC (기본 ~/.local/share/remote-pair)
#   3) glue+native 설치 + sync (shared/install.sh — manifest 가역)
#   4) ⚠ host: 수동 1회 손쉬운사용/화면기록 권한 토글 안내 (macOS 가 자동화 불가)
#
# 호스트 앱(RemotePairHost.app)은 Homebrew 가 공급: brew install --cask remote-pair-host.
# 이 스크립트는 앱을 빌드/설치하지 않는다 — 소스 빌드는 메인테이너 스크립트(host/build-*.sh) 영역.
#
# 비대화 환경변수(파이프 설치 시 권장):
#   REMOTE_HOST=my-mac  SYNC_URL=git@github.com:me/claude.git  RP_ORG=com.acme  SKIP_SYNC=1  BRANCH=main
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ghyeongl/remote-pair.git}"
SRC="${REMOTE_PAIR_SRC:-$HOME/.local/share/remote-pair}"
BRANCH="${BRANCH:-main}"
ROLE="${ROLE:-both}"     # host | client | both

c()    { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# 파이프(curl|bash)에서도 사용자 입력을 받으려면 /dev/tty 사용
ask()  { local q="$1" v=""; { printf '%s' "$q" > /dev/tty; read -r v < /dev/tty; } 2>/dev/null || true; printf '%s' "$v"; }

# ── 1. prereq ── (빌드 없음 → git 만 필수. 앱은 brew cask)
c "prereq 점검 (role=$ROLE)"
[ "$(uname -s)" = "Darwin" ] || die "macOS 전용입니다 (현재: $(uname -s))"
command -v git >/dev/null   || die "git 없음 — xcode-select --install 후 다시 시도"
command -v mosh >/dev/null   || warn "mosh 없음 — 원격 attach 시 ssh 로 폴백됨 (brew install mosh 권장)"
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

# ── 3. 설치 ── (glue 만; 앱 빌드는 메인테이너 host/build-*.sh 영역)
# client/both 는 attach 대상 REMOTE_HOST 가 필요. sync 는 opt-in(SYNC_URL 줄 때만).
if [ "$ROLE" != host ] && [ -z "${REMOTE_HOST:-}" ]; then
  REMOTE_HOST="$(ask '원격 host (mosh/ssh 대상, 단일 머신이면 빈칸 Enter): ')"
fi
export REMOTE_HOST SYNC_URL="${SYNC_URL:-}"
INSTALL_ARGS=(--role "$ROLE")
[ -n "$SYNC_URL" ] && INSTALL_ARGS+=(--with-sync)
c "설치 (install.sh --role $ROLE$([ -n "$SYNC_URL" ] && echo ' --with-sync'))"
./shared/install.sh "${INSTALL_ARGS[@]}"

# ── host: cliclick(click primitive) + RemotePairHost.app(cask) 보장 ──
# cliclick = InputServer 의 click 주입기. cask 번들엔 없으므로(CI 러너에 미설치) 호스트에서 brew 로 보장.
#   없으면 click primitive 가 런타임에 실패한다(키는 osascript 라 무관).
if [ "$ROLE" != client ]; then
  if command -v brew >/dev/null; then
    command -v cliclick >/dev/null || { c "cliclick 설치 (click primitive)"; brew install cliclick || warn "cliclick 설치 실패 — 수동: brew install cliclick"; }
    # cask 보장 (앱이 아직 없을 때만)
    if [ ! -d "$HOME/Applications/RemotePairHost.app" ] && [ ! -d /Applications/RemotePairHost.app ]; then
      c "RemotePairHost.app 설치 (Homebrew cask)"
      brew tap ghyeongl/remote-pair https://github.com/ghyeongl/remote-pair 2>/dev/null || true
      brew trust ghyeongl/remote-pair 2>/dev/null || true   # 서드파티 tap 신뢰(최신 brew 보안 게이트)
      brew install --cask remote-pair-host || warn "cask 설치 실패 — 수동: brew trust ghyeongl/remote-pair && brew install --cask remote-pair-host"
    fi
  else
    warn "Homebrew 없음 — 앱(cask)+cliclick 설치에 필요. 먼저 Homebrew 를 깔고 다시 실행하세요:"
    cat <<'EOF' >&2
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   (https://brew.sh) — 설치 후 다시 실행하면 앱(cask)+cliclick 까지 자동으로 깝니다.
EOF
  fi
fi

# ── 4. 수동 권한 단계 안내 (host/both; macOS 자동화 불가) ──
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
