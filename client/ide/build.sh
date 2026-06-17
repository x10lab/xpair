#!/usr/bin/env bash
# RemotePair IDE build — thin wrapper over the pristine VSCodium recipe in vendor/vscodium/.
#
# Vendor separation (Option C): vendor/vscodium/ is PRISTINE VSCodium (git subtree from
# github.com/VSCodium/vscodium). Everything RemotePair owns lives in remotepair/.
# This wrapper injects the RemotePair artifacts into the pristine recipe at build time
# (trap-cleaned so vendor stays byte-pristine for the next `git subtree pull`), then runs
# the RemotePair build orchestrator with CWD = the recipe root.
#
# Usage:  ./build.sh [dev-build flags]      (e.g. -p assets, -o skip-build, -s skip-source)
set -e

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$HERE/vendor/vscodium"
RP="$HERE/remotepair"

[ -d "$VENDOR" ] || {
  echo "vendor/vscodium/ missing — populate it first:" >&2
  echo "  git subtree add --prefix=client/ide/vendor/vscodium vscodium <tag> --squash" >&2
  exit 1
}

INJECTED_PATCH="$VENDOR/patches/zz-remotepair-ide-frontend.patch"
INJECTED_PATCH_MAIN="$VENDOR/patches/zz-remotepair-ide-electron-main.patch"
INJECTED_PATCH_MAIN2="$VENDOR/patches/zz-remotepair-ide-electron-main2.patch"
PRODUCT_BAK="$VENDOR/product.json.rp-orig"
# Builtin extension inject target. The vscode source lives at $VENDOR/vscode/ and the gulp recipe
# auto-discovers every dir under extensions/ via glob.sync('extensions/*/package.json') — so a dir
# dropped here becomes a builtin with NO product.json wiring. Basename MUST stay 'remotepair' so the
# US-B onboarding hook (app.ts: builtinExtensionsPath/['x10lab.remotepair','remotepair']) resolves.
INJECTED_EXT="$VENDOR/vscode/extensions/remotepair"

# Auto-incrementing dev build marker so each rebuild is visibly distinct in About (stale vs fresh
# is then unambiguous). Bumped once per build; stamped into the packaged product.json below
# (before re-sign). Override with RP_BUILD_VER=…; bump RP_BUILD_BASE when cutting a real release.
RP_BUILD_BASE="${RP_BUILD_BASE:-0.5.0a}"
# LOCKSTEP with the host build: both read+bump the SAME shared counter (repo shared/.build-counter)
# so the project has a single monotonic 0.5.0aN sequence across host + client.
COUNTER_FILE="$HERE/../../shared/.build-counter"
_n=$(( $(cat "$COUNTER_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$_n" > "$COUNTER_FILE"
RP_BUILD_VER="${RP_BUILD_VER:-${RP_BUILD_BASE}${_n}}"
echo "→ RemotePair build marker: $RP_BUILD_VER  (About → version; counter: $COUNTER_FILE)"

cleanup() {
  # restore pristine vendor (so `git subtree pull` stays conflict-free)
  rm -f "$INJECTED_PATCH"
  rm -f "$INJECTED_PATCH_MAIN"
  rm -f "$INJECTED_PATCH_MAIN2"
  rm -rf "$INJECTED_EXT"
  [ -f "$PRODUCT_BAK" ] && mv -f "$PRODUCT_BAK" "$VENDOR/product.json"
  rm -f "$VENDOR/dev/build.env"
}
trap cleanup EXIT INT TERM

# 1) inject the RemotePair patches — prepare_vscode.sh applies ../patches/*.patch (glob, name-sorted);
#    zz- sorts last so they land after all stock + RemotePair-needed patches. The frontend patch is
#    workbench(renderer)-only; the electron-main patch is the single-app onboarding hook in
#    src/vs/code/electron-main/app.ts (US-B). They touch disjoint files, so order between them is moot.
cp "$RP/patches/zz-remotepair-ide-frontend.patch" "$INJECTED_PATCH"
cp "$RP/patches/zz-remotepair-ide-electron-main.patch" "$INJECTED_PATCH_MAIN"
#    main2 = local-identity safeStorage fix: forces --password-store=basic for nameShort ending in
#    'Local' (src/main.ts), so the self-signed local build stops re-prompting for Keychain access.
#    Prod/CI (nameShort != *Local) keep the Keychain. Disjoint file (src/main.ts) from the others.
cp "$RP/patches/zz-remotepair-ide-electron-main2.patch" "$INJECTED_PATCH_MAIN2"

# 1b) The RemotePair VS Code extension is injected as a BUILTIN (vscode/extensions/remotepair) INSIDE
#     dev-build.sh — AFTER source prep, right before gulp. It CANNOT be copied here: dev-build.sh wipes
#     vscode/ on SKIP_SOURCE=no (`rm -rf vscode*` + re-clone) and resets it on SKIP_SOURCE=yes
#     (`git add . && git reset --hard HEAD`), either of which would delete a pre-build copy. gulp
#     glob-discovers extensions/*/package.json → ships it as builtin 'remotepair' (matches US-B probe).
#     The cleanup trap above still rm -rf's $INJECTED_EXT so vendor ends byte-pristine.

# 2) inject the branding overlay — prepare_vscode.sh:128 merges the in-vscode/ stock product.json
#    with ../product.json (= vendor/vscodium/product.json), our overlay winning on key conflicts.
#    Stash pristine first; the trap restores it after the build.
cp "$VENDOR/product.json" "$PRODUCT_BAK"
cp "$RP/product.overlay.json" "$VENDOR/product.json"

# 2b) Local-identity isolation. Local/dev builds get a DISTINCT product identity so they live in
#     their own single-instance lock domain. The macOS lock lives at
#     ~/Library/Application Support/<nameShort> (see vscode environmentService.ts → getUserDataPath
#     uses product.nameShort), so a stale local/dev instance sharing nameShort otherwise squats the
#     lock and a NEW launch (e.g. the production cask app) silently hands off to it and exits
#     ("the app won't launch"). Suffixing the identity for local builds prevents that collision.
#     CI keeps the production identity. Override with RP_LOCAL_IDENTITY=0 to build the prod identity locally.
RP_LOCAL_IDENTITY="${RP_LOCAL_IDENTITY:-$([ -z "$GITHUB_ACTIONS" ] && echo 1 || echo 0)}"
if [ "$RP_LOCAL_IDENTITY" = "1" ]; then
  echo "→ local-identity build: RemotePairLocal (isolated lock domain; RP_LOCAL_IDENTITY=0 for prod identity)"
  _pj_tmp="$(mktemp)"
  # NOTE: the VSCodium recipe assumes nameShort == nameLong (gulp names the .app from nameLong,
  # build_cli.sh's codium-tunnel copy looks it up via nameShort) — keep them EQUAL or the CLI
  # copy fails ("No such file"). The single-instance lock is keyed on nameShort (getUserDataPath),
  # so changing nameShort (= nameLong here) is what isolates the lock domain.
  jq '.nameShort = "RemotePairLocal"
    | .nameLong = "RemotePairLocal"
    | .applicationName = "remotepair-local"
    | .dataFolderName = ".remotepair-local"
    | .darwinBundleIdentifier = "com.x10lab.remotepair-ide-local"
    | .win32MutexName = "remotepairlocal"
    | .win32AppUserModelId = "x10lab.RemotePairLocal"
    | .win32DirName = "RemotePairLocal"' \
    "$VENDOR/product.json" > "$_pj_tmp" && mv "$_pj_tmp" "$VENDOR/product.json"
fi

# 3) run the RemotePair orchestrator (pristine VSCodium dev/build.sh + RemotePair identity)
#    with CWD = recipe root so its relative sources (get_repo.sh, build.sh, …) resolve into vendor.
( cd "$VENDOR" && bash "$RP/dev-build.sh" "$@" )

# 4) relocate the packaged app out of vendor into a clean dist/. The gulp recipe hardcodes its
#    output to ../VSCode-<os>-<arch>/ (= inside vendor/vscodium/); move it so vendor stays
#    artifact-free and the deliverable lives at a predictable client/ide/dist/ path.
shopt -s nullglob
for out in "$VENDOR"/VSCode-darwin-*/ "$VENDOR"/VSCode-linux-*/ "$VENDOR"/VSCode-win32-*/; do
  mkdir -p "$HERE/dist"
  rm -rf "$HERE/dist/$(basename "$out")"
  mv "$out" "$HERE/dist/"
  echo "→ build output: client/ide/dist/$(basename "$out")"
done
shopt -u nullglob

# 4.5) stamp the auto-incrementing build marker into the packaged product.json (BEFORE re-sign, so
#      the signature covers it). Shows in About → version, making stale-vs-fresh unambiguous.
shopt -s nullglob
for pj in "$HERE"/dist/VSCode-darwin-*/*.app/Contents/Resources/app/product.json \
          "$HERE"/dist/VSCode-linux-*/resources/app/product.json \
          "$HERE"/dist/VSCode-win32-*/resources/app/product.json; do
  [ -f "$pj" ] || continue
  _t="$(mktemp)"
  # Stamp ONLY remotePairBuild — do NOT clobber .version: VSCode's version must stay valid semver
  # (its update compareBuild() throws on '0.5.0a8') AND keep the 1.x major so extensions'
  # engines.vscode (^1.x) stay compatible. Build identity lives in the dedicated field.
  jq --arg v "$RP_BUILD_VER" '.remotePairBuild=$v' "$pj" > "$_t" && mv "$_t" "$pj"
  echo "→ stamped build marker $RP_BUILD_VER into $pj"
done
shopt -u nullglob

# 5) re-sign the macOS app so it actually launches. The gulp build emits an adhoc signature; under a
#    hardened runtime Electron's V8 JIT needs allow-jit (+ disable-library-validation for a self-signed
#    identity), and `codesign --deep` strips entitlements — so re-sign inside-out (local-sign.sh).
#    No-op when not macOS or when the signing identity is absent. Release signing is done in CI.
if [ "$(uname)" = "Darwin" ]; then
  shopt -s nullglob
  for app in "$HERE"/dist/VSCode-darwin-*/*.app; do
    bash "$RP/local-sign.sh" "$app" || echo "  (re-sign skipped/failed for $(basename "$app"))"
  done
  shopt -u nullglob
fi
