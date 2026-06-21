# RemotePair Monorepo Structure (Current)

> **This document is the single source of truth (SoT) for the current structure.** `docs/ide-merge-*.md` is the *pre*-integration plan, whereas
> this document reflects the actual execution result.
> Branch: `refactor/monorepo` · Targets: `remote-pair` (core) · `remotepair-ide` (IDE) · `remotepair-rs` (engine).
> Screen sharing is a pure in-house engine (`host/rd/screen`). External embed experiments live in a separate repo (out of scope for this repo).

## 1. Composition — 3 Sibling Repos → Single Monorepo

```
remote-pair/                  (single git monorepo — host/client × components)
├─ host/                      ◀ runs on the host machine
│   ├─ app/                   RemotePairHost.app source (owns menu bar·capture·input·grant)
│   ├─ rd/                    ◀ remote-desktop engine subtree (remotepair-rs)
│   │   ├─ screen/  Rust: serve.rs(WS+JPEG)·serve_webrtc.rs(WebRTC)
│   │   └─ rpmedia/             Swift: capture·VT encode·input injection(AX)
│   ├─ hooks/  skills/        claude host integration
│   └─ build-host·approve-router·rules·ocr-find   build/daemon glue
├─ client/                    ◀ runs on the client machine
│   ├─ cli/                   remote-pair* CLI + hangul-romanize (onboarding to be implemented as two Electron windows — see §2)
│   └─ ide/                   ◀ VSCodium-based IDE (Vendor separation / Option C)
│       ├─ remotepair/        everything RemotePair owns (ext+generated/·patches/zz·product.overlay·dev-build.sh·REMOTEPAIR.md)
│       └─ vendor/vscodium/   pristine VSCodium build recipe (git subtree ← VSCodium/vscodium, inviolable)
├─ shared/                    ◀ SoT (see §2 below)
├─ docs/  tests/  assets/  Casks/
```
> Role×location rearrangement: `rs` ("rust" is ambiguous) → **`host/rd`** (remote-desktop = screen+input, host side), `ide` → **`client/ide`**, `client/*` → **`client/cli`**, `host/RemotePairHost` → **`host/app`**.
> The old `native/` (a copy of the screen engine) was removed — unified into `host/rd`. Verification: swiftc(host/app) + full tests + SoT check green.
> Build artifacts totaling 6.9G such as `client/ide/vendor/vscodium/vscode/`·`*.dmg` are automatically ignored by `.gitignore`.

## 2. shared/ — Single Source (SoT)

| Directory | Contract | Consumers | Check |
|----------|------|--------|------|
| `shared/identity/` | brand·component identifiers·version (independent) | Casks·client/ide/remotepair/product.overlay.json·host/rd Cargo·host/app Config | `check-identity.sh` |
| `shared/screen-protocol/` | WS/WebRTC ports·frames·input channel·message vocabulary | host/rd(serve*.rs)·client/ide(extension·remote-desktop.js) | `check-screen-protocol.sh` |
| onboarding (to be implemented) | role-aware step model | host Electron window (RemotePairHost)·client Electron window (RemotePair IDE) | — |

> **Onboarding (redesign, not yet built):** the onboarding requirement survives, but the prior browser-based web wizard
> (vanilla SPA + python HTTP bridge + `remote-pair web` subcommand + `shared/onboarding/` step model) was **removed** as a
> failed pre-VSCodium attempt. Onboarding is being redesigned from scratch as **two separate Electron onboarding windows** —
> one embedded in **RemotePairHost** (the host Swift app) and one in **RemotePair** (the client VSCodium/Electron IDE) — shown
> on first install, based on a React/shadcn mockup. None of it is built yet.

**build-time codegen:** `client/ide/remotepair/ext/generate-contracts.mjs` reads `shared/` and
generates `client/ide/remotepair/ext/generated/contracts.json` (committed). `remotepair/ext` consumes only
this generated artifact → **client/ide self-contained** (the build does not need the parent `shared/`, making subtree pull safe).
Verification: `shared/check-ide-selfcontained.sh`.

## 3. Executed Refactor

| Stage | Content |
|------|------|
| Assembly | `git subtree add` → `ide/`(after unshallow)·`rs/`; remove native/ |
| G001 identity SoT | `shared/identity/` + consistency check(14 consumers) |
| G002 screen-protocol SoT | `shared/screen-protocol/` + check(rs↔ide 19 items) |
| ~~G003 onboarding SoT~~ | *removed* — the `shared/onboarding/` step model and web wizard were retired; onboarding is being redesigned as two Electron windows (see §2) |
| G004 ide self-containment | generate-contracts.mjs + generated/ + extension.js wiring |

## 4. Full Verification
```bash
shared/identity/check-identity.sh
shared/screen-protocol/check-screen-protocol.sh
shared/check-ide-selfcontained.sh
```

## 5. Known Gaps (IDE incomplete / follow-up)
- **remotepair/ext bundling not wired**: not bound into the builtInExtensions of the `vendor/vscodium` build (currently `.vsix`/dev only).
  When the IDE is complete, the inject stage (build.sh wrapper) needs to register generate-contracts + the ext bundle.
- **rs/ self-containment not applied**: rs still does not reference shared directly (literals are kept, consistency only enforced by check). Rust codegen possible in the future.
- **version consistency policy**: components keep independent versions (host 0.4.12 / ide·rs 0.1.0) — unification is not enforced.

## 6. upstream Sync (Vendor separation / Option C)
`client/ide/vendor/vscodium/` directly tracks **pristine VSCodium** (github.com/VSCodium/vscodium, remote `vscodium`)
via git subtree. RemotePair files live only in `remotepair/` and do not enter the tracked subtree, so
pull has **structurally zero conflicts**:
```bash
git subtree pull --prefix=client/ide/vendor/vscodium vscodium <tag> --squash
```
Current anchor: VSCodium `1.121.03429` (VS Code 1.121.0, MS commit `987c9597…`).
> The old standalone `remotepair-ide` repo (a fork with RemotePair files mixed into the recipe) is **retired**. The previous
> `git subtree pull --prefix=ide` path is deprecated.
