declare global {
  interface Window {
    remotepair: {
      hostInfo: () => Promise<{ hostname: string; user: string }>
      getConfig: () => Promise<{
        remoteHost: string
        folderMaps: string
        syncBackend: string
        mountBackend: string
      }>
      setHost: (host: string) => Promise<any>
      addMapping: (clientPath: string, hostPath: string) => Promise<any>
      setBackend: (sync: string, mount?: string) => Promise<any>
      mount: (hostPath: string) => Promise<{ code: number; out: string; err: string; mountpoint: string }>
      sshKeygen: () => Promise<{ pubkey: string }>
      sshReachable: (host: string) => Promise<{ reachable: boolean; err: string }>
      tailscaleStatus: () => Promise<{ installed: boolean; up: boolean }>
      complete: () => Promise<void>
    }
  }
}

export {}
