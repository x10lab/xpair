#!/usr/bin/env bash
# check-onboarding.sh — verify both onboarding UIs match the shared/onboarding/ model.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
S="$HERE/steps.json"
command -v jq >/dev/null || { echo "jq required"; exit 2; }

APP="$ROOT/client/web/app.js"
PKG="$ROOT/ide/remotepair-ext/package.json"
MEDIA="$ROOT/ide/remotepair-ext/media"

fail=0
have() { if [[ -f "$2" ]] && grep -qE "$3" "$2"; then printf 'ok:  %-44s\n' "$1"; else printf 'MISS: %-44s (%s)\n' "$1" "$3"; fail=1; fi; }
exists() { if [[ -f "$2" ]]; then printf 'ok:  %-44s\n' "$1"; else printf 'MISS: %-44s (no %s)\n' "$1" "$2"; fail=1; fi; }

# --- web wizard step ids present in app.js buildSteps ---
for s in $(jq -r '.concepts[].web[]?' "$S" | sort -u); do
  have "web step '$s' in app.js" "$APP" "id: \"$s\""
done

# --- IDE walkthrough container id ---
WID=$(jq -r .ideWalkthroughId "$S")
have "ide walkthrough '$WID' in package.json" "$PKG" "\"$WID\""

# --- IDE walkthrough steps registered + md present ---
for w in $(jq -r '.concepts[].ideWalkthrough | select(. != null)' "$S"); do
  have "ide step '$WID.$w' registered" "$PKG" "$WID\\.$w"
  exists "walkthrough-$w.md present" "$MEDIA/walkthrough-$w.md"
done

if [[ $fail -eq 0 ]]; then echo "✓ onboarding SoT: web wizard + IDE walkthroughs aligned"; else echo "✗ onboarding drift detected"; exit 1; fi
