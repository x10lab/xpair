// CrashReporter.swift — local-only crash dumps for RemotePairHost (logging contract §10).
//
// No remote telemetry is sent. On a crash we persist a dump under $LOG_DIR so it is
// recoverable via `remote-pair logs --collect` (which tars all of $LOG_DIR) and shows up
// in `remote-pair logs` (matched by the *.log glob). Two paths:
//
//   • NSException (Obj-C/AppKit interop) → NSSetUncaughtExceptionHandler. Not a signal
//     context, so Foundation + logRedact() are safe here. → crash-host-<epoch>.log
//   • Fatal signals (SIGSEGV/SIGABRT/SIGILL/SIGBUS/SIGFPE/SIGTRAP) → an async-signal-safe
//     handler that writes a backtrace straight to an fd via backtrace_symbols_fd(3).
//     ONLY async-signal-safe calls inside it (open/write/close/backtrace*, no alloc, no
//     Foundation, no String bridging). → crash-host-signal.log (fixed name)
//
// Install once, as early as possible (main.swift, after ensureDirs()). Dump files live in the
// 0700 $LOG_DIR and are created mode 0600 — same residual-leak posture as the rest of the
// contract (§6: redaction is best-effort; the signal path can't redact a raw backtrace).

import Cocoa
import Darwin

// MARK: - Signal path (async-signal-safe only)

private let kCrashMaxFrames: Int32 = 128
// Pre-allocated at install time — allocating inside a signal handler is not async-signal-safe.
private let crashFrames = UnsafeMutablePointer<UnsafeMutableRawPointer?>.allocate(capacity: Int(kCrashMaxFrames))
// fd to the signal-path dump file, opened ONCE at install time (open(2) is unavailable in Swift,
// and opening in a handler is best avoided anyway). -1 if install couldn't open it.
private var crashSignalFD: Int32 = -1
// Scratch buffer for the async-signal-safe integer writer (no per-call allocation).
private var crashIntBuf = [CChar](repeating: 0, count: 16)

/// Write a compile-time constant string to `fd`. `StaticString` lives in static storage,
/// so `withUTF8Buffer` does not allocate → safe in a signal handler.
private func crashWrite(_ fd: Int32, _ s: StaticString) {
    s.withUTF8Buffer { buf in _ = write(fd, buf.baseAddress, buf.count) }
}

/// Write a non-negative Int32 to `fd` in decimal, async-signal-safe (fills a pre-allocated
/// global buffer back-to-front; `withUnsafeBufferPointer` does not allocate).
private func crashWriteInt(_ fd: Int32, _ value: Int32) {
    if value <= 0 { crashWrite(fd, "0"); return }
    var v = value
    var i = crashIntBuf.count
    while v > 0 && i > 0 {
        i -= 1
        crashIntBuf[i] = CChar(48 + Int(v % 10))
        v /= 10
    }
    let start = i
    crashIntBuf.withUnsafeBufferPointer { ptr in
        _ = write(fd, ptr.baseAddress! + start, crashIntBuf.count - start)
    }
}

/// Fatal-signal handler. C calling convention (no captures) so it can be passed to signal(2);
/// it touches only globals and async-signal-safe libc. Appends a backtrace, restores the
/// default disposition, and re-raises so the OS still records its own crash report + exit code.
private let crashSignalHandler: @convention(c) (Int32) -> Void = { sig in
    let fd = crashSignalFD
    if fd >= 0 {
        crashWrite(fd, "\n=== RemotePairHost CRASH (signal ")
        crashWriteInt(fd, sig)
        crashWrite(fd, ") ===\n")
        let n = backtrace(crashFrames, kCrashMaxFrames)
        backtrace_symbols_fd(crashFrames, n, fd)
        crashWrite(fd, "\n")
        _ = fsync(fd)
    }
    signal(sig, SIG_DFL)
    raise(sig)
}

// MARK: - Install

/// Install the local crash handlers. Call once at startup after ensureDirs().
func installCrashReporter() {
    // Pre-open the signal-path dump fd (append). fopen is available where open(2) is not;
    // we keep the fd for the process lifetime and write(2) to it directly from the handler.
    let signalPath = "\(LOG_DIR)/crash-host-signal.log"
    if let fp = signalPath.withCString({ fopen($0, "a") }) {
        crashSignalFD = fileno(fp)
        _ = fchmod(crashSignalFD, 0o600)
    }

    for sig in [SIGSEGV, SIGABRT, SIGILL, SIGBUS, SIGFPE, SIGTRAP] {
        signal(sig, crashSignalHandler)
    }

    // NSException path: a real Obj-C exception is not a signal, so Foundation + redaction are fine.
    NSSetUncaughtExceptionHandler { exc in
        // Sentry capture BEFORE the local write (spec). Frames/reason go through the STRICT outboundScrub()
        // (not logRedact) so IPs / *.ts.net / non-$HOME absolute paths can't leak the moment the SDK is
        // linked; no-op unless RPCrashReportConsent is ON + DSN present + SDK linked (else local dump only,
        // zero network). The local dump below is always written regardless.
        SentryBridge.reporter.captureException(
            name: exc.name.rawValue,
            reason: exc.reason.map(outboundScrub),
            frames: exc.callStackSymbols.map(outboundScrub))

        let ts = logTSFormatter.string(from: Date())
        var s = "=== RemotePairHost CRASH (NSException) \(ts) ===\n"
        s += "name: \(exc.name.rawValue)\n"
        if let reason = exc.reason { s += "reason: \(reason)\n" }
        s += "\n" + exc.callStackSymbols.joined(separator: "\n") + "\n"
        s = logRedact(s)

        let path = "\(LOG_DIR)/crash-host-\(Int(Date().timeIntervalSince1970)).log"
        if (try? s.write(toFile: path, atomically: true, encoding: .utf8)) != nil {
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        }
        log(.error, "CRASH: uncaught \(exc.name.rawValue) — dump at \(path)")
    }
}
