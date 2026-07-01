// The agent engine that runs LOCALLY on this host under `xpair launch`.
export type EngineId = 'claude' | 'codex' | 'opencode'

declare global {
  interface Window {
    __rp_initialStep?: 'permissions' | 'engine' | 'connect'
    xpair: {
      openPermissionPane: (key: 'login' | 'ax' | 'sr' | 'fda' | 'sharing') => Promise<void>
      requestPermission: (key: 'login' | 'ax' | 'sr' | 'fda' | 'sharing') => Promise<void>
      startInstall: () => Promise<void>
      getInstallStatus: () => Promise<{ appAlive: boolean; launchAgentPresent: boolean; serverUp: boolean }>
      getHostInfo: () => Promise<{ hostname: string; user: string }>
      getStatus: () => Promise<{ alive: boolean; login: boolean; ax: boolean; sr: boolean; fda: boolean; sharing: boolean }>
      getOnboardingStep: () => Promise<number>
      setOnboardingStep: (n: number) => Promise<void>
      // Both flags are opt-in (default OFF). Maps to UserDefaults RPTelemetryConsent / RPCrashReportConsent.
      getConsent: () => Promise<{ telemetry: boolean; crash: boolean }>
      setConsent: (c: { telemetry: boolean; crash: boolean }) => Promise<void>
      // Read-only: clients currently connected (heartbeat ts within the freshness window). [] when none.
      connectedClients: () => Promise<Array<{ name: string; user: string; ageSec: number }>>
      // Agent-engine guard — runs LOCALLY on this host (mirrors the client's host-over-SSH guard).
      // engineStatus probes install + auth; installEngine runs brew (npm fallback for claude);
      // setEngineAuth feeds the API key over the child's stdin only (never argv/log/disk-plaintext);
      // setEngine persists the choice to ~/.xpair/host/host.env (ENGINE=<id>).
      engineStatus: (engine: EngineId) => Promise<{ installed: boolean; authed: boolean; version: string; err: string }>
      installEngine: (engine: EngineId) => Promise<{ ok: boolean; err: string }>
      setEngineAuth: (engine: EngineId, key: string) => Promise<{ ok: boolean; err: string }>
      setEngine: (engine: EngineId) => Promise<{ ok: boolean; err: string }>
      complete: () => Promise<void>
    }
  }
}

export {}
