// BonjourAdvertiser.swift — LAN discovery, host side (plan component ① / A1).
//
// Advertises this Mac as `_remotepair._tcp` on the local network so a RemotePair client
// can discover it via Bonjour (NWBrowser / `dns-sd -B`). TXT record carries:
//   hn   = friendly hostname        v   = app version (Config.swift APP_VERSION)
//   role = currentRole() (host|both)  fp = ed25519 host-key fingerprint (HostKey.swift)
//
// This is ADVERTISE-ONLY. The actual pairing handshake (PIN + PAKE) is PairingServer.swift
// (component ③, later). Bonjour requires a bound TCP port to advertise, so incoming
// connections here are accepted and immediately cancelled — nothing is served on this port.
//
// Lifecycle mirrors HostManager.ensureServer: an idempotent ensureAdvertising() called at
// launch and on the 5s host watchdog tick (AppDelegate), gated on isHostRole so a
// client-role machine never advertises itself as a host.

import Foundation
import Network

final class BonjourAdvertiser {
    static let serviceType = "_remotepair._tcp"
    private var listener: NWListener?

    /// Idempotent: (re)start the advertiser unless it is already up. Safe to call every tick.
    func ensureAdvertising() {
        switch listener?.state {
        case .some(.ready), .some(.setup), .some(.waiting):
            return                      // already advertising (or coming up)
        default:
            start()                     // nil / cancelled / failed → (re)start
        }
    }

    private func start() {
        listener?.cancel()
        let name = Host.current().localizedName ?? ProcessInfo.processInfo.hostName

        var txt = NWTXTRecord()
        txt["hn"] = name
        txt["v"] = APP_VERSION
        let role = currentRole()
        txt["role"] = role.isEmpty ? "host" : role
        if let fp = hostKeyFingerprint() { txt["fp"] = fp }

        do {
            let l = try NWListener(using: .tcp)
            l.service = NWListener.Service(name: name, type: BonjourAdvertiser.serviceType,
                                          domain: nil, txtRecord: txt)
            l.stateUpdateHandler = { state in
                if case .failed(let err) = state {
                    log(.warn, "BONJOUR: advertiser failed: \(err) — retry next tick")
                }
            }
            // Discovery-only: we don't serve anything here. Drop any connection immediately.
            l.newConnectionHandler = { conn in conn.cancel() }
            l.start(queue: .main)
            listener = l
            log("BONJOUR: advertising \(BonjourAdvertiser.serviceType) as \(name)")
        } catch {
            log(.warn, "BONJOUR: cannot start advertiser: \(error)")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }
}
