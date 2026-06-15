# generated/ — DO NOT EDIT

This directory is **generated** from the monorepo `shared/` SoT.

- Generator: `../generate-contracts.mjs` (run with `node` from the monorepo; reads `../../shared`)
- `contracts.json` = snapshot of the screen-protocol + identity contracts (port, input channels, brand, version)

`remotepair-ext` consumes **only these committed generated artifacts**, so a standalone `remotepair-ide` build
works without `../../shared` (**self-contained** — safe to subtree pull).

To change a value, edit `shared/`, regenerate with `node ide/remotepair-ext/generate-contracts.mjs`,
and commit the result. The `shared/check-ide-selfcontained.sh` script verifies that they stay in sync.
