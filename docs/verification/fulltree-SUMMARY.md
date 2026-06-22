# Full-tree Verification Summary — every flow vs requirements.md

Companion to `fulltree-verdicts.csv` (one row per unique flow ID, openable in Excel).

## Method
- Every distinct (동작→예상) expectation in `docs/subagents/` (8,568 units) judged **directly against
  requirements.md** (the only user-query-backed authority — behavior-spec/ NOT used). 16 codex workers,
  each verdict carrying a verbatim requirement quote; default UNSPECIFIED when silent.
- Verdicts joined back to **every flow ID** (path-independent: requirements-backing of an expectation
  does not change with the path that reaches it). Output = `fulltree-verdicts.csv`, one row per unique
  flow ID with verdict + req §/Q-ID + evidence quote, so any row is auditable in one hop.
- Integrity: 8,568/8,568 units judged, 0 missing, **0 hallucinated Q-IDs**.

## Coverage
- **22,594 unique flow IDs**, each verdict'd: UNSPECIFIED 15,453 (68%) · BACKED 7,127 (32%) · CONTRADICTS 13.
- **208 inconsistent-duplicate IDs** flagged (`dup_status` column): same flow ID defined in 2+ files with
  *different* expected text. Root cause = step/subagent seam overlap (benign for the 1,995 consistent
  dups; these 208 are where the two definitions disagree → structural cleanup needed).

## Confirmed contradictions (13, after control-plane adversarial audit)
Three themes — all trace to requirements recovered from opencode (Q0543) or the IDE-UX rules:

1. **Host onboarding completes / reports "ready" with no connected client (Q0543) — ~7 flows.**
   e.g. 412221, 41212241, 412221311, 41222111111. The tree advances to Done / host-ready / serving with
   no client; the requirement says hold at the permission step, do not report completion.
2. **"접근 불가" (access-denied) over-flagging — 4 flows.** The tree blocks features the requirements
   say MUST work:
   - `31242132` terminal copy/scrollback → access-denied, but Q0550/Q0551: *"copy/paste (cmd+c/cmd+v) …
     must function."* (← the exact opencode-recovered terminal-UX requirement)
   - `3124213132` shell session switch → access-denied, but Q0541: *"…should support Claude, Shell, Codex."*
   - `3122111112`, `3122113112` XpairHost-first → access-denied, but Q0543: *"Starting XpairHost before
     any client is acceptable."* (tree is too restrictive here)
3. **Onboarding moves to Done before setup is complete (Q0369) — 1 flow.** `4121214`.

## Adversarial corrections
- `1332` (§1.7 Add Mapping): Round-1 marked CONTRADICTS, but the expectation ("show Add Root, not native
  Open Folder") **agrees** with Q0414 → corrected to **BACKED** in the CSV.

## Read this as
- **CONTRADICTS (13)** = actionable defects in the flow tree where its expected behavior disagrees with
  what the user actually asked for. Two are "tree too permissive" (Q0543 completion); four are "tree too
  restrictive" (wrongly access-denied); one is premature Done.
- **UNSPECIFIED (15,453)** = requirements.md is silent. Not bugs — product-decision backlog.
- **BACKED (7,127)** = expectation is supported by a cited requirement.
- The whole-tree result confirms the M1 finding at scale: the single dominant real defect is the
  no-client-completion family (Q0543), and the gap-closure (recovering Q0543/Q0550 from opencode) is what
  made the contradictions detectable at all.
