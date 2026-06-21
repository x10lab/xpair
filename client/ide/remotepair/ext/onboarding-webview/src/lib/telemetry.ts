// telemetry.ts — thin webview wrapper over the consent-gated PostHog bridge (window.remotepair).
//
// Frozen Phase-1 event names + controlled enums mirrored here so components reference constants
// (no string typos). All capture goes through the Electron main process (onboarding-bridge.js →
// telemetry.js), which re-validates the event name, re-coerces reason/path to enums, redacts every
// value, and gates on TELEMETRY_CONSENT (opt-in, default OFF → zero network calls). Calling capture
// from the webview is therefore always safe and never throws.
//
// Phase-2 event names are reserved in telemetry.js (RESERVED_PHASE2_EVENTS) — NOT mirrored here so
// they cannot be fired from the UI.

export const EVENTS = {
  APP_FIRST_LAUNCH: "app_first_launch",
  ONBOARDING_STARTED: "onboarding_started",
  SSH_CONFIG_COMPLETED: "ssh_config_completed",
  SSH_CONFIG_FAILED: "ssh_config_failed",
  HOST_CONNECTED: "host_connected",
  HOST_CONNECT_FAILED: "host_connect_failed",
  FIRST_SESSION_STARTED: "first_session_started",
} as const;

// Controlled `reason` enum — never a raw error string.
export const REASONS = {
  TIMEOUT: "timeout",
  AUTH_DENIED: "auth_denied",
  HOST_UNREACHABLE: "host_unreachable",
  DNS_FAILED: "dns_failed",
  KEYGEN_ERROR: "keygen_error",
  PERMISSION_DENIED: "permission_denied",
  UNKNOWN: "unknown",
} as const;

export const PATHS = { LAN: "lan", TAILSCALE: "tailscale" } as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];
export type ConnPath = (typeof PATHS)[keyof typeof PATHS];

/** Fire a Phase-1 event. Fire-and-forget; never throws (the bridge does the real work + gating). */
export function capture(event: string, props?: Record<string, unknown>): void {
  try {
    void window.remotepair?.tCapture?.(event, props);
  } catch {
    /* telemetry must never break the UI */
  }
}
