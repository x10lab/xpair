#!/bin/bash
# uninstall.sh — reverts every action install.sh performed, in reverse manifest order.
#
#   Delete created files · restore backups · remove gitignore lines · LaunchAgent bootout+delete · remove git remote.
#   * Does NOT touch ~/.claude/.git itself or user data (skills/settings/memory) — data protection.
#
# Usage:  ./uninstall.sh           (revert every installed role manifest in reverse order)
#         ./uninstall.sh --purge   (the above + delete the ~/.xpair/host namespace too)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

PURGE=0; for a in "$@"; do [ "$a" = "--purge" ] && PURGE=1; done

# Collect every installed role manifest (.manifest-host/client/both + legacy .install-manifest)
shopt -s nullglob 2>/dev/null || true
mans=("$RP_DIR"/.manifest-* "$RP_DIR/.install-manifest")
found=0
for m in "${mans[@]}"; do
  [ -f "$m" ] || continue
  found=1
  say "Removing: $(basename "$m") (reverse-order revert)"
  MANIFEST="$m"; manifest_revert
  rm -f "$m"
done
[ "$found" = 0 ] && { say "No installed manifest found ($RP_DIR) — already removed."; }

if [ "$PURGE" = 1 ]; then
  say "--purge: deleting $RP_DIR"; rm -rf "$RP_DIR"
else
  # notify.conf is intentionally preserved here alongside *.env files and backups.
  # It holds user-edited ENABLED_TYPES and must survive non-purge uninstall/reinstall
  # cycles (install.sh stash/restore keeps user edits, but the manifest 'create only
  # if absent' guard means notify.conf is NOT re-recorded on reinstall, so uninstall
  # would otherwise leak it). Matching this comment to that behavior makes it explicit.
  say "Done. (config(common/host/client).env·notify.conf·backups under $RP_DIR are kept — use --purge for full deletion)"
fi
say "(~/.claude/.git and user settings are preserved)"
