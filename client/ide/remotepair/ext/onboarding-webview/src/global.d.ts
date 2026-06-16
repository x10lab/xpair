// Discovery peer shape returned by `remote-pair discover --json` (deduped by host-key fingerprint).
export type PeerStatus = "reconnect" | "connect" | "setup"
export type PeerSource = "lan" | "tailscale" | "ssh"

export interface Peer {
  name: string
  addrs: string[]
  source: PeerSource
  sources: PeerSource[]
  fp: string | null
  status: PeerStatus
}

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
      mount: (hostPath: string, mountpoint?: string) => Promise<{ code: number; out: string; err: string; mountpoint: string }>
      hostPathExists: (p: string) => Promise<{ exists: boolean; err: string }>
      defaultMountpoint: (hostPath: string) => Promise<string>
      sshKeygen: () => Promise<{ pubkey: string; keygenNew: boolean }>
      sshReachable: (host: string) => Promise<{ reachable: boolean; err: string }>
      tailscaleStatus: () => Promise<{ installed: boolean; up: boolean }>
      // Discovery / pairing (component ⑤). NONE of these carry a password or passphrase — those
      // are collected only by the separate askpass helper. The PIN passed to pair() is short-lived
      // (120s host TTL) and must never be logged or sent to telemetry.
      discover: () => Promise<{ peers: Peer[]; err: string }>
      pair: (opts: { host: string; pin: string; fp?: string | null }) => Promise<{
        ok: boolean
        err: string
      }>
      installHost: (opts: { host: string; user?: string }) => Promise<{
        ok: boolean
        out: string
        err: string
      }>
      hostKeyFingerprint: (host: string) => Promise<{ fp: string; err: string }>
      // Telemetry (consent-gated PostHog; no-ops until opt-in).
      tCapture: (event: string, props?: Record<string, unknown>) => Promise<{ ok: boolean }>
      tCatalog: () => Promise<{
        EVENTS: Record<string, string>
        REASONS: Record<string, string>
        PATHS: Record<string, string>
      }>
      tGetConsent: () => Promise<{ telemetry: boolean; crashReport: boolean }>
      tSetConsent: (
        telemetry: boolean,
        crashReport: boolean,
      ) => Promise<{ telemetry: boolean; crashReport: boolean }>
      complete: () => Promise<void>
    }
  }
}

export {}
