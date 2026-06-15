#!/usr/bin/env bash
# bootstrap.sh — RemotePair one-shot install.  For first-time users.
#
#   curl -fsSL https://raw.githubusercontent.com/ghyeongl/remote-pair/main/shared/bootstrap.sh | bash
#
# What it does (in order, idempotent) — installs glue (CLI/approve/Service/launcher) only. App binaries are supplied by Homebrew:
#   1) prereq check (macOS / git)
#   2) repo clone or update  → $REMOTE_PAIR_SRC (default ~/.local/share/remote-pair)
#   3) glue+native install + sync (shared/install.sh — manifest reversible)
#   4) ⚠ host: one-time manual Accessibility/Screen Recording permission toggle guidance (macOS cannot automate this)
#
# The host app (RemotePairHost.app) is supplied by Homebrew: brew install --cask remote-pair-host.
# This script does not build/install the app — source builds belong to the maintainer scripts (host/build-*.sh).
#
# Non-interactive environment variables (recommended for piped installs):
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
# Use /dev/tty so user input still works under a pipe (curl|bash)
ask()  { local q="$1" v=""; { printf '%s' "$q" > /dev/tty; read -r v < /dev/tty; } 2>/dev/null || true; printf '%s' "$v"; }

# ── 1. prereq ── (no build → only git is required. The app is a brew cask)
c "prereq check (role=$ROLE)"
[ "$(uname -s)" = "Darwin" ] || die "macOS only (current: $(uname -s))"
command -v git >/dev/null   || die "git not found — run xcode-select --install and try again"
command -v mosh >/dev/null   || warn "mosh not found — remote attach falls back to ssh (brew install mosh recommended)"
ok "prereq OK"

# ── 2. clone / update ──
if [ -d "$SRC/.git" ]; then
  c "repo update → $SRC"
  git -C "$SRC" fetch -q origin "$BRANCH" && git -C "$SRC" checkout -q "$BRANCH" && git -C "$SRC" pull -q --ff-only origin "$BRANCH" || warn "update failed — proceeding with existing source"
else
  c "repo clone → $SRC"
  mkdir -p "$(dirname "$SRC")"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$SRC" || die "clone failed: $REPO_URL"
fi
cd "$SRC"
ok "source ready: $SRC ($(git rev-parse --short HEAD))"

# ── 3. install ── (glue only; app builds belong to the maintainer host/build-*.sh)
# client/both need a REMOTE_HOST to attach to. sync is opt-in (only when SYNC_URL is given).
if [ "$ROLE" != host ] && [ -z "${REMOTE_HOST:-}" ]; then
  REMOTE_HOST="$(ask 'Remote host (mosh/ssh target, leave blank and press Enter for a single machine): ')"
fi
export REMOTE_HOST SYNC_URL="${SYNC_URL:-}"
INSTALL_ARGS=(--role "$ROLE")
[ -n "$SYNC_URL" ] && INSTALL_ARGS+=(--with-sync)
c "install (install.sh --role $ROLE$([ -n "$SYNC_URL" ] && echo ' --with-sync'))"
./shared/install.sh "${INSTALL_ARGS[@]}"

# ── host: ensure cliclick (click primitive) + RemotePairHost.app (cask) ──
# cliclick = the InputServer's click injector. It is not in the cask bundle (not installed on CI runners), so ensure it via brew on the host.
#   Without it the click primitive fails at runtime (keys go through osascript, so they are unaffected).
if [ "$ROLE" != client ]; then
  if command -v brew >/dev/null; then
    command -v cliclick >/dev/null || { c "install cliclick (click primitive)"; brew install cliclick || warn "cliclick install failed — manual: brew install cliclick"; }
    # ensure cask (only when the app is not present yet)
    if [ ! -d "$HOME/Applications/RemotePairHost.app" ] && [ ! -d /Applications/RemotePairHost.app ]; then
      c "install RemotePairHost.app (Homebrew cask)"
      brew tap ghyeongl/remote-pair https://github.com/ghyeongl/remote-pair 2>/dev/null || true
      brew trust ghyeongl/remote-pair 2>/dev/null || true   # trust the third-party tap (recent brew security gate)
      brew install --cask remote-pair-host \
        || warn "cask install failed — manual: brew trust ghyeongl/remote-pair && brew install --cask remote-pair-host"
    fi
  else
    warn "Homebrew not found — required to install the app (cask) + cliclick. Install Homebrew first, then run this again:"
    cat <<'EOF' >&2
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   (https://brew.sh) — after installing it, run this again and the app (cask) + cliclick will be installed automatically.
EOF
  fi
fi

# ── 4. manual permission step guidance (host/both; macOS cannot automate this) ──
echo
ok "install complete."
if [ "$ROLE" != client ]; then
  warn "Final one-time manual step — the part macOS cannot automate (SIP+non-MDM):"
  cat <<EOF
   In System Settings → Privacy & Security, turn on RemotePairHost:
     • Accessibility  : RemotePairHost ON
     • Screen Recording : RemotePairHost ON
   (if it is not listed, add  /Applications/RemotePairHost.app  with +)
   After toggling:  launchctl kickstart -k gui/\$(id -u)/${BUNDLE_PREFIX:-${RP_ORG:-com.x10lab}.remote-pair-host}
EOF
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
  echo
  ok "next: 'remote-pair status' / 'remote-pair host'."
else
  ok "client install complete — right-click a folder in Finder → Quick Actions → Launch Remote Pair. (run 'remote-pair doctor' to check SSH)"
fi
