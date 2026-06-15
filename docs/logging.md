# RemotePair Logging Contract

The single source of truth for how every RemotePair component logs. All 6 components
(bash CLI, Rust `screen`, Swift host app, IDE extension, IDE workbench, shared scripts)
conform to **this** format/level/rotation spec — do not invent per-component variants.

Goal: maintainer debugging now, production diagnostics (collect/redact) later. Logs are
**local only** (never shipped automatically).

## 1. Log directory

```
~/.remote-pair/logs/          # = $RP_DIR/logs, created mode 0700 by every emitter at init
```

`0700` because logs contain host names, ssh aliases, and file paths. Every logger MUST
`mkdir -p` the dir with mode 0700 on init (idempotent).

## 2. Component → file map

| comp tag | file | writer process(es) |
|----------|------|--------------------|
| `cli` | `cli.log` | bash CLI scripts (many concurrent, short-lived) |
| `rust` | `rust.log` | the `screen` serve engine |
| `host` | `remote-pair.log` | Swift host daemon **+** `remote-pair-launch` SESSION lines (KEEP existing file — no `host.log`) |
| `ide` | `ide.log` | IDE extension (extension-host process) |
| `workbench` | `workbench.log` | IDE workbench (renderer process) |

`remote-pair.log` is the one **cross-language multi-writer** file (Swift + launcher bash). The
launchd-captured `remote-pair.out.log` / `.err.log` / `remote-pair-watchdog.err.log` are raw
stdout/panic capture and are NOT in this contract (left as-is). `remote-pair logs` tails
`$LOG_DIR/*.log` (glob), so every component file surfaces.

## 3. Line format (exact)

```
[<ISO-8601 ts>] [<LEVEL>] [<comp>] [<session>] <message>
```

- `<ISO-8601 ts>`: e.g. `2026-06-15T10:45:16+0900` (local tz, second precision is fine).
- `<LEVEL>`: one of `TRACE DEBUG INFO WARN ERROR` (upper-case, fixed width not required).
- `<comp>`: the comp tag from §2 (`cli` `rust` `host` `ide` `workbench`).
- `<session>`: the correlation id (§5), or `-` when not session-scoped.
- `<message>`: redacted (§6) single logical line. Multi-line payloads: emit one record per line,
  each ≤ PIPE_BUF (≈4 KB) so a single `write()` is atomic.

Example:
```
[2026-06-15T10:45:16+0900] [WARN] [host] [proj-main@1718430000] reaping 2 session(s): a, b
```

## 4. Levels & verbosity control

Levels (ascending): `trace < debug < info < warn < error`.

- **File default = INFO** (single knob). **Console/stderr = WARN+.**
- **Precedence (highest first):** `REMOTEPAIR_LOG` env  >  `remotepair.log.level` (IDE setting)  >  `info`.
  - Rust additionally honors `RUST_LOG` (used only if `REMOTEPAIR_LOG` is unset).
- Values are level names (`debug`, `warn`, …). A record is written to a sink iff its level ≥ the
  resolved threshold for that sink.
- The file default is deliberately a single config value so it can later be lowered to `warn` after
  observing real volume, with no code change.

## 5. Correlation id (`<session>`)

- **Id = `<tmux-session-name>@<epoch>`.** The tmux session name is already the cross-machine
  correlation id (see `HostManager.swift` "the session name is the cross-machine correlation id").
- The bare name collides across reconnects, so suffix `@<epoch>` where **epoch is assigned ONCE on
  the host** (first-attach unix time) and **propagated to the client via `RP_SESSION`**, so both sides
  emit the identical id. Without host-owned epoch, a cross-machine `grep <name>@<epoch>` would not join.
- Grep stays simple: `grep '<name>@' ~/.remote-pair/logs/*.log` (prefix match) for one logical session.
- Propagation: created in `remote-pair-launch` (`new-session -s "$SESS"`), exported as `RP_SESSION`;
  read by the bash logger, the Rust `--session`/`RP_SESSION`, the ext, and Swift `HostManager`.
- App-level / non-session events use `-`.

## 6. Redaction

`redact(msg)` runs before every sink. Minimum masking (now):

- `$HOME` prefix → `~`
- `REMOTE_HOST` value and known ssh host aliases → `<host>`
- absolute paths captured from subprocess stderr → keep basename, mask the dir

Residual leak risk (arbitrary paths inside captured stderr) is documented, not fully solved;
`remote-pair logs --collect` ships these logs to bug reports, so deeper structured redaction is a
follow-up.

## 7. Rotation — rotate-on-open + lock + long-lived guard

- **Baseline (rotate-on-open):** at logger init, if `<file>` size > **5 MB**, shift
  `<file> → <file>.1 → <file>.2` (keep max **3**: the live file + `.1` + `.2`), then open fresh.
- **Lock:** the size-check + rename runs under an advisory lock (`flock` in bash; `flock(2)` in
  Swift/Rust) keyed on a per-file lock, so concurrent writers of the same file (e.g. many `cli`
  invocations, or Swift+launcher both on `remote-pair.log` via `$LOG_DIR/.remote-pair.log.lock`)
  cannot clobber each other's backup or write to an unlinked inode.
- **Long-lived guard:** rotate-on-open alone can't bound a 24/7 process. The host daemon tick loop
  and the Rust serve frame loop MUST additionally run a periodic (cheap `stat`) size-check and rotate
  mid-run.
- **Atomic append:** each record is a single `write()` ≤ PIPE_BUF; no interleaving of partial lines.

## 8. Per-language conformance (where each logger lives)

| comp | logger home | notes |
|------|-------------|-------|
| `cli` | `shared/logging.sh` → installed `$RP_DIR/bin/logging.sh` | `rp_log level comp msg` + `log_info/warn/error`; consumers source with a no-op fallback |
| `rust` | `host/rd/screen/src/log.rs` | `tracing` + custom format layer (session from span field) + custom `MakeWriter` (open + rotate); `EnvFilter` = REMOTEPAIR_LOG>RUST_LOG>info |
| `host` | `host/app/Config.swift` `log()` | leveled overload + `.info` shim for the 45 legacy call-sites; writes `remote-pair.log` |
| `ide` | `client/ide/remotepair/ext/extension.js` `log()` | leveled + file persist + redact; keep OutputChannel |
| `workbench` | `client/ide/.../remotePairLog.ts` (RemotePair-owned, in the zz patch) | `ILogService` primary + mirror appender to `workbench.log` using the SAME formatter |

## 9. Access

- `remote-pair logs` — tail `$LOG_DIR/*.log` (`--host` correlates over ssh; `-f` follow).
- `remote-pair logs --collect` — tar/gzip `$LOG_DIR` → `remote-pair-logs-<stamp>.tgz` for bug reports.
- IDE: `RemotePair: Show Logs` — reveal `$LOG_DIR` / invoke `--collect`.
