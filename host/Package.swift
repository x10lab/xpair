// swift-tools-version:5.9
// Package.swift — SwiftPM manifest for RemotePairHost so the host can LINK sentry-cocoa.
//
// WHY THIS EXISTS: the host was historically a flat `xcrun swiftc -O host/app/*.swift` compile with zero
// package deps (build-host.sh). Wiring the Sentry crash-reporting backend (SentryBridge.swift) needs a real
// linked dependency, so the compile step is now `swift build -c release` driven by THIS manifest. The rest of
// build-host.sh (bundle layout, inside-out local codesign) is unchanged — it copies the built product into
// the .app and signs it exactly as before.
//
// PAKE staticlib: the host links the Rust SPAKE2 C-ABI staticlib (host/rd/pake/target/release/libpake.a) via
// the bridging header host/app/pake-bridge.h — mirrors the old flat compile's
// `-import-objc-header pake-bridge.h -L <dir> -lpake`. build-host.sh still builds libpake.a first, so it is
// present before `swift build` runs.
//
// Sentry is the ONLY SwiftPM dependency. It is referenced behind `#if canImport(Sentry)` in
// SentryBridge.swift, so the source still compiles if the dependency is ever removed.

import PackageDescription

// Resolve the PAKE staticlib dir at manifest-eval time so the linker flags are absolute (swift build runs
// from this package dir; the staticlib lives under host/rd/pake/target/release relative to it).
let pakeLibDir = "rd/pake/target/release"
let pakeHeader = "app/pake-bridge.h"

let package = Package(
    name: "RemotePairHost",
    platforms: [
        // Matches the flat compile's `-target arm64-apple-macos13.0` fallback + Info.plist LSMinimumSystemVersion 13.0.
        .macOS(.v13)
    ],
    dependencies: [
        // Pinned to a recent stable sentry-cocoa (8.58.3). `swift build` fetches this from GitHub (network).
        .package(url: "https://github.com/getsentry/sentry-cocoa", exact: "8.58.3")
    ],
    targets: [
        .executableTarget(
            name: "RemotePairHost",
            dependencies: [
                .product(name: "Sentry", package: "sentry-cocoa")
            ],
            // The sources stayed in host/app (unchanged tree); point the target at that dir.
            path: "app",
            swiftSettings: [
                // Mirror the flat compile: import the PAKE C-ABI bridging header so PairingServer.swift sees
                // the pake_* symbols (pake-bridge.h).
                .unsafeFlags(["-import-objc-header", pakeHeader])
            ],
            linkerSettings: [
                // Mirror the flat compile's `-L <dir> -lpake`: link the Rust SPAKE2 staticlib.
                .unsafeFlags(["-L", pakeLibDir, "-lpake"])
            ]
        )
    ]
)
