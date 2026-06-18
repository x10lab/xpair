// Discovery peer shape returned by `remote-pair discover --json` (deduped by host-key fingerprint).
export type PeerStatus = "reconnect" | "connect" | "setup"
export type PeerSource = "lan" | "tailscale" | "ssh"

export interface Peer {
  name: string
  addrs: string[]
  // Canonical SSH target for install/connect: the ssh-config alias name when this peer is
  // config-known (carries IdentityFile + User → key auth), otherwise a discovered address. Always
  // prefer this over addrs[0] for any window.remotepair call that SSHes — a bare tailnet/LAN IP
  // not in ssh config falls back to password auth and hangs the GUI askpass. Optional for
  // back-compat with an older CLI that did not emit it (fall back to addrs[0] || name).
  target?: string
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
      // Discovery / remote-install (component ⑤). The only secret that transits here is the account
      // password (installHost), handed to the CLI over an inherited pipe (never argv/log/disk) and
      // never sent to telemetry; key passphrases are collected only by the separate askpass helper.
      discover: () => Promise<{ peers: Peer[]; err: string }>
      // `password` is the account password the user typed into the onboarding (no separate dialog).
      // It is handed to the CLI over an inherited pipe (never argv/log/disk). Omit when the host
      // already trusts the client key — the install then authenticates by key.
      installHost: (opts: { host: string; user?: string; password?: string }) => Promise<{
        ok: boolean
        out: string
        err: string
      }>
      // Post-install TCC grant status read from the host app's status.json over SSH. AX/SR/FDA must
      // be granted on the host's own screen (macOS forbids remote grants); the install step polls
      // this to confirm. `alive` = the host app is running and writing status.
      hostPermissions: (opts: { host: string }) => Promise<{
        alive: boolean
        ax: boolean
        sr: boolean
        fda: boolean
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
