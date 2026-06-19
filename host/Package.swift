// swift-tools-version:5.9
// Package.swift — SwiftPM manifest for XpairHost so the host can LINK sentry-cocoa.
//
// WHY THIS EXISTS: the host was historically a flat `xcrun swiftc -O host/app/*.swift` compile with zero
// package deps (build-host.sh). Wiring the Sentry crash-reporting backend (SentryBridge.swift) needs a real
// linked dependency, so the compile step is now `swift build -c release` driven by THIS manifest. The rest of
// build-host.sh (bundle layout, inside-out local codesign) is unchanged — it copies the built product into
// the .app and signs it exactly as before.
//
// Sentry is the ONLY SwiftPM dependency. It is referenced behind `#if canImport(Sentry)` in
// SentryBridge.swift, so the source still compiles if the dependency is ever removed.

import PackageDescription

let package = Package(
    name: "XpairHost",
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
            name: "XpairHost",
            dependencies: [
                .product(name: "Sentry", package: "sentry-cocoa")
            ],
            // The sources stayed in host/app (unchanged tree); point the target at that dir.
            path: "app"
        )
    ]
)
