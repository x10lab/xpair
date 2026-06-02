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

# ── 빌드 (brew libevent/ncurses/utf8proc) ──
LE=/opt/homebrew/opt/libevent; NC=/opt/homebrew/opt/ncurses; U=/opt/homebrew/opt/utf8proc
export LIBUTF8PROC_CFLAGS="-I$U/include" LIBUTF8PROC_LIBS="-L$U/lib -lutf8proc"
./configure --enable-utf8proc CPPFLAGS="-I$LE/include -I$NC/include" LDFLAGS="-L$LE/lib -L$NC/lib"
make -j4
mkdir -p "$(dirname "$DEST")"
cp tmux "$DEST" && chmod 755 "$DEST"
echo "installed: $DEST ($("$DEST" -V))"
