# Verification Summary — flow-tree 예상 vs requirements.md (M1 onboarding)

Round 1: 7 codex workers classified each cluster's distinct 예상 against **requirements.md only**
(BACKED / UNSPECIFIED / CONTRADICTS, every BACKED/CONTRADICTS carrying a verbatim requirement quote).
Round 2 (this file): control-plane adversarial audit of all CONTRADICTS, by Claude, against the same
single authority — refuting over-literal verdicts and confirming the rest.

## Totals (Round 1)
- BACKED 71 · UNSPECIFIED 163 · CONTRADICTS 10 (244 distinct 예상). Zero hallucinated Q-IDs.
- discovery, telemetry-consent: CONTRADICTS=0 (clean — matches earlier manual finding).

## Headline
**9 of 10 contradictions trace to the two requirements just recovered from opencode (Q0543, Q0545).**
Had we not closed the provenance gap, these flow-tree expectations would have been scored
UNSPECIFIED and the conflict would have stayed invisible. The gap-closure is what surfaced them.

## Confirmed contradictions (after adversarial audit)

### C1 — Engine step sequenced AFTER host setup → **RESOLVED (not a defect)**
Clusters: engine-gate (3), reconnect (1), ssh-keyauth (1), step-progression (1).
Round 1 flagged these against the original Q0545 ("engine before device-name/host-setup"). On review
(2026-06-22) the user **revised Q0545**: engine selection should be **device-first** — select the host,
then probe which engine binaries are installed on it and show available options, with "Other…" to
install. Under the revised requirement, the flow tree's engine-after-host ordering is **correct**, so
these 6 are no longer contradictions. (This is the verification working as intended: surfacing the
tension forced the requirement to be made precise, and the flow tree turned out to be right.)

### C2 — Host onboarding completes / reports ready with NO connected client (violates Q0543) — ~3 instances
Clusters: reconnect (1), step-progression (1), tcc-permissions (1).
The flow tree expects no-client states to advance to Done / host-ready / "serving".
- Requirement (Q0543, §1.5): *"with no connected client the Host onboarding is expected to hold at the
  permission step rather than report completion."*
- Verbatim quotes confirmed. **Real contradiction** — flow tree disagrees with stated user intent.

## Reclassified (adversarial audit overturned Round 1)

### R1 — FDA as a recommended permission → demote CONTRADICTS → UNSPECIFIED
tcc-permissions flagged "treat FDA / Full Disk Access as a recommended onboarding permission" as
contradicting §1.5 *"Avoid requesting unnecessary permissions."* **Over-reach:** requirements.md never
forbids FDA; whether FDA is necessary is undecided. This is UNSPECIFIED (a decision), not a contradiction.

## The real backlog: UNSPECIFIED = 163
Most flow-tree 예상 are neither backed nor contradicted — requirements.md is silent. These are
product decisions the user must make (host-install pairing UX, Connect/Reconnect taxonomy, permission
gate formulas, Tailscale state machine, etc.), already partly tracked in requirements.md §4 Open Issues.

## Net actionable output
- **1 confirmed contradiction (C2)** = real defect: flow tree completes Host onboarding with no client,
  against Q0543.
- **C1 resolved by requirement revision** (Q0545 → device-first engine selection); flow tree was right.
- **1 false positive removed** by adversarial audit (FDA → UNSPECIFIED).
- **163 UNSPECIFIED** = decision backlog, not bugs.
- Verification ran against requirements.md directly; behavioral-spec/ was NOT used as authority.

## Closing note
Of 10 raw contradictions: 1 real (C2), 6 dissolved by making Q0545 precise (C1), 1 false positive (FDA),
2 are the engine-ordering duplicates folded into C1. The single actionable defect is C2. The exercise's
real yield was forcing requirements.md to be precise where the flow tree exposed ambiguity.
