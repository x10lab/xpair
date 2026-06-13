#!/usr/bin/env python3
# manage-claude-hooks.py — ~/.claude/settings.json 의 hooks 에 RemotePair 훅을
# 멱등으로 추가/제거한다. 기존 사용자 훅(gstack/omc/notify 등)은 절대 건드리지 않는다.
#
# 왜 python: macOS 에 jq 가 기본 없음. python3 는 CLT 와 함께 존재(설치 전제). JSON 안전 머지.
#
# 사용:
#   manage-claude-hooks.py add    <settings_path> <approve_cmd> <notify_cmd>
#   manage-claude-hooks.py remove <settings_path> <approve_cmd> <notify_cmd>
#
# 식별: command 문자열에 cmd_path(파일 경로)가 포함된 엔트리를 '우리 것'으로 본다.
#   → add 는 없을 때만 넣고(중복 방지), remove 는 그 엔트리만 빼고 빈 이벤트 배열은 정리한다.
#
# 훅 배치 (data-driven):
#   approve-reminder.sh  → PermissionDenied, PostToolUseFailure  (matcher: GUI 도구들)
#   remote-pair-notify.sh→ Stop, Notification, SubagentStop       (matcher: None = 모든 도구)
#                        → PermissionDenied, PostToolUseFailure  (matcher: GUI 도구들, approve 이벤트)
import json, os, sys

# ── approve-reminder 전용 설정 ────────────────────────────────────────────────
APPROVE_EVENTS = ["PermissionDenied", "PostToolUseFailure"]
# GUI 승인창을 띄우는 것들 + Bash(ssh/git 이 1Password SSH agent 창에 막혀 hang→timeout).
APPROVE_MATCHER = r"mcp__claude-in-chrome__.*|mcp__computer-use__.*|Bash"

# ── notify 훅 설정 ────────────────────────────────────────────────────────────
# Stop/Notification/SubagentStop 은 matcher 없음(모든 도구에서 발생하는 세션 수준 이벤트).
NOTIFY_EVENTS_NO_MATCHER = ["Stop", "Notification", "SubagentStop"]
# approve 계열은 approve-reminder 와 같은 matcher 로 notify 도 붙임.
NOTIFY_EVENTS_WITH_MATCHER = ["PermissionDenied", "PostToolUseFailure"]


def load(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (ValueError, OSError):
        # 손상/빈 파일이면 멈춘다 — 사용자 설정을 덮어쓰지 않기 위해 실패로 처리.
        sys.stderr.write(f"settings.json 파싱 실패(보존): {path}\n")
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
    """훅 엔트리 하나를 반환. matcher=None 이면 키 자체를 생략."""
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
        sys.stderr.write("settings.json 최상위가 객체가 아님(보존)\n")
        sys.exit(3)

    changed = False

    if mode == "add":
        # 1) approve-reminder: PermissionDenied + PostToolUseFailure (with matcher)
        for ev in APPROVE_EVENTS:
            changed |= add_entry(hooks, ev, approve_cmd, APPROVE_MATCHER)

        # 2) notify: Stop / Notification / SubagentStop (matcher 없음)
        for ev in NOTIFY_EVENTS_NO_MATCHER:
            changed |= add_entry(hooks, ev, notify_cmd, matcher=None)

        # 3) notify: PermissionDenied + PostToolUseFailure (with matcher, approve 이벤트용)
        for ev in NOTIFY_EVENTS_WITH_MATCHER:
            changed |= add_entry(hooks, ev, notify_cmd, APPROVE_MATCHER)

    elif mode == "remove":
        # approve-reminder 제거
        for ev in APPROVE_EVENTS:
            changed |= remove_entry(hooks, ev, approve_cmd)

        # notify 제거 (모든 이벤트)
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
        print(f"hooks {mode}: no-op (이미 {'있음' if mode == 'add' else '없음'})")


if __name__ == "__main__":
    main()
