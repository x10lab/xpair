# RemotePair × IDE Integration Execution Runbook (Stage 2)

> ✅ **Executed** — for the current structure, see [`docs/monorepo-structure.md`](monorepo-structure.md). This runbook is the *pre*-integration plan; the actual execution proceeded via the ultragoal `monorepo-refactor` (including rs/).

> **Precondition:** `docs/ide-merge-architecture.md` (Stage 1) approved.
> **Roles:** The code refactor is **performed by the user**. This runbook provides the precise **ordering · git mechanics · structural task list · verification checklist** (executable as-is).
> **Branch:** `feat/integrate-remotepair-ide`
> **Invariants:** At every stage, (a) both sides build independently, and (b) `ide/` is self-contained (zero dependency on parent paths).

Key paths:
- Core: `/Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair`
- IDE : `/Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide`

---

## Phase 0 — Pre-checks (safety net)

```bash
# 0.1 Tag current state (rollback point)
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair
git tag pre-ide-merge

# 0.2 Unshallow the IDE repo — essential for stable subtree add/pull
#     (currently shallow, so fetch is rejected with 'shallow roots')
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide
git rev-parse --is-shallow-repository      # if true, run the below
git fetch --unshallow origin
git fetch upstream --no-tags               # also secure VSCodium history (for staging)
git rev-parse --is-shallow-repository      # confirm false
```

- [ ] `pre-ide-merge` tag created
- [ ] `remotepair-ide` unshallow complete (`is-shallow` = false)

---

## Phase 1 — in-place refactor (*before* merge, in each repo) ← user code work

> Goal: clean up both sides first so the boundary is already clean at merge time. **This entire Phase is code work** — the runbook only specifies *what goes where*.

### 1A. `remote-pair`: extract `shared/` SoT

| New location | SoT content | Extraction source | Consumer reference change |
|---------|----------|-----------|------------------|
| `shared/screen-protocol/` | WS path · binding (`127.0.0.1:<port>`) · JPEG framing · input event (relative coords 0..1 / keys) constants · types | protocol comments in `rs/screen/src/serve.rs` | sidecar (serve.rs) references the constants / unify the input back-channel format |
| `shared/identity/` | brand name + **single version source** | `Casks/remote-pair-host.rb` (0.4.12) ↔ `product.json` (0.1.0) | Casks · README · product.json reference this source |

> **Onboarding note:** The role-aware onboarding feature survives, but is being **redesigned from scratch** as two separate Electron onboarding windows — one embedded in **RemotePairHost** (the host Swift app) and one in **RemotePair** (the client VSCodium/Electron IDE) — shown on first install, based on the React/shadcn mockup (`context/remotepair-onboarding`). It is **not yet built**; the prior browser-based web onboarding wizard has been removed. There is therefore no `shared/onboarding/` step model to extract at this time — onboarding is out of scope for the Phase 1A `shared/` extraction until the new Electron windows exist.

- [ ] Extract `shared/screen-protocol/` + change the sidecar to reference it
- [ ] `shared/identity/` single version/brand source + wire up consumers
- [ ] `remote-pair` standalone build/test passes

### 1B. `remotepair-ide`: make `remotepair-ext` self-contained

> Principle: ext does **not import `shared/` directly**. Instead it consumes the **contract files generated from `shared/`**. And those **generated artifacts are committed into `remotepair-ext`** → buildable from the standalone repo alone (self-contained).

- Generation step (run in the monorepo) concept:
  ```
  shared/{screen-protocol,identity}  ──generate──▶  ide/remotepair-ext/generated/*
                                                  (committed → moves along via subtree)
  ```
- Build hook: add a `generate-contracts` step right before `build.sh`/`prepare_vscode.sh` (refreshed only in the monorepo context; output is committed).
- [ ] Clean up `remotepair-ext` so it consumes only the `generated/` contracts (zero external path references)
- [ ] Write the generation step (monorepo-only) + commit the output
- [ ] `remotepair-ide` standalone build (`build.sh`) passes

---

## Phase 2 — subtree merge (in the core repo)

```bash
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair

# 2.1 Add the IDE repo as a remote (reuse if it already exists). After unshallow, fetch succeeds.
git remote add ide /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide 2>/dev/null || true
git fetch ide

# 2.2 Enter the subtree at ide/ (only the 415 tracked files — vscode/ etc. are ignored by ide/.gitignore)
git subtree add --prefix=ide ide master

# 2.3 Verify: that the 6.9G artifacts did not come in
du -sh .git                          # only a few-MB increase is normal
git ls-files ide | wc -l             # ~415
git check-ignore ide/vscode 2>/dev/null && echo "vscode/ ignored ✓"
```

> **gitignore note:** `remotepair-ide/.gitignore` (→ `ide/.gitignore`) **already** ignores `/vscode/` `/VSCode-darwin-*/` `*.dmg` `*.vsix` `**/node_modules/` `**/target/` (nested .gitignore = anchored relative to ide/). Modifying the root `.gitignore` is in principle unnecessary. If you want to be safe, explicitly adding entries like `ide/vscode/` to the root is also fine.

- [ ] `git subtree add --prefix=ide` succeeds
- [ ] `.git` size normal (few-MB increase), `ide/vscode` etc. confirmed untracked
- [ ] In the monorepo, `generate-contracts` → `ide/` build passes

---

## Phase 3 — staging wiring (VSCodium tracking persists)

The `remotepair-ide` repo is not discarded; it is kept as the **staging point for absorbing VSCodium updates**.

```bash
# (workflow for future VSCodium updates)
# 3.1 Absorb VSCodium in the staging repo
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remotepair-ide
./get_repo.sh          # or update_upstream.sh — refresh pinned vscode
git merge upstream/master   # resolve patch conflicts here
git push origin master

# 3.2 Pull into the monorepo
cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair
git subtree pull --prefix=ide ide master
```

- [ ] Rehearse the staging workflow once (verify the pull round-trip with a small change)
- [ ] Conflict resolution first in the staging repo → then subtree pull

---

## Phase 4 — Integration verification checklist

- [ ] `remote-pair` core build/test passes (`tests/`)
- [ ] `ide/` build (`cd ide && build.sh`) produces RemotePair IDE
- [ ] Confirm `shared/` contract unification: sidecar · host · ext reference the **same source**
- [ ] Version consistency: `shared/identity/` makes Casks · README · product.json a single value
- [ ] `ide/` is self-contained: zero parent-path (`../shared`) references inside `ide/` (`grep -rn "\.\./\.\./shared" ide/ || echo clean`)
- [ ] `git subtree pull` round-trip works
- [ ] 6.9G artifacts remain untracked

---

## Command sequence summary (for copy-paste)

```bash
# Phase 0
cd .../remote-pair && git tag pre-ide-merge
cd .../remotepair-ide && git fetch --unshallow origin && git fetch upstream --no-tags

# Phase 1 = code work (extract shared/ + make ext self-contained). Until each repo's standalone build passes.

# Phase 2
cd .../remote-pair
git remote add ide .../remotepair-ide 2>/dev/null || true
git fetch ide
git subtree add --prefix=ide ide master
du -sh .git && git ls-files ide | wc -l

# Phase 3 (for each future VSCodium update)
# in staging: get_repo.sh → merge upstream → push
# in monorepo: git subtree pull --prefix=ide ide master
```

---

## Open → to be decided in progress

| Item | Decision point |
|------|-----------|
| Version consistency policy (unify on 0.4.12 vs IDE independent) | When designing `shared/identity` in Phase 1A |
| Onboarding scope (whether the new Electron onboarding windows share any model) | Deferred until the two Electron onboarding windows (host + client IDE) are built from the mockup |
| Screen protocol v1a/v1b extension shape | When designing `shared/screen-protocol` in Phase 1A |
| `generate-contracts` hook location (build.sh vs separate) | Phase 1B |

> The code refactor (Phase 1) is performed by the **user**. Let me know when each Phase is complete, and we'll proceed together with the next step (verification · merge mechanics).
