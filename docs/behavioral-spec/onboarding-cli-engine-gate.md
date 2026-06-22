# Behavioral Spec — Onboarding: CLI & Engine Install Gates

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
> **Scope:** M1 onboarding, CLI/engine gate cluster. Source flow nodes: `111*`, `411*`, `412*`.

---

## R1 — `xpair` CLI is a hard gate before CLI-dependent steps

When onboarding reaches a step that needs the `xpair` CLI (e.g. host discovery scan) and the
CLI is absent, onboarding installs the bundled CLI **before** letting that step proceed; the
CLI-dependent step stays blocked until install completes.

- **Anchor:** requirements.md §1.3 (Q0533, Q0534, Q0536, Q0537) — "xpair CLI availability is a
  hard product requirement before flows that need it. The onboarding must either install it
  before the hard gate or block with a clear reason." · §1.1 (Q0006, Q0007, Q0020, Q0026) — bundled install path.
- **Test target:** `onboarding-bridge` CLI-presence probe gates the discovery step.

## R2 — CLI install failure blocks with a clear, retryable reason

If bundled CLI install fails, onboarding shows a Retry affordance and a clear failure reason;
the CLI-dependent step remains blocked until a retry succeeds. Exiting at this point aborts
onboarding rather than silently proceeding.

- **Anchor:** requirements.md §1.3 (Q0533, Q0534, Q0536, Q0537) — "block with a clear reason"
  (note: §0.1 Q0533 — a missing `xpair` is an onboarding/product-flow problem, not to be
  silently worked around).
- **Open detail:** the exact status-bar wording / Retry placement is UI detail below requirement
  altitude — derived, not separately Q-backed.

## R3 — CLI install completion unblocks and resumes the flow

When bundled CLI install completes, the CLI-dependent step unblocks and onboarding resumes
(returns to Bonjour + Tailscale discovery scan).

- **Anchor:** requirements.md §1.3 (hard-gate resolves) + §1.4 (Q0382, Q0383, Q0384) — LAN-first
  Bonjour discovery, Tailscale fallback.
- **Test target:** discovery scan resumes after install-complete signal.

## R4 — Selected engine is probed for install + auth, with resolving actions

If the user selected Claude / Codex / OpenCode, onboarding probes that engine for
**installed** and **authenticated** state and offers resolving actions:
not-installed → Install action; installed-but-not-authed → login/auth guidance; both pass →
the engine step's Next is enabled.

- **Anchor:** requirements.md §1.3 (Q0541) — "If the user chooses Claude, Codex, or OpenCode
  support, onboarding should check for that tool and help install/configure required environment
  variables." · §1.8 (Q0540) — Codex in the session picker.
- **Test target:** host `EngineGuard` probe + client `onboarding-bridge` engine step.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **"Set up host" from a Bonjour/LAN candidate → account/password screen → install/start
  XpairHost on that host (bootstrap download → Homebrew → app install → run check).**
  The flow tree specifies this host-install-from-client sequence in detail, but requirements.md
  §4 explicitly lists it as unspecified: *"The six-digit / sign-in / host-install pairing UX is
  not fully specified."* (Q0430, Q0440). → Demoted to Open Issue. Needs a user decision before
  it can become spec; do not write tests asserting the detailed sequence yet.
- **bootstrap/Homebrew install failure & timeout handling** (Retry, "host 변경 없이 대기"):
  downstream of the unspecified host-install flow above — same Open Issue.

---

_PoC: 1 cluster of the M1 onboarding subset. Format pending user approval before fan-out to the
remaining clusters (discovery, telemetry consent, TCC/permissions, SSH key-auth, reconnect)._
