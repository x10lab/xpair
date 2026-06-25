//! `xpair` CLI entry point (P0 dispatch skeleton).
//!
//! Subcommands are ported incrementally (P1+) behind this stable surface; until a command is
//! ported it returns exit 2 with a clear "not yet implemented" message. The canonical command
//! set mirrors the bash dispatch at `client/cli/xpair:1869-1893`.

use std::process::ExitCode;
use xpair::platform::Os;

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Canonical subcommands (parity target with the bash CLI). `roots` is a legacy alias of `ls`.
const SUBCOMMANDS: &[&str] = &[
    "launch", "attach", "ls", "map", "config", "mode", "onboard", "open-gui", "discover",
    "install-host", "host-permissions", "doctor", "approve", "status", "editor", "desktop",
    "mount", "notify", "logs", "self-update", "update", "host",
];

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");

    match cmd {
        "--version" | "-V" | "version" => {
            println!("xpair {VERSION}");
            ExitCode::SUCCESS
        }
        "--help" | "-h" | "help" => {
            print_help();
            ExitCode::SUCCESS
        }
        // Minimal real P0 command: report environment + the locked per-OS transport posture.
        "doctor" => {
            let os = Os::current();
            println!("xpair {VERSION}");
            println!("os: {os}");
            println!("ssh multiplexing: {}", os.supports_multiplexing());
            if !os.supports_multiplexing() {
                println!(
                    "  (windows: independent ssh.exe per connection; {})",
                    os.ssh_mux_neutralizer_args().join(" ")
                );
            }
            ExitCode::SUCCESS
        }
        "roots" => {
            eprintln!("xpair: 'roots' is a legacy alias of 'ls' (not yet ported)");
            ExitCode::from(2)
        }
        other if SUBCOMMANDS.contains(&other) => {
            eprintln!("xpair: '{other}' is not yet ported to the native client (Rust port in progress)");
            ExitCode::from(2)
        }
        other => {
            eprintln!("xpair: unknown command '{other}'");
            eprintln!("try `xpair help`");
            ExitCode::from(2)
        }
    }
}

fn print_help() {
    println!("xpair {VERSION} — cross-platform client CLI");
    println!();
    println!("usage: xpair <command> [args]");
    println!();
    println!("commands:");
    for c in SUBCOMMANDS {
        println!("  {c}");
    }
    println!();
    println!("(native Rust client — port in progress; `doctor` works today)");
}
