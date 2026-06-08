#!/bin/bash
# build-tmux-aqua.sh — computer-use용 patched tmux 빌드 → ~/.local/bin/tmux-aqua
#
# 왜: tmux 기본은 proc.c proc_fork_and_daemon()에서 daemon(3) 호출로 서버를 launchd로 reparent.
# 그러면 그 안 claude 가 granted host(.app) 의 프로세스 서브트리에서 빠져나가 → AX 합성입력 게이트
# (host activation policy + Aqua graphic-session) 통과 실패 → computer-use 불가.
# 패치: daemon(1,0) → setsid()+stdio redirect (reparent fork 제거). 서버가 client 의 자식으로 남아,
# granted host(AutoApprove.app)가 attached client 를 붙들면 claude 가 host 서브트리에 유지된다.
#
# 사용: ./build-tmux-aqua.sh   (M1 에서 실행. libevent/ncurses/utf8proc 는 brew tmux 의존성으로 이미 존재)
set -euo pipefail

VER=3.6
BUILD=/tmp/tmux-aqua-build
DEST="$HOME/.local/bin/tmux-aqua"

mkdir -p "$BUILD" && cd "$BUILD"
[ -f "tmux-$VER.tar.gz" ] || curl -fsSL -o "tmux-$VER.tar.gz" \
  "https://github.com/tmux/tmux/releases/download/$VER/tmux-$VER.tar.gz"
rm -rf "tmux-$VER" && tar xzf "tmux-$VER.tar.gz" && cd "tmux-$VER"

# ── 패치: daemon(1,0) → setsid + stdio /dev/null (reparent 없이 tty 분리) ──
python3 - <<'PY'
p="proc.c"; s=open(p).read()
old="""\t\tif (daemon(1, 0) != 0)
\t\t\tfatal("daemon failed");
\t\treturn (0);"""
new="""\t\tif (setsid() == -1)
\t\t\tfatal("setsid failed");
\t\t{
\t\t\tint nfd = open(\"/dev/null\", O_RDWR);
\t\t\tif (nfd != -1) {
\t\t\t\tdup2(nfd, STDIN_FILENO);
\t\t\t\tdup2(nfd, STDOUT_FILENO);
\t\t\t\tdup2(nfd, STDERR_FILENO);
\t\t\t\tif (nfd > STDERR_FILENO) close(nfd);
\t\t\t}
\t\t}
\t\treturn (0);"""
assert old in s, "daemon(1,0) anchor not found — tmux 버전 확인"
s=s.replace(old,new)
if "#include <fcntl.h>" not in s:
    s=s.replace("#include <signal.h>","#include <signal.h>\n#include <fcntl.h>",1)
open(p,"w").write(s); print("patched proc.c (daemon->setsid)")
PY

# ── 빌드 ──
# STATIC=1(기본): libevent/ncurses/utf8proc 를 정적(.a)으로 링크 → brew dylib 의존 0 = self-contained.
#   .app 번들 임베드/배포용. (시스템 libc·프레임워크는 동적 — macOS 는 완전 static 불가, 그게 정상.)
# STATIC=0: 기존 동적 링크(brew 필요). 개발용.
LE=/opt/homebrew/opt/libevent; NC=/opt/homebrew/opt/ncurses; U=/opt/homebrew/opt/utf8proc
STATIC="${STATIC:-1}"
if [ "$STATIC" = 1 ]; then
  # .a 만 모은 스테이징 디렉토리로 -L 을 유도 → AC_SEARCH_LIBS 의 -levent/-lncurses 가 static 해석.
  # (.dylib 가 같은 -L 에 없으니 정적 아카이브로만 링크됨.)
  # utf8proc 는 brew 가 static .a 를 안 주므로(dylib 만) 없으면 소스에서 빌드.
  UA="$U/lib/libutf8proc.a"; UINC="$U/include"
  if [ ! -f "$UA" ]; then
    echo "utf8proc static .a 없음 → 소스 빌드"
    UVER=2.9.0
    ( cd "$BUILD"
      [ -f "utf8proc-$UVER.tar.gz" ] || curl -fsSL -o "utf8proc-$UVER.tar.gz" "https://github.com/JuliaStrings/utf8proc/archive/refs/tags/v$UVER.tar.gz"
      rm -rf "utf8proc-$UVER" && tar xzf "utf8proc-$UVER.tar.gz"
      make -C "utf8proc-$UVER" -j4 libutf8proc.a >/dev/null )
    UA="$BUILD/utf8proc-$UVER/libutf8proc.a"; UINC="$BUILD/utf8proc-$UVER"
  fi
  # .a 만 모은 스테이징 디렉토리로 -L 을 유도 → AC_SEARCH_LIBS 의 -levent/-lncurses 가 static 해석.
  STAGE="$BUILD/staticlibs"; rm -rf "$STAGE"; mkdir -p "$STAGE"
  ln -sf "$LE/lib/libevent.a"      "$STAGE/libevent.a"
  ln -sf "$LE/lib/libevent_core.a" "$STAGE/libevent_core.a"   # tmux 는 -levent_core 로 링크
  ln -sf "$NC/lib/libncursesw.a"  "$STAGE/libncursesw.a"
  ln -sf "$NC/lib/libncursesw.a"  "$STAGE/libncurses.a"   # -lncurses 폴백
  ln -sf "$NC/lib/libncursesw.a"  "$STAGE/libtinfo.a"     # -ltinfo 폴백
  ln -sf "$UA"                    "$STAGE/libutf8proc.a"
  for a in libevent libncursesw libutf8proc; do [ -e "$STAGE/$a.a" ] || { echo "✗ static lib 없음: $a.a"; exit 1; }; done
  # CFLAGS/LIBS 를 직접 줘서 pkg-config 우회 → 정적 .a 강제 (안 그러면 libevent 가 Cellar dylib 으로 링크됨).
  export LIBUTF8PROC_CFLAGS="-I$UINC" LIBUTF8PROC_LIBS="$UA"
  export LIBEVENT_CFLAGS="-I$LE/include" LIBEVENT_LIBS="$LE/lib/libevent_core.a"
  export LIBNCURSES_CFLAGS="-I$NC/include" LIBNCURSES_LIBS="$NC/lib/libncursesw.a"
  # PKG_CONFIG=false → libevent 검출이 pkg-config(Cellar dylib) 대신 AC_SEARCH_LIBS 폴백 사용
  #   → LDFLAGS 의 -L$STAGE 에서 libevent_core.a(static) 를 집는다.
  PKG_CONFIG=false ./configure --enable-utf8proc \
    CPPFLAGS="-I$LE/include -I$NC/include -I$UINC" \
    LDFLAGS="-L$STAGE"
else
  export LIBUTF8PROC_CFLAGS="-I$U/include" LIBUTF8PROC_LIBS="-L$U/lib -lutf8proc"
  ./configure --enable-utf8proc CPPFLAGS="-I$LE/include -I$NC/include" LDFLAGS="-L$LE/lib -L$NC/lib"
fi
make -j4
mkdir -p "$(dirname "$DEST")"
cp tmux "$DEST" && chmod 755 "$DEST"
echo "installed: $DEST ($("$DEST" -V))"
echo "=== 동적 의존 점검 (brew dylib 없어야 self-contained) ==="
if otool -L "$DEST" | grep -q "/opt/homebrew"; then
  echo "⚠ 아직 brew dylib 링크 남음:"; otool -L "$DEST" | grep "/opt/homebrew"
else
  echo "✓ brew dylib 의존 0 — self-contained (배포 가능)"
fi
