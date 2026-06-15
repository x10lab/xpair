#!/usr/bin/env bash
# RemotePair IDE — upstream sync (Vendor 분리 / Option C).
#
# vendor/vscodium/ is a git subtree tracking PRISTINE VSCodium (github.com/VSCodium/vscodium,
# remote 'vscodium'). RemotePair-owned files live in remotepair/ and NEVER enter the tracked
# subtree, so pulling upstream stays conflict-free by construction.
#
# This wrapper documents the sync commands (it does not auto-run them — pulling upstream is a
# deliberate, reviewed action).
set -e

cat <<'EOF'
RemotePair IDE upstream sync (Option C)
=======================================
vendor/vscodium tracks: github.com/VSCodium/vscodium   (git remote 'vscodium')
current anchor:         VSCodium 1.121.03429  (wraps VS Code 1.121.0, MS commit 987c9597…)

To pull a newer VSCodium recipe into the vendor subtree:
    git fetch vscodium --tags
    git subtree pull --prefix=client/ide/vendor/vscodium vscodium <new-tag> --squash

  • RemotePair surface (remotepair/) is untouched by the pull.
  • After pulling, rebuild (./build.sh) and re-run shared/check-ide-selfcontained.sh.
  • If the new recipe drops/renames something the RemotePair frontend patch relies on,
    refresh remotepair/patches/zz-remotepair-ide-frontend.patch — never edit vendor/.

The vendor recipe's own MS-VSCode version pin lives in vendor/vscodium/upstream/stable.json.
EOF
