# remotepair-ide Monorepo-Friendly Restructuring Design (Goal Step 1)

> ✅ **Executed** — for the current structure, see [`docs/monorepo-structure.md`](monorepo-structure.md). The previously unresolved "remotepair-ext bundling path" was confirmed to be an **unwired gap** (current doc §5).

> **Purpose:** When the user triggers "fix it" — *before* entering `ide/`, tidy up the internals of `remotepair-ide` to be monorepo-friendly → then run the runbook (`docs/ide-merge-runbook.md`).
> **Decisive constraint:** `remotepair-ide` is a **VSCodium fork**. Moving the stock layout (`patches/`·`src/`·`build/`·root scripts) breaks upstream sync (`get_repo.sh`/`update_upstream.sh`, patch application order).
> **Conclusion:** Full reshuffle ❌ · **boundary cleanup + self-containment ✅** (minimal·additive·upstream-harmless).

---

## 1. Field Survey: RemotePair Surface vs VSCodium Stock

### RemotePair-specific (maintained by us — integration target)
| Item | Details |
|------|---------|
| `remotepair-ext/` (13 files) | Built-in extension. `extension.js` has **0 references to external/parent paths** (only stock node + `vscode`) → already close to self-contained |
| `patches/zz-remotepair-ide-frontend.patch` (2185L) | Directly patches vscode `workbench/` source + newly injects `remotePairPrune.ts`·`remotePairBrowserActions.ts` |
| `patches/00-brand-remove-branding.patch` | Branding |
| `patches/80-ui-disable-onboarding.json` · `81-…patch` | Turns OFF the default VSCode onboarding |
| `product.json` branding | nameShort=RemotePair · applicationName=remotepair · darwinBundleIdentifier=`com.x10lab.remotepair-ide` · urlProtocol=remotepair … → `prepare_vscode.sh` **merges (overlays)** this into vscode product.json via `jq` = clean |

### VSCodium stock (upstream sync — **inviolable**)
`src/` (176 icon resources) · `build/` (48) · `patches/` 50 stock · `docs/` (13, all stock) · root scripts 30+ (`build.sh` `prepare_*` `get_repo` `update_upstream` `release` `version`…) · `stores/` `dev/` `font-size/` `upstream/` `icons/` `.github/`

### 1 unconfirmed item (verify before execution)
`remotepair-ext` bundling path — **there is no reference in the build scripts.** Need to determine whether it goes via `builtInExtensions` (GH download), via the `zz-frontend` patch, or via manual placement.

---

## 2. Principles

1. **Stock paths unchanged** → minimal upstream diff = sync safety.
2. **RemotePair surface made explicit·bounded** → the conflict scope of an upstream pull is identifiable immediately.
3. **`ide/` self-contained** → inject the `shared/` contract only as a build-time **artifact** (`remotepair-ext/generated/`) and **commit** it → so the standalone build doesn't break either.
4. **Establish a single ownership point for RemotePair code** (extension + frontend patches).

---

## 3. Restructuring Actions (safe·minimal·upstream-harmless)

| # | Action | Details | Kind | Risk |
|---|--------|---------|------|------|
| A | **RemotePair surface manifest** | `REMOTEPAIR.md` (or `.remotepair-manifest`) — pins the list of "our files/patches". On an upstream pull, the conflict scope is identified immediately | add | none |
| B | **`remotepair-ext` = RemotePair runtime single home** | Create `remotepair-ext/generated/` (the `shared/` contract injection point, committed) + make the bundling path explicit | add/wire | low |
| C | **RemotePair patch tracking** | Record the 4 patches in the manifest (A). ⚠️ **Do not rename** — `00-brand` (early)·`80/81` (middle)·`zz-frontend` (last) depend on the application order. Renaming breaks patch application | doc-only | none |
| D | **identity sync marker** | Mark the point that links `product.json` branding ↔ the single version source `shared/identity/` | mark | none |
| E | **Stock inviolable** | Leave `src/` `build/` `docs/` root scripts · stock patches as-is | keep | — |

> Key point: there is **almost no** actual "folder moving". Moving folders in a VSCodium fork is harmful. The essence of monorepo-friendliness is *making boundaries explicit + self-containment*.

---

## 4. Move/Create Map

| Current | Action |
|---------|--------|
| All VSCodium stock | **keep** (0 moves) |
| `remotepair-ext/` | keep + add `generated/` |
| (new) `REMOTEPAIR.md` manifest | **add** |
| 4 RemotePair patches | keep (names preserved), record in manifest |
| `product.json` branding | keep, identity SoT linkage marker |

---

## 5. 1 item to verify before execution
- Confirm the `remotepair-ext` bundling path: check the body of `zz-remotepair-ide-frontend.patch` + the `builtInExtensions`/extension-download settings in `product.json`.

---

## 6. Execution order on trigger ("fix it")
1. Create a work branch on `remotepair-ide` (e.g. `feat/monorepo-ready`)
2. Apply §3 A~E (safe·additive)
3. Confirm `remotepair-ide` standalone `build.sh` passes
4. → Continue into the runbook `docs/ide-merge-runbook.md` **Phase 0~2** (unshallow → subtree add `ide/`)

---

## 7. Honest note (for direction confirmation)
The strongest lever for the "folder structure restructuring" the user mentioned (a mass folder move) is **counterproductive in a VSCodium fork** (it destroys upstream sync). So the design above is a minimal change centered on *boundary-making·self-containment*. If a more aggressive relocation is desired (e.g. detaching RemotePair code further from stock), it comes with the trade-off of giving up upstream tracking, so on trigger we will recalibrate that intensity once more.
