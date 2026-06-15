#!/usr/bin/env bash
# logging.sh — RemotePair unified bash logger (single concern).
#
# Contract: docs/logging.md
#   Line format : [<ISO-8601 ts>] [<LEVEL>] [<comp>] [<session>] <msg>
#   Comp→file   : cli→cli.log  host→remote-pair.log  (see docs table)
#   Levels      : trace < debug < info < warn < error
#   File default: INFO (REMOTEPAIR_LOG env overrides)
#   Rotation    : rotate-on-open >5MB → shift .log→.1→.2 (max 3) under advisory lock
#   Dir         : $LOG_DIR (mode 0700)
#
# Source-safe: guard against double-source via __RP_LOGGING_LOADED.
# Do NOT put this logic in shared/lib.sh (load-bearing reversibility engine).
#
# Install path: $RP_DIR/bin/logging.sh  (see shared/install.sh)
# Consumers source with a no-op fallback:
#   [ -f "$RP_DIR/bin/logging.sh" ] && . "$RP_DIR/bin/logging.sh"
#   type rp_log >/dev/null 2>&1 || { rp_log(){ :; }; log_info(){ :; }; log_warn(){ printf '%s\n' "$*" >&2; }; log_error(){ printf '%s\n' "$*" >&2; }; }

[ "${__RP_LOGGING_LOADED:-}" = 1 ] && return 0
__RP_LOGGING_LOADED=1

# ── Resolve LOG_DIR and LOG_LEVEL ─────────────────────────────────────────────
# If config.sh was already sourced, LOG_DIR / LOG_LEVEL are already set.
# Otherwise derive safe defaults so this file can be sourced standalone.
LOG_DIR="${LOG_DIR:-${RP_DIR:-$HOME/.remote-pair}/logs}"
LOG_LEVEL="${REMOTEPAIR_LOG:-${LOG_LEVEL:-info}}"

# ── Level ordering ─────────────────────────────────────────────────────────────
# Returns a numeric rank for a level name (lower = more verbose).
_rp_level_rank() {
  case "${1:-info}" in
    trace) printf 0 ;;
    debug) printf 1 ;;
    info)  printf 2 ;;
    warn)  printf 3 ;;
    error) printf 4 ;;
    *)     printf 2 ;;   # unknown → treat as info
  esac
}

# ── Portable advisory lock (macOS stock has no flock) ─────────────────────────
# _rp_lock <lockdir>   — spin-acquire via mkdir (atomic on POSIX), timeout 5s
# _rp_unlock <lockdir> — release
_rp_lock() {
  local ld="$1" i=0
  while ! mkdir "$ld" 2>/dev/null; do
    i=$((i+1)); [ $i -ge 50 ] && return 1   # 50 × 0.1s = 5s timeout → proceed without lock
    sleep 0.1
  done
  return 0
}
_rp_unlock() { rmdir "$1" 2>/dev/null || true; }

# ── Rotate a log file if > 5 MB, under advisory lock ─────────────────────────
# _rp_rotate <filepath>
# SINGLE lock primitive on ALL platforms: an atomic mkdir lock on "<file>.lock.d".
# This is deliberate: macOS stock has no flock(1), AND the Swift writer of remote-pair.log uses
# the SAME mkdir lock dir (see host/app/Config.swift rotateIfNeeded). Using one primitive
# everywhere is what makes the cross-language lock (bash launcher ↔ Swift daemon) on
# remote-pair.log actually interoperate — a flock(2)-vs-mkdir mix would NOT mutually exclude.
_rp_rotate() {
  local f="$1"
  [ -f "$f" ] || return 0
  local sz
  sz="$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f" 2>/dev/null || echo 0)"
  [ "$sz" -le 5000000 ] && return 0   # under 5 MB — nothing to do

  local basename_f; basename_f="$(basename "$f")"
  local lockd="$LOG_DIR/.${basename_f}.lock.d"   # e.g. .remote-pair.log.lock.d (shared w/ Swift)
  if _rp_lock "$lockd"; then
    # Re-check size inside the lock (another writer may have rotated already)
    local sz2
    sz2="$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f" 2>/dev/null || echo 0)"
    if [ "$sz2" -gt 5000000 ]; then
      # Shift: .2 ← .1 ← live (drop old .2 if present) → keep max 3 (live + .1 + .2)
      [ -f "${f}.1" ] && mv -f "${f}.1" "${f}.2" 2>/dev/null || true
      mv -f "$f" "${f}.1" 2>/dev/null || true
    fi
    _rp_unlock "$lockd"
  fi
  # If the lock timed out, proceed without rotation (safe — log may grow slightly over limit).
}

# ── Redaction (docs/logging.md §6) ────────────────────────────────────────────
# Mask the home dir → ~ and the REMOTE_HOST value / ssh alias → <host>, so logs shipped via
# `remote-pair logs --collect` don't leak the reporter's paths/host. Best-effort, msg body only.
_rp_redact() {
  local s="$1"
  [ -n "${HOME:-}" ] && s="${s//$HOME/~}"
  [ -n "${REMOTE_HOST:-}" ] && s="${s//$REMOTE_HOST/<host>}"
  printf '%s' "$s"
}

# ── Core log function ──────────────────────────────────────────────────────────
# rp_log <level> <comp> <msg...>
#   level : trace | debug | info | warn | error
#   comp  : cli | host | rust | ide | workbench (see docs/logging.md §2)
#   msg   : rest of arguments joined by space
#
# Writes to $LOG_DIR/<comp>.log  (exception: comp=host → remote-pair.log)
# Echoes colored line to stderr for warn/error.
# Skips file write if level < LOG_LEVEL threshold.
rp_log() {
  local level="${1:-info}" comp="${2:-cli}"; shift 2 2>/dev/null || true
  local msg="$*"

  # Resolve destination file (comp→file contract from docs/logging.md §2)
  local logfile
  case "$comp" in
    host) logfile="$LOG_DIR/remote-pair.log" ;;
    *)    logfile="$LOG_DIR/${comp}.log" ;;
  esac

  # Ensure log directory exists with mode 0700
  [ -d "$LOG_DIR" ] || mkdir -p -m 0700 "$LOG_DIR" 2>/dev/null || true

  # Level threshold check
  local rank_msg rank_threshold
  rank_msg="$(_rp_level_rank "$level")"
  rank_threshold="$(_rp_level_rank "$LOG_LEVEL")"
  [ "$rank_msg" -ge "$rank_threshold" ] || return 0

  # Rotate-on-open (size check before append)
  _rp_rotate "$logfile"

  # Redact sensitive paths/host before any sink (docs/logging.md §6)
  msg="$(_rp_redact "$msg")"

  # Format: [<ISO-8601 ts>] [<LEVEL>] [<comp>] [<session>] <msg>
  local ts level_upper session_tag
  ts="$(date +%FT%T%z)"
  level_upper="$(printf '%s' "$level" | tr '[:lower:]' '[:upper:]')"
  session_tag="${RP_SESSION:--}"

  local line="[$ts] [$level_upper] [$comp] [$session_tag] $msg"

  # Append to file (single printf → single write syscall, atomic for lines ≤ PIPE_BUF)
  printf '%s\n' "$line" >> "$logfile" 2>/dev/null || true

  # Colored stderr for warn / error
  case "$level" in
    warn)  printf '\033[1;33m⚠ [%s] %s\033[0m\n' "$comp" "$msg" >&2 ;;
    error) printf '\033[1;31m✗ [%s] %s\033[0m\n' "$comp" "$msg" >&2 ;;
  esac
}

# ── Convenience wrappers (comp-explicit) ──────────────────────────────────────
log_info()  { rp_log info  "$@"; }
log_warn()  { rp_log warn  "$@"; }
log_error() { rp_log error "$@"; }

# ── Colored UI helpers ────────────────────────────────────────────────────────
# err/info/warn — single definition replacing per-script duplicates (AC-6).
# Prints colored output to stderr AND persists to the cli log via rp_log.
# info() omits the log write (informational UI only — not a log event).
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; rp_log error cli "$*"; }
info() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; rp_log warn  cli "$*"; }
