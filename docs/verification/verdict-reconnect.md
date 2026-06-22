# Verification Verdict - reconnect

Authority: `docs/requirements.md` only.
Cluster: `/tmp/m1_clusters/05-reconnect.txt`.

## CONTRADICTS

- Engine selection/check is expected after reconnect/SSH/host-guard success, including "Engine 단계로 이동" and "지원 엔진 선택, 설치 여부, 인증 상태를 확인". This contradicts §1.3 (Q0545). Quote: "Engine choice (Claude / Codex / OpenCode) should be offered **before** the device-name / host-setup step". Conflict: the cluster places engine choice after host setup/reconnect has already succeeded.

- A stale-only/no-client state is expected to advance to Done: "클라이언트 미연결 상태로 Done 단계에 진입". This contradicts §1.5 (Q0543). Quote: "with no connected client the Host onboarding is expected to hold at the permission step rather than report completion." Conflict: the cluster reports completion despite explicitly saying the client is unconnected.

## UNSPECIFIED

- Exact reconnect action vocabulary and row actions, including Set up / Connect / Reconnect as selectable actions, are unspecified. §4 (Q0430, Q0440) flags adjacent pairing UX as open: "The six-digit / sign-in / host-install pairing UX is not fully specified."

- Existing-host rediscovery becoming a Reconnect card, default Reconnect action, and route selection among setup/connect/reconnect are unspecified. Requirements support discovery generally, not these action-state rules.

- Stored SSH key reuse, existing-key reachability checks, automatic reconnect confirmation, and "same host/key" retry loops are unspecified.

- SSH host-key mismatch handling, rekeyed messaging, known_hosts cleanup, manual-connect fallback, and key-renewal choices are unspecified. §1.2 (Q0430) only says: "Host key fingerprint should be hidden by default and revealed only when expanded."

- Host app guard, XpairHost-installed guard, XpairHost-running guard, and compatible-version guard outcomes are unspecified.

- Exact Next enabled/disabled behavior after SSH reachability, host-app status, and version status is unspecified.

- Retry/wait state machines for network recovery, repeated failure, retry-before-fix, and retry-after-fix are unspecified.

- Cancel, close, and back behavior preserving previous settings or leaving current reconnect unconfirmed is unspecified.

- Bundled CLI installation completion returning to Bonjour/Tailscale scan is unspecified. The hard CLI gate is backed, but the post-install resume state is not.

- Manual host address input behavior, reachable/unreachable address validation, connection-button availability, and SSH-probe-based judgment are unspecified.

- No-host fallback UI details such as same-Wi-Fi copy, Tailscale prompt, manual input fallback, and scan-refresh behavior are unspecified.

- Tailscale installed/running/recovered states feeding back into SSH/host-app guards are unspecified.

- Already-installed XpairHost causing setup to be skipped in favor of existing-host connect/reconnect is unspecified.

- Fully configured host detection, workbench resume, relaunch sentinel behavior, forced-onboarding exit, and setup-again scheduling are unspecified.

- GUI restart or setup-again preserving host tmux sessions is unspecified.

- Existing-session candidate screens, attach-progress states, session-list refresh, disappeared/unreachable sessions, and new-session-only fallback are unspecified.

- Project/mapping selection routing into session creation or existing-session confirmation is unspecified beyond the general mapping requirement.

- Password authentication, corrected-password retry, and same-password retry behavior are unspecified.

- Accessibility pane reopening and permission retry mechanics are unspecified beyond the general onboarding-permission requirement.

- Engine restart, host restart, and next-Retry engine-response recovery are unspecified.

- Stale heartbeat polling states, including fresh/stale/empty/failure branches, are unspecified.

- Hiding stale clients, not showing stale clients as paired, and Done-screen stale-client display behavior are unspecified.

- Multiple-client list behavior after stale filtering is unspecified beyond the general "multiple clients possible" direction.

- Blocking Host-side stale-client removal or forced stale-client recovery is unspecified.

- Marking Xpair-out-of-scope VSCodium surfaces as "접근 불가" is unspecified by requirements.md.

- Failure-screen choices such as Retry, manual connection, reset, other-host selection, and maintaining the same failure UI are unspecified.

- Reconnect success restoring existing settings and moving to the next stage is unspecified.

- Workbench close immediately after attach leaving only attach state is unspecified.

- Post-install or repeated-recheck routing into "client connection wait" or "existing host connect" is unspecified.

- Changed-network, changed-host, changed-credential, and invalidated-check retry behavior is unspecified.

- Editing host input invalidating a prior successful check is unspecified.

- Permission/file-access onboarding sequence after reconnect or host check is unspecified.

- Discover refresh/back behavior, including clearing previous results or returning to the same Bonjour result list, is unspecified.

- Refusing installation before SSH host trust is confirmed is unspecified. Requirements mention host-key fingerprint display, not trust-blocking behavior.

- Editing host name/address moving from discovered-host reconnect to manual flow is unspecified.

- Default row action chosen from Connect/Reconnect/Set up based on host identity is unspecified.

- Attach success routing specifically to workbench versus session terminal is unspecified.

- Terminating or exiting when the user closes stale/no-client screens, as distinct from reporting completion, is unspecified.

## BACKED

- LAN/Bonjour discovery before first connection is backed by §1.4 (Q0382, Q0384). Quote: "First connection should be LAN-first: scan the local network with Bonjour".

- Tailscale as fallback when LAN discovery does not find a Mac is backed by §1.4 (Q0383, Q0384). Quote: "Tailscale is a fallback, not a prerequisite."

- CLI availability acting as a hard gate before dependent flows is backed by §1.3 (Q0533, Q0534, Q0536, Q0537). Quote: "`xpair` CLI availability is a hard product requirement before flows that need it."

- Installing or blocking clearly when the CLI is unavailable is backed by §1.3 (Q0533, Q0534, Q0536, Q0537). Quote: "The onboarding must either install it before the hard gate or block with a clear reason."

- Client onboarding appearing before the workbench is backed by §1.2 (Q0369, Q0421, Q0424, Q0426). Quote: "Client onboarding appears before the IDE workbench."

- The workbench not appearing alongside onboarding is backed by §1.2 (Q0369, Q0421, Q0424, Q0426). Quote: "The workbench window should not appear alongside it".

- Onboarding not being considered complete until necessary setup is complete is backed by §1.2 (Q0369, Q0402, Q0474). Quote: "Client onboarding closes only after the necessary setup is complete".

- Host onboarding and permission/TCC blocking are backed by §1.5 (Q0443). Quote: "If TCC is not resolved, the app should not proceed as though setup succeeded."

- Reopening onboarding from Settings/permission actions is backed by §1.2 (Q0473, Q0493, Q0494). Quote: "Permissions and Settings actions should be able to reopen the relevant onboarding step".

- Launching or attaching persistent host sessions from the client is backed by §1.6 (Q0056, Q0153, Q0154). Quote: "centered on launching/attaching persistent host sessions from the client."

- Restoring terminal/session state after closing and reopening the client is backed by §1.6 (Q0546, Q0547). Quote: "Terminal windows/tabs should be restored after the client is closed and reopened".

- Detached/orphaned session handling is backed by §1.6 (Q0061, Q0062, Q0063). Quote: "Detached/orphaned session handling is part of the launcher requirement".

- Client/host folder mapping as a product concept is backed by §1.7 (Q0041, Q0042, Q0043). Quote: "maps client paths to host paths."

- Add Mapping as the intended folder UX is backed by §1.7 (Q0414). Quote: "Client UX should use **Add Mapping**, not generic **Open Folder**".

- Sessions as the primary container is backed by §1.8 (Q0480). Quote: "Sessions is the primary container."

- One host having multiple clients possible is backed by §1.6 (Q0096, Q0248). Quote: "one host with multiple clients possible".

- A no-connected-client Host state waiting instead of reporting completion is backed by §1.5 (Q0543). Quote: "with no connected client the Host onboarding is expected to hold at the permission step".

Tally: BACKED=17 UNSPECIFIED=38 CONTRADICTS=2 (distinct 예상 considered: 57)
