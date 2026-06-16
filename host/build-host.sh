#!/bin/bash
# build-host.sh — build RemotePairHost.app (menu-bar host: tmux host + approve + session management + updater)
#
# Compiles the per-responsibility .swift files in one shot (zero package dependencies). Embeds the helpers (tmux-aqua, router, ocr-find) in the bundle.
# Signing: stable self-signed cert "RemotePair Local Signing" → the TCC grant is bound to the designated requirement
#   so it survives rebuilds/updates. Without the cert, falls back to ad-hoc (re-toggle on every rebuild). Generate it with: ./make-signing-cert.sh
#
# Usage:
#   ./build-host.sh                 # build/RemotePairHost.app build+sign+verify
#   ./build-host.sh --deploy [host] # above + rsync → remote (default REMOTE_HOST or gh-mac-m1) → install.sh --role host
#   ./build-host.sh --release       # above + signed-app zip → gh release create v<version>
set -euo pipefail
cd "$(dirname "$0")/.."                       # repo root
. shared/config.sh                            # SSOT: APP_NAME·BUNDLE_PREFIX·SIGN_CN·GH_REPO

VERSION="${RP_VERSION:-0.5.0}"                # single source of truth for the version (baked into Info.plist). Release tag = v$VERSION. (pre-1.0, patch +0.0.1)
SRC_DIR=host/app
APP="build/${APP_NAME}.app"
EXEC="$APP_NAME"
DEPLOY_HOST="${REMOTE_HOST:-gh-mac-m1}"

# ── signing identity ──
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_CN"; then
  SIGN_ID="$SIGN_CN"; echo "signing: stable cert '$SIGN_CN' (grant survives rebuilds/updates)"
else
  SIGN_ID="-"; echo "⚠ signing: ad-hoc (cert '$SIGN_CN' missing → re-toggle on every rebuild). ./host/make-signing-cert.sh recommended"
fi

# ── ③ PAKE staticlib (Rust libpake) — linked into the host for PairingServer.swift ──
# Crypto (SPAKE2) lives in host/rd/pake; Swift links the C-ABI staticlib (pake-bridge.h).
# The P agent's `cargo build --release -p pake` produces target/release/libpake.a; if it is
# not present yet we build it here so the host build is self-contained.
export PATH="$HOME/.cargo/bin:$PATH"
PAKE_MANIFEST=host/rd/pake/Cargo.toml
PAKE_LIB=host/rd/pake/target/release/libpake.a
if [ ! -f "$PAKE_LIB" ]; then
  echo "=== build PAKE staticlib (cargo build --release -p pake) ==="
  command -v cargo >/dev/null || { echo "✗ cargo missing — Rust toolchain required for the PAKE staticlib" >&2; exit 1; }
  cargo build --release --manifest-path "$PAKE_MANIFEST" \
    || { echo "✗ pake staticlib cargo build failed" >&2; exit 1; }
fi
[ -f "$PAKE_LIB" ] || { echo "✗ libpake.a missing after cargo build: $PAKE_LIB" >&2; exit 1; }
PAKE_BRIDGE="$SRC_DIR/pake-bridge.h"
# Link flags shared by both compile attempts: import the C ABI header + link the staticlib.
PAKE_FLAGS=(-import-objc-header "$PAKE_BRIDGE" -L "$(dirname "$PAKE_LIB")" -lpake)

# ── SDK selection (fall back to 14.x when the CLT + new-SDK combination breaks) ──
compile() { # $1=out
  local out="$1" sdk
  # 1) try the default toolchain
  if xcrun swiftc -O "$SRC_DIR"/*.swift "${PAKE_FLAGS[@]}" -o "$out" 2>/tmp/rp-swiftc.err; then return 0; fi
  # 2) fallback: probe for a compatible SDK (avoid the Swift 5.10 CLT + MacOSX15 swiftinterface mismatch)
  for sdk in /Library/Developer/CommandLineTools/SDKs/MacOSX14.5.sdk \
             /Library/Developer/CommandLineTools/SDKs/MacOSX14.sdk \
             /Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk; do
    [ -d "$sdk" ] || continue
    echo "  (default compile failed → SDK fallback: $(basename "$sdk"))"
    if xcrun swiftc -O -sdk "$sdk" -target arm64-apple-macos13.0 "$SRC_DIR"/*.swift "${PAKE_FLAGS[@]}" -o "$out" 2>/tmp/rp-swiftc.err; then return 0; fi
  done
  echo "✗ Swift compile failed:"; cat /tmp/rp-swiftc.err >&2; return 1
}

echo "=== compile (Swift, multi-file) ==="
mkdir -p build
compile "build/$EXEC"
xcrun swiftc -O host/ocr-find.swift -o host/ocr-find 2>/dev/null \
  || xcrun swiftc -O -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX14.5.sdk -target arm64-apple-macos13.0 host/ocr-find.swift -o host/ocr-find

echo "=== bundle ==="
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS"
mv "build/$EXEC" "$APP/Contents/MacOS/$EXEC"
cat > "$APP/Contents/Info.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${APP_NAME}</string>
<key>CFBundleDisplayName</key><string>${APP_NAME}</string>
<key>CFBundleIdentifier</key><string>${BUNDLE_PREFIX}</string>
<key>CFBundleExecutable</key><string>${EXEC}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${VERSION}</string>
<key>CFBundleShortVersionString</key><string>${VERSION}</string>
<key>RPGitHubRepo</key><string>${GH_REPO}</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSBonjourServices</key><array><string>_remotepair._tcp</string></array>
<key>NSLocalNetworkUsageDescription</key><string>RemotePair advertises this Mac on your local network so your RemotePair client can discover and pair with it.</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleIconName</key><string>AppIcon</string>
</dict></plist>
P

echo "=== embed helpers → Contents/Helpers ==="
HELP="$APP/Contents/Helpers"; mkdir -p "$HELP"
cp host/remote-pair-approve-router.sh "$HELP/"; chmod +x "$HELP/remote-pair-approve-router.sh"
cp host/ocr-find "$HELP/"; chmod +x "$HELP/ocr-find"
# cliclick = the app's click/key primitive injector. Embedded in the bundle (self-contained). If missing, falls back to the homebrew path at runtime.
if [ -x /opt/homebrew/bin/cliclick ]; then cp /opt/homebrew/bin/cliclick "$HELP/cliclick"; chmod +x "$HELP/cliclick"; echo "  embedded: cliclick"; fi
# tmux-aqua is the heart of the host (the keeper server = parent of every session). The cask installs only the .app, so
# the runtime ~/.local/bin fallback does not exist → if it is missing from the bundle, the host ships dead (zero sessions).
# So instead of "warn and pass through if missing": if missing, try to build it → if still missing, HARD-FAIL.
if [ ! -x "$HOME/.local/bin/tmux-aqua" ]; then
  echo "  tmux-aqua missing (~/.local/bin) → auto-running ./host/build-tmux-aqua.sh ..."
  ./host/build-tmux-aqua.sh || { echo "✗ tmux-aqua build failed — run ./host/build-tmux-aqua.sh manually and retry" >&2; exit 1; }
fi
[ -x "$HOME/.local/bin/tmux-aqua" ] || { echo "✗ tmux-aqua still missing — cannot bundle (without the helper the cask host is wiped out: zero sessions)" >&2; exit 1; }
cp "$HOME/.local/bin/tmux-aqua" "$HELP/tmux-aqua"; chmod +x "$HELP/tmux-aqua"
# Final check that it actually made it into the bundle — block a broken bundle from leaking into release/cask at the source.
[ -x "$HELP/tmux-aqua" ] || { echo "✗ tmux-aqua bundle embed verification failed: $HELP/tmux-aqua" >&2; exit 1; }
echo "  embedded: tmux-aqua ($("$HELP/tmux-aqua" -V 2>/dev/null || echo '?')) + remote-pair-approve-router.sh + ocr-find"

# ── the 3 screenshare binaries (screen sidecar + rp-screencap/rp-input-inject helpers) → Contents/Helpers ──
# Since the SSH deploy channel was retired, this bundle is the only delivery path for the three binaries.
#   • screen           v1 (JPEG/WS) + v2 (WebRTC/H.264) sidecar. v2 requires --features webrtc.
#   • rp-screencap     SCK+VT H.264 capture (Screen Recording permission)
#   • rp-input-inject  remote keyboard/cursor injection (Accessibility permission)
# All three are individually inside-out signed with the stable cert (below) so the TCC grant is bound to the designated requirement
# and survives .app updates. The resolver (serve_webrtc.rs) probes the current_exe() sibling path first, so
# when screen starts from Helpers/ it auto-discovers the sibling rp-screencap/rp-input-inject.
echo "=== build + embed screenshare binaries (screen + rp-screencap + rp-input-inject) ==="
# Ensure cargo (+rustc): the rustup shell may not have put the toolchain on PATH, so put ~/.cargo/bin first.
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || { echo "✗ cargo missing — Rust toolchain required (rustup). Cannot build the screen sidecar." >&2; exit 1; }
SCREEN_MANIFEST="host/rd/screen/Cargo.toml"
echo "  cargo build --release --features webrtc ($SCREEN_MANIFEST) …"
cargo build --release --features webrtc --manifest-path "$SCREEN_MANIFEST" \
  || { echo "✗ screen sidecar cargo build failed (--features webrtc)" >&2; exit 1; }
cp host/rd/screen/target/release/screen "$HELP/screen"; chmod +x "$HELP/screen"
[ -x "$HELP/screen" ] || { echo "✗ screen bundle embed verification failed: $HELP/screen" >&2; exit 1; }
# Confirm the v2 path (serve-webrtc subcommand) actually made it in — if the webrtc feature is missing, v2 silently disappears.
"$HELP/screen" serve-webrtc --help >/dev/null 2>&1 \
  || { echo "✗ screen has no serve-webrtc — --features webrtc build failed" >&2; exit 1; }
# rp-screencap / rp-input-inject — single Swift file, same toolchain/fallback strategy as compile().
compile_helper() { # $1=src $2=out
  local src="$1" out="$2" sdk
  if xcrun swiftc -O "$src" -o "$out" 2>/tmp/rp-helper.err; then return 0; fi
  for sdk in /Library/Developer/CommandLineTools/SDKs/MacOSX14.5.sdk \
             /Library/Developer/CommandLineTools/SDKs/MacOSX14.sdk \
             /Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk; do
    [ -d "$sdk" ] || continue
    echo "  (helper default compile failed → SDK fallback: $(basename "$sdk"))"
    if xcrun swiftc -O -sdk "$sdk" -target arm64-apple-macos13.0 "$src" -o "$out" 2>/tmp/rp-helper.err; then return 0; fi
  done
  echo "✗ Swift helper compile failed ($src):"; cat /tmp/rp-helper.err >&2; return 1
}
compile_helper host/rd/rpmedia/rp-screencap.swift    "$HELP/rp-screencap";    chmod +x "$HELP/rp-screencap"
compile_helper host/rd/rpmedia/rp-input-inject.swift "$HELP/rp-input-inject"; chmod +x "$HELP/rp-input-inject"
[ -x "$HELP/rp-screencap" ] && [ -x "$HELP/rp-input-inject" ] \
  || { echo "✗ rp-screencap/rp-input-inject bundle embed verification failed" >&2; exit 1; }
echo "  embedded: screen ($("$HELP/screen" --version 2>/dev/null || echo '?')) + rp-screencap + rp-input-inject"

RES="$APP/Contents/Resources"; mkdir -p "$RES"   # (for the icon; populated below)
# NOTE: keep coupling low — the app bundle holds only what the app uses directly at runtime (Helpers: tmux-aqua·router·ocr-find).
#   skills (the claude harness), rules.txt (approve config), and the CLI are not embedded/self-installed here.
#   That is handled by the single CLI/README install (shared/install.sh).

echo "=== embed app icon + menu-bar template → Contents/Resources ==="
if [ -f assets/icon/AppIcon-1024.png ]; then
  ISET="build/AppIcon.iconset"; rm -rf "$ISET"; mkdir -p "$ISET"
  _gen() { sips -z "$2" "$2" assets/icon/AppIcon-1024.png --out "$ISET/$1" >/dev/null; }
  _gen icon_16x16.png 16;    _gen icon_16x16@2x.png 32
  _gen icon_32x32.png 32;    _gen icon_32x32@2x.png 64
  _gen icon_128x128.png 128; _gen icon_128x128@2x.png 256
  _gen icon_256x256.png 256; _gen icon_256x256@2x.png 512
  _gen icon_512x512.png 512; _gen icon_512x512@2x.png 1024
  iconutil -c icns "$ISET" -o "$RES/AppIcon.icns" && echo "  app icon → Resources/AppIcon.icns (from assets/icon/AppIcon-1024.png)"
elif [ -f assets/icon/AppIcon.icns ]; then
  cp assets/icon/AppIcon.icns "$RES/AppIcon.icns"; echo "  app icon → Resources/AppIcon.icns (prebuilt)"
else
  echo "  ⚠ no app icon (assets/icon/AppIcon-1024.png or .icns) — bundle ships without one"
fi
for f in menubar.png menubar@2x.png; do
  [ -f "assets/icon/$f" ] && cp "assets/icon/$f" "$RES/$f"
done
[ -f "$RES/menubar.png" ] && echo "  menu-bar template → Resources/menubar.png (+@2x)"

# ── signing: inside-out individual signing (Apple-recommended; not reliant on --deep) ──
# --deep is for verification and can miss or mis-sign nested code, destabilizing the TCC designated requirement.
# Sign each Helpers entry individually with the stable cert first (--options runtime for Mach-O), then sign the outer .app.
# Done this way, the Authority of the 3 screenshare binaries (screen·rp-screencap·rp-input-inject) is baked in with the stable cert
# so the Screen Recording / Accessibility grant survives .app updates (designated requirement = cert leaf).
# The shell script (approve-router.sh) must also be signed individually so that --verify --strict passes after the outer non-deep signing.
for bin in "$HELP"/*; do
  [ -f "$bin" ] || continue
  if file -b "$bin" | grep -q 'Mach-O'; then
    codesign -s "$SIGN_ID" --force --options runtime --timestamp=none "$bin" \
      || { echo "✗ Helpers individual signing failed (Mach-O): $bin" >&2; exit 1; }
  else
    # non-Mach-O (shell script): a hardened runtime is meaningless → a plain signature is enough to satisfy the nested seal.
    codesign -s "$SIGN_ID" --force --timestamp=none "$bin" \
      || { echo "✗ Helpers individual signing failed (script): $bin" >&2; exit 1; }
  fi
done
codesign -s "$SIGN_ID" --force "$APP"
echo "built + signed (inside-out): $APP (v$VERSION, $BUNDLE_PREFIX)"
codesign -dv "$APP" 2>&1 | grep -iE 'Authority|^Identifier' || true
# Check the Authority of the 3 screenshare binaries (AC2): it must be the stable cert for the grant to survive. If ad-hoc ('-'), report only (the build still passes).
for b in screen rp-screencap rp-input-inject; do
  echo "  helper $b: $(codesign -dvv "$HELP/$b" 2>&1 | grep -i 'Authority=' | head -1 || echo 'unsigned?')"
done
codesign --verify --strict "$APP" && echo "verify OK ✓"

# ── --deploy: rsync to the remote, then install.sh --role host (reuse the reversible manifest install) ──
if [ "${1:-}" = "--deploy" ]; then
  HOST="${2:-$DEPLOY_HOST}"
  echo ""
  echo "=== deploy → $HOST (rsync repo + install.sh --role host) ==="
  ssh "$HOST" 'mkdir -p ~/.local/share/remote-pair'
  rsync -az --delete --exclude '.git' --exclude '.omc' ./ "$HOST:~/.local/share/remote-pair/"
  ssh "$HOST" 'cd ~/.local/share/remote-pair && ./shared/install.sh --role host'
  echo ""
  echo "※ For a new bundle id ($BUNDLE_PREFIX), re-grant once: System Settings → Accessibility / Screen Recording → $APP_NAME ON"
fi

# ── --release: signed-app zip → GitHub Releases (+ Homebrew Cask bump) ──
if [ "${1:-}" = "--release" ]; then
  command -v gh >/dev/null || { echo "✗ gh CLI required (brew install gh)"; exit 1; }
  # Guard: no ad-hoc signed releases. The TCC (AX·SR) grant is bound to the designated requirement (= cert leaf), but
  #   ad-hoc has only a cdhash, so every install site would re-toggle permissions on each update → never ship it in a distribution build.
  # NOTE: the canonical release path is 'tag push → CI(release.yml)', signed with the stable p12 from the repo secret (leaf 898E32).
  #   Use this manual path only on a machine that holds the same cert as that secret. Releasing manually with a different cert (e.g. the client's 33849F)
  #   splits the signing identity and breaks the grant on existing install sites.
  [ "$SIGN_ID" = "-" ] && { echo "✗ release refused: ad-hoc signing. Release only on a machine with the stable cert '$SIGN_CN' (./host/make-signing-cert.sh)"; exit 1; }
  ZIP="build/${APP_NAME}-${VERSION}.zip"
  echo "=== release: $ZIP → gh release create v$VERSION ($GH_REPO) ==="
  ( cd build && /usr/bin/ditto -c -k --sequesterRsrc --keepParent "${APP_NAME}.app" "$(basename "$ZIP")" )
  codesign --verify --strict "$APP"
  gh release create "v$VERSION" "$ZIP" --repo "$GH_REPO" --title "v$VERSION" --generate-notes \
    || gh release upload "v$VERSION" "$ZIP" --repo "$GH_REPO" --clobber
  echo "released v$VERSION ✓"

  # Homebrew Cask auto-bump: update version + sha256 against the zip just uploaded (SSOT = the release artifact).
  CASK="Casks/remote-pair-host.rb"
  if [ -f "$CASK" ]; then
    SHA=$(shasum -a 256 "$ZIP" | awk '{print $1}')
    /usr/bin/sed -i '' -E "s/^  version \".*\"/  version \"${VERSION}\"/" "$CASK"
    /usr/bin/sed -i '' -E "s/^  sha256 \".*\"/  sha256 \"${SHA}\"/" "$CASK"
    echo "cask bumped: $CASK → v$VERSION sha256=${SHA:0:12}…  (reflected in the tap after commit)"
  else
    echo "⚠ $CASK missing — skipping cask bump"
  fi
fi
