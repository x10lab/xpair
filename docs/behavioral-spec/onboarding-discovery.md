# Behavioral Spec — Onboarding: Discovery

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
> **Scope:** M1 onboarding, discovery cluster. Source flow cluster: `/tmp/m1_clusters/01-discovery.txt`.

---

## R1 — Consent decisions hand off into discovery without silently enabling telemetry

When the user leaves the consent step for discovery, onboarding may persist the explicit
telemetry / crash-report choices the user selected, then continue into host discovery. Product
analytics must not be silently enabled as an implicit side effect of reaching discovery.

- **Anchor:** requirements.md §1.12 (Q0385, Q0401, Q0403, Q0448, Q0449) — "onboarding must
  expose the opt-in decision" and "Product analytics should not be silently enabled."
- **Open detail:** the exact four ON/OFF transition rows are derived from the flow tree. Crash-report
  default is separately open in requirements.md §4 (Q0448, Q0449).
- **Test target:** `StepConsent.tsx`, `ConsentControls.tsx`, `telemetry.js`, `telemetry.test.js`.

## R2 — `xpair` CLI availability gates discovery

Discovery and other CLI-dependent onboarding actions must not proceed until the `xpair` CLI is
available. If the CLI is missing, onboarding must install it or block with a clear reason; if
installation fails, Retry is allowed but discovery remains blocked until the gate resolves.

- **Anchor:** requirements.md §1.3 (Q0533, Q0534, Q0536, Q0537) — "`xpair` CLI availability is a
  hard product requirement before flows that need it" and onboarding must "install it before the
  hard gate or block with a clear reason." · §0.1 (Q0533, Q0534, Q0536, Q0537) — missing `xpair`
  is an onboarding/product-flow problem, not something to silently fix outside the flow.
- **Open detail:** status-bar placement, retry copy, duplicate Retry suppression, and polling cadence
  are UI/implementation details below requirement altitude.
- **Test target:** `onboarding-bridge.js` CLI guard, `StepInstalling.tsx`, `StepDiscover.tsx`,
  `onboarding-routing.test.js`.

## R3 — Discovery is LAN-first, with Tailscale as fallback rather than prerequisite

After the CLI gate resolves, client onboarding should scan the local network with Bonjour first
and surface same-network Mac candidates when found. Tailscale/tailnet discovery is allowed as a
fallback path and must not be treated as a prerequisite for the first connection.

- **Anchor:** requirements.md §1.4 (Q0382, Q0383, Q0384) — "First connection should be LAN-first:
  scan the local network with Bonjour" and "Tailscale is a fallback, not a prerequisite."
- **Open detail:** exact ordering of LAN and tailnet cards, source badges, and "first shown" timing is
  derived from the flow tree.
- **Test target:** `client/cli/xpair` `cmd_discover`, `onboarding-bridge.js` `discover`,
  `StepDiscover.tsx`.

## R4 — Empty discovery stays in discovery and offers fallback paths

If Bonjour/Tailscale discovery finds no usable host, onboarding must not advance as though a host
was selected. The user remains in discovery with guidance toward same Wi-Fi, Tailscale, or another
fallback/manual connection path.

- **Anchor:** requirements.md §1.4 (Q0383, Q0384, Q0399) — if no same-network Mac is found, guide
  naturally toward "Tailscale or another fallback path" and verify likely tailnet topology. · §1.13
  (Q0176, Q0177, Q0184, Q0185, Q0193, Q0197, Q0201) — docs/install guidance includes Remote
  Login/SSH and troubleshooting paths.
- **Open detail:** exact no-host copy, Retry button label, and whether the manual action is named
  "Enter manually" or "Connect over Internet" are derived, not separately Q-backed.
- **Test target:** `StepDiscover.tsx` empty state, `client/cli/xpair` discovery empty JSON path.

## R5 — Found hosts are selectable candidates, not automatic completion

When discovery finds one or more Mac candidates, onboarding should present them as choices and wait
for a user selection. Seeing or selecting a candidate does not complete onboarding by itself; the
flow must continue until the necessary setup/connection work is complete.

- **Anchor:** requirements.md §1.4 (Q0382, Q0384) — Bonjour should "offer to connect when another
  Mac is found." · §1.2 (Q0369, Q0402, Q0474) — client onboarding "closes only after the necessary
  setup is complete."
- **Open detail:** host row layout, address display, source badges, and secondary details are UI
  detail below requirement altitude.
- **Test target:** `StepDiscover.tsx` peer list, `App.tsx` discovered-peer routing,
  `onboarding-routing.test.js`.

## R6 — Manual host entry remains available as a discovery fallback

The user may leave automatic discovery for a manual host path when discovery is empty or when they
choose to connect over another route. That path should validate reachability instead of assuming
Tailscale presence alone proves the host is connectable.

- **Anchor:** requirements.md §1.4 (Q0383, Q0384, Q0399) — Tailscale is a fallback path and discovery
  must be verified for likely topologies, including tailnet situations. · §1.13 (Q0176, Q0177,
  Q0184, Q0185, Q0193, Q0197, Q0201) — install docs should include Remote Login/SSH guidance and
  troubleshooting.
- **Open detail:** detailed Tailscale Ready / not installed / not running screens are derived from
  the flow tree unless separately covered by a later user decision.
- **Test target:** `StepConnect.tsx`, `onboarding-bridge.js` host reachability probes,
  `client/cli/xpair` SSH/Tailscale discovery helpers.

## R7 — Interruption before setup completion cannot mark onboarding complete

If the user closes, cancels, or backs out during discovery, no-host fallback, host selection, or the
next connection/setup step, onboarding must remain incomplete and must not open the IDE workbench as
though setup succeeded.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — client onboarding appears before the
  workbench and "closes only after the necessary setup is complete, then the IDE opens into the
  intended working surface."
- **Open detail:** whether Back returns to the same discovery state, clears results, or exits is
  derived and not separately Q-backed.
- **Test target:** `App.tsx`, `useWizard.ts`, `onboarding-main.cjs`, IDE startup/onboarding lifecycle
  tests.

## R8 — Pre-workbench onboarding excludes unrelated IDE and external surfaces

During client onboarding, the user flow must stay inside the pre-workbench Xpair onboarding surface.
VSCodium default workbench surfaces, command palette paths, extensions/search as primary surfaces,
and external apps/settings are not discovery branches that can complete onboarding.

- **Anchor:** requirements.md §1.2 (Q0369, Q0421, Q0424, Q0426) — onboarding is "before the IDE
  workbench" and "not an editor tab." · §1.8 (Q0183, Q0248, Q0398, Q0414, Q0480) — the Client is
  VS Code/VSCodium-like, but product surfaces are Sessions/Browser/Add Mapping after onboarding
  rather than generic default workbench entry.
- **Open detail:** exact UX for blocking or labeling out-of-scope surfaces is derived from the flow
  tree.
- **Test target:** IDE launch gating in `extension.js`, `onboarding-main.cjs`,
  `zz-remotepair-ide-frontend.patch`.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **"Set up host" from a Bonjour/Tailscale candidate → account/password input → SSH/password
  validation → Homebrew/download/install/start XpairHost.** The flow tree repeats this in many
  forms, but requirements.md §4 explicitly says the "six-digit / sign-in / host-install pairing UX
  is not fully specified." (Q0430, Q0440). Do not assert the detailed host-install sequence until
  the user decides it.
- **Exact candidate taxonomy: Set up vs Connect vs Reconnect, and which one is prioritized.** The
  requirements support LAN-first discovery and offering connection, but they do not define status
  labels, saved-host priority, existing SSH-key reachability semantics, or whether a known host with
  an unconfirmed app should be treated as setup/reconnect.
- **Tailscale state-machine screens.** Tailscale fallback is required, but the exact states
  "not installed," "installed but not running," "Ready," "MagicDNS off," and external Tailscale app
  round-trips are not separately Q-backed.
- **SSH host-key mismatch / known_hosts cleanup behavior.** requirements.md §1.2 only backs hiding
  the host key fingerprint by default; the detailed rekeyed-host blocking, known_hosts cleanup copy,
  and trust-confirmation routes are not specified by user Q evidence.
- **Retry mechanics and scan cadence.** Retry scan, repeated Retry clicks, polling waves, stale
  heartbeat handling, and duplicate scan suppression are implementation details. They can be tested
  once chosen, but they are not requirements-backed behavior yet.
- **Host-first routing.** If XpairHost is installed or launched before the Xpair Client, role
  separation and Host onboarding are backed by §0.2 and §1.2, but the discovery-tree route/terminate
  behavior is not specified.

---

_PoC: 1 cluster of the M1 onboarding subset. This file anchors the discovery cluster; unsupported
flow-tree detail is demoted to Open Issues until requirements.md gains user-query backing._
