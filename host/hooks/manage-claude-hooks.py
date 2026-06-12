#!/usr/bin/env python3
# manage-claude-hooks.py — ~/.claude/settings.json 의 hooks 에 RemotePair approve 훅을
# 멱등으로 추가/제거한다. 기존 사용자 훅(gstack/omc/notify 등)은 절대 건드리지 않는다.
#
# 왜 python: macOS 에 jq 가 기본 없음. python3 는 CLT 와 함께 존재(설치 전제). JSON 안전 머지.
#
# 사용:
#   manage-claude-hooks.py add    <settings_path> <hook_command_path>
#   manage-claude-hooks.py remove <settings_path> <hook_command_path>
#
# 식별: command 문자열에 hook_command_path(파일 경로)가 포함된 엔트리를 '우리 것'으로 본다.
#   → add 는 없을 때만 넣고(중복 방지), remove 는 그 엔트리만 빼고 빈 이벤트 배열은 정리한다.
import json, os, sys

EVENTS = ["PermissionDenied", "PostToolUseFailure"]
# 매칭 도구: GUI 승인창을 띄우는 것들 + Bash(ssh/git 이 1Password SSH agent 창에 막혀 hang→timeout).
# Bash 는 광범위하지만 스크립트가 denied|permission|timeout 신호일 때만 주입하므로 일반 실패엔 안 뜬다.
MATCHER = r"mcp__claude-in-chrome__.*|mcp__computer-use__.*|Bash"


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


def entry(cmd_path, event):
    return {"matcher": MATCHER,
            "hooks": [{"type": "command", "command": f"{cmd_path} {event}"}]}


def has_ours(arr, cmd_path):
    for e in arr:
        for h in e.get("hooks", []):
            if cmd_path in h.get("command", ""):
                return True
    return False


def main():
    if len(sys.argv) != 4:
        sys.stderr.write("usage: manage-claude-hooks.py add|remove <settings> <cmd_path>\n")
        sys.exit(2)
    mode, path, cmd_path = sys.argv[1], sys.argv[2], sys.argv[3]
    data = load(path)
    hooks = data.setdefault("hooks", {}) if isinstance(data, dict) else None
    if hooks is None:
        sys.stderr.write("settings.json 최상위가 객체가 아님(보존)\n")
        sys.exit(3)

    changed = False
    for ev in EVENTS:
        arr = hooks.get(ev, [])
        if not isinstance(arr, list):
            continue
        if mode == "add":
            if not has_ours(arr, cmd_path):
                arr.append(entry(cmd_path, ev))
                hooks[ev] = arr
                changed = True
        elif mode == "remove":
            new = [e for e in arr
                   if not any(cmd_path in h.get("command", "") for h in e.get("hooks", []))]
            if len(new) != len(arr):
                changed = True
                if new:
                    hooks[ev] = new
                else:
                    hooks.pop(ev, None)
        else:
            sys.stderr.write(f"unknown mode: {mode}\n")
            sys.exit(2)

    if mode == "remove" and not hooks:
        data.pop("hooks", None)

    if changed:
        save(path, data)
        print(f"hooks {mode}: {path}")
    else:
        print(f"hooks {mode}: no-op (이미 {'있음' if mode=='add' else '없음'})")


if __name__ == "__main__":
    main()
