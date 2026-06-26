#!/usr/bin/env bash
# check-screen-protocol.sh — verify host/rd/ + client/ide/ implement the screen-protocol SoT.
# Presence/equality checks of the canonical constants in both implementations.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
C="$HERE/constants.json"
command -v jq >/dev/null || { echo "jq required"; exit 2; }

MAIN="$ROOT/host/rd/screen/src/main.rs"
EXT="$ROOT/client/ide/remotepair/ext/extension.js"
RDJS="$ROOT/client/ide/remotepair/ext/media/remote-desktop.js"

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
REMOTE_INPUT=$(jq -r .remoteInput.supported "$C")

# --- rs main.rs: default ports (clap args) ---
have "rs main.rs v1a port = $PORT_V1A" "$MAIN" "default_value_t = $PORT_V1A"
have "rs main.rs v2 signal port = $PORT_V2" "$MAIN" "default_value_t = $PORT_V2"

# --- ide consumes the SoT via build-time generated contracts (self-contained) ---
GEN="$ROOT/client/ide/remotepair/ext/generated/contracts.json"
have "ext requires generated contracts" "$EXT" 'require\("\./generated/contracts\.json"\)'
if [[ -f "$GEN" ]]; then
  eq "generated v1aPort"        "$PORT_V1A" "$(jq -r .screen.v1aPort "$GEN")"
  eq "generated v2SignalPort"   "$PORT_V2"  "$(jq -r .screen.v2SignalPort "$GEN")"
  eq "generated remoteInputSupported" "$REMOTE_INPUT" "$(jq -r .screen.remoteInputSupported "$GEN")"
else
  printf 'MISS: %-46s (run generate-contracts.mjs)\n' "generated/contracts.json present"; fail=1
fi

# --- ide webview: Remote Desktop supports authenticated remote input ---
have "remote-desktop.js recvonly video" "$RDJS" 'addTransceiver\("video", \{ direction: "recvonly" \}\)'
have "remote-desktop.js receives DataChannels" "$RDJS" 'ondatachannel = function'
have "remote-desktop.js creates rp-ctl" "$RDJS" 'createDataChannel\("rp-ctl"\)'
have "remote-desktop.js creates rp-move" "$RDJS" 'createDataChannel\("rp-move"\)'
have "remote-desktop.js captures pointerdown" "$RDJS" 'addEventListener\("pointerdown"'
have "remote-desktop.js captures pointermove" "$RDJS" 'addEventListener\("pointermove"'
have "remote-desktop.js captures pointerup" "$RDJS" 'addEventListener\("pointerup"'
have "remote-desktop.js captures wheel" "$RDJS" 'addEventListener\("wheel"'
have "remote-desktop.js captures keydown" "$RDJS" 'addEventListener\("keydown"'
have "remote-desktop.js captures keyup" "$RDJS" 'addEventListener\("keyup"'
have "remote-desktop.js captures compositionend" "$RDJS" 'addEventListener\("compositionend"'
have "remote-desktop.js captures beforeinput" "$RDJS" 'addEventListener\("beforeinput"'
have "remote-desktop.js sends pointer down" "$RDJS" 't:[[:space:]]*["'\'']d["'\'']'
have "remote-desktop.js sends pointer up" "$RDJS" 't:[[:space:]]*["'\'']u["'\'']'
have "remote-desktop.js sends pointer move" "$RDJS" 't:[[:space:]]*["'\'']m["'\'']'
have "remote-desktop.js sends wheel" "$RDJS" 't:[[:space:]]*["'\'']w["'\'']'
have "remote-desktop.js sends key" "$RDJS" 't:[[:space:]]*["'\'']k["'\'']'
have "remote-desktop.js sends text" "$RDJS" 't:[[:space:]]*["'\'']x["'\'']'
have "remote-desktop.js gates badge on input-ready" "$RDJS" 'input-ready'

# --- ide webview: message vocabulary ---
for m in $(jq -r '.webviewToExtMessages[]' "$C"); do
  have "remote-desktop.js msg '$m'" "$RDJS" "\"$m\""
done
if [[ $fail -eq 0 ]]; then echo "✓ screen-protocol SoT: host/rd/ + client/ide/ aligned"; else echo "✗ screen-protocol drift detected"; exit 1; fi
