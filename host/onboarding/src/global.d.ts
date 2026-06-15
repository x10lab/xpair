declare global {
  interface Window {
    remotepair: {
      openPermissionPane: (key: 'ax' | 'sr' | 'fda') => Promise<void>
      requestPermission: (key: 'ax' | 'sr' | 'fda') => Promise<void>
      startInstall: () => Promise<void>
      getInstallStatus: () => Promise<{ appAlive: boolean; launchAgentPresent: boolean; serverUp: boolean }>
      getHostInfo: () => Promise<{ hostname: string; user: string }>
      getStatus: () => Promise<{ alive: boolean; ax: boolean; sr: boolean; fda: boolean }>
      complete: () => Promise<void>
    }
  }
}

export {}
