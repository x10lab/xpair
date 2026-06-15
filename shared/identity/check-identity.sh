#!/usr/bin/env bash
# check-identity.sh — verify all consumers match the shared/identity/ SoT.
# Non-breaking: reads identity.json + versions.json and asserts that
# ide/product.json, Casks/remote-pair-host.rb, rs Cargo.toml, and host Swift
# carry the canonical brand/version values. Exits non-zero on drift.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ID="$HERE/identity.json"
VER="$HERE/versions.json"

command -v jq >/dev/null || { echo "jq required"; exit 2; }

fail=0
check() { # desc expected actual
  if [[ "$2" != "$3" ]]; then
    printf 'MISMATCH: %-40s SoT=%q actual=%q\n' "$1" "$2" "$3"; fail=1
  else
    printf 'ok: %-40s = %s\n' "$1" "$2"
  fi
}

# --- ide/product.json brand fields + version ---
PJ="$ROOT/ide/product.json"
if [[ -f "$PJ" ]]; then
  for k in nameShort nameLong applicationName dataFolderName darwinBundleIdentifier \
           urlProtocol serverApplicationName serverDataFolderName win32AppUserModelId win32MutexName; do
    check "ide/product.json:$k" "$(jq -r ".components.ide.$k" "$ID")" "$(jq -r ".$k // empty" "$PJ")"
  done
else
  echo "skip: ide/product.json not found"
fi

# ide version lives in the committed RemotePair extension (product.json has none;
# the app version is injected at build from RELEASE_VERSION).
EXT_PKG="$ROOT/ide/remotepair-ext/package.json"
[[ -f "$EXT_PKG" ]] && check "ide version (remotepair-ext)" "$(jq -r .ide "$VER")" "$(jq -r '.version // empty' "$EXT_PKG")"

# --- Casks/remote-pair-host.rb version ---
CASK="$ROOT/Casks/remote-pair-host.rb"
[[ -f "$CASK" ]] && check "Casks host version" "$(jq -r .host "$VER")" \
  "$(grep -E '^[[:space:]]*version "' "$CASK" | head -1 | sed -E 's/.*version "([^"]+)".*/\1/')"

# --- rs Cargo.toml version ---
CARGO="$ROOT/rs/remote-pair-screen/Cargo.toml"
[[ -f "$CARGO" ]] && check "rs screen-engine version" "$(jq -r '."screen-engine"' "$VER")" \
  "$(awk -F'"' '/^\[package\]/{p=1} p&&/^version[[:space:]]*=/{print $2; exit}' "$CARGO")"

# --- host bundle id present in Config.swift ---
CFG="$ROOT/host/RemotePairHost/Config.swift"
EXP_BID="$(jq -r .components.host.bundleId "$ID")"
if [[ -f "$CFG" ]]; then
  if grep -q "$EXP_BID" "$CFG"; then printf 'ok: %-40s = %s\n' "host bundleId in Config.swift" "$EXP_BID"
  else printf 'MISMATCH: %-40s %q not found\n' "host bundleId in Config.swift" "$EXP_BID"; fail=1; fi
fi

if [[ $fail -eq 0 ]]; then echo "✓ identity SoT: all consumers aligned"; else echo "✗ identity drift detected"; exit 1; fi
