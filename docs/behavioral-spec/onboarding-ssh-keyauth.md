# Behavioral Spec — Onboarding: SSH Key-Auth

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
> **Scope:** M1 onboarding, SSH/key-auth cluster. Source flow cluster: `/tmp/m1_clusters/04-ssh-keyauth.txt`.

---

## R1 — SSH reachability is not onboarding completion

When the user enters a Connect / Reconnect / manual-host path, SSH reachability or SSH credential
success is only a connection/authentication check. It must not by itself close onboarding or open
the workbench as though setup succeeded; the Host-side setup and required guards still have to
complete.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — client onboarding "closes only after
  the necessary setup is complete." · §0.2 (Q0245, Q0337, Q0443) — Host is the permission-holding
  side that runs on the controlled machine.
- **Test target:** `StepConnect.tsx`, `onboarding-bridge.js` SSH/reachability probe, `App.tsx`
  onboarding completion routing.

## R2 — Raw SSH must not replace the permission-holding Host

After SSH succeeds, onboarding still has to verify that the controlled machine is a usable Xpair
Host path. Raw SSH sessions must not be treated as a substitute for the Host app because the Host
is the component that preserves the macOS grants required for computer-use.

- **Anchor:** requirements.md §0.3 (Q0025, Q0101, Q0245) — permission-needing behavior belongs on
  the Host side and should not rely on raw SSH sessions that lose macOS grants. · §1.5 (Q0443) —
  unresolved TCC means the app "should not proceed as though setup succeeded."
- **Open detail:** the exact Host-app-installed check, version compatibility check, and "Next"
  enablement matrix are derived from the flow tree and not separately Q-backed.
- **Test target:** `onboarding-bridge.js` host guard, `host/onboarding`, `StepPermissions.tsx`.

## R3 — Host key fingerprints are hidden by default

When SSH host key / fingerprint information appears in the onboarding flow, the fingerprint should
be hidden by default and revealed only through an explicit expanded/details state.

- **Anchor:** requirements.md §1.2 (Q0430) — "Host key fingerprint should be hidden by default and
  revealed only when expanded."
- **Open detail:** mismatch copy, known_hosts cleanup wording, and whether the UI offers
  re-pairing, manual connect, or key replacement are not specified by the requirement.
- **Test target:** `StepConnect.tsx` host-key warning/details UI, `onboarding-routing.test.js`.

## R4 — Bonjour remains first, Tailscale remains fallback

SSH/key-auth paths may originate from Bonjour, Tailscale, or manual host entry, but first
connection should stay LAN-first. Tailscale can be offered as a fallback path; its presence must
not be treated as a prerequisite or as proof that SSH and Host guards have passed.

- **Anchor:** requirements.md §1.4 (Q0382, Q0383, Q0384, Q0399) — first connection should
  "scan the local network with Bonjour," Tailscale is "a fallback, not a prerequisite," and
  discovery must be verified for likely tailnet topologies.
- **Open detail:** exact Tailscale Ready / not installed / not running states and MagicDNS copy are
  derived from the flow tree.
- **Test target:** `client/cli/xpair` discovery/connect probes, `onboarding-bridge.js`,
  `StepDiscover.tsx`, `StepConnect.tsx`.

## R5 — Failures and interruptions stay incomplete

If SSH auth fails, the host is unreachable, required Host/TCC checks fail, or the user cancels or
closes the key-auth step before setup completion, onboarding must remain incomplete and must not
advance as though the Host is ready.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — onboarding precedes the workbench and
  closes only after necessary setup is complete. · §1.5 (Q0443) — unresolved permissions must not
  be treated as setup success.
- **Open detail:** exact Retry, Back, host-edit, and stale-settings behavior is below requirement
  altitude unless the user specifies it later.
- **Test target:** `StepConnect.tsx`, `useWizard.ts`, `onboarding-routing.test.js`,
  IDE startup/onboarding lifecycle tests.

## R6 — Unsupported host targets cannot become Xpair Hosts

If SSH reaches a target outside the supported Host platform path, onboarding must not accept it as
a usable Xpair Host or proceed into normal Host completion. It should block or route to an
unsupported-target explanation until scope expands.

- **Anchor:** requirements.md §2 (Q0026) — supported host/client path targets Apple Silicon Mac
  unless scope is explicitly expanded. · §0.2 (Q0343, Q0245, Q0337, Q0443) — Host and Client
  roles remain separated and the Host is the controlled macOS side.
- **Open detail:** exact "access denied" copy and terminate-vs-route behavior are not specified in
  requirements.md.
- **Test target:** `onboarding-bridge.js` platform/host guard, `StepConnect.tsx`.

## R7 — SSH troubleshooting is required, but it does not define the pairing UX

The product documentation should explain Remote Login / SSH setup and troubleshooting for users
who hit key-auth or reachability failures. That documentation requirement supports clear recovery
guidance, but it does not itself specify a full in-product username/password/install wizard.

- **Anchor:** requirements.md §1.13 (Q0176, Q0177, Q0184, Q0185, Q0193, Q0197, Q0201) —
  install docs should include "Remote Login/SSH guidance" and a "troubleshooting path."
- **Open detail:** exact in-product password form copy, sudo prompts, and credential retry rules
  are not separately Q-backed.
- **Test target:** docs install/troubleshooting coverage, `StepConnect.tsx` failure help links.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **Client-driven host setup from username/password to bootstrap install/start.** The flow tree
  repeatedly specifies account entry, password entry, sudo/remote command checks, Homebrew or
  download/bootstrap installation, app launch, and retry/timeout branches. requirements.md §4 says
  the "six-digit / sign-in / host-install pairing UX is not fully specified." (Q0430, Q0440)
- **Connect / Reconnect / Set up taxonomy and saved SSH-key semantics.** requirements.md backs
  LAN-first discovery and offering to connect, but it does not define candidate labels, saved-host
  priority, reconnect key reuse, or when a discovered host becomes setup vs connect vs reconnect.
- **Detailed SSH credential state machine.** Empty username/password validation, password retry,
  same-credential retry, failed sudo, permission-denied, and remote command execution errors are
  plausible product states but are not specified by user-query-backed requirements.
- **Host-key mismatch and known_hosts cleanup.** Only default-hidden fingerprint display is backed.
  Rekeyed-host blocking, known_hosts cleanup, trust confirmation, key replacement, and manual
  connect routing need a user decision before tests assert them.
- **XpairHost app/version guard matrix.** The Host/TCC guard is backed, but exact "app missing,"
  "app not running," "version incompatible," and "Next disabled" states are implementation/product
  details still below requirement altitude.
- **Tailscale state-machine screens.** Tailscale fallback is backed, but exact not-installed,
  not-running, offline, SSH-port-unreachable, MagicDNS-off, and external Tailscale round-trip
  behavior is not specified.
- **Engine/API-key lines in this cluster.** Claude/Codex/OpenCode install/auth checks are covered
  by requirements.md §1.3 and the CLI/engine behavioral spec; API-key retry wording inside this
  SSH cluster should not be asserted here as separate SSH-keyauth spec.

---

_PoC: 1 cluster of the M1 onboarding subset. This file anchors the SSH/key-auth cluster; unsupported
flow-tree detail is demoted to Open Issues until requirements.md gains user-query backing._
