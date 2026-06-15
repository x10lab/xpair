#!/usr/bin/env bash
# Inside-out re-sign of a LOCALLY-built RemotePair IDE app with a self-signed identity +
# hardened runtime + JIT entitlements, so the Electron app actually launches.
#
# Why: the gulp build produces an adhoc/linker signature; launching it with V8 JIT under a
# hardened runtime needs com.apple.security.cs.allow-jit (+ disable-library-validation for a
# self-signed/no-Team-ID identity). `codesign --deep` STRIPS entitlements, so we sign inside-out:
# nested dylibs/.node → frameworks → helper apps (with entitlements) → main app (with entitlements).
#
# Usage:  local-sign.sh <path-to-.app>     (identity via RP_SIGN_IDENTITY, default below)
# NOT for release — release signing is done in CI with a Developer ID cert.
set -e

APP="${1:?usage: local-sign.sh <path-to-.app>}"
[ -d "$APP" ] || { echo "local-sign: not an app bundle: $APP" >&2; exit 1; }
IDENTITY="${RP_SIGN_IDENTITY:-RemotePair Local Signing}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENT="$HERE/local.entitlements.plist"
FW="$APP/Contents/Frameworks"

if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  echo "local-sign: signing identity '$IDENTITY' not in keychain — skipping re-sign." >&2
  echo "            (create one with host/make-signing-cert.sh, or set RP_SIGN_IDENTITY.)" >&2
  exit 0
fi

sign()     { codesign --force --timestamp=none --options runtime -s "$IDENTITY" "$@"; }
sign_ent() { codesign --force --timestamp=none --options runtime --entitlements "$ENT" -s "$IDENTITY" "$@"; }

echo "local-sign: $APP  (identity: $IDENTITY)"

# 1) deepest first: nested dylibs / native node addons
find "$APP" -type f \( -name '*.dylib' -o -name '*.node' \) -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do sign "$f" 2>/dev/null || true; done
[ -e "$FW/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler" ] \
  && sign "$FW/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler"
[ -e "$FW/Squirrel.framework/Versions/A/Resources/ShipIt" ] \
  && sign "$FW/Squirrel.framework/Versions/A/Resources/ShipIt"

# 2) frameworks
for fwk in "Electron Framework" Mantle ReactiveObjC Squirrel; do
  [ -d "$FW/$fwk.framework" ] && sign "$FW/$fwk.framework"
done

# 3) helper apps (name varies with product nameShort → glob; each needs the JIT entitlements)
shopt -s nullglob
for h in "$FW"/*\ Helper*.app; do
  [ -d "$h" ] && sign_ent "$h"
done
shopt -u nullglob

# 4) main app
sign_ent "$APP"

# 5) verify
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -1
jit=$(codesign -d --entitlements :- "$APP" 2>/dev/null | grep -c allow-jit || true)
echo "local-sign: done (allow-jit present: $jit)"
