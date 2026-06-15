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
PRODUCT_BAK="$VENDOR/product.json.rp-orig"

cleanup() {
  # restore pristine vendor (so `git subtree pull` stays conflict-free)
  rm -f "$INJECTED_PATCH"
  [ -f "$PRODUCT_BAK" ] && mv -f "$PRODUCT_BAK" "$VENDOR/product.json"
  rm -f "$VENDOR/dev/build.env"
}
trap cleanup EXIT INT TERM

# 1) inject the RemotePair frontend patch — prepare_vscode.sh applies ../patches/*.patch (glob,
#    name-sorted); zz- sorts last so it lands after all stock + RemotePair-needed patches.
cp "$RP/patches/zz-remotepair-ide-frontend.patch" "$INJECTED_PATCH"

# 2) inject the branding overlay — prepare_vscode.sh:128 merges the in-vscode/ stock product.json
#    with ../product.json (= vendor/vscodium/product.json), our overlay winning on key conflicts.
#    Stash pristine first; the trap restores it after the build.
cp "$VENDOR/product.json" "$PRODUCT_BAK"
cp "$RP/product.overlay.json" "$VENDOR/product.json"

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
