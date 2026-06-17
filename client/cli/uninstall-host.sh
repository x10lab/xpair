#!/usr/bin/env bash
# uninstall-host.sh — remove RemotePairHost from a target Mac over SSH (the reverse of
# `remote-pair install-host`), for repeatable install/uninstall testing of the onboarding flow.
#
# SAFETY (deliberate, to protect the production 0.4.x host):
#   • Requires an EXPLICIT --host — it never defaults to REMOTE_HOST, so it cannot accidentally
#     hit your configured production host (e.g. gh-mac-m1 running 0.4.12).
#   • REFUSES to remove a 0.4.x install unless --force is passed. The 0.4.x line is the protected
#     production version; only 0.5.0+ test installs are removable by default.
#   • Confirms before doing anything destructive unless -y/--yes.
#
# Removes (user-level, no sudo): the LaunchAgents + plists, ~/Applications/RemotePairHost.app, the
# host config (~/.remote-pair/host.env) and the staged build cache. A /Applications/*.app copy needs
# admin and is reported (not force-removed) so this stays sudo-free and safe.
#
# Usage: uninstall-host.sh --host <ssh-target> [-y] [--force]
set -euo pipefail

HOST=""; YES=0; FORCE=0; APP_NAME="RemotePairHost"
while [ $# -gt 0 ]; do case "$1" in
  --host) HOST="${2:-}"; shift 2 ;;
  -y|--yes) YES=1; shift ;;
  --force) FORCE=1; shift ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac; done
[ -n "$HOST" ] || { echo "uninstall-host requires --host <ssh-target> (never defaults to REMOTE_HOST)" >&2; exit 2; }

ssh_t() { ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$HOST" "$@"; }

# Read the installed version (prefer /Applications, then ~/Applications).
VER="$(ssh_t '
  for p in /Applications/'"$APP_NAME"'.app "$HOME/Applications/'"$APP_NAME"'.app"; do
    [ -d "$p" ] && { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$p/Contents/Info.plist" 2>/dev/null; break; }
  done' 2>/dev/null || true)"
VER="$(printf '%s' "$VER" | tr -d "[:space:]")"

if [ -z "$VER" ]; then
  echo "✅ $HOST has no $APP_NAME installed — nothing to remove."
  exit 0
fi
echo "$HOST has $APP_NAME $VER"

case "$VER" in
  0.4*) [ "$FORCE" = 1 ] || { echo "⛔ REFUSING: $VER is a protected 0.4.x (production) install. Use --force only if you really mean it." >&2; exit 3; } ;;
esac

if [ "$YES" != 1 ]; then
  printf 'Remove %s %s from %s? [y/N]: ' "$APP_NAME" "$VER" "$HOST"
  read -r ans </dev/tty 2>/dev/null || ans=""
  case "${ans:-n}" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac
fi

# Reverse the host-role install (user-level only).
ssh_t 'bash -s' <<'REMOTE'
  set -u
  U="$(id -u)"
  for L in com.x10lab.remote-pair-host com.x10lab.remote-pair-host-watchdog \
           com.ghyeong.remote-pair-host com.ghyeong.remote-pair-host-watchdog \
           com.x10lab.remote-pair com.x10lab.remote-pair-watchdog \
           com.x10lab.auto-approve com.ghyeong.auto-approve; do
    launchctl bootout "gui/$U/$L" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$L.plist" 2>/dev/null || true
  done
  pkill -f "RemotePairHost" 2>/dev/null || true
  pkill -f "tmux-aqua"      2>/dev/null || true
  rm -rf "$HOME/Applications/RemotePairHost.app" 2>/dev/null || true
  rm -f  "$HOME/.remote-pair/host.env" 2>/dev/null || true
  rm -rf "$HOME/.cache/remote-pair" 2>/dev/null || true
  if [ -d /Applications/RemotePairHost.app ]; then
    echo "⚠︎ /Applications/RemotePairHost.app needs admin to remove — left in place (run 'sudo rm -rf' on that Mac if intended)."
  fi
  echo "removed user-level RemotePairHost (app/agents/config)"
REMOTE

echo "✅ uninstalled $APP_NAME from $HOST. Re-run 'remote-pair install-host --host $HOST' to reinstall."
