#!/bin/bash
# lib.sh — 가역성 엔진. install 이 한 모든 동작을 manifest 에 기록하고,
#          uninstall 이 그 기록을 역순으로 정확히 되돌린다.  source 전용.
#
# manifest 한 줄 = 한 동작 (TAB 구분):
#   FILE       <path>                  → install 이 새로 만든 파일. uninstall 이 삭제.
#   TREE       <path>                  → install 이 만든 디렉토리 번들(.app/.workflow). uninstall 이 rm -rf.
#   BACKUP     <path> <backup>         → 덮어쓴 기존 파일. uninstall 이 backup→path 복원.
#   MKDIR      <path>                  → install 이 만든 디렉토리. uninstall 이 비었으면 삭제.
#   GITIGNORE  <line>                  → ~/.claude/.gitignore 에 추가한 줄. uninstall 이 제거.
#   LAUNCHCTL  <label> <plist>         → bootstrap 한 agent. uninstall 이 bootout + plist 삭제.
#   GITREMOTE  <name>                  → 추가한 git remote. uninstall 이 제거(다른 remote 있을 때만).
#   NOTE       <text>                  → 로그용. uninstall 이 무시.

# ── manifest 기록 ──
manifest_init() { mkdir -p "$(dirname "$MANIFEST")"; : > "$MANIFEST"; }
record() { printf '%s\t%s\t%s\n' "$1" "${2:-}" "${3:-}" >> "$MANIFEST"; }

# ── 멱등 디렉토리 생성 + 기록(우리가 만든 경우만) ──
mk_dir() {
  local d="$1"
  [ -d "$d" ] && return 0
  mkdir -p "$d" && record MKDIR "$d"
}

# ── 파일 설치: src→dst. dst 가 이미 있으면 백업 후 BACKUP, 없으면 FILE 기록 ──
install_file() {
  local src="$1" dst="$2" mode="${3:-}"
  mk_dir "$(dirname "$dst")"
  if [ -e "$dst" ]; then
    mk_dir "$BACKUP_DIR"
    local bak="$BACKUP_DIR/$(echo "$dst" | sed 's#/#_#g').bak"
    cp -p "$dst" "$bak"
    record BACKUP "$dst" "$bak"
  else
    record FILE "$dst"
  fi
  cp "$src" "$dst"
  if [ -n "$mode" ]; then chmod "$mode" "$dst"; fi
}

# ── 내용을 직접 써서 파일 생성(템플릿 치환 결과 등). stdin 으로 받는다 ──
write_file() {
  local dst="$1" mode="${2:-}"
  mk_dir "$(dirname "$dst")"
  if [ -e "$dst" ]; then
    mk_dir "$BACKUP_DIR"
    local bak="$BACKUP_DIR/$(echo "$dst" | sed 's#/#_#g').bak"
    cp -p "$dst" "$bak"; record BACKUP "$dst" "$bak"
  else
    record FILE "$dst"
  fi
  cat > "$dst"
  if [ -n "$mode" ]; then chmod "$mode" "$dst"; fi
}

# ── .gitignore 에 줄 추가(없을 때만) + 기록 ──
add_gitignore() {
  local line="$1" gi="$CLAUDE_DIR/.gitignore"
  [ -f "$gi" ] || { record FILE "$gi"; : > "$gi"; }
  grep -qxF "$line" "$gi" 2>/dev/null && return 0
  printf '%s\n' "$line" >> "$gi"
  record GITIGNORE "$line"
}

# ── uninstall: manifest 역순 처리 ──
manifest_revert() {
  [ -f "$MANIFEST" ] || { echo "manifest 없음: $MANIFEST"; return 1; }
  # tail -r = 역순
  tail -r "$MANIFEST" | while IFS=$'\t' read -r action a b; do
    case "$action" in
      FILE)      [ -e "$a" ] && rm -f "$a" && echo "  rm   $a" ;;
      TREE)      [ -e "$a" ] && rm -rf "$a" && echo "  rm -rf $a" ;;
      BACKUP)    [ -e "$b" ] && cp -p "$b" "$a" && rm -f "$b" && echo "  restore $a" ;;
      MKDIR)     rmdir "$a" 2>/dev/null && echo "  rmdir $a" || true ;;
      GITIGNORE) local gi="$CLAUDE_DIR/.gitignore"
                 if [ -f "$gi" ]; then
                   { grep -vxF "$a" "$gi" || true; } > "$gi.tmp" && mv "$gi.tmp" "$gi" && echo "  gitignore- $a"
                 fi ;;
      LAUNCHCTL) launchctl bootout "gui/$(id -u)/$a" 2>/dev/null || true
                 [ -n "$b" ] && [ -e "$b" ] && rm -f "$b"; echo "  bootout $a" ;;
      GITREMOTE) ( cd "$CLAUDE_DIR" && git remote remove "$a" 2>/dev/null ) && echo "  remote- $a" || true ;;
      # HOOKS: settings.json(기존 사용자 파일)을 in-place 수정한 것 → surgical 제거(우리 엔트리만).
      #   a=settings.json 경로, b=훅 command(식별자=설치된 hook cmd 경로). manage 스크립트는 같은
      #   manifest 의 FILE 로 설치돼 있고 역순 처리상 이 HOOKS 보다 뒤에 제거되므로 여기서 호출 가능.
      #   manage-claude-hooks.py 가 4-arg(remove <settings> <approve_cmd> <notify_cmd>) 로 바뀌어
      #   같은 경로를 두 위치에 넣어 "그 경로를 포함한 우리 엔트리 전부"를 제거한다(경로별로 고유 →
      #   approve/notify 각각 한 줄씩 기록된 HOOKS 가 안전하게 자기 것만 지운다).
      HOOKS)     [ -f "$a" ] && python3 "$RP_DIR/bin/manage-claude-hooks.py" remove "$a" "$b" "$b" >/dev/null 2>&1 \
                   && echo "  hook- $b" || true ;;
      NOTE)      : ;;
    esac
  done
}
