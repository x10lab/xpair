# Behavioral Spec — Onboarding: TCC Permissions

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
> **Scope:** M1 onboarding, TCC/permissions cluster. Source flow cluster: `/tmp/m1_clusters/03-tcc-permissions.txt`.

---

## R1 — Host TCC is a hard usability gate

Host onboarding must not mark the Host usable, complete setup, or proceed as though setup succeeded
while required macOS permission/TCC grants are unresolved. Missing required TCC keeps the user in a
permission recovery path instead of any state that treats Host setup as ready.

- **Anchor:** requirements.md §1.5 (Q0443) — "Host onboarding must resolve required macOS
  permissions before the Host is considered usable" and unresolved TCC "should not proceed as
  though setup succeeded." · §1.2 (Q0441, Q0442, Q0443) — Host onboarding exists for the required
  permission/TCC flow.
- **Test target:** host `StepPermissions.tsx`, host `Permissions.swift`, client
  `StepGrantPermissions.tsx`, `onboarding-bridge.js` `hostPermissions`.

## R2 — Permission setup belongs to the Host-side permission boundary

Permission-needing behavior must stay on the Host side. Client onboarding may observe and guide the
Host permission state, but raw SSH, Client-side UI, or generic IDE surfaces must not be treated as
substitutes for the permission-holding Host app.

- **Anchor:** requirements.md §0.2 (Q0245, Q0337, Q0443) — "Host is the permission-holding side."
  · §0.3 (Q0025, Q0101, Q0245) — permission-needing behavior belongs on the Host side and should
  not rely on raw SSH sessions that lose macOS grants.
- **Test target:** `onboarding-bridge.js` host permission probe, client `StepGrantPermissions.tsx`,
  host `OnboardingWindow.swift`, host `Permissions.swift`.

## R3 — Permission recovery uses onboarding-owned steps, not disconnected UI

When required TCC is missing, onboarding should guide the user through understandable permission
steps and be able to reopen or return to the relevant permission step after a Settings action. The
flow waits for the user to complete the external macOS grant and then routes back into onboarding.

- **Anchor:** requirements.md §1.5 (Q0183, Q0443, Q0473) — permission steps should be broken into
  understandable onboarding steps. · §1.2 (Q0473, Q0493, Q0494) — Permissions and Settings actions
  should reopen the relevant onboarding step rather than disconnected UI.
- **Open detail:** exact System Settings pane URLs, row labels, button copy, and retry placement are
  derived, not separately Q-backed.
- **Test target:** host `StepPermissions.tsx` `requestPermission`/`openPermissionPane`, host
  `OnboardingWindow.swift`, Settings/Configure action routing.

## R4 — TCC status must be re-checked after user action

After the user opens Settings, toggles a grant, returns to onboarding, retries, or waits for macOS
to reflect a grant, onboarding must re-check the Host permission state before clearing the gate.
An external action or a user claim is not enough to mark setup ready without a confirmed TCC status.

- **Anchor:** requirements.md §1.5 (Q0443) — Host onboarding must resolve required macOS
  permissions before the Host is considered usable. · §1.2 (Q0429, Q0438) — onboarding must be
  testable by actually launching and walking through it, not only by inspecting code.
- **Open detail:** polling interval, pending/error wording, and duplicate retry suppression are
  implementation details below requirement altitude.
- **Test target:** host `StepPermissions.tsx` status polling, host `Permissions.swift` status
  checks, client `StepGrantPermissions.tsx` polling, `onboarding-bridge.js` `hostPermissions`.

## R5 — Avoid unnecessary permission expansion

Onboarding may request or recommend only permissions that are needed for a Host-side capability and
must explain why each grant is needed when that grant supports a child session or screen component.
Permissions outside the required Host capability set must not be treated as required gates.

- **Anchor:** requirements.md §1.5 (Q0025, Q0101, Q0245) — "Avoid requesting unnecessary
  permissions" and say explicitly when a grant is needed because a child session or screen component
  needs it. · §0.3 (Q0183, Q0303) — product logic that does not require macOS grants should remain
  outside the permission boundary where possible.
- **Open detail:** the cluster's exact "required" vs "recommended" labels are derived unless backed
  by a later user decision.
- **Test target:** host permission-row model, client `StepGrantPermissions.tsx` gate calculation,
  permission-copy tests or onboarding walkthrough assertions.

## R6 — Unrelated apps, panes, and privacy entries do not satisfy XpairHost TCC

If the user opens the wrong privacy pane, changes a grant for an unrelated app, or tries to proceed
through an unrelated VSCodium/Client surface, onboarding must not count that action as resolving
Host TCC. The flow remains incomplete or routes back to the Host permission step.

- **Anchor:** requirements.md §0.2 (Q0245, Q0337, Q0443) — the Host is the permission-holding side.
  · §1.2 (Q0369, Q0421, Q0424, Q0426) — Client onboarding is a standalone pre-workbench window, not
  an editor tab or unrelated workbench surface.
- **Open detail:** exact "access denied" or terminate-vs-route copy is derived from the flow tree.
- **Test target:** host `Permissions.swift` app-bound grant checks, client/host onboarding route
  guards, `onboarding-routing.test.js`.

## R7 — Closing or cancelling before TCC completion leaves setup incomplete

If the user closes, cancels, or stops onboarding while required Host permissions are still
unresolved, onboarding must not call setup complete or open the finished IDE surface. Returning to
setup should resume at the unfinished permission or Host setup path.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — Client onboarding closes only after the
  necessary setup is complete. · §1.5 (Q0443) — unresolved TCC must not be treated as successful
  setup.
- **Test target:** host onboarding completion guard, client `App.tsx`/`useWizard.ts`, IDE startup
  onboarding lifecycle tests.

## R8 — TCC success unlocks the next gate, not full onboarding completion

Once required Host TCC is confirmed, onboarding may enable explicit progression into the next
required setup surface, such as selected engine checks, file access, mapping, connection, or
session setup. Permission readiness alone must not skip those remaining gates or imply the workbench
is ready.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — onboarding closes only after necessary
  setup is complete. · §1.3 (Q0541) — selected agent tools must be checked/configured. · §1.7
  (Q0041, Q0042, Q0043, Q0414) — file access and mapping are part of the intended setup surface.
- **Test target:** host `App.tsx` permission-to-engine routing, client `App.tsx`
  grant-permissions-to-engine/file-access routing, `StepEngine.tsx`, `StepFileAccess.tsx`.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **Exact TCC matrix: Accessibility required, Screen Recording required, Full Disk Access
  recommended.** The flow tree and implementation-oriented docs repeat this matrix, but
  requirements.md only backs "required macOS permissions/TCC" at a broad level and says unnecessary
  permissions should be avoided (§1.5, Q0443; §1.5, Q0025, Q0101, Q0245). Do not assert exact
  AX/SR/FDA required-vs-optional behavior from this spec until user-query backing is added.
- **Exact macOS pane behavior.** Opening Accessibility, Screen Recording, or Full Disk Access panes;
  finding the XpairHost row; adding the app manually; and handling missing rows, admin locks,
  restart prompts, or pane-open failures are plausible implementation flows, but not separately
  specified by requirements.md.
- **FDA-specific skip/poll/error behavior.** The cluster includes pending FDA polls, skip decisions,
  "ignore error and continue," restart handling, and protected-folder prompt rationale. That detail
  may be useful product design, but it is below the current requirements altitude unless the exact
  optional grant policy is user-backed.
- **Host-first terminate vs route behavior.** requirements.md backs Host/Client separation and Host
  onboarding, but it does not specify whether a user who installed or launched XpairHost before the
  Xpair Client should terminate, route to a specific existing branch, or start a separate Host-first
  wizard.
- **Client-driven host install, sudo, credential, and SSH retry branches.** Those lines overlap the
  SSH/key-auth and discovery clusters and are also under requirements.md §4's open issue for the
  "six-digit / sign-in / host-install pairing UX" (Q0430, Q0440). Do not assert them here.
- **Exact post-permission order.** The cluster alternates among Engine, file access, project setup,
  Connect, Done, host advertisement, watchdog, and menu bar states. requirements.md backs those
  domains separately, but does not define a single ordered state machine after TCC resolution.

---

_Cluster output for M1 onboarding fan-out. Anchored from `/tmp/m1_clusters/03-tcc-permissions.txt`
to `requirements.md`; flow-tree-only details are demoted to Open Issues._
