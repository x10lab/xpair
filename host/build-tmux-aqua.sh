#!/bin/bash
# build-tmux-aqua.sh — build a patched tmux for computer-use → ~/.local/bin/tmux-aqua
#
# Why: by default tmux calls daemon(3) in proc.c proc_fork_and_daemon(), reparenting the server to launchd.
# That makes the claude inside it escape the process subtree of the granted host (.app) → it fails the AX
# synthetic-input gate (host activation policy + Aqua graphic-session) → computer-use is impossible.
# Patch: daemon(1,0) → setsid()+stdio redirect (removes the reparent fork). The server stays a child of the
# client, and when the granted host (AutoApprove.app) holds the attached client, claude stays in the host subtree.
#
# Usage: ./build-tmux-aqua.sh   (run on M1. libevent/ncurses/utf8proc already exist as brew tmux dependencies)
set -euo pipefail

VER=3.6
BUILD=/tmp/tmux-aqua-build
DEST="$HOME/.local/bin/tmux-aqua"

mkdir -p "$BUILD" && cd "$BUILD"
[ -f "tmux-$VER.tar.gz" ] || curl -fsSL -o "tmux-$VER.tar.gz" \
  "https://github.com/tmux/tmux/releases/download/$VER/tmux-$VER.tar.gz"
rm -rf "tmux-$VER" && tar xzf "tmux-$VER.tar.gz" && cd "tmux-$VER"

# ── patch: daemon(1,0) → setsid + stdio /dev/null (detach tty without reparenting) ──
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
assert old in s, "daemon(1,0) anchor not found — check tmux version"
s=s.replace(old,new)
if "#include <fcntl.h>" not in s:
    s=s.replace("#include <signal.h>","#include <signal.h>\n#include <fcntl.h>",1)
open(p,"w").write(s); print("patched proc.c (daemon->setsid)")
PY

# ── build ──
# STATIC=1 (default): link libevent/ncurses/utf8proc statically (.a) → 0 brew dylib dependencies = self-contained.
#   For .app bundle embedding/distribution. (System libc and frameworks stay dynamic — fully static is impossible on macOS, which is expected.)
# STATIC=0: the existing dynamic linking (requires brew). For development.
LE=/opt/homebrew/opt/libevent; NC=/opt/homebrew/opt/ncurses; U=/opt/homebrew/opt/utf8proc
STATIC="${STATIC:-1}"
if [ "$STATIC" = 1 ]; then
  # Point -L at a staging directory holding only .a files → AC_SEARCH_LIBS resolves -levent/-lncurses statically.
  # (Since no .dylib is in the same -L, linking happens against the static archives only.)
  # brew does not ship a static .a for utf8proc (dylib only), so build it from source if missing.
  UA="$U/lib/libutf8proc.a"; UINC="$U/include"
  if [ ! -f "$UA" ]; then
    echo "no utf8proc static .a → building from source"
    UVER=2.9.0
    ( cd "$BUILD"
      [ -f "utf8proc-$UVER.tar.gz" ] || curl -fsSL -o "utf8proc-$UVER.tar.gz" "https://github.com/JuliaStrings/utf8proc/archive/refs/tags/v$UVER.tar.gz"
      rm -rf "utf8proc-$UVER" && tar xzf "utf8proc-$UVER.tar.gz"
      make -C "utf8proc-$UVER" -j4 libutf8proc.a >/dev/null )
    UA="$BUILD/utf8proc-$UVER/libutf8proc.a"; UINC="$BUILD/utf8proc-$UVER"
  fi
  # Point -L at a staging directory holding only .a files → AC_SEARCH_LIBS resolves -levent/-lncurses statically.
  STAGE="$BUILD/staticlibs"; rm -rf "$STAGE"; mkdir -p "$STAGE"
  ln -sf "$LE/lib/libevent.a"      "$STAGE/libevent.a"
  ln -sf "$LE/lib/libevent_core.a" "$STAGE/libevent_core.a"   # tmux links against -levent_core
  ln -sf "$NC/lib/libncursesw.a"  "$STAGE/libncursesw.a"
  ln -sf "$NC/lib/libncursesw.a"  "$STAGE/libncurses.a"   # -lncurses fallback
  ln -sf "$NC/lib/libncursesw.a"  "$STAGE/libtinfo.a"     # -ltinfo fallback
  ln -sf "$UA"                    "$STAGE/libutf8proc.a"
  for a in libevent libncursesw libutf8proc; do [ -e "$STAGE/$a.a" ] || { echo "✗ static lib missing: $a.a"; exit 1; }; done
  # Pass CFLAGS/LIBS directly to bypass pkg-config → force the static .a (otherwise libevent links against the Cellar dylib).
  export LIBUTF8PROC_CFLAGS="-I$UINC" LIBUTF8PROC_LIBS="$UA"
  export LIBEVENT_CFLAGS="-I$LE/include" LIBEVENT_LIBS="$LE/lib/libevent_core.a"
  export LIBNCURSES_CFLAGS="-I$NC/include" LIBNCURSES_LIBS="$NC/lib/libncursesw.a"
  # PKG_CONFIG=false → libevent detection uses the AC_SEARCH_LIBS fallback instead of pkg-config (Cellar dylib)
  #   → it picks libevent_core.a (static) from -L$STAGE in LDFLAGS.
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
echo "=== dynamic dependency check (no brew dylib = self-contained) ==="
if otool -L "$DEST" | grep -q "/opt/homebrew"; then
  echo "⚠ brew dylib links still remain:"; otool -L "$DEST" | grep "/opt/homebrew"
else
  echo "✓ 0 brew dylib dependencies — self-contained (ready to distribute)"
fi
