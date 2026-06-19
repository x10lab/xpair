declare global {
  interface Window {
    xpair: {
      // VIEW-ONLY: Accessibility ('ax') is no longer a granted permission, but the
      // bridge still accepts it for forward-compat; the UI only uses 'sr' | 'fda'.
      openPermissionPane: (key: 'ax' | 'sr' | 'fda') => Promise<void>
      requestPermission: (key: 'ax' | 'sr' | 'fda') => Promise<void>
      startInstall: () => Promise<void>
      getInstallStatus: () => Promise<{ appAlive: boolean; launchAgentPresent: boolean; serverUp: boolean }>
      getHostInfo: () => Promise<{ hostname: string; user: string }>
      getStatus: () => Promise<{ alive: boolean; ax: boolean; sr: boolean; fda: boolean }>
      // Both flags are opt-in (default OFF). Maps to UserDefaults RPTelemetryConsent / RPCrashReportConsent.
      getConsent: () => Promise<{ telemetry: boolean; crash: boolean }>
      setConsent: (c: { telemetry: boolean; crash: boolean }) => Promise<void>
      // Read-only: clients currently connected (heartbeat ts within the freshness window). [] when none.
      connectedClients: () => Promise<Array<{ name: string; user: string; ageSec: number }>>
      complete: () => Promise<void>
    }
  }
}

export {}
