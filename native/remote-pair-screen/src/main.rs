//! remote-pair-screen — license-clean screen-capture sidecar for RemotePair
//! Remote Desktop (the v1 high-performance path).
//!
//! STATUS: HONEST SCAFFOLD. The `capture`/`info` paths are real and prove the
//! screen-capture foundation works license-clean (no RustDesk/AGPL anywhere in
//! the dependency tree — see `deny.toml`). The `serve` path is a deliberate stub:
//! the WebRTC transport (webrtc-rs, MIT/Apache-2.0) is the remaining multi-week
//! work and is intentionally NOT implemented here. See README.md.
//!
//! Capture backend: `xcap` (Apache-2.0). `scap` (MIT) was tried first per the
//! original plan but its ScreenCaptureKit backend invokes `xcodebuild` in its
//! build script, which fails on this toolchain.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use xcap::Monitor;

/// License-clean screen-capture sidecar for RemotePair Remote Desktop (v1).
#[derive(Parser, Debug)]
#[command(name = "remote-pair-screen", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Capture ONE frame of the primary display, encode to PNG, write to <out>.
    ///
    /// Proves the capture path works license-clean end to end. This is a
    /// single-shot capture, not the streaming path (that is `serve`, TODO).
    Capture {
        /// Output PNG path.
        #[arg(long, value_name = "PATH")]
        out: PathBuf,
    },
    /// Print the dimensions and metadata of every connected display.
    Info,
    /// (STUB) Start the v1 WebRTC screen-share transport. Not implemented yet.
    ///
    /// Prints a TODO pointer and exits 0. The streaming/encode/transport path
    /// (capture -> VideoToolbox HW encode -> webrtc-rs) is the remaining
    /// multi-week milestone; see README.md.
    Serve,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Capture { out } => cmd_capture(&out),
        Command::Info => cmd_info(),
        Command::Serve => cmd_serve(),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Pick the primary display, falling back to the first available one.
fn primary_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| format!("could not enumerate displays: {e}"))?;
    if monitors.is_empty() {
        return Err("no displays found (is Screen Recording permission granted?)".to_string());
    }

    // Prefer the monitor that reports itself as primary; otherwise take the first.
    for m in &monitors {
        if m.is_primary().unwrap_or(false) {
            return Ok(m.clone());
        }
    }
    Ok(monitors.into_iter().next().expect("checked non-empty"))
}

/// `capture --out <path>`: grab one frame of the primary display and write a PNG.
fn cmd_capture(out: &PathBuf) -> Result<(), String> {
    let monitor = primary_monitor()?;

    let frame = monitor
        .capture_image()
        .map_err(|e| format!("capture failed (check Screen Recording permission): {e}"))?;

    let (width, height) = (frame.width(), frame.height());

    // `image` is re-exported by xcap, so the RgbaImage we got back encodes
    // directly with the same crate version we depend on.
    frame
        .save(out)
        .map_err(|e| format!("failed to write PNG to {}: {e}", out.display()))?;

    println!(
        "captured {}x{} frame -> {}",
        width,
        height,
        out.display()
    );
    Ok(())
}

/// `info`: enumerate displays and print dimensions + metadata.
fn cmd_info() -> Result<(), String> {
    let monitors = Monitor::all().map_err(|e| format!("could not enumerate displays: {e}"))?;
    if monitors.is_empty() {
        return Err("no displays found (is Screen Recording permission granted?)".to_string());
    }

    println!("{} display(s):", monitors.len());
    for (i, m) in monitors.iter().enumerate() {
        let name = m.name().unwrap_or_else(|_| "<unknown>".to_string());
        let width = m.width().unwrap_or(0);
        let height = m.height().unwrap_or(0);
        let scale = m.scale_factor().unwrap_or(1.0);
        let primary = m.is_primary().unwrap_or(false);
        println!(
            "  [{i}] {name}: {width}x{height} @ {scale}x{}",
            if primary { " (primary)" } else { "" }
        );
    }
    Ok(())
}

/// `serve`: deliberate stub for the v1 WebRTC transport.
fn cmd_serve() -> Result<(), String> {
    println!("v1 webrtc transport: TODO (see README)");
    Ok(())
}
