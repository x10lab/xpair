//! `xpair` CLI entry point (P0 dispatch skeleton).
//!
//! Subcommands are ported incrementally (P1+) behind this stable surface; until a command is
//! ported it returns exit 2 with a clear "not yet implemented" message. The canonical command
//! set mirrors the bash dispatch at `client/cli/xpair:1869-1893`.

use std::process::ExitCode;
use xpair::config;
use xpair::mapping::{map_to_host, parse_maps};
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
        "map" => cmd_map(&args[1..]),
        "config" => run_config(&args[1..]),
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

fn cmd_map(args: &[String]) -> ExitCode {
    let raw_maps = std::env::var("FOLDER_MAPS").unwrap_or_default();
    let pairs = parse_maps(&raw_maps);

    match args {
        [flag] if flag == "--list" => {
            if pairs.is_empty() {
                println!("(none)");
            } else {
                for (client, host) in pairs {
                    println!("{client}::{host}");
                }
            }
            ExitCode::SUCCESS
        }
        [client_path] => match map_to_host(client_path, &pairs) {
            Ok(host_path) => {
                println!("{host_path}");
                ExitCode::SUCCESS
            }
            Err(err) => {
                eprintln!("{err}");
                ExitCode::from(2)
            }
        },
        _ => {
            eprintln!("usage: xpair map <client_path>");
            eprintln!("       xpair map --list");
            ExitCode::from(2)
        }
    }
}

fn run_config(args: &[String]) -> ExitCode {
    let path = match config::default_client_env_path() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("xpair config: {err}");
            return ExitCode::from(2);
        }
    };

    match args.first().map(String::as_str).unwrap_or("list") {
        "list" | "" => match config::list_cli(&path) {
            Ok(rows) => {
                println!("Xpair client config");
                for (key, value) in rows {
                    println!("{key:<12} {value}");
                }
                ExitCode::SUCCESS
            }
            Err(err) => {
                eprintln!("xpair config: {err}");
                ExitCode::from(1)
            }
        },
        "get" => {
            if args.len() != 2 {
                eprintln!("config get <host|mode|local_mode|terminal|engine>");
                return ExitCode::from(2);
            }
            match config::get_cli(&path, &args[1]) {
                Ok(value) => {
                    println!("{value}");
                    ExitCode::SUCCESS
                }
                Err(err) if err.kind() == std::io::ErrorKind::InvalidInput => {
                    eprintln!("{err}");
                    ExitCode::from(2)
                }
                Err(err) => {
                    eprintln!("xpair config: {err}");
                    ExitCode::from(1)
                }
            }
        }
        "set" => {
            if args.len() != 3 {
                eprintln!("config set <host|mode|local_mode|terminal|engine> <value>");
                return ExitCode::from(2);
            }
            match config::set_cli(&path, &args[1], &args[2]) {
                Ok(message) => {
                    println!("{message}");
                    ExitCode::SUCCESS
                }
                Err(err) if err.kind() == std::io::ErrorKind::InvalidInput => {
                    eprintln!("{err}");
                    ExitCode::from(2)
                }
                Err(err) => {
                    eprintln!("xpair config: {err}");
                    ExitCode::from(1)
                }
            }
        }
        "maps" => {
            eprintln!("xpair: 'config maps' is not yet ported to the native client (Rust port in progress)");
            ExitCode::from(2)
        }
        _ => {
            eprintln!("config [list|get <key>|set <key> <value>|maps]");
            ExitCode::from(2)
        }
    }
}
