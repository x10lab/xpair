# Onboarding redesign — implementation blueprint

Design owner: Claude. Implementation: Codex. Source of truth for the target UX:
`context/remotepair-onboarding` (gitignored reference clone). Requirements spec:
`.omc/specs/deep-interview-onboarding-redesign.md`. This blueprint is the bridge
from that spec to code.

Delivery: single branch `feat/onboarding-redesign`, big-bang replacement of both
onboarding surfaces, old onboarding deleted. Done = both apps build + typecheck
green, happy-path e2e for client and host, and quit&reopen resume verified.

---

## 1. Scope map (what replaces what)

| Surface | Current (delete/replace) | Target |
|---|---|---|
| Client webview | `client/ide/remotepair/ext/onboarding-webview/` (9-step, dark, macOS chrome) | Demo client flow (8-step, light 720px card) |
| Host webview | `host/onboarding/` (5-step, dark) | Demo host flow (11-step, light 720px card) |
| Host backend | passive `connectedClients` poll, no accept/deny | broadcast advertise + pairing accept/deny + SSH key authorize + per-step probes |
| Guard | client `runLivenessCheck` + `nextDisabled`; host `nextDisabled` only | per-step self-healing parachute on BOTH, cross-restart resume, DeadEnd |

Keep reusing existing bridge capabilities where they already exist (SSH probe,
discovery, host-app install, mount) — re-sequence and re-skin, do not rewrite.

---

## 2. Design system (replace shell)

From demo `src/styles.css` — light default, no `.dark` toggle:
- `--background: oklch(1 0 0)` (white); foreground near-black slate.
- `--primary: oklch(0.52 0.22 277)` (indigo/violet); `--destructive` red; inline emerald/amber/rose/blue accents.
- `--radius: 0.625rem` (10px); cards `rounded-3xl`/`rounded-2xl`.
- Wizard card `w-[720px]`, body `h-[440px]` scrollable, 3-col footer (Back ghost / center / Next primary). **No macOS traffic-light chrome.** Floating card on `bg-muted/40`, soft shadow.
- System sans; `font-mono` for hostnames, IPs, paths, fingerprints.
- Animations: `step-enter-next/prev` (260ms slide), `radar-ring`, `shimmer-bar`, `soft-pulse`.

Port the demo's `WizardShell`, `AnimatedStep`, `useWizard`, `StepProgress`,
`StepHero`, `StepDeadEnd`, `InstallProgressBar`, and shadcn `ui/*` into both real
webviews, replacing the current dark shell. `StepCheckPerm` is demo dead code — do
not port.

---

## 3. Client flow (8 steps) — `TOTAL = 8`

Indices + gates (from demo `routes/client.tsx`, verbatim logic):

| idx | Step | Gate (`nextDisabled`) / behavior |
|---|---|---|
| 0 | Welcome | none; Next "Get started" |
| 1 | Consent(crash) | none; toggle default **ON** |
| 2 | Consent(analytics) | none; toggle default **OFF** |
| 3 | Discover | disabled until a host selected |
| 4 | Update | auto-skip (650ms) if up-to-date; `needsUpdate`→gated until `updateState==="done"`; `majorMismatch`→**DeadEnd**, Next hidden |
| 5 | WaitPerm | gated until `permAccepted`; `permDenied`→**DeadEnd**, Next hidden |
| 6 | Mappings | gated until `mappings.length>=1`; Next "Finish" |
| 7 | Done | last; footer "Open Xpair" |

`goBackToDiscover()` resets selected/update/perm and `goTo(3,"prev")`.

---

## 4. Host flow (11 steps) — `TOTAL = 11`

| idx | Step | Gate |
|---|---|---|
| 0 | Welcome | none; Next "Begin setup" |
| 1 | Consent(crash) | none; default ON |
| 2 | Consent(analytics) | none; default OFF |
| 3-7 | SinglePerm ×5 `PERM_ORDER=[login,ax,sr,fda,sharing]` | each gated until that perm `granted` |
| 8 | Engine (multi-select) | gated until `engines.size>=1` |
| 9 | Broadcast | never hard-gated; Next "Continue" if accepted else "Skip" |
| 10 | Done | last; footer "Open Xpair" |

Permission copy + panes (verbatim, demo `StepSinglePerm`):
- login "Remote Login (SSH)" — "System Settings → General → Sharing → Remote Login"
- ax "Accessibility" — "…→ Privacy & Security → Accessibility"
- sr "Screen Recording" — "…→ Screen Recording"
- fda "Full Disk Access" — "…→ Full Disk Access"
- sharing "File Sharing" — "System Settings → General → Sharing → File Sharing"

Engines (multi-select, ≥1): Claude Code (Recommended) / Codex / Opencode.

---

## 5. Parachute guard (the core logic change)

**Model:** every step is a self-healing node. On entry AND re-entry, the step
re-probes its precondition. If unmet → auto-bounce (descend) to the matching
repair step. Unrecoverable → `StepDeadEnd` (Next hidden, in-body recovery only).
No single end-of-flow completion gate. Applies to client AND host.

**Cross-restart resume (why the guard is mandatory):** granting a macOS TCC
permission forces the host app to quit & relaunch. Onboarding progress MUST
persist across restart; on relaunch the guard re-probes from the top and lands at
the first unmet step (never restarts at step 0). Persist to disk (host:
`status.json`/app-support state; client: extension global state).

### 5.1 Guard = { probe, repairTarget, deadEnd? } per step

Client:
| Step | Probe (re-check on entry) | Bounce → | DeadEnd |
|---|---|---|---|
| Discover | host still selected & reachable | Discover | — |
| Update | host version compatible | Update (run update) | majorMismatch → DeadEnd "too new" |
| WaitPerm | host accepted + AX/SR granted on host | WaitPerm | denied → DeadEnd "host denied" |
| Mappings | ≥1 mapping mounts | Mappings | — |
| Done | all above fresh | first failing | — |

Host:
| Step | Probe | Bounce → | DeadEnd |
|---|---|---|---|
| SinglePerm(login/ax/sr/fda/sharing) | that TCC/sharing pane granted (re-probe after relaunch) | that same perm step | — |
| Engine | ≥1 engine installed+authed on this Mac | Engine | — |
| Broadcast | (soft) client still paired | Broadcast (re-advertise) | deny is soft in-body, not routing |

DeadEnd tones: majorMismatch = danger `ShieldAlert` "This host is too new"
(actions: "Check for client updates" ext link, "Pick another host"); host-denied =
danger `ShieldX` "Host denied the request" (actions: "Try again", "Pick another host").

---

## 6. Pairing control channel (net-new backend) — DRAFT for codex-challenge

Decisions locked by `260701 논의.txt`:
- **No fixed inbound port.** Host advertises via **LAN broadcast/multicast**
  (Bonjour/mDNS + Syncthing-style local discovery). Client only listens. Remote =
  Tailscale. Cross-NAT hole-punching out of scope.
- **Host is fixed; client portable.** Host keeps advertising open.
- **Client roaming safety:** client watches default gateway MAC; on change →
  moved networks → auto-disable. (Client-only; host does no network key-check.)

### 6.1 Pairing flow (proposed)
1. Host (Broadcast step) advertises `{ hostname, host-key-fp }` over mDNS/broadcast on LAN (+ Tailscale name for remote).
2. Client Discover sees the ad; on select, client sends a **pairing request** carrying `IncomingRequest = { name, ip, user, keyFingerprint }` where `keyFingerprint = SHA-256(client ed25519 pubkey)` short-form.
3. Host Broadcast/incoming shows request + fingerprint; user eyeball-compares against what the client displays; **Accept** → host appends the client pubkey to `~/.ssh/authorized_keys` (authorize) and notifies client; **Deny** → notify client (→ client DeadEnd).
4. Client verifies **host** key via TOFU (existing); host verifies **client** via the fingerprint eyeball-compare (new). Mutual, no PIN.

### 6.2 Open questions for codex-challenge (security/robustness)
- Transport for the pairing request itself (step 2): reuse the just-established SSH channel vs a small broadcast-discovered control endpoint? Which is safe without opening a fixed port?
- Fingerprint spoofing / MITM on LAN: is eyeball-compare + TOFU sufficient, or is a short auth tag needed on the request channel?
- authorized_keys authorization: scope/hardening (forced command? key options? per-client comment for later revoke)?
- Gateway-MAC roaming check: false-positive cases (VPN up/down, dual-NIC); fail-open vs fail-closed.

---

## 7. Delivery

- Branch `feat/onboarding-redesign` (already open). Big-bang; delete old onboarding dirs after parity reached.
- Order suggested for Codex: (1) shell+design port both apps → (2) client steps+guard → (3) host steps+guard+resume → (4) pairing backend (broadcast/accept-deny/authorize) + gateway-MAC watch.
- Done: both webviews `tsc` + build green; ext test harness green; happy-path e2e (client discover→pair→map→done; host consent→perms→engine→accept→done); quit&reopen resume lands on correct step.

## 8. Non-goals
No PIN. Client has no engine step. No re-pair/revoke management UI (first-run only). No cross-NAT hole-punching.
