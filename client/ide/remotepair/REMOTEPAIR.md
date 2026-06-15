# RemotePair surface manifest — `client/ide/` (VSCodium fork, Vendor 분리 / Option C)

> **What this is:** `client/ide/` is a VSCodium-based IDE split into two halves:
> - `remotepair/` — **everything RemotePair owns** (this directory). The only files we author/maintain.
> - `vendor/vscodium/` — **pristine VSCodium** build recipe, tracked as a `git subtree` from
>   github.com/VSCodium/vscodium (remote `vscodium`). **Inviolable** — never edit; any RemotePair
>   change to a stock file must be expressed here in `remotepair/` (as a patch/overlay/orchestrator).
>
> **Why (Option C):** vendor tracks *pristine* VSCodium directly, so RemotePair files never enter
> the tracked subtree → `git subtree pull` stays conflict-free **by construction**. (The earlier
> standalone `remotepair-ide` fork — which carried RemotePair files inside the recipe — is retired.)

---

## 1. RemotePair-owned surface (everything under `remotepair/`)

### A. Embedded extension — `remotepair/ext/`
| Path | Role |
|------|------|
| `ext/extension.js` | host status-bar button, `openFileBrowser` (FOLDER_MAPS multiroot), `addRoot` (mount-first), `reconcileBrowserRoots`, Remote Desktop (v1 JPEG / v2 WebRTC), openSettings, layout setup |
| `ext/package.json` | extension manifest (commands, walkthroughs, contributes) |
| `ext/generate-contracts.mjs` | **build-time** codegen: reads monorepo `../../../../shared/` SoT → writes `generated/contracts.json`. Runs in the monorepo only. |
| `ext/generated/contracts.json` | **committed** codegen output (screen-protocol ports/channels, identity). The ext consumes ONLY this → `client/ide/` stays self-contained. |
| `ext/media/` | `remote-desktop.js`/`.css`, icons, `walkthrough-*.md` |

Regenerate after editing `shared/`: `node client/ide/remotepair/ext/generate-contracts.mjs`, then
commit `generated/contracts.json`. Verify: `shared/check-ide-selfcontained.sh`.

### B. Frontend patch — `remotepair/patches/zz-remotepair-ide-frontend.patch`
The **single** RemotePair-authored patch (the entire G001–G009 workbench frontend). At build time
`build.sh` copies it into `vendor/vscodium/patches/`, where `prepare_vscode.sh` applies it last
(`../patches/*.patch` glob is name-sorted; `zz-` sorts after every stock patch). It injects 9 NEW
RemotePair files and modifies 18 stock workbench files (all marked `// RemotePair:`):

NEW (RemotePair-authored):
- `browser/parts/remotePairPrune.ts` — rail/panel/auxbar allowlist
- `contrib/files/browser/remotePairBrowserActions.ts` — Browser Search/Extensions/AddRoot, per-folder hover star+'+'
- `contrib/files/browser/remotePairBrowserRouter.ts` — Browser meta-container Explorer↔Search router
- `contrib/files/browser/remotePairFavorites.ts` — Favorites store + bottom view
- `contrib/terminal/browser/remotePairSessionManager.ts` (+ `media/remotePairSessionManager.css`)
- `contrib/terminal/browser/remotePairSessionPicker.ts`
- `contrib/terminal/browser/remotePairTerminalSidebar.ts` (+ `media/remotePairSessions.css`)

MODIFIED stock (conflict surface on upstream pull): `browser/layout.ts`, `browser/parts/{activitybar,
auxiliarybar,paneCompositeBar,panel,globalCompositeBar}*`, `contrib/files/browser/{explorerViewlet,
files.contribution,views/explorerView}.ts`, `contrib/{outline,remote,timeline}/browser/*.contribution.ts`,
`contrib/terminal/browser/terminal.contribution.ts`, and the related CSS.

### C. Branding overlay — `remotepair/product.overlay.json`
RemotePair identity (nameShort=RemotePair, applicationName=remotepair, darwinBundleIdentifier
`com.x10lab.remotepair-ide`, urlProtocol=remotepair, …). At build time `build.sh` places it at
`vendor/vscodium/product.json`; `prepare_vscode.sh:128` merges it onto the in-`vscode/` stock
product.json (overlay wins). Identity SoT is `shared/identity/` (`shared/identity/check-identity.sh`).

### D. Build orchestrator — `remotepair/dev-build.sh`
= pristine VSCodium `dev/build.sh` with the RemotePair identity env (APP_NAME, ASSETS_REPOSITORY,
BINARY_NAME, GH_REPO_PATH, ORG_NAME). It is a **5-line diff** from upstream `dev/build.sh`. It must
live here (not in vendor) because pristine `dev/build.sh` hardcodes `APP_NAME="VSCodium"` etc., which
would override any env exported by a wrapper. Run via the root `build.sh` wrapper (CWD = recipe root).

---

## 2. Pristine VSCodium (`vendor/vscodium/`) — inviolable
The entire build recipe: root scripts (`build.sh`, `prepare_*.sh`, `get_repo.sh`, `update_upstream.sh`,
`version.sh`, `utils.sh`, …), `src/`, `build/`, `dev/` (incl. **pristine** `dev/build.sh`), `patches/`
(**all stock**, incl. `00-brand-remove-branding.patch`, `80`/`81-ui-disable-onboarding` — these are
**VSCodium's own** de-branding/onboarding patches, NOT RemotePair's), `icons/`, `stores/`, `upstream/`,
`font-size/`, `.github/`, and the stock `product.json`/`README.md`/`.gitignore`. Never edit in place —
it must stay a byte-faithful mirror of `vscodium/<tag>` so subtree pulls apply cleanly.

> Attribution correction (vs the pre-restructure manifest): the ONLY RemotePair deviations from
> pristine VSCodium are the four §1 items (ext, zz patch, product overlay, dev-build.sh). `00-brand`,
> `80`, `81` were previously mislabeled as RemotePair — they are stock and live in `vendor/`.

## 3. Build & sync flow
- **Build:** `client/ide/build.sh` → inject zz patch + overlay into `vendor/vscodium/` (trap-cleaned) →
  `remotepair/dev-build.sh` (CWD=vendor) → `get_repo.sh` (clone vscode into gitignored `vendor/vscodium/vscode/`)
  → `build.sh` → `prepare_vscode.sh` (cp `src/stable/*`, `jq`-merge product.json, apply `patches/*`) → gulp package.
- **Dev-watch:** operates inside `vendor/vscodium/vscode/`; `buildConfig.ts useEsbuildTranspile=true` is
  **dev-only** (never committed to a branded build).
- **Upstream pull (Option C):** `git subtree pull --prefix=client/ide/vendor/vscodium vscodium <tag> --squash`.
  Current anchor: VSCodium `1.121.03429` (VS Code 1.121.0, MS commit `987c9597…`). RemotePair files are
  not in the subtree, so pulls don't conflict with them. See `client/ide/update_upstream.sh`.

## 4. Invariants
1. **Core terminal behavior is inviolable** — never modify xterm wiring / `TerminalInstance` /
   `TerminalProcessManager` / `terminalInstance.ts` / `xterm*.ts` / the input `onData` path. Terminal
   focus/input is solved only in the hosting layer (`remotePairTerminalSidebar.ts`).
2. **"Code kept, UI hidden/added"** — hide native UI via composite-bar allowlists + `when=false`,
   never `unregister`; keeps upstream rebase cheap.
3. `localize`/`localize2` first arg = **static string literal** (dynamic keys break the prod NLS build).
4. tsc clean (nvm node 22.22.1), 0 errors before committing the zz patch.
5. **vendor/vscodium/ is pristine** — verify with `git diff vscodium/<tag> -- client/ide/vendor/vscodium`
   (expect no RemotePair content). Any needed stock change becomes a `remotepair/patches/*` patch.
