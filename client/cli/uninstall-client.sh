#!/usr/bin/env bash
# uninstall-client.sh — fully wipe the Xpair client from this Mac for a clean reinstall.
#
# Reverts manifest-recorded install actions when run from a repo checkout, then removes
# the local xpair namespace, installed CLIs, legacy tmux-aqua symlink, client Quick
# Action, and the xpair Homebrew cask.
#
# Usage: uninstall-client.sh [-y|--yes] [--dry-run]
set -euo pipefail

YES=0
DRY_RUN=0

usage() { awk 'NR == 1 { next } /^set -euo pipefail$/ { exit } { print }' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

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
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHARED="$REPO_ROOT/shared"

confirm "Wipe xpair client state, binaries, Quick Action, and cask from this Mac?"

if [ -f "$SHARED/uninstall.sh" ]; then
  say "Reverting manifest-recorded install actions"
  run bash "$SHARED/uninstall.sh"
else
  say "No shared manifest reverter found; continuing with known paths."
fi

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

say "Removing client Quick Action"
run rm -rf "$HOME/Library/Services/Launch Xpair.workflow"

say "Removing Homebrew cask"
run_quiet brew uninstall --cask xpair

say "Refreshing Finder Quick Action cache"
run_quiet /System/Library/CoreServices/pbs -flush

say "client wiped — re-run xpair onboarding to reinstall."
