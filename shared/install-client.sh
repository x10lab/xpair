#!/bin/bash
# install-client.sh — install the Xpair client app WITHOUT Homebrew.
#
# Same end state as `brew install --cask xpair`: download the (self-signed) Xpair.app from the latest
# release and strip the Gatekeeper quarantine so it launches. Homebrew users get the quarantine strip
# from the cask's postflight (Casks/xpair.rb); this is the no-Homebrew equivalent — pure curl + xattr.
#
#   curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/install-client.sh | bash
#
# After it installs, open Xpair — first-run onboarding does the rest (CLI, SSH, engine, host app).
set -euo pipefail

REPO=x10lab/xpair
APP=Xpair.app

[ "$(uname -s)" = Darwin ] || { echo "✗ macOS only" >&2; exit 1; }
[ "$(uname -m)" = arm64 ]  || { echo "✗ Xpair ships arm64-only (Apple Silicon)" >&2; exit 1; }

# Releases are alpha pre-releases, so github.com/.../releases/latest 404s (it excludes pre-releases).
# Resolve the newest release tag via the API instead, then pull its stable-named Xpair.zip asset.
tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" \
        | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$tag" ] || { echo "✗ could not resolve the latest Xpair release tag" >&2; exit 1; }

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
[ -d "$DEST/$APP" ] && rm -rf "$DEST/$APP"
/usr/bin/ditto -x -k "$tmp/Xpair.zip" "$DEST"
[ -d "$DEST/$APP" ] || { echo "✗ extraction did not produce $DEST/$APP" >&2; exit 1; }

# Strip the Gatekeeper quarantine so the self-signed app opens without the "unidentified developer"
# block — exactly what the Homebrew cask does in its postflight (brew's --no-quarantine equivalent).
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "✓ installed: $DEST/$APP ($tag)"
echo "  open it — first-run onboarding installs the CLI, wires SSH, and sets up the host."
