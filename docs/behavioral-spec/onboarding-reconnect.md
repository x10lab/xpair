# Behavioral Spec — Onboarding: Reconnect

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
> **Scope:** M1 onboarding, reconnect cluster. Source flow cluster: `/tmp/m1_clusters/05-reconnect.txt`.

---

## R1 — Reconnect remains an explicit user choice, not automatic completion

When discovery or saved state surfaces a known host, onboarding may offer a reconnect path, but it
must wait for an explicit user choice and must not mark onboarding complete merely because the host
appeared in Bonjour, Tailscale, or saved configuration.

- **Anchor:** requirements.md §1.4 (Q0382, Q0384) — discovery should "offer to connect when another
  Mac is found." · §1.2 (Q0369, Q0402, Q0474) — client onboarding "closes only after the necessary
  setup is complete."
- **Open detail:** exact row labels and priority between Set up / Connect / Reconnect are derived,
  not separately Q-backed.
- **Test target:** `StepDiscover.tsx`, `StepReconnect.tsx`, `onboarding-routing.test.js`.

## R2 — Reconnect reuses Xpair-owned saved state only after the user selects that host

After the user chooses a reconnect candidate, onboarding may reuse stored host identity, address,
and connection settings from Xpair-owned state. If the user edits the host/address or chooses a
different host, the previous success state is invalidated and the connection must be checked again.

- **Anchor:** requirements.md §2 (Q0009, Q0010, Q0011, Q0528) — state and config should live in an
  Xpair-owned namespace. · §0.2 (Q0183, Q0261, Q0474) — the Client is where the user connects and
  opens sessions.
- **Open detail:** the exact saved-state schema, cache invalidation timing, and whether SSH key
  aliases are visible are implementation details below requirement altitude.
- **Test target:** `onboarding-bridge.js` saved-host probe, `StepReconnect.tsx`, `StepConnect.tsx`.

## R3 — Raw SSH reachability is not enough to finish reconnect

Reconnect may check SSH reachability, but a reachable SSH session alone cannot complete onboarding.
Before the user can proceed as connected, the flow must verify that the target is a usable Xpair
Host path capable of preserving the required Host-side permission boundary.

- **Anchor:** requirements.md §0.2 (Q0245, Q0337, Q0443) — Host is the permission-holding side. ·
  §0.3 (Q0025, Q0101, Q0245) — Host must preserve computer-use ability rather than relying on raw
  SSH sessions that lose macOS grants. · §1.5 (Q0443) — unresolved TCC must not be treated as setup
  success.
- **Open detail:** exact app/version guard names and compatibility copy are not separately
  Q-backed.
- **Test target:** `onboarding-bridge.js` host guard, host `EngineGuard.swift`, host
  `Permissions.swift`, `StepReconnect.tsx`.

## R4 — Successful reconnect routes into remaining required onboarding gates

If reconnect reaches a usable Xpair Host, onboarding should continue through any still-required
engine, permission, and file-access gates instead of jumping straight to the workbench when those
requirements are unresolved.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — onboarding closes only after necessary
  setup is complete. · §1.3 (Q0541) — selected Claude / Codex / OpenCode support must be checked
  and helped through install/configuration. · §1.5 (Q0443) — Host permissions must be resolved
  before the Host is considered usable.
- **Open detail:** the exact order among engine, permission, and file-access screens is derived
  from the flow tree unless separately decided.
- **Test target:** `StepReconnect.tsx`, `StepEngine.tsx`, `StepGrantPermissions.tsx`,
  `StepFileAccess.tsx`, `onboarding-routing.test.js`.

## R5 — Failed reconnect stays retryable and incomplete

If reconnect cannot confirm a usable host, onboarding remains in an incomplete connection state.
Retry may re-run the same host check, and manual/fallback connection paths may be offered, but the
flow must not advance as though connection succeeded.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — the workbench opens only after setup is
  complete. · §1.4 (Q0383, Q0384, Q0399) — fallback paths should guide the user when the first
  connection route does not work.
- **Open detail:** exact retry cadence, duplicate Retry behavior, failure copy, and manual-connect
  button naming are derived, not separately Q-backed.
- **Test target:** `StepReconnect.tsx`, `StepConnect.tsx`, `onboarding-bridge.js` reachability
  probe, `onboarding-routing.test.js`.

## R6 — Cancellation before reconnect confirmation preserves existing state

If the user closes, cancels, or backs out before reconnect is confirmed, onboarding remains
incomplete and must not overwrite or delete existing host/session configuration as a side effect of
the aborted attempt.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — onboarding precedes the workbench and
  completes only after setup is done. · §1.6 (Q0061, Q0062, Q0063) — detached/orphaned session
  handling is part of the launcher requirement; users should not need to manually reason about
  stale sockets.
- **Open detail:** whether Back returns to the same result list, an empty discovery state, or the
  previous screen is UI detail below requirement altitude.
- **Test target:** `App.tsx`, `useWizard.ts`, `StepReconnect.tsx`, `onboarding-main.cjs`.

## R7 — Fully configured reconnect may restore the intended working surface and sessions

When a saved host is reachable, the Host is usable, and the remaining required gates are already
resolved, onboarding may return to the intended Xpair workbench surface and expose existing session
attach/new-session choices. Detached or stale session state must be handled by the launcher instead
of requiring the user to reason about stale sockets manually.

- **Anchor:** requirements.md §1.6 (Q0056, Q0153, Q0154, Q0061, Q0062, Q0063) — the product centers
  on launching/attaching persistent host sessions and must handle detached/orphaned sessions. ·
  §1.8 (Q0402, Q0474, Q0480) — the default editor area should show Remote Desktop and Sessions is
  the primary container.
- **Open detail:** exact stale heartbeat polling states and whether stale clients are hidden,
  grayed, or omitted are derived from the flow tree.
- **Test target:** `client/cli/xpair-launch`, host `Sessions.swift`, host `ConnectedClients.swift`,
  `session-list.test.js`, `tests/t_12_attach.sh`.

## R8 — Reconnect onboarding stays inside the Xpair pre-workbench surface

During reconnect onboarding, unrelated VSCodium default surfaces and Host-side controls are not
valid branches that can complete Client onboarding. If exposed accidentally, they should be treated
as inaccessible for this flow and should not bypass the Xpair onboarding gates.

- **Anchor:** requirements.md §1.2 (Q0369, Q0421, Q0424, Q0426) — Client onboarding is a standalone
  pre-workbench window and not an editor tab. · §1.8 (Q0183, Q0248, Q0398, Q0414, Q0480) — Xpair
  uses a VS Code/VSCodium-like base, but product surfaces are Sessions/Browser/Add Mapping rather
  than generic default workbench entry.
- **Open detail:** exact blocking copy or visual treatment for inaccessible surfaces is derived.
- **Test target:** `onboarding-main.cjs`, `extension.js`, `zz-remotepair-ide-frontend.patch`,
  `onboarding-routing.test.js`.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **Detailed SSH host-key mismatch / rekeyed-host flow.** requirements.md §1.2 backs hiding the host
  key fingerprint by default (Q0430), but it does not specify known_hosts cleanup, automatic key
  refresh, re-pairing copy, or whether mismatch should route to manual connect. Do not assert those
  detailed branches until a user decision exists.
- **Exact Set up / Connect / Reconnect candidate taxonomy.** requirements.md §1.4 backs offering a
  connection when another Mac is found, but it does not define saved-host detection thresholds,
  default actions, row labels, or prioritization among setup/connect/reconnect.
- **XpairHost app version compatibility matrix.** Host/client role separation and permission gating
  are backed, but exact app-version compatibility rules and copy are not specified in
  requirements.md.
- **Stale client heartbeat UI.** requirements.md §1.6 backs stale/detached/orphaned session handling
  at launcher altitude, but the flow-tree's fresh/stale/empty heartbeat polling states and exact
  Done-screen behavior are not separately Q-backed.
- **Host-first or XpairHost-before-Xpair routing.** requirements.md backs Host and Client separation,
  but it does not specify terminate vs route behavior when Host was installed or launched before the
  Client onboarding flow.

---

_PoC: 1 cluster of the M1 onboarding subset. This file anchors the reconnect cluster; unsupported
flow-tree detail is demoted to Open Issues until requirements.md gains user-query backing._
