# Behavioral Spec — Onboarding: Step Progression

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
> **Scope:** M1 onboarding, step-progression cluster. Source flow cluster: `/tmp/m1_clusters/07-step-progression.txt`.

---

## R1 — Passing a gate enables explicit progression; it does not auto-complete onboarding

When a step's required gate passes, onboarding may enable the relevant Next / Continue / Done
action or move to the next required setup surface after the user invokes that action. A ready state
by itself must not mark onboarding complete, open the workbench, or imply that later gates have
already passed.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — Client onboarding "closes only after
  the necessary setup is complete." · §1.5 (Q0443) — unresolved Host permissions must not be
  treated as setup success. · §1.3 (Q0541) — selected agent tools must be checked/configured.
- **Open detail:** exact button labels, disabled styling, and whether a successful gate auto-focuses
  or merely enables the next action are UI details below requirement altitude.
- **Test target:** `client/onboarding/src/App.tsx`, onboarding wizard reducer/state machine,
  `client/ide/remotepair/ext/onboarding-routing.test.js`.

## R2 — Unresolved gates stay blocked on the current step

If a required gate is absent, pending, failed, stale, or still being retried, the flow remains on
the current recovery surface and does not continue silently. This applies to CLI availability,
host reachability, Host/TCC readiness, selected engine install/auth, file-access or mapping
checks, and session creation/attach readiness.

- **Anchor:** requirements.md §1.3 (Q0533, Q0534, Q0536, Q0537) — `xpair` availability is a hard
  gate and onboarding must "install it before the hard gate or block with a clear reason." · §1.5
  (Q0443) — Host onboarding must resolve required macOS permissions before the Host is usable. ·
  §1.7 (Q0041, Q0042, Q0043, Q0414) — project access proceeds through mapping-oriented UX.
- **Open detail:** exact timeout thresholds, polling cadence, retry limits, and progress-bar/status
  copy are derived from the flow tree, not separately Q-backed.
- **Test target:** `onboarding-bridge` probes, host `Permissions.swift`, host `EngineGuard.swift`,
  mapping/session readiness reducers, `onboarding-routing.test.js`.

## R3 — Closing, cancelling, or backing out before completion leaves onboarding incomplete

If the user closes a window, cancels, backs out, or leaves an external settings/install step before
the relevant setup is complete, the current onboarding branch ends incomplete. It must not mark
setup complete, start the finished surface, or overwrite confirmed existing host/session state as
though the aborted branch succeeded.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — onboarding precedes the workbench and
  closes only after necessary setup is complete. · §1.6 (Q0061, Q0062, Q0063) — detached/orphaned
  session handling belongs to the launcher rather than requiring the user to reason about stale
  sockets manually.
- **Open detail:** exact Back behavior, whether partial form fields are retained, and which aborted
  install artifacts remain on disk are implementation details below requirement altitude.
- **Test target:** onboarding lifecycle/close handlers, `useWizard` or equivalent route state,
  `onboarding-main.cjs`, `session-list.test.js`.

## R4 — Onboarding stays inside the pre-workbench Xpair surface until completion

During client onboarding, progression must remain inside the standalone pre-workbench Xpair
onboarding surface. VSCodium default workbench surfaces, editor tabs, extension/search surfaces as
primary entry points, external documentation links, and unrelated Host controls must not become
branches that bypass onboarding gates.

- **Anchor:** requirements.md §1.2 (Q0369, Q0421, Q0424, Q0426) — Client onboarding appears before
  the workbench and is "not an editor tab." · §1.8 (Q0183, Q0248, Q0398, Q0414, Q0480) — Xpair may
  use a VS Code/VSCodium-like base, but product surfaces are Sessions/Browser/Add Mapping.
- **Open detail:** exact "access unavailable" copy, modal-vs-route blocking, and which secondary
  IDE commands stay visible are derived, not separately Q-backed.
- **Test target:** IDE launch gating in `extension.js`, `onboarding-main.cjs`,
  `zz-remotepair-ide-frontend.patch`, `onboarding-routing.test.js`.

## R5 — Host completion and Client workbench continuation remain separate outcomes

Host onboarding completion finalizes the Host-side setup path only after the user performs the
explicit completion action. It must not be treated as a Client attach/session-selection action, and
Client-side work continues through the Xpair Client workbench/session surfaces after the relevant
Client gates pass.

- **Anchor:** requirements.md §0.2 (Q0343, Q0245, Q0337, Q0443) — Host and Client are distinct roles,
  with Host as the permission-holding side and Client as the user-facing IDE/CLI side. · §1.2
  (Q0441, Q0442, Q0443) — Host onboarding exists and is responsible for required permission/TCC
  flow. · §1.8 (Q0402, Q0474, Q0480) — the Client opens into the intended Sessions/Remote Desktop
  working surface.
- **Open detail:** exact "Open Xpair" copy, no-client Host-ready wording, connected-client wording,
  and menu-bar status text are derived from the flow tree.
- **Test target:** host `OnboardingWindow.swift`, host `HostManager.swift`,
  host `ConnectedClients.swift`, Client session/workbench routing tests.

## R6 — Re-running setup may route back into onboarding without tearing down sessions

When a settings/configure/setup-again entry point reopens onboarding, the flow may route the user
back through unfinished setup gates. That re-entry must not be modeled as a session-kill operation;
persistent host sessions remain launcher/session concerns and become visible again only when the
required onboarding gates have passed.

- **Anchor:** requirements.md §1.2 (Q0473, Q0493, Q0494) — Settings/Configure actions may reopen the
  relevant onboarding step or onboarding from scratch. · §1.6 (Q0056, Q0153, Q0154, Q0061, Q0062,
  Q0063) — the product centers on launching/attaching persistent host sessions and handling
  detached/orphaned sessions.
- **Open detail:** sentinel filenames, restart prompts, exact relaunch timing, and "Restart now"
  behavior are implementation details not separately Q-backed.
- **Test target:** setup-again command routing, onboarding sentinel/relaunch guard,
  host `Sessions.swift`, `session-list.test.js`.

## R7 — Consent toggles are explicit choices, not hidden progression gates

Telemetry and crash-report controls may be shown before progression or on a final confirmation
surface. Progression must persist only the explicit choices the user made and must not silently
enable product analytics; changing those choices alone should not be treated as completing Host or
Client onboarding.

- **Anchor:** requirements.md §1.12 (Q0385, Q0401, Q0403, Q0448, Q0449) — onboarding must expose the
  telemetry opt-in decision and product analytics "should not be silently enabled." ·
  requirements.md §4 (Q0448, Q0449) — crash-report default remains undecided.
- **Open detail:** exact checkbox defaults, persistence timing before Done/Next, and ON/OFF summary
  copy are derived from the flow tree.
- **Test target:** telemetry consent controls, host/client consent persistence adapters,
  onboarding route tests around consent-step and Done-step transitions.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **Client-driven host install state machine.** The cluster repeatedly specifies Set up host →
  username/password → SSH/sudo checks → bootstrap/Homebrew/download → app launch/advertisement →
  retry/timeout/manual-run branches. requirements.md §4 says the "six-digit / sign-in /
  host-install pairing UX is not fully specified." (Q0430, Q0440)
- **Exact post-gate ordering among Engine, permissions, Connect, Done, mapping, project selection,
  existing session attach, and new session creation.** requirements.md backs those domains, but not
  a single ordered state machine after every possible success branch.
- **Exact TCC matrix and pane behavior.** requirements.md backs required Host/TCC resolution, but
  the flow tree's detailed AX/SR/FDA labels, optional-vs-required split, System Settings pane
  branches, and polling copy are not separately Q-backed.
- **Connect/Done heartbeat details.** Fresh/stale heartbeat polling, one-client vs many-client
  display, paired/no-client Done copy, client disconnect affordances, and exact Next behavior from
  failed/empty Connect states are not specified by user-query-backed requirements.
- **Setup-again sentinel/restart mechanics.** Settings-driven onboarding re-entry and persistent
  sessions are backed, but sentinel write/delete names, relaunch prompts, and failure recovery
  wording are implementation details.
- **Host-first or XpairHost-before-Xpair route/terminate behavior.** Host/Client role separation is
  backed, but the required route target or terminate rule for Host-first detours is not specified.
- **Crash-report default and consent persistence timing.** requirements.md §4 explicitly leaves the
  crash-report default undecided (Q0448, Q0449), so tests must not assert opt-in vs opt-out defaults
  until the user decides.

---

_Cluster output for M1 onboarding fan-out. Anchored from `/tmp/m1_clusters/07-step-progression.txt`
to `requirements.md`; flow-tree-only details are demoted to Open Issues._
