//! xpair client CLI — cross-platform Rust core.
//!
//! This crate is the single-source Rust port of the bash client CLI
//! (`client/cli/xpair`, `client/cli/xpair-launch`). It targets macOS, Linux, and
//! **native Windows** (no WSL/Cygwin/MSYS/Git Bash). See
//! `.omc/plans/windows-native-client-support.md` for the phased plan.
//!
//! P0 establishes the crate skeleton + the locked architectural seams:
//! - [`platform`]: OS detection and per-OS capability flags (encodes decision **C1**:
//!   SSH connection multiplexing is unsupported on Win32-OpenSSH).
//! - [`remote_quote`]: POSIX shell quoting for commands sent to the (always-POSIX) host
//!   over SSH (decision **U1** — kept distinct from local Windows argv spawning).
//! - [`transport`]: the mockable transport trait seam (mirrors the bash `tests/lib.sh`
//!   MOCKLOG argv-capture philosophy) so logic is testable without a real host.

pub mod attach;
pub mod config;
pub mod doctor;
pub mod logs;
pub mod mapping;
pub mod mode;
pub mod platform;
pub mod remote_quote;
pub mod session;
pub mod status;
pub mod transport;
