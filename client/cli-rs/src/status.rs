//! Status report rendering for `xpair status`.
//!
//! Ports the portable core of `cmd_status()` from `client/cli/xpair:910-938`:
//! fixed-width rows, flat `status.json` permission gates, host server reachability through
//! [`crate::transport::Transport`], and the bash `mode_label()` shape from
//! `client/cli/xpair:125-134`.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::remote_quote;
use crate::transport::Transport;

const HOST_TMUX_AQUA: &str = "$HOME/.local/bin/tmux-aqua";

/// Parsed subset of the app-written `status.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusJson {
    pub ax: bool,
    pub sr: bool,
    pub fda: bool,
    pub ts: Option<i64>,
}

/// Parse the app's tiny flat JSON status payload without adding a JSON dependency.
///
/// Mirrors the bash `_jget()`/`_mark()` behavior at `client/cli/xpair:151-152` for the
/// fields `cmd_status()` consumes: only literal/string `true` grants a boolean, and
/// missing keys fall back to false/None.
pub fn parse_status_json(s: &str) -> StatusJson {
    StatusJson {
        ax: scalar_field(s, "ax").as_deref() == Some("true"),
        sr: scalar_field(s, "sr").as_deref() == Some("true"),
        fda: scalar_field(s, "fda").as_deref() == Some("true"),
        ts: scalar_field(s, "ts").and_then(|value| value.parse::<i64>().ok()),
    }
}

/// Bash `_mark()`: literal true is granted, everything else is denied.
pub fn mark(b: bool) -> char {
    if b {
        '✓'
    } else {
        '✗'
    }
}

/// Render the `permissions` row and, when AX+SR is not granted, the indented gate warning.
pub fn render_permissions_row(status: &StatusJson, now_ts: i64) -> String {
    let age = now_ts - status.ts.unwrap_or(0);
    let stale = if age > 15 {
        " — STALE, app may be down"
    } else {
        ""
    };

    let mut out = row(
        "permissions",
        &format!(
            "AX {}  SR {}  FDA {}   (status.json, {}s ago{})",
            mark(status.ax),
            mark(status.sr),
            mark(status.fda),
            age,
            stale
        ),
    );

    if !(status.ax && status.sr) {
        out.push_str(&row(
            "",
            "⚠ computer-use gated: AX+SR must both be ✓. If ✗, the app is running but NOT granted → grant in System Settings (this is NOT 'host down').",
        ));
    }

    out
}

/// Render the transport-backed host server row.
pub fn render_host_server_row<T: Transport + ?Sized>(
    transport: &T,
    host: &str,
    aqua_sock: &str,
) -> String {
    let up = transport
        .ssh_exec(host, &host_server_command(aqua_sock))
        .map(|out| out.code == 0)
        .unwrap_or(false);

    if up {
        row("host server", &format!("up ({aqua_sock})"))
    } else {
        row("host server", "down")
    }
}

/// Render the configured remote host row.
pub fn render_remote_row(remote_host: &str) -> String {
    row(
        "remote",
        if remote_host.is_empty() {
            "(local-only)"
        } else {
            remote_host
        },
    )
}

/// Render the bash-compatible mode row.
///
/// The `mode_label()` logic (`client/cli/xpair:125-134`) lives in [`crate::mode`] — the single
/// source of truth shared with the `mode` subcommand.
pub fn render_mode_row(local_mode: bool, remote_host: &str) -> String {
    row("mode", &crate::mode::mode_label(local_mode, remote_host))
}

/// Render the live portable subset of `xpair status`.
pub fn render_status<T: Transport + ?Sized>(
    transport: &T,
    remote_host: &str,
    local_mode: bool,
    aqua_sock: &str,
    status_json: Option<&str>,
    now_ts: i64,
) -> String {
    let mut out = String::new();

    // deferred (P2): macOS app pid liveness via launchctl/pgrep.
    let use_remote = !remote_host.is_empty() && !local_mode;
    if use_remote {
        out.push_str(&render_host_server_row(transport, remote_host, aqua_sock));
    }

    if let Some(status_json) = status_json {
        out.push_str(&render_permissions_row(
            &parse_status_json(status_json),
            now_ts,
        ));
    }

    // deferred (P2): in-host session detection via TMUX/aqua socket context.
    // deferred (P2): heartbeat file mtime freshness.
    out.push_str(&render_remote_row(remote_host));
    out.push_str(&render_mode_row(local_mode, remote_host));
    // deferred (P2): bundle prefix reporting.

    out
}

/// Resolve the local app status file path using bash's `$STATUS_FILE`/`$RP_DIR/logs/status.json`.
pub fn status_file_path(client_env_path: &Path) -> PathBuf {
    if let Some(path) = non_empty_env("STATUS_FILE") {
        return PathBuf::from(path);
    }

    client_env_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("logs")
        .join("status.json")
}

/// Current Unix time in seconds for the impure CLI path.
pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row(label: &str, value: &str) -> String {
    format!("{label:<14} {value}\n")
}

fn host_server_command(aqua_sock: &str) -> String {
    let aqua_sock = remote_quote::posix_single_quote(aqua_sock);
    let script = format!("\"{HOST_TMUX_AQUA}\" -S {aqua_sock} has-session");
    remote_quote::posix_join(&["sh", "-lc", &script])
}

fn scalar_field(s: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = s.rfind(&needle)?;
    let after_key = &s[start + needle.len()..];
    let colon = after_key.find(':')?;
    let mut value = after_key[colon + 1..].trim_start();

    if let Some(rest) = value.strip_prefix('"') {
        value = rest;
        let end = value
            .find(|c| matches!(c, '"' | ',' | '}'))
            .unwrap_or(value.len());
        return Some(value[..end].trim().to_string());
    }

    let end = value
        .find(|c: char| matches!(c, ',' | '}') || c.is_whitespace())
        .unwrap_or(value.len());
    Some(value[..end].trim().to_string())
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::MockTransport;

    #[test]
    fn parses_all_true_status_json() {
        assert_eq!(
            parse_status_json(r#"{"ax":true,"sr":true,"fda":true,"ts":123}"#),
            StatusJson {
                ax: true,
                sr: true,
                fda: true,
                ts: Some(123),
            }
        );
    }

    #[test]
    fn parses_mixed_status_json_with_string_scalars() {
        assert_eq!(
            parse_status_json(r#"{"ax":"true","sr":false,"fda":"false","ts":"456"}"#),
            StatusJson {
                ax: true,
                sr: false,
                fda: false,
                ts: Some(456),
            }
        );
    }

    #[test]
    fn missing_status_keys_default_to_false_and_none() {
        assert_eq!(
            parse_status_json(r#"{"other":true}"#),
            StatusJson {
                ax: false,
                sr: false,
                fda: false,
                ts: None,
            }
        );
    }

    #[test]
    fn render_permissions_granted_fresh_without_warning() {
        let status = StatusJson {
            ax: true,
            sr: true,
            fda: true,
            ts: Some(90),
        };

        assert_eq!(
            render_permissions_row(&status, 100),
            "permissions    AX ✓  SR ✓  FDA ✓   (status.json, 10s ago)\n"
        );
    }

    #[test]
    fn render_permissions_gated_and_stale_with_warning() {
        let status = StatusJson {
            ax: true,
            sr: false,
            fda: true,
            ts: Some(80),
        };

        assert_eq!(
            render_permissions_row(&status, 100),
            "permissions    AX ✓  SR ✗  FDA ✓   (status.json, 20s ago — STALE, app may be down)\n               ⚠ computer-use gated: AX+SR must both be ✓. If ✗, the app is running but NOT granted → grant in System Settings (this is NOT 'host down').\n"
        );
    }

    #[test]
    fn host_server_row_maps_success_and_quotes_aqua_sock() {
        let transport = MockTransport::new();
        transport.push_response(0, "");

        assert_eq!(
            render_host_server_row(&transport, "mac-mini", "/tmp/aqua 'sock.sock"),
            "host server    up (/tmp/aqua 'sock.sock)\n"
        );

        let calls = transport.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].host, "mac-mini");
        assert_eq!(
            calls[0].remote_cmd,
            "'sh' '-lc' '\"$HOME/.local/bin/tmux-aqua\" -S '\\''/tmp/aqua '\\''\\'\\'''\\''sock.sock'\\'' has-session'"
        );
    }

    #[test]
    fn host_server_row_maps_nonzero_to_down() {
        let transport = MockTransport::new();
        transport.push_response(1, "");

        assert_eq!(
            render_host_server_row(&transport, "mac-mini", "/tmp/aqua-tmux.sock"),
            "host server    down\n"
        );
    }

    #[test]
    fn mode_and_remote_rows_match_bash_labels() {
        assert_eq!(render_remote_row("mac-mini"), "remote         mac-mini\n");
        assert_eq!(render_remote_row(""), "remote         (local-only)\n");
        assert_eq!(
            render_mode_row(true, "mac-mini"),
            "mode           local (transient)\n"
        );
        assert_eq!(
            render_mode_row(false, "mac-mini"),
            "mode           auto (remote)\n"
        );
        assert_eq!(render_mode_row(false, ""), "mode           auto (local)\n");
    }

    #[test]
    fn render_status_skips_deferred_and_missing_permission_rows() {
        let transport = MockTransport::new();
        transport.push_response(0, "");

        assert_eq!(
            render_status(&transport, "mac-mini", false, "/tmp/aqua-tmux.sock", None, 100),
            "host server    up (/tmp/aqua-tmux.sock)\nremote         mac-mini\nmode           auto (remote)\n"
        );
    }
}
