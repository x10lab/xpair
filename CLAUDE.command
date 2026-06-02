#!/bin/bash
set -e
if [ "$(hostname -s)" != "gh-mac-m4" ]; then
  printf 'CLAUDE.command is locked to gh-mac-m4 (current host: %s)\n' "$(hostname -s)" >&2
  read -n1 -s -r -p "press any key to close" _ || true
  exit 1
fi
cd "$(dirname "$0")"
exec "$HOME/.claude/bin/claude-iterm-launch" "$PWD"
