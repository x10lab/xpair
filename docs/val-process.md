# Verification Process — reproducible runbook

This document lets another session reproduce the full user-flow verification pipeline 100%,
including the exact worker-prompt contracts. Control plane = the main Claude session
(decompose / dispatch / verify / integrate). Workers = headless `codex exec` (subscription auth),
run in parallel and collected from files. Cap: up to ~50–100 concurrent (codex exec is heavy;
ramp and watch load average).

## 0. The model: 예상 / 현행 / 추론

Each flow-tree node row is `ID | 동작(action) | 예상(expected) | 현행(current) | flag`.
- **예상 (ideal)** — what the flow SHOULD do. AI-written in the tree → **untrusted**, must be anchored.
- **현행 (current)** — what the code does now. codex read real code to fill it → evidence-based but can be **stale**.
- **추론 (requirements-derived ideal)** — derived from `docs/requirements.md` (the only user-query-backed SSOT). **The real target.**

The three verification axes:
1. **예상 vs 추론** — is the ideal sound? → verdict BACKED / UNSPECIFIED / CONTRADICTS (Phase A).
2. **현행 vs 추론** — does the code match the requirement? → executable tests, RED/GREEN (Phase B).
3. **flow path validity** — does the flow PATH still exist in the product? → BFS top-down (Phase C).

Key rule (from the user): **a flow can be 현행 == 예상 yet both != 추론** (silent defect). So never
derive 현행-vs-추론 transitively — test 현행 against 추론 (the requirement) directly. Tests are the
ground truth, immune to stale 현행/예상.

## 1. Inputs & artifacts

- `docs/subagents/` — user-flow tree. Base-36 step IDs; 1 step = 3 depths; `0` = terminal flag
  (ID ending in 0 has no children); flags ∈ {continue(implicit), `terminate`, `route to: XXX`};
  unintended VSCodium features → branch + "접근 불가" + block descent. Generation spec is in `AGENTS.md`.
  Different ID = different flow (path). Same text under different IDs = different flows (keep separate);
  collapse only for compute (judge identical text once, emit per ID). Seam dups: a node appears in its
  own `<id>.md` and in an ancestor's expansion table — benign if identical, defect if divergent.
- `docs/requirements.md` — SSOT (user-query provenance; close the opencode/codex gap, see §5).
- Outputs: `docs/verification/fulltree-verdicts.csv` (Phase A, one row per flow),
  the behavior `*.test.{js,cjs}` files + run results (Phase B),
  `docs/verification/fulltree-validity.md` (Phase C).

## 2. Phase A — verdicts (예상 vs requirements)

1. Extract distinct `(동작, 예상)` pairs from all `docs/subagents/*.md` (5-col rows only; skip headers).
   Whitespace-flexible regex: `^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|`.
2. Partition distinct pairs into N slices (TSV: `idx<TAB>act<TAB>exp<TAB>occur<TAB>sample_ids`).
3. Launch N `codex exec` workers (one per slice), contract = **VERDICT CONTRACT** (§6.1).
   `nohup codex exec -C <repo> --dangerously-bypass-approvals-and-sandbox -o <last> "<prompt>" &`
4. Validate: every idx judged, 0 missing, **0 hallucinated Q-IDs** (cross-check cited Q-IDs exist in
   requirements.md). Dedup duplicate idx lines last-wins.
5. Assemble `fulltree-verdicts.csv`: parse every tree row → unique ID; map `(동작,예상)`→verdict;
   emit `id,depth,동작,예상,tree_flag,verdict,req_section,evidence,dup_status`. Flag
   `inconsistent-duplicate` where one ID has >1 distinct `(동작,예상)`.
6. Adversarial audit the CONTRADICTS (control plane): verify each quote actually supports the conflict;
   demote over-literal ones to UNSPECIFIED. (e.g. FDA "avoid unnecessary perms" ≠ "FDA forbidden".)

## 3. Phase B — behavior tests (현행 vs 추론)

1. Clusters = BACKED+CONTRADICTS rows grouped by normalized requirement section. (Test EVERY
   requirement-backed behavior, not only `현행≠예상` ones — silent defects hide in `현행==예상`.)
2. Launch workers (one per cluster batch), contract = **TEST CONTRACT** (§6.2). Each locates the REAL
   code, writes a `node:assert` source-assertion test in the house style (study
   `client/ide/remotepair/ext/onboarding-routing.test.js`), asserts the **intended** behavior (so RED
   where code diverges), runs it, reports `REDGREEN <pass> <fail>`. `.cjs` where the nearest
   package.json has `"type":"module"` (host/onboarding), else `.test.js`.
3. Control plane runs every test itself for the authoritative tally: GREEN (compliant / stale-현행
   false alarm) vs RED (real gap) vs ERROR (broken test → fix). The 18 RED = fix backlog.
4. Tests assert intended behavior on purpose → a later fix pass turns RED → GREEN.

## 4. Phase C — flow-path validity (BFS)

1. Per top-level 3-digit root, collect shallow nodes (depth ≤7): `id<TAB>동작<TAB>예상<TAB>flag`.
2. Launch one worker per root, contract = **VALIDITY CONTRACT** (§6.3). Each reads the REAL entry-flow
   code, walks shallow nodes shortest-ID-first, marks each VALID / STALE; **cascade**: a stale node
   makes its whole prefix-subtree stale (report prefix once, don't descend). Output per-root report +
   `STALE_PREFIXES <n>`.
3. Consolidate reports → `docs/verification/fulltree-validity.md`.

## 5. Provenance gap closure (must do before trusting requirements.md)

requirements.md was first built from Claude Code logs only (`~/.claude/projects`). The user also drove
the project in **opencode** (`~/.local/share/opencode/opencode.db` — sqlite: tables session/message/part;
filter `session.directory LIKE '%<repo>%' AND parent_id IS NULL`, role=user) and **codex**
(`~/.codex/sessions/**/rollout-*.jsonl`, filter user turns, drop `<user_action>`/`<environment_context>`
wrappers). Extract human-only Qs, drop greetings/ops/loop-control/terminal pastes, fold product-relevant
ones into requirements-raw.md + requirements.md (source-tagged). codex yielded ~0 product Qs; opencode
yielded the terminal-UX + RD-reconnect + host-first + engine-ordering requirements (Q0543–Q0552).

## 6. Worker contracts (verbatim — the reproducible prompts)

### 6.1 VERDICT CONTRACT
```
Judge each flow expectation against the ONLY authority: docs/requirements.md (user-query-backed).
Do NOT use docs/subagents/ or docs/behavioral-spec/ as authority.
Input slice TSV (no header): idx<TAB>act(동작)<TAB>exp(예상)<TAB>occur<TAB>sample_ids. Judge `exp`.
For each idx emit one line: idx<TAB>verdict<TAB>section<TAB>evidence
  - verdict ∈ BACKED | UNSPECIFIED | CONTRADICTS
  - section: requirements.md §X.Y (+ Q-IDs), or `-` for UNSPECIFIED
  - evidence: BACKED/CONTRADICTS → a SHORT verbatim quote copied from requirements.md (1-hop audit);
              UNSPECIFIED → ≤10-word reason. One line, no tabs/newlines inside.
Discipline: default to UNSPECIFIED when silent/unsure. CONTRADICTS only on explicit conflict (quote it).
No invented Q-IDs/quotes. Exactly one output line per input idx. Write all lines to the given .tsv,
then print `DONE <n>`.
```

### 6.2 TEST CONTRACT
```
Write ONE runnable test asserting a requirements-backed INTENDED behavior (추론) against the ACTUAL code,
so it goes RED where code is wrong and GREEN where it complies. docs/requirements.md is the only authority.
Input: cluster spec (requirement §+Q-IDs, a verbatim requirement quote = 추론, representative 예상 strings,
sample flow IDs). Steps: (1) identify the concrete checkable behavior; (2) LOCATE the real current code
(explore host/onboarding/src, client/ide/remotepair/ext, client/cli, host/rd, host/app — do NOT trust any
현행 claim, read the code); (3) write a test in the house style (node:assert/strict + small test(name,fn)
runner, read source files with fs and assert on them; cite the Q-ID in each test name; .cjs if nearest
package.json is type:module else .test.js); (4) RUN it with node. Assert INTENDED behavior, not current —
RED is expected where not yet implemented. Output: write the test next to the code (or matching ext/ test
dir); print the path, PASS/FAIL+reason per test, and `REDGREEN <nPass> <nFail>`. Tests only, no other edits.
```

### 6.3 VALIDITY CONTRACT
```
Check whether each flow PATH still EXISTS in the current product (not behavior — existence). Flows can be
stale: screen redesigned, step removed, button renamed, action unreachable. Input: spec listing a root's
shallow nodes (depth ≤7): id<TAB>동작<TAB>예상<TAB>flag. Method (BFS top-down): (1) identify the entry flow
from root+nodes; (2) LOCATE the real current code/UI (do NOT trust 현행/예상, read it); (3) walk nodes
shortest-ID-first, judge each VALID (step/action real) or STALE (no longer exists / diverges from real step
sequence); (4) CASCADE: if a node is STALE, all longer IDs with that prefix are STALE — report the prefix
once, don't descend. Output report: `## <root>` + entry flow + files read; `### STALE` bullets
`<id-prefix> : one-line reason`; `### VALID` one line; final `STALE_PREFIXES <n>`. Read-only.
```

## 7. Reproduction notes / gotchas
- **codex auth must be ChatGPT subscription**, not API key: `codex login status`; if `sk-proj`, run
  `codex logout && codex login`. (API-key billing otherwise.)
- `codex exec` is far more reliable for batch than tmux-pane runtimes (omc team) — headless, `-o` file
  output, nohup background, collect from files. Watch for MCP-startup 401 noise (harmless in exec).
- Counts shift with parse strictness — anchor on the committed CSV, use the 5-col regex consistently.
- "1 test covers N flows" is valid: many flows share one code point; a coverage ledger keyed by distinct
  `(동작,예상)` (not by requirement section — too coarse) prevents silently dropping flows.
- Deeper expansion has diminishing returns: distinct-behavior count plateaus (~depth 18, +0 new at 19),
  so don't expand the frontier just for completeness.
- Git: work on shared `develop`; main protected (develop→PR→main); commit only touched files (no `git add
  -A`, no `.omo/`); risky code-fix work in a worktree based on `origin/develop`, merge back to develop.
