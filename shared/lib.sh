#!/bin/bash
# lib.sh — reversibility engine. It records every action that install performs into a manifest,
#          and uninstall precisely undoes those records in reverse order. Source-only.
#
# One manifest line = one action (TAB-separated):
#   FILE       <path>                  → file newly created by install. uninstall deletes it.
#   TREE       <path>                  → directory bundle created by install (.app/.workflow). uninstall does rm -rf.
#   BACKUP     <path> <backup>         → existing file that was overwritten. uninstall restores backup→path.
#   MKDIR      <path>                  → directory created by install. uninstall deletes it if empty.
#   GITIGNORE  <line>                  → line added to ~/.claude/.gitignore. uninstall removes it.
#   LAUNCHCTL  <label> <plist>         → bootstrapped agent. uninstall does bootout + deletes plist.
#   GITREMOTE  <name>                  → git remote that was added. uninstall removes it (only when other remotes exist).
#   NOTE       <text>                  → for logging. uninstall ignores it.

# ── manifest recording ──
manifest_init() { mkdir -p "$(dirname "$MANIFEST")"; : > "$MANIFEST"; }
record() { printf '%s\t%s\t%s\n' "$1" "${2:-}" "${3:-}" >> "$MANIFEST"; }

# ── idempotent directory creation + recording (only when we created it) ──
mk_dir() {
  local d="$1"
  [ -d "$d" ] && return 0
  mkdir -p "$d" && record MKDIR "$d"
}

# ── file install: src→dst. If dst already exists, back it up and record BACKUP; otherwise record FILE ──
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

# ── create a file by writing content directly (e.g. template-substitution output). Reads from stdin ──
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

# ── add a line to .gitignore (only if absent) + record ──
add_gitignore() {
  local line="$1" gi="$CLAUDE_DIR/.gitignore"
  [ -f "$gi" ] || { record FILE "$gi"; : > "$gi"; }
  grep -qxF "$line" "$gi" 2>/dev/null && return 0
  printf '%s\n' "$line" >> "$gi"
  record GITIGNORE "$line"
}

# ── uninstall: process the manifest in reverse order ──
manifest_revert() {
  [ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST"; return 1; }
  # Reverse the manifest portably. `tail -r` is BSD-only and fails on GNU/Linux/WSL with
  # `tail: invalid option -- 'r'`, which aborted uninstall mid-run on non-macOS clients;
  # awk reverses identically on both BSD and GNU.
  awk '{ lines[NR] = $0 } END { for (i = NR; i >= 1; i--) print lines[i] }' "$MANIFEST" | while IFS=$'\t' read -r action a b; do
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
      # HOOKS: we modified settings.json (the user's existing file) in place → surgical removal (only our entries).
      #   a=settings.json path, b=hook command (identifier = installed hook cmd path). The manage script is
      #   installed via FILE in the same manifest, and since reverse processing removes it after this HOOKS
      #   entry, it can still be called here.
      #   manage-claude-hooks.py changed to 4-arg (remove <settings> <approve_cmd> <notify_cmd>), passing the
      #   same path in two positions to remove "all of our entries containing that path" (paths are unique →
      #   the HOOKS lines recorded one each for approve/notify safely delete only their own).
      HOOKS)     [ -f "$a" ] && python3 "$RP_DIR/bin/manage-claude-hooks.py" remove "$a" "$b" "$b" >/dev/null 2>&1 \
                   && echo "  hook- $b" || true ;;
      NOTE)      : ;;
    esac
  done
}
