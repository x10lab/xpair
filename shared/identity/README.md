# shared/identity — Single Source of Truth (SoT) for Brand and Version

Declares the **brand identifiers and versions in one place** for the Xpair monorepo
(`xpair` core · `client/ide/` VSCodium fork · `host/rd/` native engine).
Because consumers are heterogeneous (Ruby · JSON · Swift · Cargo), instead of injecting values
directly, singularity is enforced through **declaration + consistency checks**.

## Files
| File | Role |
|------|------|
| `identity.json` | Product name · org · urlProtocol · signing CN + per-component identifiers (bundleId, applicationName, etc.) |
| `versions.json` | Per-component version registry (host/ide/screen-engine — **independent versions**, not forced to be identical) |
| `check-identity.sh` | Verifies that consumers match the SoT; exits non-zero on drift |

## Consumer Mapping
| Consumer | Verified Items |
|--------|-----------|
| `client/ide/product.json` | nameShort/Long · applicationName · dataFolderName · darwinBundleIdentifier · urlProtocol · server* · win32* |
| `client/ide/remotepair-ext/package.json` | `version` == `versions.ide` (product.json has no version — the app version is injected as RELEASE_VERSION at build time) |
| `Casks/xpair-host.rb` | `version` == `versions.host` |
| `host/rd/screen/Cargo.toml` | `version` == `versions.screen-engine` |
| `host/app/Config.swift` | `components.host.bundleId` is present in the `BUNDLE_ID` default value |

## Usage
```bash
shared/identity/check-identity.sh      # consistency check (before CI/release)
```

When changing a value, **fix it here first (identity.json/versions.json)**, then align the consumers and make the check pass.

## Version Policy
Components mature at different rates, so their versions are bumped independently (host 0.4.x = mature, client/ide/rs 0.1.0 = early).
`versions.json` is merely the point where you "read the current version from one place"; it does not force versions to be identical.

## Future
Following the build-time codegen direction in `docs/ide-merge-architecture.md`, the prepare step can be extended
to **generate/inject** consumer values from this SoT (especially during `client/ide/` self-containment — a separate story).
