// PairingServer.swift — host PIN/PAKE pairing server (plan component ③ / B2 + B3).
//
// SECURITY-CRITICAL. Implements the authn-before-touch trust path: a short-lived,
// rate-limited 6-digit PIN is shown ONLY on the host's physical screen; a client proves
// knowledge of that PIN via SPAKE2 (Rust libpake C ABI, pake-bridge.h) bound to the host
// ed25519 key fingerprint; ONLY after the confirmation MAC verifies does the host accept the
// client's SSH pubkey and append it to the GUI-session account's ~/.ssh/authorized_keys.
//
// Invariants enforced structurally below:
//  • authn-before-touch: the connection state machine cannot reach `.awaitingPubkey` (the only
//    state that reads the client pubkey / touches ~/.ssh/*) until `pake_verify_mac` returned OK.
//  • bind scope: bound to the host's LAN interface address(es) ONLY — never 0.0.0.0, never the
//    Tailscale utun interface — and only while ARMED (the PIN TTL window).
//  • single armed connection: a 2nd concurrent connection is refused while one is in-flight.
//  • rate-limit: ≤5 failed PAKE attempts within the TTL burns the PIN; re-arm needs on-screen action.
//  • PIN never logged / never sent on the network / never in telemetry. Only the on-screen menu
//    (via pairing.json, read by AppDelegate) ever sees the digits.
//
// Lifecycle: AppDelegate calls `arm()` (menu "Pair a new Mac…") and `tick()` (1Hz poll). The
// listener is created on arm and torn down on expiry/disarm/burn.

import Foundation
import Network
import Security
import Darwin

// ── on-screen state shared with the menu (NEVER the network / logs / telemetry) ──

/// What the host menu renders. Written to pairing.json by the server, read by AppDelegate's
/// rebuildMenu(). `pin` is present ONLY while armed; it is the single channel the digits travel.
struct PairingDisplay {
    var armed: Bool
    var pin: String          // "" when not armed
    var secondsLeft: Int
    var message: String      // e.g. "Enable Remote Login on the host to finish" / "pairing failed…"
}

/// Path the menu reads. Lives under LOG_DIR (mode 0700) but the PIN is intentionally written
/// here because the menu process is the same app; it is NEVER routed through log()/telemetry.
let PAIRING_FILE = "\(LOG_DIR)/pairing.json"

final class PairingServer {
    static let shared = PairingServer()

    // ── PIN policy ──
    private static let pinTTL: TimeInterval = 120          // §B3: 120s TTL
    private static let maxFailedAttempts = 5               // §B3: ≤5 failed PAKE attempts → burn
    private static let pairingPort: NWEndpoint.Port = 53427 // fixed LAN port for pairing (distinct from Bonjour)
    private static let perIPThrottleWindow: TimeInterval = 10 // §B3: per-source-IP throttle window

    private let q = DispatchQueue(label: "com.x10lab.remote-pair.pairing")

    // ── armed state (all touched only on `q`) ──
    private var listener: NWListener?
    private var pin: String = ""
    private var armedUntil: Date = .distantPast
    private var failedAttempts = 0
    private var pinBurned = false
    private var inFlight: NWConnection?                     // single armed connection
    private var lastMessage = ""
    private var perIPLastAttempt: [String: Date] = [:]      // source IP → last attempt time

    private var isArmed: Bool { !pinBurned && Date() < armedUntil && listener != nil }

    private init() {}

    // ── public API (called from AppDelegate, main thread) ──

    /// Explicit on-screen action ("Pair a new Mac…"). Generates a fresh PIN, binds the LAN
    /// listener, and starts the TTL. Gated on host role by the caller. Idempotent-ish: a fresh
    /// arm replaces any prior armed state (new PIN, counters reset).
    func arm() {
        q.async { [weak self] in self?._arm() }
    }

    /// Disarm: burn the PIN, tear down the listener, clear the on-screen display. Idempotent.
    func disarm() {
        q.async { [weak self] in self?._disarm(message: "") }
    }

    /// 1Hz tick from AppDelegate.poll(). Expires the PIN on TTL, refreshes pairing.json.
    func tick() {
        q.async { [weak self] in self?._tick() }
    }

    // ── arming ──

    private func _arm() {
        guard isHostRole else { return }                   // a client machine never pairs
        guard let _ = hostKeyFingerprintRaw() else {
            log(.warn, "PAIRING: cannot arm — host ed25519 fingerprint unavailable")
            _disarm(message: "Host SSH key missing — cannot pair")
            return
        }
        _teardownListener()
        pin = Self.makePIN()                               // crypto-random, NEVER logged
        armedUntil = Date().addingTimeInterval(Self.pinTTL)
        failedAttempts = 0
        pinBurned = false
        perIPLastAttempt.removeAll()
        lastMessage = Self.sshdEnabled() ? "" : "Enable Remote Login on the host to finish"

        guard let l = makeLANListener() else {
            log(.warn, "PAIRING: failed to bind LAN listener — cannot arm")
            _disarm(message: "Could not open pairing port")
            return
        }
        listener = l
        l.start(queue: q)
        log("PAIRING: armed (TTL \(Int(Self.pinTTL))s) — pairing code shown on host screen only")
        _writeDisplay()
    }

    private func _disarm(message: String) {
        pinBurned = true
        pin = ""
        armedUntil = .distantPast
        lastMessage = message
        _teardownListener()
        _writeDisplay()
    }

    private func _teardownListener() {
        inFlight?.cancel(); inFlight = nil
        listener?.cancel(); listener = nil
    }

    /// Burn the PIN and stop advertising/accepting NEW pairing connections promptly, but DO NOT
    /// cancel the already-authenticated in-flight connection: it must finish receiving the client
    /// pubkey and persist it to authorized_keys before anything tears it down (see step3). The
    /// in-flight connection is cleaned up by finishConnection() once the handshake completes.
    private func _burnPinKeepInFlight(message: String) {
        pinBurned = true
        pin = ""
        armedUntil = .distantPast
        lastMessage = message
        listener?.cancel(); listener = nil   // stop accepting NEW connections; leave inFlight alone
        _writeDisplay()
    }

    private func _tick() {
        // Expire on TTL (not a burn-by-failure — just silent expiry, indistinguishable to client).
        if listener != nil && !pinBurned && Date() >= armedUntil {
            log("PAIRING: PIN expired — disarming")
            _teardownListener()
            pin = ""
            lastMessage = ""
        }
        _writeDisplay()
    }

    // ── on-screen display (pairing.json) ──

    /// AppDelegate reads this to decide whether to show the "Pairing code: …" menu item.
    static func readDisplay() -> PairingDisplay {
        guard let data = FileManager.default.contents(atPath: PAIRING_FILE),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return PairingDisplay(armed: false, pin: "", secondsLeft: 0, message: "")
        }
        return PairingDisplay(
            armed: (obj["armed"] as? Bool) ?? false,
            pin: (obj["pin"] as? String) ?? "",
            secondsLeft: (obj["secondsLeft"] as? Int) ?? 0,
            message: (obj["message"] as? String) ?? "")
    }

    private func _writeDisplay() {
        let armed = isArmed
        let secs = armed ? max(0, Int(armedUntil.timeIntervalSinceNow.rounded())) : 0
        // The PIN is written ONLY here, ONLY when armed, ONLY to the local 0700 pairing.json the
        // same-app menu reads. It is NEVER passed to log()/outboundScrub()/telemetry.
        let obj: [String: Any] = [
            "armed": armed,
            "pin": armed ? pin : "",
            "secondsLeft": secs,
            "message": lastMessage,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        ensureDirs()
        do {
            try data.write(to: URL(fileURLWithPath: PAIRING_FILE), options: .atomic)
            // 0600: the file carries the live PIN while armed.
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: PAIRING_FILE)
        } catch {
            log(.warn, "PAIRING: write pairing.json failed: \(error)")
        }
    }

    // ── PIN generation (crypto-random, uniform; NEVER logged) ──

    /// 6-digit PIN, uniformly random over 000000…999999 via SecRandomCopyBytes + rejection
    /// sampling (no modulo bias). The digits never appear in any log/network/telemetry path.
    static func makePIN() -> String {
        let n = uniformRandom(below: 1_000_000)
        return String(format: "%06u", n)
    }

    /// Uniform random in [0, bound) using SecRandomCopyBytes with rejection sampling. arc4random
    /// is avoided per spec ("SecRandom/arc4random_uniform-free uniform").
    static func uniformRandom(below bound: UInt32) -> UInt32 {
        precondition(bound > 0)
        // Largest multiple of bound that fits in UInt32; reject above it to remove modulo bias.
        let limit = UInt32.max - (UInt32.max % bound)
        while true {
            var raw = UInt32(0)
            let rc = withUnsafeMutableBytes(of: &raw) { ptr -> Int32 in
                SecRandomCopyBytes(kSecRandomDefault, MemoryLayout<UInt32>.size, ptr.baseAddress!)
            }
            if rc != errSecSuccess { continue }            // RNG hiccup → retry (never fall back to weak RNG)
            if raw < limit { return raw % bound }
        }
    }

    // ── LAN bind scope ──

    /// Build a listener bound to the host's LAN interface ONLY. Never 0.0.0.0, never the Tailscale
    /// utun interface. We pick a concrete IPv4 LAN address and bind the listener's params to it.
    private func makeLANListener() -> NWListener? {
        guard let lanIP = Self.primaryLANIPv4() else {
            log(.warn, "PAIRING: no LAN IPv4 interface found — refusing to bind (no 0.0.0.0)")
            return nil
        }
        // requiredLocalEndpoint pins the bind to this specific LAN address.
        let params = NWParameters.tcp
        let host = NWEndpoint.Host(lanIP)
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: host, port: Self.pairingPort)
        params.allowLocalEndpointReuse = true
        do {
            let l = try NWListener(using: params, on: Self.pairingPort)
            l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            l.stateUpdateHandler = { state in
                if case .failed(let err) = state { log(.warn, "PAIRING: listener failed: \(err)") }
            }
            return l
        } catch {
            log(.warn, "PAIRING: NWListener bind to LAN addr failed: \(error)")
            return nil
        }
    }

    /// First non-loopback, non-utun (non-Tailscale) IPv4 address on a real LAN interface
    /// (en* / bridge*). Excludes utun*/utap* (Tailscale/VPN), lo0, awdl*, llw*.
    static func primaryLANIPv4() -> String? {
        var result: String?
        var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrPtr) == 0, let first = ifaddrPtr else { return nil }
        defer { freeifaddrs(ifaddrPtr) }
        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let cur = ptr {
            defer { ptr = cur.pointee.ifa_next }
            let flags = Int32(cur.pointee.ifa_flags)
            guard (flags & IFF_UP) != 0, (flags & IFF_LOOPBACK) == 0,
                  let sa = cur.pointee.ifa_addr, sa.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let name = String(cString: cur.pointee.ifa_name)
            // Bind ONLY on a real LAN interface; never the tailnet utun or other transient links.
            guard name.hasPrefix("en") || name.hasPrefix("bridge") else { continue }
            var addr = sockaddr_in()
            memcpy(&addr, sa, Int(MemoryLayout<sockaddr_in>.size))
            var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            inet_ntop(AF_INET, &addr.sin_addr, &buf, socklen_t(INET_ADDRSTRLEN))
            let ip = String(cString: buf)
            if !ip.isEmpty && ip != "0.0.0.0" { result = ip; break }
        }
        return result
    }

    // ── per-connection PAKE state machine (authn-before-touch) ──

    /// The ONLY states. `.awaitingPubkey` is reachable EXCLUSIVELY by a successful pake_verify_mac
    /// (see `step3VerifyAndAdvance`); there is no other transition into it. This is the structural
    /// guarantee that no ~/.ssh/* access happens pre-MAC.
    private enum PakeState {
        case awaitingClientMsg(handle: OpaquePointer)      // host msg sent; waiting for client SPAKE2 msg
        case awaitingClientMac(expectMac: [UInt8])         // host MAC sent; waiting for client MAC (NO pubkey yet)
        case awaitingPubkey                                // MAC verified — and ONLY now may we read pubkey + touch ~/.ssh
    }

    private func accept(_ conn: NWConnection) {
        q.async { [weak self] in
            guard let self else { conn.cancel(); return }
            // Single armed connection: refuse a 2nd concurrent connection (no parallel PAKE on one PIN).
            guard self.isArmed else { conn.cancel(); return }
            guard self.inFlight == nil else {
                log("PAIRING: refusing 2nd concurrent connection (one armed PIN, one connection)")
                conn.cancel(); return
            }
            // Per-source-IP throttle.
            let ip = Self.peerIP(conn)
            if let last = self.perIPLastAttempt[ip], Date().timeIntervalSince(last) < Self.perIPThrottleWindow {
                log("PAIRING: throttling source — too frequent")
                conn.cancel(); return
            }
            self.perIPLastAttempt[ip] = Date()
            self.inFlight = conn
            conn.stateUpdateHandler = { [weak self] st in
                switch st {
                case .failed, .cancelled:
                    self?.q.async { if self?.inFlight === conn { self?.inFlight = nil } }
                default: break
                }
            }
            conn.start(queue: self.q)
            self.startPake(conn)
        }
    }

    /// Step 1: pake_server_start → send msg_host. Crypto only; NO ~/.ssh access.
    private func startPake(_ conn: NWConnection) {
        guard let fpRaw = hostKeyFingerprintRaw(), fpRaw.count == 32 else {
            failAndMaybeBurn(conn, reason: "host fp unavailable"); return
        }
        let pinBytes = Array(pin.utf8)
        var handle: OpaquePointer? = nil
        var msg = [UInt8](repeating: 0, count: Int(PAKE_MSG_MAX))
        var msgLen: Int = 0
        let rc = pinBytes.withUnsafeBufferPointer { pinPtr in
            fpRaw.withUnsafeBufferPointer { fpPtr in
                pake_server_start(pinPtr.baseAddress, pinBytes.count,
                                  fpPtr.baseAddress,
                                  &handle, &msg, Int(PAKE_MSG_MAX), &msgLen)
            }
        }
        guard rc == PAKE_OK, let h = handle else {
            failAndMaybeBurn(conn, reason: "pake_server_start rc=\(rc)"); return
        }
        send(conn, Array(msg[0..<msgLen])) { [weak self] ok in
            guard let self else { pake_server_free(h); return }
            self.q.async {
                guard ok else { pake_server_free(h); self.failAndMaybeBurn(conn, reason: "send msg_host"); return }
                self.recvFramed(conn) { [weak self] data in
                    guard let self else { pake_server_free(h); return }
                    guard let data else { pake_server_free(h); self.failAndMaybeBurn(conn, reason: "recv client msg"); return }
                    self.step2(conn, handle: h, clientMsg: data)
                }
            }
        }
    }

    /// Step 2: pake_server_step → send send_mac, then await client MAC. Crypto only; NO ~/.ssh access.
    private func step2(_ conn: NWConnection, handle: OpaquePointer, clientMsg: [UInt8]) {
        var sendMac = [UInt8](repeating: 0, count: Int(PAKE_MAC_LEN))
        var expectMac = [UInt8](repeating: 0, count: Int(PAKE_MAC_LEN))
        var key = [UInt8](repeating: 0, count: Int(PAKE_KEY_MAX))
        var keyLen: Int = 0
        let rc = clientMsg.withUnsafeBufferPointer { cPtr in
            pake_server_step(handle, cPtr.baseAddress, clientMsg.count,
                             &sendMac, &expectMac, &key, Int(PAKE_KEY_MAX), &keyLen)
        }
        // On a non-OK return the handle is left valid → free it. On OK it was consumed.
        guard rc == PAKE_OK else {
            pake_server_free(handle)
            failAndMaybeBurn(conn, reason: "pake_server_step rc=\(rc)")
            return
        }
        let expect = expectMac
        send(conn, sendMac) { [weak self] ok in
            guard let self else { return }
            self.q.async {
                guard ok else { self.failAndMaybeBurn(conn, reason: "send host mac"); return }
                self.recvFramed(conn) { [weak self] data in
                    guard let self else { return }
                    guard let got = data else { self.failAndMaybeBurn(conn, reason: "recv client mac"); return }
                    self.step3VerifyAndAdvance(conn, expectMac: expect, gotMac: got)
                }
            }
        }
    }

    /// Step 3: THE authn-before-touch GATE. pake_verify_mac on the CLIENT's MAC. ONLY on OK do we
    /// advance to receiving the pubkey + touching ~/.ssh. Wrong/expired/tampered → indistinguishable.
    private func step3VerifyAndAdvance(_ conn: NWConnection, expectMac: [UInt8], gotMac: [UInt8]) {
        let rc = expectMac.withUnsafeBufferPointer { ePtr in
            gotMac.withUnsafeBufferPointer { gPtr in
                pake_verify_mac(ePtr.baseAddress, expectMac.count, gPtr.baseAddress, gotMac.count)
            }
        }
        guard rc == PAKE_OK else {
            // No pubkey read, no ~/.ssh touch. Indistinguishable failure.
            failAndMaybeBurn(conn, reason: "mac mismatch")
            return
        }
        // MAC VERIFIED. State has now advanced to .awaitingPubkey — the only point past which any
        // ~/.ssh access is permitted. Burn the PIN immediately so this PIN can never be reused.
        log("PAIRING: PAKE verified — receiving client pubkey")
        recvFramed(conn) { [weak self] data in
            guard let self else { return }
            // NOTE: do NOT cancel the connection here. sendResult() tears it down from the final
            // frame's send-completion so the result bytes are flushed before the connection closes.
            guard let pubData = data, let pubLine = String(data: Data(pubData), encoding: .utf8) else {
                self.sendResult(conn, ok: false, msg: "no pubkey")
                return
            }
            switch self.appendAuthorizedKey(pubLine) {
            case .success:
                let warn = Self.sshdEnabled() ? "" : "Enable Remote Login on the host to finish"
                self.sendResult(conn, ok: true, msg: warn)
            case .failure(let err):
                // Partial-failure rollback already handled in appendAuthorizedKey (atomic temp+rename:
                // no half-written file). Burn the PIN, explicit client error.
                log(.warn, "PAIRING: authorized_keys append failed: \(err)")
                self.sendResult(conn, ok: false, msg: "pairing failed, re-arm on host")
            }
        }
        // Burn the PIN and stop accepting NEW connections now that a connection has authenticated
        // (one PIN, one successful pairing). Do NOT cancel the in-flight connection here — it is
        // still awaiting the client pubkey above; tearing it down now would drop the authenticated
        // handshake before authorized_keys is written. finishConnection() cancels it once done.
        q.async { [weak self] in self?._burnPinKeepInFlight(message: "") }
    }

    private func finishConnection(_ conn: NWConnection) {
        if inFlight === conn { inFlight = nil }
        conn.cancel()
    }

    /// Increment the failed-attempt counter; burn the PIN at the cap. Never reveals why to the client.
    private func failAndMaybeBurn(_ conn: NWConnection, reason: String) {
        failedAttempts += 1
        log(.debug, "PAIRING: attempt failed (\(failedAttempts)/\(Self.maxFailedAttempts)) [\(reason)]")
        if failedAttempts >= Self.maxFailedAttempts {
            log("PAIRING: max failed attempts reached — burning PIN (re-arm required on host)")
            _disarm(message: "Too many tries — re-arm on host")
        }
        if inFlight === conn { inFlight = nil }
        conn.cancel()
    }

    // ── authorized_keys append (only reachable post-MAC) ──

    /// Validate a single SSH pubkey line and atomically append it (temp+rename) to the GUI-session
    /// account's ~/.ssh/authorized_keys, deduping. Reachable ONLY after pake_verify_mac == OK.
    private func appendAuthorizedKey(_ raw: String) -> Result<Void, Error> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isWellFormedPubkey(trimmed) else {
            return .failure(PairingError.badPubkey)
        }
        let sshDir = "\(HOME)/.ssh"
        let akPath = "\(sshDir)/authorized_keys"
        let fm = FileManager.default
        do {
            // mkdir ~/.ssh 0700
            if !fm.fileExists(atPath: sshDir) {
                try fm.createDirectory(atPath: sshDir, withIntermediateDirectories: true,
                                       attributes: [.posixPermissions: 0o700])
            }
            // Dedup: read existing, skip if the key already present.
            var existing = ""
            if let cur = try? String(contentsOfFile: akPath, encoding: .utf8) {
                existing = cur
                let keyField = Self.keyBody(trimmed)
                for line in existing.split(separator: "\n") {
                    if Self.keyBody(String(line)) == keyField { return .success(()) } // already authorized
                }
            }
            // Build the new content (preserve existing, ensure trailing newline, append our line).
            var content = existing
            if !content.isEmpty && !content.hasSuffix("\n") { content += "\n" }
            content += trimmed + "\n"
            // Atomic temp+rename so a failure never leaves a half-written authorized_keys.
            let tmpPath = "\(sshDir)/.authorized_keys.rp.\(getpid()).\(Int(Date().timeIntervalSince1970)).tmp"
            try content.write(toFile: tmpPath, atomically: false, encoding: .utf8)
            try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tmpPath)
            // rename is atomic on the same filesystem; replaces any existing file.
            if rename(tmpPath, akPath) != 0 {
                try? fm.removeItem(atPath: tmpPath)        // rollback: no half-written file
                return .failure(PairingError.appendFailed)
            }
            try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: akPath)
            log("PAIRING: client key appended to authorized_keys")
            return .success(())
        } catch {
            return .failure(error)
        }
    }

    enum PairingError: Error { case badPubkey, appendFailed }

    /// Strict single-line validation: exactly `<type> <base64> [comment]`, type ∈ the SSH key
    /// types, base64 body only, NO newlines, NO `command=`/options prefix, NO shell metachars.
    static func isWellFormedPubkey(_ line: String) -> Bool {
        // Reject any control/newline char outright.
        if line.contains(where: { $0 == "\n" || $0 == "\r" || $0 == "\t" || $0 == "\0" }) { return false }
        // Reject options/forced-command and shell metachars anywhere.
        let banned: Set<Character> = ["`", "$", ";", "&", "|", "<", ">", "(", ")", "\\", "\"", "'", "*", "?", "{", "}", "[", "]", "!", "#"]
        if line.contains(where: { banned.contains($0) }) { return false }
        if line.lowercased().contains("command=") { return false }
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        // 2 fields (type + body) or 3 (type + body + comment). An options field would push the
        // type to field 2+; we require the FIRST field to be a known key type → no options allowed.
        guard parts.count == 2 || parts.count == 3 else { return false }
        let validTypes: Set<String> = [
            "ssh-ed25519", "ssh-rsa",
            "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
        ]
        guard validTypes.contains(String(parts[0])) else { return false }
        // Body: base64 alphabet only (A-Za-z0-9+/=), non-empty, and must decode.
        let body = String(parts[1])
        guard !body.isEmpty else { return false }
        let b64set = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
        guard body.unicodeScalars.allSatisfy({ b64set.contains($0) }) else { return false }
        guard Data(base64Encoded: body) != nil else { return false }
        // Comment (if any) must be free of whitespace already (split guarantees) and metachars (checked above).
        return true
    }

    /// The `<type> <base64>` body of a pubkey line (ignoring any comment), for dedup comparison.
    static func keyBody(_ line: String) -> String {
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2 else { return line.trimmingCharacters(in: .whitespaces) }
        return "\(parts[0]) \(parts[1])"
    }

    // ── sshd / Remote Login detection (DO NOT auto-enable) ──

    /// Whether Remote Login (sshd) is enabled. We probe `launchctl print system/com.openssh.sshd`;
    /// exit 0 → the service is loaded. We NEVER enable it (non-goal) — only surface the message.
    static func sshdEnabled() -> Bool {
        let (_, status) = runCapture("/bin/launchctl", ["print", "system/com.openssh.sshd"])
        return status == 0
    }

    // ── framed I/O (length-prefixed: 2-byte big-endian length + payload) ──

    private func send(_ conn: NWConnection, _ payload: [UInt8], _ done: @escaping (Bool) -> Void) {
        var framed = [UInt8]()
        let n = payload.count
        framed.append(UInt8((n >> 8) & 0xff))
        framed.append(UInt8(n & 0xff))
        framed.append(contentsOf: payload)
        conn.send(content: Data(framed), completion: .contentProcessed { err in done(err == nil) })
    }

    /// Receive one length-prefixed frame. nil on error/short read. Caps the payload defensively.
    private func recvFramed(_ conn: NWConnection, _ done: @escaping ([UInt8]?) -> Void) {
        conn.receive(minimumIncompleteLength: 2, maximumLength: 2) { hdr, _, _, err in
            guard err == nil, let hdr, hdr.count == 2 else { done(nil); return }
            let n = (Int(hdr[0]) << 8) | Int(hdr[1])
            guard n > 0 && n <= 8192 else { done(nil); return }   // defensive cap
            conn.receive(minimumIncompleteLength: n, maximumLength: n) { body, _, _, err2 in
                guard err2 == nil, let body, body.count == n else { done(nil); return }
                done([UInt8](body))
            }
        }
    }

    /// Send the final result frame: a tiny JSON {ok,msg}. Surfaces the sshd-disabled message and
    /// the explicit partial-failure error. Carries NO PIN.
    private func sendResult(_ conn: NWConnection, ok: Bool, msg: String) {
        let obj: [String: Any] = ["ok": ok, "msg": msg]
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"ok\":false}".utf8)
        // Tear the connection down ONLY after the final frame's bytes are processed (success OR
        // error). This is the sole owner of per-connection teardown for every final-frame path, so
        // closing never races the send: the client always reads the result before the drop.
        send(conn, [UInt8](data)) { [weak self] _ in
            self?.q.async { self?.finishConnection(conn) }
        }
        if !msg.isEmpty {
            q.async { [weak self] in self?.lastMessage = msg; self?._writeDisplay() }
        }
    }

    /// Best-effort source IP of a connection for the per-IP throttle.
    static func peerIP(_ conn: NWConnection) -> String {
        if case let .hostPort(host, _) = conn.endpoint {
            switch host {
            case .ipv4(let a): return "\(a)"
            case .ipv6(let a): return "\(a)"
            case .name(let n, _): return n
            @unknown default: return "?"
            }
        }
        return "?"
    }
}
