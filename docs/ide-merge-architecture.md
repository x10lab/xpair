# RemotePair × IDE Integration Architecture & Refactoring Strategy

> ✅ **Executed** — for the current structure see [`docs/monorepo-structure.md`](monorepo-structure.md). This document is the *pre-*integration planning record (the actual outcome added rs/, removed native/, and reflected the shared SoT).

> **Status:** Stage 1 — **strategy design document** for agreeing on direction. Once approved, it expands into an execution runbook (Stage 2).
> **Scope:** folder/architecture structure · coupling structure · refactoring strategy. **Does not include code implementation** (code is written directly).
> **Derivation:** 5 rounds of deep-interview (ambiguity 100%→~14%). Full record: `.omc/specs/deep-interview-ide-merge.md`.

---

## 0. One-Line Summary

Absorb `remotepair-ide` (VSCodium fork, v0.1.0, incomplete) into `remote-pair` as a **single monorepo**. With the following caveats:
- Place the IDE as the `ide/` **subtree**,
- Extract the contracts shared by the two codebases into a `shared/` **SoT** (injected into the IDE at build time),
- Proceed in the order **"refactor first → subtree merge → the old IDE repo survives as VSCodium-tracking staging."**

---

## 1. Starting Point (Measured Status)

The two repos have **0 byte-identical files** — they are not "the same code with files merely relocated" but **complementary, separate codebases**.

| | `remote-pair` (product core, v0.4.12) | `remotepair-ide` (IDE, v0.1.0 · incomplete) |
|---|---|---|
| Identity | host/client/CLI + onboarding + Rust screen sidecar | **VSCodium fork** (shallow, upstream=VSCodium/vscodium) |
| Core tree | `host/` `client/` `native/` `shared/` `tests/` | `remotepair-ext/` `patches/` `product.json` + build scripts |
| Screen | `rs/screen` — v1a (WS+JPEG) done, v1b (WebRTC) TODO | `remotepair-ext/media/remote-desktop.js` — webview consuming the sidecar WS |
| Onboarding | to be implemented as two Electron windows (host in RemotePairHost, client in RemotePair IDE), based on the mockup — not yet built; the prior browser-based web wizard was removed | 4 walkthroughs (+ patch turning the default VSCode onboarding OFF) |
| Size | `.git` 4.4M | `.git` 12M (shallow) · working tree **6.9G = entirely gitignored build artifacts** |

**The 4 seams the integration must address:**
1. **Screen protocol** — WS+JPEG frames (127.0.0.1, `ssh -L` tunnel) + reverse input transport (relative coordinates/keys). Defined by the sidecar, consumed by the IDE webview and web client. → **Single-contract candidate.**
2. **Onboarding** — the same concepts (permissions/connect/file-access) are expressed across **two surfaces**: the (to-be-built) Electron onboarding windows and the IDE walkthroughs. The onboarding is being redesigned as two Electron windows (host in RemotePairHost, client in RemotePair IDE), based on the mockup — not yet built; the prior browser-based web wizard was removed.
3. **Version/branding** — 0.4.12 (Casks/README) vs 0.1.0 (product.json).
4. **Launch glue** — `client/cli/remote-pair-editor` · `remote-pair-desktop`.

---

## 2. Decisions (5 Rounds of deep-interview)

| # | Question | Decision | Rejected |
|---|------|------|------|
| R1 | Final repo form | **Single monorepo** (IDE=subtree) | Hub+submodule, frozen absorption |
| R2 | Folder layout | **Incremental**: keep the root + `ide/` + strengthen `shared/` SoT | Full reorg, minimal drop-in |
| R3 | `ide/`↔`shared/` coupling | **Build-time generate/copy** (ide/ self-contained) | Direct cross-import, packaging |
| R4 | Merge order | **Refactor-first → merge → old repo=staging** | Merge-first/discard, direction reversal |
| R5 | Deliverable | **Strategy doc → approval → runbook** | Runbook alone, strategy doc alone |

**Fully rejected alternatives:** full root merge (causes only root conflicts · 0 dedup benefit), git submodule (the request was "merge into the repo"), direction reversal (making the IDE the umbrella), VSCodium frozen absorption (the burden of manually handling upstream security/feature updates).

---

## 3. Target Structure (#1)

```
remote-pair/                       ← single monorepo root (keep current structure)
├─ host/                           RemotePairHost · hooks · approve-router · ocr-find
│                                  (will embed the host-side Electron onboarding window — not yet built)
├─ client/                         7 CLIs
├─ native/
│   └─ screen/         Rust sidecar (v1a WS+JPEG · v1b WebRTC)
│       └─ (protocol constants/formats reference shared/screen-protocol/)
│
├─ ide/                            ◀ NEW: remotepair-ide subtree
│   ├─ remotepair-ext/             extension (self-contained — includes generated contracts)
│   ├─ patches/                    VSCodium patches (brand/onboarding/frontend)
│   ├─ product.json  build.sh ...  VSCodium build wrapper
│   └─ vscode/  VSCode-darwin-*/   ← gitignore (regenerated)
│
├─ shared/                         ◀ strengthened: single SoT (where contracts are defined)
│   ├─ screen-protocol/            WS path · JPEG framing · input event (+v1b) contract
│   │                              (former shared/onboarding/ step-model SoT was deleted — blank slate, TBD with the Electron onboarding)
│   └─ identity/                   brand name · single version source
│
├─ docs/  tests/  assets/  Casks/  .github/
└─ (context/ = untracked reference, left as-is)
```

### Current → Target Mapping

| Current location | Target | Change |
|-----------|------|------|
| `remote-pair/host/` | `host/` | as-is |
| `remote-pair/client/` | `client/` | as-is (the onboarding **step model** is a blank slate — TBD with the Electron onboarding; the former `shared/onboarding/` SoT was deleted) |
| `remote-pair/rs/screen/` | `rs/screen/` | extract protocol constants/formats to `shared/screen-protocol/` |
| `remote-pair/shared/` | `shared/` | + `screen-protocol/` `onboarding/` `identity/` |
| `remotepair-ide/` (415 tracked files) | `ide/` | enter as a subtree, make `remotepair-ext` self-contained |
| `remotepair-ide/vscode/` etc. 6.9G | `ide/…` (gitignore) | not tracked |
| Version (Casks/README ↔ product.json) | `shared/identity/` | reconcile to a single version source |

---

## 4. Coupling Structure (#2)

Core principle: **`shared/` is the SoT of contracts. `ide/` is self-contained.** The IDE does not import `shared/` directly at runtime; instead, **the build prepare step generates/copies the required contracts into `remotepair-ext`**.

```
            shared/screen-protocol/                              shared/identity/
                  │  (SoT: .ts/.json contracts · constants · version)
                  │  (former shared/onboarding/ step-model SoT was deleted — blank slate)
        ┌─────────┼───────────────────────────────────────────┬───────────────────────┐
        │ direct  │ direct                                     │ prepare build: generate/copy
        ▼ ref     ▼ ref                                        ▼                       ▼
   native/      onboarding Electron windows                    host/                 ide/remotepair-ext/
 remote-pair-   (host + IDE — not yet built, no shared SoT)   (identity · version)  (includes generated contracts = self-contained)
   screen                                                                              │
                                                                          subtree pull ▼ ← VSCodium-IDE repo
                                                                          no conflicts (ext holds only generated artifacts)
```

- **sidecar · onboarding windows · host** = same-repo modules, so referencing `shared/` directly is fine.
- **`ide/remotepair-ext`** = inside the subtree that follows VSCodium → **direct reference forbidden.** The prepare build injects the contracts. As a result:
  - on `git subtree pull` (reflecting VSCodium updates) there are no `shared/` path conflicts,
  - the build does not break even with the standalone `remotepair-ide` repo alone.
- **Boundary rule (invariant):** the `ide/` tree must have no build/runtime dependency on parent-repo paths (`../shared`, etc.). Dependencies are only via "generated artifacts."

---

## 5. Refactoring Strategy (#3)

**Order is key — refactor before merge.** (If self-containment is done after the merge, the boundary gets muddied on top of a heavy tree.)

```
[1] in-place refactor of both repos (each in its own repo)
    ├─ remotepair-ide:  make remotepair-ext self-contained
    │                   (restructure contracts from external-reference → generated-artifact consumption)
    └─ remote-pair:     extract shared/{screen-protocol,onboarding,identity}
                        (make sidecar · onboarding windows · host reference shared/)
                 │
[2] subtree merge  ▼
    in remote-pair:  git subtree add --prefix=ide <remotepair-ide> <ref>
    → enters at remote-pair/ide/  (vscode/ etc. gitignored)
                 │
[3] staging survives  ▼
    remotepair-ide repo = kept as VSCodium-tracking staging
    ├─ future VSCodium updates are absorbed here first (get_repo.sh/update_upstream.sh),
    └─ remote-pair pulls them in via git subtree pull --prefix=ide
```

### Move/Unify/Extract Classification

| Action | Target |
|------|------|
| **move** | remotepair-ide tracked tree → `ide/` (subtree) |
| **extract** | screen protocol constants · onboarding step model · version → `shared/` |
| **unify** | version unification (0.4.12/0.1.0 policy), brand identity → `shared/identity/` |
| **keep** | host/ · CLI · sidecar core logic, VSCodium build wrapper |
| **ignore** | `ide/vscode/` `ide/VSCode-darwin-*/` `*.dmg` `node_modules` |

### git Mechanics & Caveats

- **shallow clone:** `remotepair-ide` is currently shallow (an earlier `git fetch` was rejected with `shallow roots…`). To survive as staging, **`git fetch --unshallow`** (downloading VSCodium's full history) must precede it for subtree add/pull to be stable.
- **subtree pull conflicts:** if a VSCodium update meets `patches/` · `remotepair-ext` changes, conflicts are possible → resolve in the staging repo first, then pull.
- **gitignore:** before the merge, add `ide/vscode/`, `ide/VSCode-darwin-*/`, `ide/**/node_modules/`, `ide/*.dmg` to the remote-pair `.gitignore`.
- **keep builds working during transition:** at any point between [1] and [2], both sides must be independently buildable (the self-contained principle guarantees this).

---

## 6. Risks & Items to Decide at the Runbook Stage

| Item | Note |
|------|------|
| shallow → unshallow | need to check VSCodium full-history size/time |
| version reconciliation policy | unify on 0.4.12? Independent IDE version? — finalized in the runbook |
| onboarding SoT scope | this stage covers only the "step-model-sharing **structure**". The onboarding itself is to be implemented as two Electron windows (host in RemotePairHost, client in RemotePair IDE), based on the mockup — not yet built; the prior browser-based web wizard was removed. The render + walkthrough implementation is code work (user) |
| screen protocol v1b | WebRTC is future on both sides — design the contract to be extensible to v1a/v1b |
| exact file-move map | per-file in the runbook |

---

## 7. Next Steps

1. **Approve this document (strategy)** ← current gate
2. Upon approval → **execution runbook (Stage 2)**: file-move map · `git`/shell command sequence · `.gitignore` diff · prepare-build generation steps · step-by-step checklist (directly executable as written)
3. The code refactor·merge execution is performed by the **user**. Let me know when done and I'll support the next step.
