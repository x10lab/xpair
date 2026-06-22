# Behavioral Spec — Onboarding: Engine Gate

> **Layer:** This is the missing middle layer between [requirements.md](../requirements.md)
> (user-query-backed principles) and [subagents/](../subagents/) (per-click flow tree).
>
> **Provenance rule (inherited from requirements.md):** every expected behavior below
> must cite a `requirements.md` section (which in turn cites user Q-IDs). A behavior with
> no requirement backing is **not** spec — it is logged under *Open Issues* and must not be
> asserted as expected. AI-invented expectations from the flow tree are demoted here.
>
> **Current-state rule:** there is intentionally **no "current behavior" column**. Whether
> the implementation matches each rule is answered by tests (see *Test target*), not by a
> hand-written/AI-inferred snapshot that rots on the next commit.
>
> **Scope:** M1 onboarding, engine gate cluster. Source cluster: `/tmp/m1_clusters/06-engine-gate.txt`.

---

## R1 — Required Host permissions block Engine readiness

Host onboarding must not mark setup usable, or advance as though setup succeeded, while required
macOS permission/TCC grants are unresolved. Permission recovery actions may reopen or return to
the relevant onboarding step; after the user grants permissions, onboarding must re-check the
permission state before treating the Host as ready.

- **Anchor:** requirements.md §1.5 (Q0443) — "Host onboarding must resolve required macOS
  permissions before the Host is considered usable." · §1.2 (Q0473, Q0493, Q0494) — permission
  and Settings actions should reopen the relevant onboarding step.
- **Test target:** host permission guard plus client `onboarding-bridge` permission retry/recheck path.

## R2 — The Engine gate supports only selected, explicit agent tools

When the user reaches the Engine step, Xpair may offer Claude, Codex, and OpenCode as supported
engine choices. Selecting an engine starts that engine's gate; unsupported engines, arbitrary
engine paths, and unrelated IDE/workbench surfaces are outside the onboarding flow.

- **Anchor:** requirements.md §1.3 (Q0541) — "If the user chooses Claude, Codex, or OpenCode
  support, onboarding should check for that tool..." · §1.8 (Q0540, Q0541) — terminal/session
  creation supports explicitly selected agents. · §1.2 (Q0369, Q0421, Q0424, Q0426) — Client
  onboarding is pre-workbench and should not appear as an editor tab or alongside the workbench.
- **Test target:** client Engine-step engine selector and onboarding shell route guards.

## R3 — Engine readiness requires installed and authenticated state

For the selected supported engine, onboarding must probe both installation and authentication
state. The Engine step's Next/Continue action stays unavailable until the selected engine is
both installed and authenticated.

- **Anchor:** requirements.md §1.3 (Q0541) — onboarding should check the selected Claude,
  Codex, or OpenCode tool and help install/configure required environment variables. · §5 M1
  — onboarding hardening includes selected agent tool gates.
- **Test target:** host `EngineGuard` installed/authed probe and client Engine-step readiness reducer.

## R4 — Missing engine install resolves through install help, then re-probe

If the selected engine is not installed, onboarding must present an install or setup action for
that selected engine and keep Engine readiness false while install is unresolved. After an install
action reports completion, onboarding re-runs the selected engine probe rather than assuming ready.

- **Anchor:** requirements.md §1.3 (Q0541) — onboarding should "help install/configure required
  environment variables" for the selected tool. · §1.1 (Q0006, Q0007, Q0020, Q0026) — normal
  users should not need source-build setup as the default path.
- **Test target:** host engine installer adapter and client install-success re-probe event.

## R5 — Missing engine auth resolves through auth guidance, then re-probe

If the selected engine is installed but not authenticated, onboarding must present authentication
guidance for that selected engine and keep Engine readiness false. When the user supplies or
updates auth material, or completes external login, onboarding re-runs the selected engine probe
before enabling Next/Continue.

- **Anchor:** requirements.md §1.3 (Q0541) — onboarding should help configure required
  environment variables for the selected Claude, Codex, or OpenCode support.
- **Test target:** host `EngineGuard` auth probe, API-key/env update path, and external-login recheck path.

## R6 — Engine probe, install, and auth failures remain retryable but blocked

If an engine status check, install action, start/restart action, or auth action fails, onboarding
must keep Engine readiness false and preserve resolving actions such as retry/recheck, fixing the
same engine, or selecting a different supported engine. The flow must not silently continue with an
unready engine.

- **Anchor:** requirements.md §1.3 (Q0541) — the selected tool is checked and configured as an
  onboarding gate. · requirements.md §1.3 (Q0533, Q0534, Q0536, Q0537) — CLI-dependent hard
  gates block with a clear reason rather than proceeding silently; the same gating principle
  applies to selected engine gates in §5 M1.
- **Test target:** `EngineGuard` failure states and client Engine-step retry/change-engine transitions.

## R7 — Closing or cancelling before gates pass leaves onboarding incomplete

If the user closes, cancels, or stops onboarding before required permissions and the selected
engine gate are complete, onboarding must not mark setup complete. Returning to setup should route
back to the relevant unfinished onboarding step rather than opening the finished IDE surface.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — Client onboarding closes only after
  necessary setup is complete. · §1.5 (Q0443) — unresolved TCC must not be treated as successful
  setup. · §1.3 (Q0541) — selected agent tool checks belong in onboarding.
- **Test target:** onboarding persistence/routing state and unfinished Engine-step close/cancel handling.

## R8 — Passing Engine and permission gates unlocks the next onboarding surface

After required Host permissions and the selected engine gate pass, onboarding may enable explicit
user continuation into the next setup surface, such as connection, session, mapping, or project
setup. Readiness alone should not imply that arbitrary workbench surfaces are already available.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — Client onboarding owns the pre-workbench
  setup before the IDE opens into the intended working surface. · §1.6 (Q0056, Q0153, Q0154) —
  the product centers on launching/attaching persistent host sessions. · §1.7 (Q0041, Q0042,
  Q0043, Q0414) — file access proceeds through mapping-oriented UX rather than arbitrary folder opening.
- **Test target:** Engine-ready Next/Continue transition into connect/session/mapping setup.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **Exact required TCC matrix:** the cluster repeatedly names Accessibility, Screen Recording,
  and optional FDA-like decisions, but requirements.md only says required macOS permissions/TCC
  must be resolved and unnecessary grants avoided (§1.5, Q0443; §0.3, Q0025, Q0101, Q0245).
  The exact AX/SR/FDA matrix and optional-vs-required labels need a user-backed decision before
  tests assert the detailed matrix.
- **Exact Engine-step UI copy and controls:** button labels such as Install, Retry, Restart engine,
  Re-check, API key entry, external login, and progress wording are derived from the flow tree.
  They are consistent with §1.3's broad install/configure gate, but their exact copy, placement,
  timeout behavior, and failure taxonomy are not separately Q-backed.
- **Engine start/restart semantics:** the cluster includes start/restart engine actions and host
  restart recovery. requirements.md backs checking and configuring selected tools (§1.3, Q0541)
  but does not specify which component is restarted, how long to wait, or how restart success is
  detected.
- **Exact post-gate screen order:** the cluster alternates among Connect, Waiting, Done, project
  selection, mapping, and session creation. requirements.md backs those domains separately
  (§1.6, §1.7, §1.8), but not a single ordered state machine after Engine readiness.
- **Host-first manual setup / XpairHost advertisement route:** requirements.md requires Host
  onboarding and TCC resolution (§1.2, §1.5), while §4 keeps the detailed six-digit/sign-in/
  host-install pairing UX open (Q0430, Q0440). Host-first transitions should route to existing
  backed onboarding branches or terminate until the pairing UX is specified.

---

_Cluster output for M1 onboarding fan-out. Anchored from `/tmp/m1_clusters/06-engine-gate.txt`
to `requirements.md`; flow-tree-only details are demoted to Open Issues._
