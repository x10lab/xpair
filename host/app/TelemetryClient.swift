// TelemetryClient.swift — opt-in, privacy-safe PostHog capture for XpairHost.
//
// Phase 1 (telemetry-funnel spec): the host fires NO funnel events itself — the 7 activation events are
// client-side. This file exists so the host CAN emit later, and to host the FROZEN event/reason catalog
// shared across all lanes. The host wires Sentry crash capture (SentryBridge); funnel capture stays dormant.
//
// Hard privacy constraints (OSS audit): NEVER transmit repo names, file paths, command contents, or IP
// addresses. Every string value runs through logRedact() (Config.swift §6) before send. `reason` is a
// controlled enum, never raw stderr. distinct_id = anonymous install_id (UUID v4, disk-persisted).
//
// Transport: raw HTTPS POST to a config-provided endpoint (Cloud EU default https://eu.i.posthog.com,
// path /capture/). Project key from Info.plist RPPostHogKey. If key/endpoint absent OR consent OFF =>
// silent no-op (zero network calls — the default state, since RPTelemetryConsent defaults false).

import Foundation

enum TelemetryClient {

    // MARK: - UserDefaults / config keys (FROZEN — must match across lanes)

    /// Gates PostHog. Default false (opt-in). Registered in AppDelegate via UserDefaults.register(defaults:).
    static let consentKey = "RPTelemetryConsent"
    /// Anonymous install_id (UUID v4), generated once on first run, disk-persisted. = distinct_id.
    static let anonIdKey = "RPTelemetryAnonId"
    /// Info.plist project key. Absent => no-op (key not yet provisioned — never hardcoded).
    static let posthogKeyPlist = "RPPostHogKey"
    /// Info.plist endpoint override. Absent => Cloud EU default.
    static let posthogEndpointPlist = "RPPostHogEndpoint"
    static let defaultEndpoint = "https://eu.i.posthog.com"
    static let capturePath = "/capture/"
    /// host.env mirror key for reinstall continuity (so a reinstall keeps the same anonymous id).
    static let anonIdEnvKey = "TELEMETRY_ANON_ID"

    // MARK: - Frozen event catalog (names do not change between phases)

    /// Phase-1 events (the ONLY 7 to fire now). All client-side; the host does not emit them in Phase 1.
    enum Event: String {
        case appFirstLaunch       = "app_first_launch"
        case onboardingStarted    = "onboarding_started"
        case sshConfigCompleted   = "ssh_config_completed"
        case sshConfigFailed      = "ssh_config_failed"
        case hostConnected        = "host_connected"
        case hostConnectFailed    = "host_connect_failed"
        case firstSessionStarted  = "first_session_started"

        // Phase-2 reserved names (DO NOT EMIT in Phase 1 — defined only so nothing gets renamed later).
        case hostDiscoveryStarted    = "host_discovery_started"
        case hostDiscovered          = "host_discovered"
        case hostDiscoveryEmpty      = "host_discovery_empty"
        case tailscaleFallbackStarted = "tailscale_fallback_started"
        case tailscaleAuthCompleted  = "tailscale_auth_completed"
        case tailscaleHostReachable  = "tailscale_host_reachable"
        case hostedCtaShown          = "hosted_cta_shown"
        case hostedWaitlistSubmitted = "hosted_waitlist_submitted"
    }

    /// Controlled `reason` enum — NEVER raw stderr (it leaks hostnames/IPs/paths). Spec-frozen set.
    enum Reason: String {
        case timeout
        case authDenied        = "auth_denied"
        case hostUnreachable   = "host_unreachable"
        case dnsFailed         = "dns_failed"
        case keygenError       = "keygen_error"
        case permissionDenied  = "permission_denied"
        case unknown
    }

    // MARK: - install_id

    /// Anonymous install_id (UUID v4). Generated once on first run, persisted to UserDefaults
    /// (RPTelemetryAnonId) and mirrored to host.env (TELEMETRY_ANON_ID) for reinstall continuity.
    /// This is the PostHog distinct_id. No PII, no account linkage, ever.
    static var installId: String {
        let d = UserDefaults.standard
        if let existing = d.string(forKey: anonIdKey), !existing.isEmpty {
            return existing
        }
        // Prefer an id already mirrored to host.env (survives a UserDefaults reset on reinstall).
        if let mirrored = readMirroredAnonId(), !mirrored.isEmpty {
            d.set(mirrored, forKey: anonIdKey)
            return mirrored
        }
        let fresh = UUID().uuidString
        d.set(fresh, forKey: anonIdKey)
        mirrorAnonId(fresh)
        return fresh
    }

    /// Read TELEMETRY_ANON_ID from host.env (KEY=VALUE), if present.
    private static func readMirroredAnonId() -> String? {
        let hostEnv = "\(RP_DIR)/host.env"
        guard let raw = try? String(contentsOfFile: hostEnv, encoding: .utf8) else { return nil }
        for line in raw.split(separator: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("\(anonIdEnvKey)=") {
                let v = String(t.dropFirst("\(anonIdEnvKey)=".count))
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
                return v.isEmpty ? nil : v
            }
        }
        return nil
    }

    /// Append/replace TELEMETRY_ANON_ID in host.env. Best-effort (a failed mirror is non-fatal —
    /// UserDefaults remains the primary store; the mirror only aids reinstall continuity).
    private static func mirrorAnonId(_ id: String) {
        let hostEnv = "\(RP_DIR)/host.env"
        ensureDirs()
        var lines: [String] = []
        if let raw = try? String(contentsOfFile: hostEnv, encoding: .utf8) {
            lines = raw.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            // Drop any trailing empty element from a final newline so we re-add exactly one.
            if lines.last == "" { lines.removeLast() }
        }
        let prefix = "\(anonIdEnvKey)="
        lines.removeAll { $0.trimmingCharacters(in: .whitespaces).hasPrefix(prefix) }
        lines.append("\(prefix)\(id)")
        let out = lines.joined(separator: "\n") + "\n"
        do {
            try out.write(toFile: hostEnv, atomically: true, encoding: .utf8)
            // host.env mirrors the anon id (and lives beside other secrets) → lock down to 0600,
            // matching the CrashReporter/SentryBridge dump posture (owner-only read/write).
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: hostEnv)
        } catch { log(.debug, "TELEMETRY: host.env anon-id mirror skipped: \(error)") }
    }

    // MARK: - capture

    /// Capture a PostHog event. No-op unless RPTelemetryConsent is ON and a project key is configured.
    /// Super properties (app_version, os_version, device_arch, install_id, telemetry_consent) are attached
    /// automatically. Every String property value is run through logRedact() before send. Fire-and-forget
    /// background POST; failures are silently ignored (telemetry must never affect host behavior).
    ///
    /// NOTE: in Phase 1 the host does not call this for funnel events (those are client-side). Provided so
    /// the host CAN emit later without re-plumbing transport/consent/redaction.
    static func capture(_ event: String, properties: [String: Any] = [:]) {
        // Consent gate (default OFF => zero network calls).
        guard UserDefaults.standard.bool(forKey: consentKey) else { return }
        // Key gate (not yet provisioned => silent no-op; never hardcoded).
        guard let key = Bundle.main.object(forInfoDictionaryKey: posthogKeyPlist) as? String,
              !key.isEmpty else { return }

        let endpoint = (Bundle.main.object(forInfoDictionaryKey: posthogEndpointPlist) as? String)
            .flatMap { $0.isEmpty ? nil : $0 } ?? defaultEndpoint
        guard let url = URL(string: endpoint + capturePath) else { return }

        var props = superProperties()
        for (k, v) in properties { props[k] = redactValue(v) }

        let body: [String: Any] = [
            "api_key": key,
            "event": event,
            "distinct_id": installId,
            "properties": props,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: []) else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        // Ephemeral background session: fire-and-forget, no caching, no persistence.
        let session = URLSession(configuration: .ephemeral)
        session.dataTask(with: req) { _, _, _ in /* fire-and-forget; ignore result */ }.resume()
    }

    // MARK: - super properties + redaction

    /// Super properties attached to every event (FROZEN set). install_id is the anonymous distinct_id;
    /// telemetry_consent reflects the live flag. No PII.
    private static func superProperties() -> [String: Any] {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return [
            "app_version": APP_VERSION,
            "os_version": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            "device_arch": deviceArch(),
            "install_id": installId,
            "telemetry_consent": UserDefaults.standard.bool(forKey: consentKey),
        ]
    }

    /// CPU architecture (e.g. "arm64" / "x86_64") — not PII.
    private static func deviceArch() -> String {
        var sysinfo = utsname()
        uname(&sysinfo)
        let machine = withUnsafePointer(to: &sysinfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
        return machine.isEmpty ? "unknown" : machine
    }

    /// Redact a single property value for OUTBOUND send. Strings (and string arrays) pass through the
    /// strict `outboundScrub()` (Config.swift) — which composes logRedact() ($HOME, REMOTE_HOST) PLUS
    /// IPv4/IPv6 → <ip>, absolute paths → <path>, *.ts.net → <host> — so no IP/path/hostname can leak
    /// even if a future caller passes a free-form string. Numbers/bools pass through unchanged; nested
    /// dicts are redacted recursively. (Phase-1 props are enums/numbers/bools; this is defense in depth.)
    private static func redactValue(_ v: Any) -> Any {
        switch v {
        case let s as String: return outboundScrub(s)
        case let arr as [String]: return arr.map(outboundScrub)
        case let dict as [String: Any]: return dict.mapValues(redactValue)
        default: return v
        }
    }
}
