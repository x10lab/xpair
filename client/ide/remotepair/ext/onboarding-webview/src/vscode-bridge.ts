// vscode-bridge.ts — replaces the standalone Electron preload.
//
// The onboarding UI runs inside the RemotePair IDE (VSCodium) as a webview. There is no Node
// `contextBridge`; instead the webview talks to the extension host over `postMessage`. This shim
// installs `window.remotepair`, where each method posts `{ id, method, args }` to the extension and
// resolves when a matching `{ id, result }` message arrives (rejects on `{ id, error }`).
//
// The extension-side handler dispatches to onboarding-bridge.js (Node ↔ remote-pair CLI).
// Spec: .omc/specs/deep-interview-client-onboarding-real-wiring.md

declare function acquireVsCodeApi(): { postMessage(m: any): void }

const vscode = acquireVsCodeApi()

type Pending = {
  resolve: (value: any) => void
  reject: (reason: any) => void
}

const pending = new Map<number, Pending>()
let nextId = 1

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data
  if (!data || typeof data !== 'object' || typeof data.id !== 'number') return
  const entry = pending.get(data.id)
  if (!entry) return
  pending.delete(data.id)
  if ('error' in data && data.error !== undefined) {
    entry.reject(data.error)
  } else {
    entry.resolve(data.result)
  }
})

/** Post one RPC call to the extension host and resolve with its result. */
function call<T>(method: string, args: any[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    vscode.postMessage({ id, method, args })
  })
}

window.remotepair = {
  hostInfo: () => call('hostInfo'),
  getConfig: () => call('getConfig'),
  setHost: (host) => call('setHost', [host]),
  addMapping: (clientPath, hostPath) => call('addMapping', [clientPath, hostPath]),
  setBackend: (sync, mount) => call('setBackend', [sync, mount]),
  mount: (hostPath) => call('mount', [hostPath]),
  sshKeygen: () => call('sshKeygen'),
  sshReachable: (host) => call('sshReachable', [host]),
  tailscaleStatus: () => call('tailscaleStatus'),
  complete: () => {
    // `complete` is fire-and-forget: the extension closes the webview, so no result returns.
    vscode.postMessage({ method: 'complete' })
    return Promise.resolve()
  },
}
