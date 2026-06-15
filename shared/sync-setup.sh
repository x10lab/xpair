#!/bin/bash
# sync-setup.sh — Turns ~/.claude into a git backbone so two machines share the agent identity.
#   - Sets the provided GitHub URL as origin (kept as-is if already set)
#   - Checks local auth (ssh / https); if it fails, gives guidance (gh auth login / SSH key)
#   - Verifies GitHub auth on the remote (REMOTE_HOST) machine — if unauthenticated, explains what to do on that machine
#
# Can be called from the config environment that install.sh sources, or run standalone.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"
. "$HERE/lib.sh"
[ -f "$MANIFEST" ] || manifest_init   # in case of standalone run

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }

# Whether git auth is possible (per URL type)
auth_ok() { # $1=url  $2=host (for ssh test, optional)
  local url="$1"
  case "$url" in
    git@*|ssh://*)
      local h; h="$(printf '%s' "$url" | sed -E 's#^(ssh://)?git@([^:/]+).*#\2#')"
      ssh -o BatchMode=yes -o ConnectTimeout=5 -T "git@$h" 2>&1 | grep -qiE 'success|authenticat' ;;
    https://*)
      git ls-remote "$url" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# ── 1. Collect URL ──
SYNC_URL="${SYNC_URL:-}"
if [ -z "$SYNC_URL" ]; then
  if [ -d "$CLAUDE_DIR/.git" ] && git -C "$CLAUDE_DIR" remote get-url origin >/dev/null 2>&1; then
    SYNC_URL="$(git -C "$CLAUDE_DIR" remote get-url origin)"
    say "Using existing origin: $SYNC_URL"
  elif [ -t 0 ]; then
    read -r -p "GitHub repo URL for ~/.claude sync (leave empty to skip sync): " SYNC_URL || true
  fi
fi
[ -z "$SYNC_URL" ] && { warn "No sync URL — skipping git backbone setup."; exit 0; }

# ── 2. Local repo + origin ──
if [ ! -d "$CLAUDE_DIR/.git" ]; then
  say "git init → $CLAUDE_DIR"
  ( cd "$CLAUDE_DIR" && git init -q -b main )
  record NOTE "git init $CLAUDE_DIR (uninstall does not delete .git — protects data)"
fi
cd "$CLAUDE_DIR"
if git remote get-url origin >/dev/null 2>&1; then
  [ "$(git remote get-url origin)" = "$SYNC_URL" ] || warn "origin already differs: $(git remote get-url origin) (kept)"
else
  git remote add origin "$SYNC_URL"
  record GITREMOTE origin
  say "Added origin: $SYNC_URL"
fi

# ── 3. Local auth ──
if auth_ok "$SYNC_URL"; then
  say "Local GitHub auth OK"
  git fetch -q origin 2>/dev/null || true
else
  warn "Local GitHub auth failed — do one of the following, then push again:"
  case "$SYNC_URL" in
    git@*|ssh://*) printf '   • Register SSH key:  ssh-keygen -t ed25519 → add ~/.ssh/id_ed25519.pub under GitHub Settings→SSH keys\n' ;;
    https://*)     printf '   • gh auth login   (or store a PAT in the git credential helper)\n' ;;
  esac
fi

# ── 4. Remote machine auth check (REMOTE_HOST) ──
if [ -n "${REMOTE_HOST:-}" ]; then
  say "Checking GitHub auth on remote ($REMOTE_HOST)"
  if ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE_HOST" "git ls-remote '$SYNC_URL' >/dev/null 2>&1"; then
    say "  Remote auth OK — that machine can pull/push the same repo too"
  else
    warn "  GitHub auth failed on remote ($REMOTE_HOST). ssh into that machine and run:"
    case "$SYNC_URL" in
      git@*|ssh://*) printf '     ssh %s\n     ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519\n     # add the printed ~/.ssh/id_ed25519.pub under GitHub→SSH keys\n' "$REMOTE_HOST" ;;
      https://*)     printf '     ssh %s\n     gh auth login   # or store a PAT\n' "$REMOTE_HOST" ;;
    esac
    printf '     then:  ssh %s "cd ~/.claude && git pull --rebase origin main"\n' "$REMOTE_HOST"
  fi
fi
say "sync backbone setup complete"
