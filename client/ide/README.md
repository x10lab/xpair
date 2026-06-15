# RemotePair IDE (VSCodium fork — Vendor separation / Option C)

`client/ide/` is RemotePair's VSCodium-based IDE, restructured so RemotePair-owned code is
cleanly separated from the **pristine** VSCodium build recipe.

## Layout

```
client/ide/
├─ remotepair/              ← everything RemotePair owns (the only files we maintain)
│  ├─ ext/                  embedded extension + generate-contracts.mjs + committed generated/
│  ├─ patches/              zz-remotepair-ide-frontend.patch (the whole RemotePair frontend)
│  ├─ product.overlay.json  RemotePair branding (merged onto stock product.json at build)
│  ├─ dev-build.sh          RemotePair build orchestrator (= pristine dev/build.sh + identity)
│  └─ REMOTEPAIR.md         authoritative RemotePair-surface manifest + invariants
├─ vendor/vscodium/         ← PRISTINE VSCodium recipe, git subtree from VSCodium/vscodium
│                             (remote `vscodium`). Do NOT edit — changes go in remotepair/.
├─ build.sh                 thin wrapper: inject RemotePair artifacts → run remotepair/dev-build.sh
├─ update_upstream.sh       documents `git subtree pull` for the vendor recipe
└─ README.md  .gitignore  .nvmrc  .editorconfig
```

## Build

```sh
cd client/ide && ./build.sh        # → vendor/vscodium/VSCode-darwin-<arch>/RemotePair.app
```

`build.sh` injects `remotepair/`'s frontend patch + branding overlay into the pristine vendor
recipe (trap-cleaned afterward, so `vendor/` stays byte-pristine for the next subtree pull),
then runs `remotepair/dev-build.sh` with CWD = the recipe root. Requires nvm node (`.nvmrc`).
Build flags pass through to `dev-build.sh` (`-p` build assets, `-o` skip build, `-s` skip source).

Dev-watch operates inside the checkout at `vendor/vscodium/vscode/` (created by the first build).

## Upstream sync (Option C)

`vendor/vscodium/` tracks pristine VSCodium directly; RemotePair files never round-trip:

```sh
git subtree pull --prefix=client/ide/vendor/vscodium vscodium <tag> --squash
```

Current anchor: VSCodium **1.121.03429** (VS Code 1.121.0). See `./update_upstream.sh`.

See **`remotepair/REMOTEPAIR.md`** for the full RemotePair surface + invariants, and
`vendor/vscodium/README.md` for upstream VSCodium documentation.
