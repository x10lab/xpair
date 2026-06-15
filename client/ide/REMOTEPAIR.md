# RemotePair surface manifest — `ide/` (VSCodium fork)

> **What this is:** `ide/` is a **VSCodium fork** consumed as a `git subtree`. The vast majority of
> files are **VSCodium stock** (upstream-tracked, **do not move/rename** — it breaks `get_repo.sh`/
> `update_upstream.sh` and the patch-apply order). This file is the **single list of the
> RemotePair-owned surface**: the only things we author/maintain here. On `git subtree pull`, merge
> conflicts will land **only in the files listed below** — everything else is stock and takes
> upstream as-is.
>
> **Boundary rule:** if a file is NOT listed here, treat it as VSCodium stock — don't edit it
> outside a patch, don't reorganize it.

---

## 1. RemotePair-owned surface (what we maintain)

### A. Embedded extension — `remotepair-ext/`  (single home for RemotePair runtime UI)
Self-contained: `extension.js` has **0 parent/external path refs** (stock node + `vscode` only).
| Path | Role |
|------|------|
| `remotepair-ext/extension.js` | host status-bar button, `openFileBrowser`(FOLDER_MAPS multiroot), `addRoot`(mount-first), `reconcileBrowserRoots`, Remote Desktop (v1 JPEG / v2 WebRTC), openSettings, layout setup |
| `remotepair-ext/package.json` | extension manifest (commands, walkthroughs, contributes) |
| `remotepair-ext/generate-contracts.mjs` | **build-time** codegen: reads monorepo `../../shared/` SoT → writes `generated/contracts.json`. Runs in the monorepo only. |
| `remotepair-ext/generated/contracts.json` | **committed** codegen output (screen-protocol ports/channels, identity). The ext consumes ONLY this → `ide/` stays self-contained for standalone build + safe `subtree pull`. |
| `remotepair-ext/media/` | `remote-desktop.js`/`.css`, icons, `walkthrough-*.md` (connect/extensions/fileaccess/permissions) |

Regenerate contracts after editing `shared/`: `node ide/remotepair-ext/generate-contracts.mjs` then commit `generated/contracts.json`. Verify: `shared/check-ide-selfcontained.sh`.

### B. RemotePair patches — in `patches/` (mixed with ~50 stock patches by design)
**⚠️ DO NOT RENAME — apply order is name-sorted by `prepare_vscode.sh` (`../patches/*.patch` glob).**
The numeric prefix encodes ordering; renaming breaks `git apply`.
| Patch | When (order) | Role |
|-------|-------------|------|
| `patches/00-brand-remove-branding.patch` | early (`00-`) | branding strip/replace |
| `patches/80-ui-disable-onboarding.json` | mid (`*.json` actions run before `*.patch`) | remove stock welcome/onboarding files |
| `patches/81-ui-disable-onboarding.patch` | mid (`81-`) | disable stock onboarding UI |
| `patches/zz-remotepair-ide-frontend.patch` | **last** (`zz-`) | the entire G001–G009 frontend (see §C). MUST apply after all stock + RemotePair patches. |

All other `patches/*` (00-*, 10–81 except the four above, `osx/`, `user/`, `*.json`) = **VSCodium stock**.

### C. Frontend source (delivered via `patches/zz-remotepair-ide-frontend.patch` — NOT loose files)
The fork's `vscode/` checkout is gitignored/build-generated; our `workbench/` changes live in the
`zz` patch. It **injects 9 NEW RemotePair files** and **modifies 18 stock files**.

NEW (RemotePair-authored, all prefixed `remotePair*` or in RemotePair media):
- `src/vs/workbench/browser/parts/remotePairPrune.ts` — rail/panel/auxbar allowlist
- `src/vs/workbench/contrib/files/browser/remotePairBrowserActions.ts` — Browser Search/Extensions/AddRoot, per-folder hover star+'+'(IExplorerFileContribution)
- `src/vs/workbench/contrib/files/browser/remotePairBrowserRouter.ts` — Browser meta-container Explorer↔Search in-frame router (hosted SearchView)
- `src/vs/workbench/contrib/files/browser/remotePairFavorites.ts` — Favorites store + bottom view
- `src/vs/workbench/contrib/terminal/browser/remotePairSessionManager.ts` (+ `media/remotePairSessionManager.css`)
- `src/vs/workbench/contrib/terminal/browser/remotePairSessionPicker.ts`
- `src/vs/workbench/contrib/terminal/browser/remotePairTerminalSidebar.ts` (+ `media/remotePairSessions.css`)

MODIFIED stock (minimal, marked `// RemotePair:`; conflict surface on upstream pull):
- `browser/layout.ts` (auxbar removed), `browser/parts/{activitybar/activitybarPart, auxiliarybar/auxiliaryBarPart, paneCompositeBar, panel/panelPart, globalCompositeBar}.ts`
- `contrib/files/browser/{explorerViewlet, files.contribution, views/explorerView}.ts`
- `contrib/{outline,remote,timeline}/browser/*.contribution.ts`, `contrib/terminal/browser/terminal.contribution.ts`
- CSS: `parts/activitybar/media/{activityaction,activitybarpart}.css`, `parts/editor/media/multieditortabscontrol.css`, `parts/media/paneCompositePart.css`, `contrib/files/browser/media/explorerviewlet.css`

### D. Branding overlay — `product.json`
RemotePair identity (nameShort=RemotePair, applicationName=remotepair, darwinBundleIdentifier
`com.x10lab.remotepair-ide`, urlProtocol=remotepair, …). `prepare_vscode.sh` `jq`-merges this onto
the stock vscode product.json (overlay, non-destructive). Source of truth for identity is
`shared/identity/` (see `shared/identity/check-identity.sh`).

---

## 2. Everything else = VSCodium stock (upstream, inviolable)
`src/` (icon/resource overlays) · `build/` · `dev/` · `stores/` · `font-size/` · `icons/` ·
`upstream/` · `docs/` · `.github/` · root scripts (`build.sh`, `prepare_*.sh`, `get_repo.sh`,
`update_upstream.sh`, `release.sh`, `version.sh`, `utils.sh`, …) · the ~50 stock `patches/`.
Do not move/rename these — upstream sync depends on the stock layout + patch order.

## 3. Build & sync flow
- **Build:** `build.sh` → `get_repo.sh` (clone vscode into gitignored `vscode/`) → `prepare_vscode.sh`
  (cp `src/stable/*`, `jq`-merge `product.json`, apply `patches/*.json` then `patches/*.patch` in
  name order incl. our 4, then `osx/`+`user/`, `undo_telemetry.sh`, announcement replace) → gulp package.
- **Dev:** `vscode/build/buildConfig.ts useEsbuildTranspile=true` is **dev-only** (never in branded build / patches).
- **Upstream pull:** standalone `remotepair-ide` repo is the VSCodium-tracking staging; absorb upstream
  there, then `git subtree pull --prefix=ide` into the monorepo. Conflicts ⇒ only §1 files.

## 4. Invariants
1. **Core terminal behavior is inviolable** — never modify xterm wiring / `TerminalInstance` /
   `TerminalProcessManager` / `terminalInstance.ts` / `xterm*.ts` / the input `onData` path.
   Terminal focus/input is solved only in the hosting layer (`remotePairTerminalSidebar.ts`).
2. **"Code kept, UI hidden/added"** — hide native UI via composite-bar allowlists + `when=false`,
   never `unregister`; keeps upstream rebase cheap.
3. `localize`/`localize2` first arg = **static string literal** (dynamic keys break the prod NLS build).
4. tsc clean: `tsc --noEmit -p src/tsconfig.json` (nvm node 22.22.1), 0 errors before commit.
5. Verify by behavior (dev-watch recompile + CDP), **not** `build.sh` (it wipes uncommitted `vscode/src`).
