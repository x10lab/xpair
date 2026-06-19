# xpair-launch ↔ claude-iterm-launch Equivalence Audit

Item-by-item verification of whether the new `client/cli/xpair-launch` reproduces every behavior of the reference `~/.claude/bin/claude-iterm-launch` (1:1 connection model). Test evidence: `tests/t_*.sh` (116 assertions total, 0 failures).

## Behavior Mapping Table

| # | Reference behavior | New | Verdict | Test |
|---|---|---|---|---|
| 1 | Error log + stderr tee + pause on failure | Same (only the log path is namespaced to `$RP_DIR/logs/claude-launch.err.log`) | **SAME** | t_08 s1,s3 |
| 2 | `_readable`: ASCII as-is / non-ASCII → haiku translation + cache / hangul-romanize fallback / original | Same (cache `$RP_DIR/session-names`) | **SAME** | t_03 |
| 3 | `_proj_base` = readable name (≤15) + path hash (5) | Same | **SAME** | t_03 |
| 4 | host-prefix session name `<host>_<base>`, `[.:]` → `_` | Same | **SAME** | t_03 |
| 5 | respawn loop + `--resume` (per-machine last-session) + `CL_CONTINUE` | Same | **SAME** | t_05 s1,s3,s4 |
| 6 | 3-way: none → create + continue / detached → `attach -d` take-over / attached → `_N` fresh | Same | **SAME** | t_05 s1-4 |
| 7 | Plain tmux fallback | Same | **SAME** | t_05 s5 |
| 8 | Target selection (m1 = local, otherwise prompt [1]remote/[2]local) | Generalized: REMOTE_HOST empty / == local → local, `--local/--remote`, `RP_YES` → remote, prompt | **SAME** (+RP_YES non-interactive added) | t_04 |
| 9 | reach + tailscale exit-node auto-config + local fallback | Same | **SAME** | t_07 s1-3 |
| 10 | dir-check 3-attempt retry (marker) + creation prompt + local fallback | Same | **SAME** | t_07 s4-6 |
| 11 | Zombie tab cleanup | Same | **SAME** | t_08 s4 (the kill path is a headless limitation) |
| 12 | Remote setup: ensure server is running → create session → base64 respawn injection | Same (adapted to app/bundle names `XpairHost` / `com.x10lab.xpair-host`) | **SAME** | t_06 s1,3,6 |
| 13 | mosh attach absolute path + `on_tab_close` detach trap + ssh -t fallback | Same | **SAME** | t_06 s4,5 |

## Intended Differences (DIVERGENCE — Not Restored)

| Item | Reference | New | Reason |
|---|---|---|---|
| Path mapping (FOLDER_MAPS) | None (assumes identical paths) | **New feature** (handles differing absolute paths between client ↔ host) | Supports external sync environments. t_02 |
| `~/.claude` sync | Heavy parallel (M1 bg + lock + index.lock self-healing) | Lightweight best-effort one-liner | Decouples sync (opt-in). [[launcher-1to1-decision]] |
| Local aqua usage | On non-m1 machines AQUA is disabled (`AQUA=""`) → always plain tmux | If tmux-aqua is present, local also uses aqua | The new structure does not fix the host role to m1 — more general |
| presize | Computes COLS/LINES but does not apply them to new-session (dead code) | Actually applied via `new-session -x/-y` | Realizes the reference's intent (improvement) |
| Session sharing | (None — single attach take-over) | (None — 1:1 maintained) | User decision: drop multi-attach, keep the same 1:1 as the reference |

## Bugs Found and Fixed (during ralph)

1. **`exec tm_local attach`** (line ~200) — `exec` cannot run a shell function → local aqua take-over attach breaks. → Fixed to `exec "$LOCAL_BIN/tmux-aqua" -S "$AQUA_SOCK" attach -d ...`. (detected by t_00/t_05)
2. **mosh `$REMOTE_BIN/tmux-aqua`** (just before ralph) — mosh `--` is a non-shell exec, so the literal `$HOME` is not expanded → tmux-aqua cannot be found. → Fixed to an absolute path (`"$HOME/.local/bin/tmux-aqua"`). (regression guarded by t_06 s4)

## Conclusion
- UNINTENTIONAL gap: **0**. Every core behavior of the reference maps to either SAME or an intended improvement.
- Headless-unverified (limitations): interactive mosh attach on a real screen, AX synthetic-input real behavior, on_tab_close real trigger, zombie kill real path → a human needs to confirm via terminal/VNC.
