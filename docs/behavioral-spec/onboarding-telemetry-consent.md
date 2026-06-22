# Behavioral Spec — Onboarding: Telemetry Consent

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
> **Scope:** M1 onboarding, telemetry consent cluster. Source flow cluster: `/tmp/m1_clusters/02-telemetry-consent.txt`.

---

## R1 — Product analytics requires an explicit onboarding decision

Onboarding must expose the product-analytics consent decision before treating PostHog telemetry
as enabled. Product analytics must not become enabled merely because the user launches Xpair,
advances onboarding, reaches discovery, or completes another setup gate.

- **Anchor:** requirements.md §1.12 (Q0385, Q0401, Q0403, Q0448, Q0449) — "PostHog is the
  preferred funnel/product analytics tool" and "onboarding must expose the opt-in decision." ·
  requirements.md §4 (Q0448, Q0449) — "Product analytics should not be silently enabled."
- **Test target:** client `StepConsent.tsx`, client/host `ConsentControls.tsx`, client
  `telemetry.js` PostHog consent gate, `telemetry.test.js`.

## R2 — Telemetry exists to harden first-run setup, not to broaden analytics

Consent-backed product analytics should be limited to first-run hardening and activation/setup
failure visibility. Onboarding must not use the consent step as a blanket authorization for
unrelated or vanity event collection.

- **Anchor:** requirements.md §1.12 (Q0385) — "Telemetry must serve first-run hardening, not
  vanity analytics." · requirements.md §5 M5 (Q0380, Q0385, Q0401, Q0403, Q0448, Q0449) —
  observability covers "golden path" setup evidence through logs, Sentry, PostHog, Host coverage,
  and onboarding consent/default decisions.
- **Test target:** client `telemetry.js` event catalog and allowlist, `telemetry.test.js`,
  onboarding `tCapture` calls.

## R3 — Crash/error reporting is a separate exposed decision

Crash/error reporting belongs to the Sentry path and must be exposed as its own onboarding
decision rather than being silently bundled with product analytics. Tests must not assume a final
crash-report default until the open default decision is resolved.

- **Anchor:** requirements.md §1.12 (Q0385, Q0401, Q0403, Q0448, Q0449) — "Sentry is the
  preferred crash/error reporting tool" and onboarding must expose the opt-in decision. ·
  requirements.md §4 (Q0448, Q0449) — "Whether crash reports are opt-in or opt-out remains
  undecided."
- **Test target:** client `telemetry.js` Sentry consent gate, host `SentryBridge.swift`,
  host `AppDelegate.swift`, host/client consent controls.

## R4 — Host telemetry consent is not Client-only

The Host side must be covered by the same observability consent requirement: if Host telemetry or
crash reporting is enabled, Host onboarding must expose that decision and the Host reporting path
must honor it. Client consent UI alone is not enough to satisfy Host coverage.

- **Anchor:** requirements.md §1.12 (Q0448) — "Host should also be covered by Sentry/PostHog if
  telemetry is enabled, and onboarding must expose the opt-in decision." · requirements.md §0.2
  (Q0343, Q0245, Q0337, Q0443) — Host and Client have separate roles and should not be collapsed.
- **Test target:** host `StepWelcome.tsx`, host `StepDone.tsx`, host `ConsentControls.tsx`,
  `OnboardingWindow.swift`, `TelemetryClient.swift`, `SentryBridge.swift`.

## R5 — Consent choice is not a setup-completion gate

Accepting, declining, or changing telemetry/crash-report consent must not by itself mark onboarding
complete, and declining optional observability must not block completion of otherwise completed
setup. Completion remains governed by the required onboarding gates for the relevant role.

- **Anchor:** requirements.md §1.12 (Q0448, Q0449) — telemetry is exposed as an opt-in/default
  decision, not as a setup dependency. · requirements.md §1.2 (Q0369, Q0402, Q0474) — Client
  onboarding closes only after necessary setup is complete. · requirements.md §1.5 (Q0443) —
  required Host permissions must resolve before Host is usable.
- **Test target:** onboarding route/completion state in client `App.tsx`, host `App.tsx`,
  `useWizard.ts`, `onboarding-main.cjs`, host `OnboardingWindow.swift`.

## R6 — Closing before required setup remains incomplete

If the user closes onboarding after viewing or changing consent but before the required setup gates
have completed, onboarding must remain incomplete and must not proceed as though Host serving or
the Client workbench is ready.

- **Anchor:** requirements.md §1.2 (Q0369, Q0402, Q0474) — onboarding precedes the workbench and
  closes only after necessary setup is complete. · requirements.md §1.5 (Q0443) — unresolved Host
  setup must not be treated as successful setup.
- **Open detail:** whether partially changed consent values are persisted across that incomplete
  exit is derived from the flow tree, not separately Q-backed.
- **Test target:** onboarding close/cancel lifecycle, host `OnboardingWindow.swift`, client
  `onboarding-main.cjs`, consent persistence bridge tests.

---

## Open Issues (flow-tree expectations with NO user-query backing — do NOT assert)

- **Crash-report default.** The flow tree repeatedly treats crash reporting as a checkbox with
  opt-in/opt-out branches, but requirements.md §4 explicitly keeps the default undecided:
  "Whether crash reports are opt-in or opt-out remains undecided." (Q0448, Q0449) Do not assert
  crash-report default ON or OFF until the user decides it.
- **Exact consent UI placement and copy.** "Welcome" → "Before you start", Done-screen summaries,
  the exact `Open Xpair` label, checkbox labels, and Settings wording are plausible UI choices,
  but requirements.md only backs exposing the onboarding decision. Treat the exact screen order,
  copy, and placement as Open detail.
- **Re-toggle and latest-value semantics.** The cluster says repeated checkbox changes should leave
  only the latest telemetry/crash value, but requirements.md does not specify save-on-toggle,
  debounce, bridge failure handling, or whether the value is saved before the user clicks Next.
- **Immediate-send behavior on checkbox change.** "Changing consent should only save consent and
  must not immediately send analytics/crash data" is privacy-friendly, but the SSOT does not
  separately specify whether a consent-change event exists. Do not assert this as spec without a
  user-backed telemetry event decision.
- **Detailed consent settings.** Separate "advanced analytics settings," "access denied" branches,
  and non-onboarding settings routes are not specified by requirements.md. They should either
  terminate as out-of-scope in the flow tree or route to a later settings spec after user backing.
- **Exact four-row ON/OFF matrix.** Two independent decisions imply four UI states, but storage
  keys, default values, migration behavior, and persistence across abandoned onboarding are
  implementation details until requirements.md is expanded.

---

_Cluster output for M1 onboarding fan-out. Anchored from `/tmp/m1_clusters/02-telemetry-consent.txt`
to `requirements.md`; flow-tree-only details are demoted to Open Issues._
