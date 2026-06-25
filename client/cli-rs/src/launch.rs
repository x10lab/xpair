//! Launch a folder into a tmux-aqua session.
//!
//! Ports the decision layer of `cmd_launch()` from `client/cli/xpair:747-824`
//! plus the portable remote session construction from `client/cli/xpair-launch`.
//! The host-probe onboarding branch (`client/cli/xpair:782-815`) and local
//! macOS launch runtime are intentionally deferred.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

pub use crate::attach::Target;
use crate::config;
use crate::mapping::{map_to_host, parse_maps};
use crate::platform::Os;
use crate::remote_quote;
use crate::session::{self, SshTransport};
use crate::transport::Transport;

const ENGINE_USAGE: &str = "claude|claudecode|shell|codex|opencode";
const LOCAL_LAUNCH_DEFERRED: &str =
    "// deferred (P2): local launch runtime (macOS host) not yet ported";
const REMOTE_BIN: &str = "$HOME/.local/bin";
const TMUX_AQUA: &str = "tmux-aqua";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchReq {
    pub target_pref: Option<Target>,
    pub fresh: bool,
    pub yes: bool,
    pub engine: Option<String>,
    pub dir: String,
}

/// Parse `xpair launch` args with the bash exit-code contract.
pub fn parse_launch_args(args: &[String]) -> Result<LaunchReq, (String, u8)> {
    let mut target_pref = None;
    let mut fresh = false;
    let mut yes = false;
    let mut engine = None;
    let mut dir = None;
    let mut i = 0;

    while i < args.len() {
        match args[i].as_str() {
            "--local" => {
                target_pref = Some(Target::Local);
                i += 1;
            }
            "--remote" => {
                target_pref = Some(Target::Remote);
                i += 1;
            }
            "--fresh" => {
                fresh = true;
                i += 1;
            }
            "--yes" | "-y" => {
                yes = true;
                i += 1;
            }
            "--engine" => {
                let raw = args.get(i + 1).map(String::as_str).unwrap_or("");
                let Some(canon) = canonical_engine(raw) else {
                    return Err((format!("unknown engine: {raw} (use {ENGINE_USAGE})"), 2));
                };
                engine = Some(canon);
                i += 2;
            }
            _ => {
                dir = Some(args[i].clone());
                i += 1;
            }
        }
    }

    Ok(LaunchReq {
        target_pref,
        fresh,
        yes,
        engine,
        dir: dir.unwrap_or_else(|| ".".to_string()),
    })
}

/// Canonicalize the launch engine aliases from `client/cli/xpair:113-119`.
pub fn canonical_engine(engine: &str) -> Option<String> {
    match engine {
        "claude" | "claudecode" | "claude-code" => Some("claude".to_string()),
        "shell" => Some("shell".to_string()),
        "codex" => Some("codex".to_string()),
        "opencode" => Some("opencode".to_string()),
        _ => None,
    }
}

/// Resolve the launch target using the same precedence as `attach` and `ls`.
pub fn resolve_target(pref: Option<Target>, local_mode: bool, host: &str) -> Target {
    crate::attach::resolve_target(pref, local_mode, host)
}

/// Derive the deterministic project session base from a mapped host dir.
///
/// Mirrors `_proj_base()` and the final `.`/`:` normalization from
/// `client/cli/xpair-launch:237-247`, with the remote host prefix added by
/// [`remote_session_name_for`] just like `REMOTE_PROJ` at
/// `client/cli/xpair-launch:580-585`.
pub fn session_name_for(host_dir: &str) -> String {
    normalize_session_name(&proj_base(host_dir))
}

/// Derive the default remote tmux session name for the mapped host dir.
///
/// The bash launcher computes `REMOTE_PROJ="${REMOTE_HOST}_$(_proj_base "$HOST_DIR")"`
/// and then appends `_N` during remote setup. This Rust slice does not yet port the live
/// client/zombie tab numbering probe, so the default deterministic handoff is `_1`.
pub fn remote_session_name_for(host: &str, host_dir: &str) -> String {
    format!(
        "{}_1",
        normalize_session_name(&format!("{host}_{}", proj_base(host_dir)))
    )
}

/// Build the remote create-or-reuse command for a detached tmux-aqua session.
pub fn build_ensure_session_remote_cmd(
    aqua_sock: &str,
    session: &str,
    host_dir: &str,
    fresh: bool,
) -> String {
    let has = remote_has_session_cmd(aqua_sock, session);
    let new = remote_new_session_cmd(aqua_sock, session, host_dir);
    if fresh {
        format!("{has} && exit 10; {new}")
    } else {
        format!("{has} || {new}")
    }
}

/// Build the local argv for the remote SSH attach handoff.
pub fn build_remote_launch_attach_argv(
    os: Os,
    host: &str,
    aqua_sock: &str,
    session: &str,
) -> Vec<String> {
    crate::attach::build_remote_attach_argv(os, host, session, aqua_sock)
}

/// Ensure the remote session exists, preserving exact SSH payloads for MockTransport tests.
pub fn ensure_remote_session(
    transport: &dyn Transport,
    host: &str,
    aqua_sock: &str,
    session: &str,
    host_dir: &str,
    fresh: bool,
) -> Result<(), String> {
    let remote_cmd = build_ensure_session_remote_cmd(aqua_sock, session, host_dir, fresh);
    let out = transport
        .ssh_exec(host, &remote_cmd)
        .map_err(|err| format!("remote launch setup failed: {err}"))?;

    if out.code == 0 {
        Ok(())
    } else {
        Err(format!("remote launch setup failed (exit={})", out.code))
    }
}

/// Impure CLI entrypoint: resolve config, map the folder, ensure remote tmux, then attach.
pub fn run(args: &[String]) -> ExitCode {
    let req = match parse_launch_args(args) {
        Ok(req) => req,
        Err((msg, code)) => {
            eprintln!("{msg}");
            return ExitCode::from(code);
        }
    };

    let path = match config::default_client_env_path() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("xpair launch: {err}");
            return ExitCode::from(2);
        }
    };
    let host = match resolve_host(&path) {
        Ok(host) => host,
        Err(err) => {
            eprintln!("xpair launch: {err}");
            return ExitCode::from(1);
        }
    };
    let local_mode = match resolve_local_mode(&path) {
        Ok(local_mode) => local_mode,
        Err(err) => {
            eprintln!("xpair launch: {err}");
            return ExitCode::from(1);
        }
    };

    match resolve_target(req.target_pref, local_mode, &host) {
        Target::Local => {
            eprintln!("{LOCAL_LAUNCH_DEFERRED}");
            ExitCode::from(2)
        }
        Target::Remote => run_remote(&path, &host, local_mode, &req),
    }
}

fn run_remote(path: &Path, host: &str, local_mode: bool, req: &LaunchReq) -> ExitCode {
    if host.is_empty() {
        eprintln!("no REMOTE_HOST configured -- use --local or 'xpair config set host <ssh-host>'");
        return ExitCode::from(1);
    }

    let dir = match absolutize_existing_dir(&req.dir) {
        Ok(dir) => dir,
        Err(_) => {
            eprintln!("folder not found");
            return ExitCode::from(1);
        }
    };
    let raw_maps = match resolve_raw_maps(path) {
        Ok(raw_maps) => raw_maps,
        Err(err) => {
            eprintln!("xpair launch: {err}");
            return ExitCode::from(1);
        }
    };
    let pairs = parse_maps(&raw_maps);
    let client_dir = dir.to_string_lossy().into_owned();
    let host_dir = match map_to_host(&client_dir, &pairs) {
        Ok(host_dir) => host_dir,
        Err(err) => {
            eprintln!("{err}");
            return ExitCode::from(2);
        }
    };
    // Deferred: the interactive unmapped-dir host probe from `client/cli/xpair:782-815`.
    // The Rust path maps deterministically and lets the remote tmux setup surface failures.

    let aqua_sock = resolve_aqua_sock();
    let session = remote_session_name_for(host, &host_dir);
    let transport = SshTransport;
    if let Err(err) =
        ensure_remote_session(&transport, host, &aqua_sock, &session, &host_dir, req.fresh)
    {
        eprintln!("xpair launch: {err}");
        return ExitCode::from(1);
    }
    if local_mode {
        let _ = config::set(path, "LOCAL_MODE", "0");
    }

    emit_terminal_title(&session);
    spawn_and_wait(&build_remote_launch_attach_argv(
        Os::current(),
        host,
        &aqua_sock,
        &session,
    ))
}

fn remote_has_session_cmd(aqua_sock: &str, session: &str) -> String {
    let sock = remote_quote::posix_single_quote(aqua_sock);
    let target = remote_quote::posix_single_quote(&format!("={session}"));
    format!("{REMOTE_BIN}/{TMUX_AQUA} -S {sock} has-session -t {target} 2>/dev/null")
}

fn remote_new_session_cmd(aqua_sock: &str, session: &str, host_dir: &str) -> String {
    let sock = remote_quote::posix_single_quote(aqua_sock);
    let session = remote_quote::posix_single_quote(session);
    let host_dir = remote_quote::posix_single_quote(host_dir);
    format!("{REMOTE_BIN}/{TMUX_AQUA} -S {sock} new-session -d -s {session} -c {host_dir}")
}

fn proj_base(host_dir: &str) -> String {
    let basename = posix_basename(host_dir);
    let mut name = sanitize_readable_name(&basename);
    if name.is_empty() {
        name = "session".to_string();
    }
    format!("{}_{}", name, sha256_hex_prefix(host_dir, 5))
}

fn posix_basename(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    trimmed.rsplit('/').next().unwrap_or(trimmed).to_string()
}

fn sanitize_readable_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;

    for ch in name.chars().flat_map(char::to_lowercase) {
        let keep = ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '_' | '.' | '-');
        if keep {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }

    let trimmed = out.trim_matches('-');
    trimmed.chars().take(15).collect()
}

fn normalize_session_name(session: &str) -> String {
    session
        .chars()
        .map(|ch| if matches!(ch, '.' | ':') { '_' } else { ch })
        .collect()
}

fn sha256_hex_prefix(input: &str, chars: usize) -> String {
    let digest = sha256(input.as_bytes());
    let mut out = String::with_capacity(chars);
    for byte in digest {
        if out.len() >= chars {
            break;
        }
        out.push(hex_digit(byte >> 4));
        if out.len() >= chars {
            break;
        }
        out.push(hex_digit(byte & 0x0f));
    }
    out
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const H0: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let bit_len = (input.len() as u64) * 8;
    let mut msg = input.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut h = H0;
    let mut w = [0u32; 64];
    for chunk in msg.chunks_exact(64) {
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (idx, word) in h.into_iter().enumerate() {
        out[idx * 4..idx * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn hex_digit(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        10..=15 => (b'a' + (nibble - 10)) as char,
        _ => unreachable!(),
    }
}

fn absolutize_existing_dir(dir: &str) -> std::io::Result<PathBuf> {
    fs::canonicalize(dir).and_then(|path| {
        if path.is_dir() {
            Ok(path)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "folder not found",
            ))
        }
    })
}

fn resolve_host(path: &Path) -> std::io::Result<String> {
    if let Some(host) = non_empty_env("REMOTE_HOST") {
        return Ok(host);
    }
    config::get_cli(path, "host")
}

fn resolve_local_mode(path: &Path) -> std::io::Result<bool> {
    if let Ok(value) = std::env::var("LOCAL_MODE") {
        return Ok(session::local_mode_on_value(&value));
    }
    Ok(config::get_cli(path, "local_mode")? == "1")
}

fn resolve_raw_maps(path: &Path) -> std::io::Result<String> {
    if let Some(raw_maps) = non_empty_env("FOLDER_MAPS") {
        return Ok(raw_maps);
    }
    if let Some(raw_maps) = non_empty_env("SYNC_ROOTS") {
        return Ok(raw_maps);
    }
    if let Some(raw_maps) = config::get(path, "FOLDER_MAPS")?.filter(|maps| !maps.is_empty()) {
        return Ok(raw_maps);
    }
    Ok(config::get(path, "SYNC_ROOTS")?.unwrap_or_default())
}

fn resolve_aqua_sock() -> String {
    non_empty_env("AQUA_SOCK").unwrap_or_else(|| session::DEFAULT_AQUA_SOCK.to_string())
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

fn emit_terminal_title(session: &str) {
    print!("\x1b]2;{session}\x07");
}

fn spawn_and_wait(argv: &[String]) -> ExitCode {
    let Some((program, args)) = argv.split_first() else {
        return ExitCode::from(1);
    };
    match Command::new(program).args(args).status() {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(err) => {
            eprintln!("{program}: {err}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::MockTransport;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_string()).collect()
    }

    fn parse(args: &[&str]) -> Result<LaunchReq, (String, u8)> {
        parse_launch_args(&strings(args))
    }

    #[test]
    fn parses_all_launch_flags_and_last_positional_dir() {
        assert_eq!(
            parse(&[
                "--local",
                "--remote",
                "--fresh",
                "--yes",
                "-y",
                "--engine",
                "claude-code",
                "/first",
                "/last",
            ])
            .unwrap(),
            LaunchReq {
                target_pref: Some(Target::Remote),
                fresh: true,
                yes: true,
                engine: Some("claude".to_string()),
                dir: "/last".to_string(),
            }
        );
    }

    #[test]
    fn parse_defaults_dir_to_current_marker() {
        assert_eq!(
            parse(&[]).unwrap(),
            LaunchReq {
                target_pref: None,
                fresh: false,
                yes: false,
                engine: None,
                dir: ".".to_string(),
            }
        );
    }

    #[test]
    fn parse_rejects_unknown_engine_with_exit_two() {
        assert_eq!(
            parse(&["--engine", "vim"]),
            Err((
                "unknown engine: vim (use claude|claudecode|shell|codex|opencode)".to_string(),
                2,
            ))
        );
        assert_eq!(
            parse(&["--engine"]),
            Err((
                "unknown engine:  (use claude|claudecode|shell|codex|opencode)".to_string(),
                2,
            ))
        );
    }

    #[test]
    fn canonical_engine_matches_bash_aliases() {
        assert_eq!(canonical_engine("claude").as_deref(), Some("claude"));
        assert_eq!(canonical_engine("claudecode").as_deref(), Some("claude"));
        assert_eq!(canonical_engine("claude-code").as_deref(), Some("claude"));
        assert_eq!(canonical_engine("shell").as_deref(), Some("shell"));
        assert_eq!(canonical_engine("codex").as_deref(), Some("codex"));
        assert_eq!(canonical_engine("opencode").as_deref(), Some("opencode"));
        assert_eq!(canonical_engine("CLAUDE"), None);
    }

    #[test]
    fn resolves_target_precedence_like_attach() {
        assert_eq!(
            resolve_target(Some(Target::Local), false, "mac"),
            Target::Local
        );
        assert_eq!(
            resolve_target(Some(Target::Remote), true, ""),
            Target::Remote
        );
        assert_eq!(resolve_target(None, true, "mac"), Target::Local);
        assert_eq!(resolve_target(None, false, "mac"), Target::Remote);
        assert_eq!(resolve_target(None, false, ""), Target::Local);
    }

    #[test]
    fn derives_session_name_from_host_dir_like_launcher() {
        assert_eq!(session_name_for("/Users/me/project"), "project_8779b");
        assert_eq!(session_name_for("/srv/work/My App"), "my-app_d4b2c");
        assert_eq!(
            session_name_for("/tmp/ReallyLongProjectName"),
            "reallylongproje_bdab5"
        );
        assert_eq!(session_name_for("/Users/me/.claude"), "_claude_0bd83");
        assert_eq!(session_name_for("/"), "session_8a5ed");
    }

    #[test]
    fn derives_default_remote_session_with_host_prefix_and_number() {
        assert_eq!(
            remote_session_name_for("mac.local", "/Users/me/project"),
            "mac_local_project_8779b_1"
        );
    }

    #[test]
    fn builds_reuse_remote_session_command_exactly() {
        assert_eq!(
            build_ensure_session_remote_cmd(
                "/tmp/aqua sock's.sock",
                "mac_project_8779b_1",
                "/Users/me/project",
                false,
            ),
            "$HOME/.local/bin/tmux-aqua -S '/tmp/aqua sock'\\''s.sock' has-session -t '=mac_project_8779b_1' 2>/dev/null || $HOME/.local/bin/tmux-aqua -S '/tmp/aqua sock'\\''s.sock' new-session -d -s 'mac_project_8779b_1' -c '/Users/me/project'"
        );
    }

    #[test]
    fn builds_fresh_remote_session_command_exactly() {
        assert_eq!(
            build_ensure_session_remote_cmd(
                "/tmp/aqua-tmux.sock",
                "mac_project_8779b_1",
                "/Users/me/project",
                true,
            ),
            "$HOME/.local/bin/tmux-aqua -S '/tmp/aqua-tmux.sock' has-session -t '=mac_project_8779b_1' 2>/dev/null && exit 10; $HOME/.local/bin/tmux-aqua -S '/tmp/aqua-tmux.sock' new-session -d -s 'mac_project_8779b_1' -c '/Users/me/project'"
        );
    }

    #[test]
    fn builds_windows_remote_launch_attach_argv_with_mux_neutralizer() {
        assert_eq!(
            build_remote_launch_attach_argv(
                Os::Windows,
                "mac.local",
                "/tmp/aqua sock's.sock",
                "mac_project_8779b_1",
            ),
            vec![
                "ssh",
                "-tt",
                "-o",
                "ControlMaster=no",
                "-o",
                "ControlPath=none",
                "mac.local",
                "$HOME/.local/bin/tmux-aqua -S '/tmp/aqua sock'\\''s.sock' attach -d -t '=mac_project_8779b_1'",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn builds_non_windows_remote_launch_attach_argv_without_mux_neutralizer() {
        assert_eq!(
            build_remote_launch_attach_argv(
                Os::Linux,
                "mac.local",
                "/tmp/aqua-tmux.sock",
                "mac_project_8779b_1",
            ),
            vec![
                "ssh",
                "-tt",
                "mac.local",
                "$HOME/.local/bin/tmux-aqua -S '/tmp/aqua-tmux.sock' attach -d -t '=mac_project_8779b_1'",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn ensure_remote_session_records_exact_command_and_maps_exit_code() {
        let transport = MockTransport::new();
        transport.push_response(0, "");
        transport.push_response(12, "nope");

        assert_eq!(
            ensure_remote_session(
                &transport,
                "mac.local",
                "/tmp/aqua-tmux.sock",
                "mac_project_8779b_1",
                "/Users/me/project",
                false,
            ),
            Ok(())
        );
        assert_eq!(
            ensure_remote_session(
                &transport,
                "mac.local",
                "/tmp/aqua-tmux.sock",
                "mac_project_8779b_1",
                "/Users/me/project",
                false,
            ),
            Err("remote launch setup failed (exit=12)".to_string())
        );

        let calls = transport.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].host, "mac.local");
        assert_eq!(
            calls[0].remote_cmd,
            "$HOME/.local/bin/tmux-aqua -S '/tmp/aqua-tmux.sock' has-session -t '=mac_project_8779b_1' 2>/dev/null || $HOME/.local/bin/tmux-aqua -S '/tmp/aqua-tmux.sock' new-session -d -s 'mac_project_8779b_1' -c '/Users/me/project'"
        );
        assert_eq!(calls[1], calls[0]);
    }
}
