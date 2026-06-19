#!/usr/bin/env python3
# manage-claude-hooks.py — idempotently adds/removes the Xpair hooks in the
# hooks section of ~/.claude/settings.json. Never touches existing user hooks
# (gstack/omc/notify, etc.).
#
# Why python: jq is not present by default on macOS. python3 ships with the CLT
# (installation prerequisite). Safe JSON merge.
#
# Usage:
#   manage-claude-hooks.py add    <settings_path> <approve_cmd> <notify_cmd>
#   manage-claude-hooks.py remove <settings_path> <approve_cmd> <notify_cmd>
#
# Identification: an entry whose command string contains cmd_path (the file path)
# is treated as 'ours'.
#   → add only inserts when absent (avoids duplicates); remove drops only that
#     entry and cleans up empty event arrays.
#
# Hook layout (data-driven):
#   approve-reminder.sh  → PermissionDenied, PostToolUseFailure  (matcher: GUI tools)
#   xpair-notify.sh→ Stop, Notification, SubagentStop       (matcher: None = all tools)
#                        → PermissionDenied, PostToolUseFailure  (matcher: GUI tools, approve events)
import json, os, sys

# ── approve-reminder-specific config ──────────────────────────────────────────
APPROVE_EVENTS = ["PermissionDenied", "PostToolUseFailure"]
# Things that pop up a GUI approval dialog + Bash (ssh/git blocked on the 1Password SSH agent dialog, hang→timeout).
APPROVE_MATCHER = r"mcp__claude-in-chrome__.*|mcp__computer-use__.*|Bash"

# ── notify hook config ────────────────────────────────────────────────────────
# Stop/Notification/SubagentStop have no matcher (session-level events fired by all tools).
NOTIFY_EVENTS_NO_MATCHER = ["Stop", "Notification", "SubagentStop"]
# For the approve family, attach notify with the same matcher as approve-reminder.
NOTIFY_EVENTS_WITH_MATCHER = ["PermissionDenied", "PostToolUseFailure"]


def load(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (ValueError, OSError):
        # Stop on a corrupted/empty file — treat as failure to avoid overwriting user settings.
        sys.stderr.write(f"failed to parse settings.json (preserved): {path}\n")
        sys.exit(3)


def save(path, data):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".rp-tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def make_entry(cmd_path, event, matcher=None):
    """Return a single hook entry. If matcher=None, omit the key entirely."""
    e = {"hooks": [{"type": "command", "command": f"{cmd_path} {event}"}]}
    if matcher is not None:
        e["matcher"] = matcher
    return e


def has_ours(arr, cmd_path):
    for e in arr:
        for h in e.get("hooks", []):
            if cmd_path in h.get("command", ""):
                return True
    return False


def add_entry(hooks, event, cmd_path, matcher=None):
    arr = hooks.get(event, [])
    if not isinstance(arr, list):
        return False
    if has_ours(arr, cmd_path):
        return False
    arr.append(make_entry(cmd_path, event, matcher))
    hooks[event] = arr
    return True


def remove_entry(hooks, event, cmd_path):
    arr = hooks.get(event, [])
    if not isinstance(arr, list):
        return False
    new = [e for e in arr
           if not any(cmd_path in h.get("command", "") for h in e.get("hooks", []))]
    if len(new) == len(arr):
        return False
    if new:
        hooks[event] = new
    else:
        hooks.pop(event, None)
    return True


def main():
    if len(sys.argv) != 5:
        sys.stderr.write(
            "usage: manage-claude-hooks.py add|remove <settings> <approve_cmd> <notify_cmd>\n"
        )
        sys.exit(2)

    mode, path, approve_cmd, notify_cmd = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

    data = load(path)
    hooks = data.setdefault("hooks", {}) if isinstance(data, dict) else None
    if hooks is None:
        sys.stderr.write("top level of settings.json is not an object (preserved)\n")
        sys.exit(3)

    changed = False

    if mode == "add":
        # 1) approve-reminder: PermissionDenied + PostToolUseFailure (with matcher)
        for ev in APPROVE_EVENTS:
            changed |= add_entry(hooks, ev, approve_cmd, APPROVE_MATCHER)

        # 2) notify: Stop / Notification / SubagentStop (no matcher)
        for ev in NOTIFY_EVENTS_NO_MATCHER:
            changed |= add_entry(hooks, ev, notify_cmd, matcher=None)

        # 3) notify: PermissionDenied + PostToolUseFailure (with matcher, for approve events)
        for ev in NOTIFY_EVENTS_WITH_MATCHER:
            changed |= add_entry(hooks, ev, notify_cmd, APPROVE_MATCHER)

    elif mode == "remove":
        # remove approve-reminder
        for ev in APPROVE_EVENTS:
            changed |= remove_entry(hooks, ev, approve_cmd)

        # remove notify (all events)
        for ev in NOTIFY_EVENTS_NO_MATCHER + NOTIFY_EVENTS_WITH_MATCHER:
            changed |= remove_entry(hooks, ev, notify_cmd)

    else:
        sys.stderr.write(f"unknown mode: {mode}\n")
        sys.exit(2)

    if mode == "remove" and not hooks:
        data.pop("hooks", None)

    if changed:
        save(path, data)
        print(f"hooks {mode}: {path}")
    else:
        print(f"hooks {mode}: no-op (already {'present' if mode == 'add' else 'absent'})")


if __name__ == "__main__":
    main()
