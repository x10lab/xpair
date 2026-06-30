#!/usr/bin/env bash
# uninstall-host.sh — fully wipe the Xpair host from this Mac for a clean reinstall.
# (Run LOCALLY on the host Mac. For the over-SSH teardown from a client, see client/cli/uninstall-host.sh.)
#
# SAFETY (deliberate, to protect the production 0.4.x host):
#   • REFUSES to remove a 0.4.x install unless --force is passed. The 0.4.x line is
#     the protected production version; only newer test installs are removable by default.
#   • Defaults to user-level, sudo-free removal. /Applications/XpairHost.app is only
#     sudo-removed when --force is passed.
#   • Confirms before doing anything destructive unless -y/--yes.
#
# Reverts manifest-recorded install actions when run from a repo checkout, then removes
# LaunchAgents, local xpair state, installed CLIs, legacy tmux-aqua symlink, app bundles,
# and the xpair-host Homebrew cask.
#
# Usage: uninstall-host.sh [-y|--yes] [--dry-run] [--force]
set -euo pipefail

YES=0
DRY_RUN=0
FORCE=0
APP_NAME="XpairHost"

usage() { awk 'NR == 1 { next } /^set -euo pipefail$/ { exit } { print }' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠︎ %s\033[0m\n' "$*" >&2; }

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf 'DRY:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@" || true
}

run_quiet() {
  if [ "$DRY_RUN" = 1 ]; then
    run "$@"
    return 0
  fi
  "$@" >/dev/null 2>&1 || true
}

confirm() {
  [ "$YES" = 1 ] && return 0
  printf '%s [y/N]: ' "$1" >/dev/tty 2>/dev/null || true
  read -r ans </dev/tty 2>/dev/null || ans=""
  case "${ans:-n}" in
    [yY]|[yY][eE][sS]) ;;
    *) say "Aborted."; exit 1 ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARED="$REPO_ROOT/shared"

APP_PATH=""
VER=""
for p in "/Applications/$APP_NAME.app" "$HOME/Applications/$APP_NAME.app"; do
  [ -d "$p" ] || continue
  v="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$p/Contents/Info.plist" 2>/dev/null || true)"
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  [ -n "$v" ] || continue
  APP_PATH="$p"
  VER="$v"
  break
done

if [ -z "$VER" ]; then
  say "nothing to remove"
else
  say "$APP_NAME $VER found at $APP_PATH"
fi

case "$VER" in
  0.4*) [ "$FORCE" = 1 ] || { echo "⛔ REFUSING: $VER is a protected 0.4.x (production) install. Use --force only if you really mean it." >&2; exit 3; } ;;
esac

if [ -n "$VER" ]; then
  confirm "Remove $APP_NAME $VER and wipe xpair host leftovers from this Mac?"
else
  confirm "Wipe stray xpair host state and leftovers from this Mac?"
fi

say "Removing LaunchAgents"
U="$(id -u)"
for L in \
  com.x10lab.xpair-host \
  com.x10lab.xpair-host-watchdog \
  com.ghyeong.xpair-host \
  com.ghyeong.xpair-host-watchdog \
  com.x10lab.xpair \
  com.x10lab.xpair-watchdog \
  com.x10lab.auto-approve \
  com.ghyeong.auto-approve; do
  run_quiet launchctl bootout "gui/$U/$L"
  run rm -f "$HOME/Library/LaunchAgents/$L.plist"
done

if [ -f "$SHARED/uninstall.sh" ]; then
  say "Reverting manifest-recorded install actions"
  run bash "$SHARED/uninstall.sh"
else
  say "No shared manifest reverter found; continuing with known paths."
fi

say "Stopping host processes"
run_quiet pkill -f XpairHost
run_quiet pkill -f tmux-aqua

say "Removing xpair state"
run rm -rf "$HOME/.xpair"

say "Removing installed CLIs"
for p in \
  "$HOME/.local/bin/xpair" \
  "$HOME/.local/bin/xpair-askpass" \
  "$HOME/.local/bin/xpair-desktop" \
  "$HOME/.local/bin/xpair-editor" \
  "$HOME/.local/bin/xpair-mount" \
  "$HOME/.local/bin/xpair-launch" \
  "$HOME/.local/bin/tmux-aqua"; do
  run rm -f "$p"
done

say "Removing user Applications copy"
run rm -rf "$HOME/Applications/$APP_NAME.app"

SYSTEM_APP="/Applications/$APP_NAME.app"
if [ -d "$SYSTEM_APP" ]; then
  if [ "$FORCE" = 1 ]; then
    say "Removing system Applications copy"
    run sudo rm -rf "$SYSTEM_APP"
    if [ "$DRY_RUN" != 1 ] && [ -d "$SYSTEM_APP" ]; then
      warn "$SYSTEM_APP is still present; sudo removal did not complete."
    fi
  else
    warn "$SYSTEM_APP needs admin to remove — left in place (run 'sudo rm -rf $SYSTEM_APP' if intended)."
  fi
fi

say "Removing Homebrew cask"
run_quiet brew uninstall --cask xpair-host

say 'host wiped — re-run `xpair install-host` (or onboarding) to reinstall.'
