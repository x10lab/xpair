#!/bin/bash
# install-client.sh — install the Xpair client app WITHOUT Homebrew.
#
# Same end state as `brew install --cask xpair`: download the (self-signed) Xpair.app from the latest
# release and strip the Gatekeeper quarantine so it launches. Homebrew users get the quarantine strip
# from the cask's postflight (Casks/xpair.rb); this is the no-Homebrew equivalent — pure curl + xattr.
#
#   curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/install-client.sh | bash
#
# By default it installs the latest STABLE release. To install the latest alpha
# pre-release (Xpair currently ships only 0.5.0aN pre-releases), pass --prerelease:
#   curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/install-client.sh | bash -s -- --prerelease
#
# After it installs, open Xpair — first-run onboarding does the rest (CLI, SSH, engine, host app).
set -euo pipefail

REPO=x10lab/xpair
APP=Xpair.app

PRERELEASE=0
for arg in "$@"; do
  case "$arg" in
    --prerelease|--pre) PRERELEASE=1 ;;
    -h|--help) echo "usage: install-client.sh [--prerelease]"; exit 0 ;;
    *) echo "✗ unknown argument: $arg (use --prerelease)" >&2; exit 2 ;;
  esac
done

[ "$(uname -s)" = Darwin ] || { echo "✗ macOS only" >&2; exit 1; }
[ "$(uname -m)" = arm64 ]  || { echo "✗ Xpair ships arm64-only (Apple Silicon)" >&2; exit 1; }

# Resolve the release tag, then pull its stable-named Xpair.zip asset.
#  - default: latest STABLE release via /releases/latest (this endpoint EXCLUDES pre-releases).
#  - --prerelease, OR no stable release exists yet: newest release via /releases?per_page=1
#    (this list INCLUDES alpha pre-releases). Xpair currently ships only 0.5.0aN pre-releases,
#    so a bare run falls back to the newest pre-release with a notice until a stable is cut.
api="https://api.github.com/repos/$REPO"
parse_tag() { sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1; }
tag=""
if [ "$PRERELEASE" = 0 ]; then
  tag="$(curl -fsSL "$api/releases/latest" 2>/dev/null | parse_tag || true)"
  [ -n "$tag" ] && echo "→ installing the latest STABLE release ($tag); pass --prerelease for the newest alpha build" >&2
fi
if [ -z "$tag" ]; then
  tag="$(curl -fsSL "$api/releases?per_page=1" | parse_tag)"
  [ "$PRERELEASE" = 0 ] && [ -n "$tag" ] && \
    echo "→ no stable release yet — installing the latest pre-release ($tag); pass --prerelease to silence this" >&2
fi
[ -n "$tag" ] || { echo "✗ could not resolve a Xpair release tag" >&2; exit 1; }

# Install to /Applications, where the cask puts it. It is group-writable by `admin`, so an admin account
# (the macOS default) installs with NO sudo — same as `brew install --cask` or a drag-install. A standard
# (non-admin) account can't write /Applications for ANY app; that's a macOS rule, not ours, so fail fast
# with a clear message instead of escalating or dropping the app somewhere unexpected.
DEST=/Applications
[ -w "$DEST" ] || { echo "✗ $DEST isn't writable — installing an app there needs an admin account (no sudo required on one). Run this as an admin user, or drag Xpair.app in by hand." >&2; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "→ downloading Xpair $tag …"
curl -fsSL -o "$tmp/Xpair.zip" "https://github.com/$REPO/releases/download/$tag/Xpair.zip"

# Release zips are made with `ditto -c -k --keepParent`, so extract with ditto (preserves the bundle).
[ -d "${DEST:?}/${APP:?}" ] && rm -rf "${DEST:?}/${APP:?}"
/usr/bin/ditto -x -k "$tmp/Xpair.zip" "$DEST"
[ -d "$DEST/$APP" ] || { echo "✗ extraction did not produce $DEST/$APP" >&2; exit 1; }

# Strip the Gatekeeper quarantine so the self-signed app opens without the "unidentified developer"
# block — exactly what the Homebrew cask does in its postflight (brew's --no-quarantine equivalent).
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "✓ installed: $DEST/$APP ($tag)"
echo "  open it — first-run onboarding installs the CLI, wires SSH, and sets up the host."
