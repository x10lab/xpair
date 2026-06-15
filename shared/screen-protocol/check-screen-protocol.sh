#!/usr/bin/env bash
# check-screen-protocol.sh — verify rs/ + ide/ implement the screen-protocol SoT.
# Presence/equality checks of the canonical constants in both implementations.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
C="$HERE/constants.json"
command -v jq >/dev/null || { echo "jq required"; exit 2; }

MAIN="$ROOT/rs/remote-pair-screen/src/main.rs"
EXT="$ROOT/ide/remotepair-ext/extension.js"
RDJS="$ROOT/ide/remotepair-ext/media/remote-desktop.js"

fail=0
have() { # desc file pattern
  if [[ -f "$2" ]] && grep -qE "$3" "$2"; then printf 'ok:  %-46s\n' "$1"
  else printf 'MISS: %-46s (%s)\n' "$1" "${3}"; fail=1; fi
}
eq() { # desc expected actual
  if [[ "$2" == "$3" ]]; then printf 'ok:  %-46s = %s\n' "$1" "$2"
  else printf 'MISS: %-46s SoT=%q gen=%q\n' "$1" "$2" "$3"; fail=1; fi
}

PORT_V1A=$(jq -r .transport.v1a_jpeg.defaultPort "$C")
PORT_V2=$(jq -r .transport.v2_webrtc.defaultSignalPort "$C")
REQ=$(jq -r .input.reqFile "$C")
RES=$(jq -r .input.resFile "$C")
THROTTLE=$(jq -r .input.throttleMs "$C")

# --- rs main.rs: default ports (clap args) ---
have "rs main.rs v1a port = $PORT_V1A" "$MAIN" "default_value_t = $PORT_V1A"
have "rs main.rs v2 signal port = $PORT_V2" "$MAIN" "default_value_t = $PORT_V2"

# --- ide consumes the SoT via build-time generated contracts (self-contained) ---
GEN="$ROOT/ide/remotepair-ext/generated/contracts.json"
have "ext requires generated contracts" "$EXT" 'require\("\./generated/contracts\.json"\)'
if [[ -f "$GEN" ]]; then
  eq "generated v1aPort"        "$PORT_V1A" "$(jq -r .screen.v1aPort "$GEN")"
  eq "generated v2SignalPort"   "$PORT_V2"  "$(jq -r .screen.v2SignalPort "$GEN")"
  eq "generated inputThrottleMs" "$THROTTLE" "$(jq -r .screen.inputThrottleMs "$GEN")"
  eq "generated reqFile"        "$REQ"      "$(jq -r .screen.reqFile "$GEN")"
  eq "generated resFile"        "$RES"      "$(jq -r .screen.resFile "$GEN")"
else
  printf 'MISS: %-46s (run generate-contracts.mjs)\n' "generated/contracts.json present"; fail=1
fi

# --- ide extension: InputServer verbs present (wire form `<verb>\t` — doc + send sites) ---
for v in $(jq -r '.input.verbs | keys[]' "$C"); do
  have "ext references verb '$v' (\\t-form)" "$EXT" "$v\\\\t"
done

# --- ide webview: message vocabulary ---
for m in $(jq -r '.webviewToExtMessages[]' "$C"); do
  have "remote-desktop.js msg '$m'" "$RDJS" "\"$m\""
done

if [[ $fail -eq 0 ]]; then echo "✓ screen-protocol SoT: rs/ + ide/ aligned"; else echo "✗ screen-protocol drift detected"; exit 1; fi
