//! `log` — the `rust` component's conforming logger for the RemotePair logging
//! contract (see `docs/logging.md`).
//!
//! Emits the unified line
//!
//! ```text
//! [<ISO-8601 ts>] [<LEVEL>] [rust] [<session>] <message>
//! ```
//!
//! to `~/.remote-pair/logs/rust.log`, level-gated by `EnvFilter`
//! (`REMOTEPAIR_LOG` > `RUST_LOG` > `info`), with size-based rotate-on-open
//! (5 MB → `.1` → `.2`, max 3) under a `flock(2)` advisory lock.
//!
//! ## Why a custom `Layer` instead of the stock `fmt` layer
//!
//! `tracing_subscriber::fmt` cannot produce this exact bracket grammar (it owns
//! its own field/timestamp formatting). Rather than fight `FormatEvent`, we
//! implement a tiny `Layer` whose `on_event` extracts the event's `message`
//! field, formats the contract line by hand, and writes it through a shared
//! `Mutex<File>` in one `write_all` (a single `write(2)`, atomic ≤ PIPE_BUF for
//! normal log lines). The session id is a **process-global** (`set_session`):
//! this crate serves exactly one pair session per process, so a global is more
//! robust than threading a span field through every call site.

use std::fmt::Write as _;
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Layer};

/// Component tag for this crate, per the contract's comp→file map (§2).
const COMP: &str = "rust";
/// Rotate when the live log exceeds this many bytes (contract §7: 5 MB).
const ROTATE_BYTES: u64 = 5 * 1024 * 1024;
/// Keep the live file plus this many `.N` backups (contract §7: max 3 total).
const MAX_BACKUPS: u32 = 2;

/// Process-global correlation id (contract §5). `-` until `set_session` is
/// called (app-level / non-session events use `-`).
static SESSION: OnceLock<Mutex<String>> = OnceLock::new();

/// The shared, open handle to `rust.log`. The custom layer writes every record
/// through this single `Mutex<File>` so concurrent threads cannot interleave
/// partial lines.
static FILE: OnceLock<Mutex<File>> = OnceLock::new();

fn session_cell() -> &'static Mutex<String> {
    SESSION.get_or_init(|| Mutex::new("-".to_string()))
}

/// Set the process-global session id used in the `[session]` column. Pass the
/// tmux session name (the cross-machine correlation id); app-level processes may
/// leave it at the default `-`.
pub fn set_session(s: String) {
    let s = if s.is_empty() { "-".to_string() } else { s };
    *session_cell().lock().unwrap() = s;
}

fn current_session() -> String {
    session_cell().lock().unwrap().clone()
}

/// `~/.remote-pair/logs`.
fn log_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join(".remote-pair").join("logs")
}

/// `~/.remote-pair/logs/rust.log`.
fn log_path() -> PathBuf {
    log_dir().join("rust.log")
}

/// Lock file guarding the rotate-on-open critical section. Per-file so it does
/// not contend with other components' locks.
fn lock_path() -> PathBuf {
    log_dir().join(".rust.log.lock")
}

/// Create `~/.remote-pair/logs` mode 0700 (idempotent). Logs hold host names and
/// paths, so the dir is owner-only (contract §1).
fn ensure_dir() -> std::io::Result<()> {
    let dir = log_dir();
    if !dir.exists() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)?;
    } else {
        // Tighten perms if the dir pre-existed with looser bits (best-effort).
        if let Ok(meta) = std::fs::metadata(&dir) {
            let mut perms = meta.permissions();
            if perms.mode() & 0o777 != 0o700 {
                perms.set_mode(0o700);
                let _ = std::fs::set_permissions(&dir, perms);
            }
        }
    }
    Ok(())
}

/// RAII wrapper around a `flock(2)` advisory exclusive lock on the lock fd.
/// Held across the size-check + rename so a second starting process (or the
/// mid-run guard) cannot clobber a backup or write to an unlinked inode.
struct FlockGuard(File);

impl FlockGuard {
    /// Acquire `LOCK_EX` on the lock file, creating it if needed. Returns `None`
    /// on any error (we then proceed unlocked — rotation is single-process at
    /// start in the common case, so a missing lock degrades to the documented
    /// "racing is minimal" behavior rather than blocking startup).
    fn acquire() -> Option<FlockGuard> {
        let f = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(lock_path())
            .ok()?;
        // SAFETY: flock on a valid fd; LOCK_EX blocks until exclusive.
        let rc = unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX) };
        if rc != 0 {
            return None;
        }
        Some(FlockGuard(f))
    }
}

impl Drop for FlockGuard {
    fn drop(&mut self) {
        // SAFETY: fd is still valid until the File drops after us.
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

/// Size-check + shift `rust.log → .1 → .2` (max [`MAX_BACKUPS`] backups) if the
/// live file exceeds [`ROTATE_BYTES`]. Runs under [`FlockGuard`] so concurrent
/// starters / the mid-run guard cannot interleave. No-op when the file is small
/// or absent.
fn rotate_if_needed() {
    let path = log_path();
    let size = match std::fs::metadata(&path) {
        Ok(m) => m.len(),
        Err(_) => return, // no live file yet → nothing to rotate
    };
    if size <= ROTATE_BYTES {
        return;
    }

    let _guard = FlockGuard::acquire();
    // Re-check under the lock: another process may have just rotated.
    match std::fs::metadata(&path) {
        Ok(m) if m.len() > ROTATE_BYTES => {}
        _ => return,
    }

    // Drop the oldest, then shift each backup up by one: .1→.2, live→.1.
    let dir = log_dir();
    let oldest = dir.join(format!("rust.log.{MAX_BACKUPS}"));
    let _ = std::fs::remove_file(&oldest);
    let mut n = MAX_BACKUPS;
    while n > 1 {
        let from = dir.join(format!("rust.log.{}", n - 1));
        let to = dir.join(format!("rust.log.{n}"));
        let _ = std::fs::rename(&from, &to);
        n -= 1;
    }
    let _ = std::fs::rename(&path, dir.join("rust.log.1"));
}

/// Open (or re-open) `rust.log` for appending and store it as the shared writer.
fn open_file() -> std::io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
}

/// Format the local-tz ISO-8601 timestamp `YYYY-MM-DDTHH:MM:SS+ZZZZ` (second
/// precision; contract §3). Computed from `SystemTime` + the host's UTC offset
/// (via `localtime_r`) to avoid a chrono dependency.
fn iso8601_now() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as libc::time_t;

    // SAFETY: localtime_r writes into our stack `tm`; we read it after.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe {
        libc::localtime_r(&secs, &mut tm);
    }

    let off = tm.tm_gmtoff; // seconds east of UTC
    let sign = if off >= 0 { '+' } else { '-' };
    let off_abs = off.unsigned_abs();
    let off_h = off_abs / 3600;
    let off_m = (off_abs % 3600) / 60;

    let mut s = String::with_capacity(25);
    let _ = write!(
        s,
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday,
        tm.tm_hour,
        tm.tm_min,
        tm.tm_sec,
        sign,
        off_h,
        off_m,
    );
    s
}

/// Map a `tracing::Level` to the contract's upper-case level token (§3/§4).
fn level_str(level: &Level) -> &'static str {
    match *level {
        Level::ERROR => "ERROR",
        Level::WARN => "WARN",
        Level::INFO => "INFO",
        Level::DEBUG => "DEBUG",
        Level::TRACE => "TRACE",
    }
}

/// Extracts the `message` field (the macro's format-string body) from an event.
struct MessageVisitor {
    message: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            // The `message` field arrives as a Debug value; `{:?}` of a
            // fmt::Arguments renders the formatted string without quotes.
            let _ = write!(self.message, "{value:?}");
        }
    }
}

/// §6 REMOTE_HOST for redaction — env wins, else parsed once from ~/.remote-pair/client.env.
static REMOTE_HOST: OnceLock<Option<String>> = OnceLock::new();
fn remote_host() -> Option<String> {
    REMOTE_HOST
        .get_or_init(|| {
            if let Ok(h) = std::env::var("REMOTE_HOST") {
                if !h.trim().is_empty() {
                    return Some(h);
                }
            }
            let home = std::env::var_os("HOME")?;
            let path = std::path::Path::new(&home).join(".remote-pair/client.env");
            let raw = std::fs::read_to_string(path).ok()?;
            for line in raw.lines() {
                if let Some(v) = line.trim().strip_prefix("REMOTE_HOST=") {
                    let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
            None
        })
        .clone()
}

/// §6 redaction: mask the home dir → ~ and REMOTE_HOST → <host> before any sink (logs may be
/// shipped via `remote-pair logs --collect`). Best-effort, message body only.
fn redact(s: &str) -> String {
    let mut r = s.to_string();
    if let Some(home) = std::env::var_os("HOME").and_then(|h| h.into_string().ok()) {
        if !home.is_empty() {
            r = r.replace(&home, "~");
        }
    }
    if let Some(host) = remote_host() {
        if !host.is_empty() {
            r = r.replace(&host, "<host>");
        }
    }
    r
}

/// The custom layer: formats and persists the unified contract line for every
/// event whose level passes the `EnvFilter`.
struct RemotePairLayer;

impl<S: Subscriber> Layer<S> for RemotePairLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = MessageVisitor {
            message: String::new(),
        };
        event.record(&mut visitor);

        let meta = event.metadata();
        let line = format!(
            "[{}] [{}] [{}] [{}] {}\n",
            iso8601_now(),
            level_str(meta.level()),
            COMP,
            current_session(),
            redact(&visitor.message),
        );

        if let Some(file) = FILE.get() {
            if let Ok(mut f) = file.lock() {
                // One write_all → one write(2) for a contract-sized line.
                let _ = f.write_all(line.as_bytes());
            }
        }
    }
}

/// Build the `EnvFilter`: `REMOTEPAIR_LOG` if set, else `RUST_LOG` if set, else
/// `info` (contract §4 precedence; Rust additionally honors `RUST_LOG`).
fn build_filter() -> EnvFilter {
    if let Ok(v) = std::env::var("REMOTEPAIR_LOG") {
        if !v.trim().is_empty() {
            return EnvFilter::new(v);
        }
    }
    if let Ok(v) = std::env::var("RUST_LOG") {
        if !v.trim().is_empty() {
            return EnvFilter::new(v);
        }
    }
    EnvFilter::new("info")
}

/// Initialize the global tracing subscriber. Idempotent-safe to call once early
/// in `main` (after [`set_session`]). Creates the log dir (0700), rotates on
/// open if oversized, opens `rust.log`, and installs the custom layer behind the
/// resolved `EnvFilter`.
pub fn init() {
    if ensure_dir().is_err() {
        // Without a dir we cannot persist; install nothing and let the process
        // run silently rather than panic.
        return;
    }
    rotate_if_needed();

    match open_file() {
        Ok(f) => {
            let _ = FILE.set(Mutex::new(f));
        }
        Err(_) => return,
    }

    let _ = tracing_subscriber::registry()
        .with(RemotePairLayer.with_filter(build_filter()))
        .try_init();
}

/// Mid-run rotation guard for long-lived loops (the serve frame loop). Cheap:
/// one `stat`; rotates + re-opens the shared writer only when oversized
/// (contract §7 "long-lived guard"). Call periodically, e.g. every N frames.
pub fn rotate_guard() {
    let oversized = matches!(std::fs::metadata(log_path()), Ok(m) if m.len() > ROTATE_BYTES);
    if !oversized {
        return;
    }
    rotate_if_needed();
    // Re-open onto the fresh inode so subsequent writes don't go to the
    // now-renamed `.1` (which would also keep it growing).
    if let (Ok(f), Some(slot)) = (open_file(), FILE.get()) {
        if let Ok(mut guard) = slot.lock() {
            *guard = f;
        }
    }
}
