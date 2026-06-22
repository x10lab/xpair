# Product decisions — UNSPECIFIED resolution, round 1 (2026-06-23)

Closes open-issue branches surfaced by the UNSPECIFIED-inference pass. requirements.md SSOT updates.

| # | Area | Decision |
|---|------|----------|
| 1 | §4 pairing/auth (connect to running host) | **SSH-key automatic, minimal input** — fingerprint confirm only; no password/6-digit-code entry as the primary path. |
| 2 | §1.9/§0.3 Remote Desktop input scope | **view-only** — RD mirrors the screen only; NO remote click/keyboard input. (Reverses current input-forwarding impl: drop rp-ctl/rp-move input channels + click/keyboard capture; rd-core test must assert view-only.) |
| 3 | §1.8 terminal surface | **Xpair Sessions only** — native VSCodium terminal/workbench surfaces stay hidden during owned Xpair flows. |
| 4 | §1.6/§1.13 remote transport | **mosh-preferred** when installed (fallback SSH); matches mosh auto-install. |

## Impact on existing green tests
- RD view-only (decision 2) contradicts `remote-desktop-core-q0346.test.js` (asserts click+keyboard forwarding) and the input code in `media/remote-desktop.js` + `extension.js`. These must be revised to view-only. Tracked as a fix issue.

## Round 2 (2026-06-23)

| # | Area | Decision |
|---|------|----------|
| 5 | §1.7/§1.8 Browser folder favorites | **Provide favorites** — folder star/favorite toggle with a local favorites store. |
| 6 | §1.4/§1.6/§1.7 local fallback | **Remote-first, NO auto local fallback.** Goal: 100% remote env from app launch. On disconnect → show "please connect" (prioritize reconnect), do NOT silently drop to local. Local IS allowed only via EXPLICIT local mode: enable local mode + top-bar "로컬 모드" indicator + CLI offers ONLY local options; local mode AUTO-CLEARS when the connection returns. |
| 7 | §4 host multi-client card | **Informational only** — read-only list of connected clients; no select/disconnect action (MVP). |
| 8 | §1.12/§4 telemetry consent UI | **opt-in toggle only** — single consent toggle; no detailed per-category analytics settings screen. |

## Remaining low-impact ambiguous → heuristic defaults (not interviewed)
- mosh-absence fallback: SSH (per decision 4).
- session transport selection: attach immediately (no extra confirm step) — fewer clicks, reconnect-friendly.
- overlong terminal input: follow terminal/agent native limits (no special file-based delivery feature in MVP).
- diagnostic-collection terminal: normal shell (do not lock down input) — simpler, matches "normal terminal" expectation.
- pairing completion copy: connected-client-specific copy when a client is present, else generic.
- manual host-name edit after discovery: remain editable in the selected-host auth step (no separate validation branch).
- non-Xpair workbench surfaces during RD reconnect: hidden (per decisions 2 view-only + 3 sessions-only).
