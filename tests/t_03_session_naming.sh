#!/usr/bin/env bash
# t_03_session_naming — verify the launcher's deterministic session name (_readable + _proj_base)
# + compare naming-scheme equivalence against the reference (claude-iterm-launch).
#
# Observation: on the --local path (MOCK_HASSESSION=0 → aqua server present), the launcher emits
#       `new-session -s <NAME>`; pull NAME out of MLOG and verify it.
# session name = "<host>_<readable15>_<sha256(fullpath)[1-5]>"  ('.'/':' → '_').
cd "$(dirname "$0")"; . ./lib.sh

LOCAL_HOST="$(hostname -s)"

# Extract the local session name the launcher built from MLOG (tmux-aqua|...|new-session|-d|-s|<NAME>|... shape)
extract_session() {
  # Pull the NAME token out of "new-session|...|-s|<NAME>".
  printf '%s\n' "$MLOG" | awk -F'|' '
    /new-session/ {
      for (i=1;i<=NF;i++) if ($i=="-s") { print $(i+1); exit }
    }'
}

# Compute the expected session name with the same rules as the launcher (independent impl for verification).
# readable: keep as-is if ASCII, otherwise use the given slug. Then cut -c1-15 and strip a trailing '-'.
# base = "<readable15>_<sha5(fullpath)>", final = "<host>_<base>" with [.:]→_.
expect_name() { # $1=fullpath  $2=readable(slug; may be omitted if basename is ASCII)
  local dir="$1" readable="$2" base name hash
  [ -z "$readable" ] && readable="$(basename "$dir")"
  name="$(printf '%s' "$readable" | cut -c1-15 | LC_ALL=C sed 's/-$//')"
  hash="$(printf '%s' "$dir" | shasum -a 256 | cut -c1-5)"
  base="${name}_${hash}"
  name="${LOCAL_HOST}_${base}_1"   # first session → _1
  printf '%s' "$(printf '%s' "$name" | tr '.:' '__')"
}

# ───────────────────────────────────────────────────────────────────
# Scenario 1 — ASCII basename → used verbatim, no translation. claude/hangul-romanize not invoked.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
ASCII_DIR="$SBX/myproj"; mkdir -p "$ASCII_DIR"
MOCK_HASSESSION=0 run_launcher --local "$ASCII_DIR"
GOT1="$(extract_session)"
EXP1="$(expect_name "$ASCII_DIR" "myproj")"

it "ascii/verbatim-name"
assert_rc "$RP_RC" 0 "ascii local launch succeeds"
assert_eq "$GOT1" "$EXP1" "session name = host_myproj_<5hex>_1"
assert_absent "$MLOG" "claude|" "ASCII → claude translation not invoked"
assert_absent "$MLOG" "hangul-romanize|" "ASCII → romanization not invoked"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# Scenario 2 — non-ASCII basename + claude present → use the claude-translated slug.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
HAN_DIR="$SBX/한글폴더"; mkdir -p "$HAN_DIR"
MOCK_HASSESSION=0 MOCK_CLAUDE_SLUG=myslug run_launcher --local "$HAN_DIR"
GOT2="$(extract_session)"
EXP2="$(expect_name "$HAN_DIR" "myslug")"

it "nonascii/claude-translate"
assert_rc "$RP_RC" 0 "non-ASCII local launch succeeds"
assert_contains "$MLOG" "claude|" "non-ASCII → claude translation invoked"
assert_contains "$GOT2" "myslug" "session name contains the claude slug"
assert_eq "$GOT2" "$EXP2" "session name = host_myslug_<5hex>_1"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# Scenario 3 — cache determinism: same RP_DIR/same dir twice → no second claude call.
# new_sandbox is not called again, so RP_DIR (=the cache) stays intact.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
HAN_DIR3="$SBX/한글폴더"; mkdir -p "$HAN_DIR3"
MOCK_HASSESSION=0 MOCK_CLAUDE_SLUG=cachedslug run_launcher --local "$HAN_DIR3"
RUN1_NAME="$(extract_session)"
it "nonascii/cache-first-call"
assert_contains "$MLOG" "claude|" "first call goes through claude translation"
# Second run — only clear MOCKLOG and rerun against the same sandbox/RP_DIR (expect a cache hit).
: > "$MOCKLOG"
MOCK_HASSESSION=0 MOCK_CLAUDE_SLUG=cachedslug run_launcher --local "$HAN_DIR3"
RUN2_NAME="$(extract_session)"
it "nonascii/cache-hit-no-reclaude"
assert_absent "$MLOG" "claude|" "cache hit → no second claude call"
assert_eq "$RUN2_NAME" "$RUN1_NAME" "session name stays stable via cache (identical across 2 runs)"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# Scenario 4 — claude translation fails (empty output) + hangul-romanize present → romanization fallback.
# Note: a local launch only proceeds if `command -v claude` succeeds (launcher L182, dies 11 otherwise).
#       So we create the "binary exists but -p translation is empty" case — that drives _readable
#       down the romanization fallback, reaching new-session so the session name is observable.
#       (A truly absent claude only matters on the remote path — the name is computed locally then injected remotely.)
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
# Overwrite the claude mock as "present but no -p output" (keeping argv logging).
{
  printf '#!/bin/bash\n'
  printf '{ printf "%%s" "$(basename "$0")"; for a in "$@"; do printf "|%%s" "$a"; done; printf "\\n"; } >> "$MOCKLOG"\n'
  printf 'exit 0\n'
} > "$MOCKBIN/claude"; chmod +x "$MOCKBIN/claude"
# The launcher's romanizer looks at $HROMANIZE=$RP_DIR/bin/hangul-romanize, not PATH (L30,L100).
# → to hit the romanization fallback, place an executable at that location.
cp "$MOCKBIN/hangul-romanize" "$RP_DIR/bin/hangul-romanize"; chmod +x "$RP_DIR/bin/hangul-romanize"
HAN_DIR4="$SBX/한글폴더"; mkdir -p "$HAN_DIR4"
MOCK_HASSESSION=0 MOCK_HROMANIZE=romanX run_launcher --local "$HAN_DIR4"
GOT4="$(extract_session)"
EXP4="$(expect_name "$HAN_DIR4" "romanX")"

it "nonascii/hangul-fallback"
assert_rc "$RP_RC" 0 "claude-translation-failure romanization fallback launch succeeds"
assert_contains "$MLOG" "claude|" "claude -p attempted (present but empty output)"
assert_contains "$GOT4" "romanX" "session name contains the romanization result"
assert_eq "$GOT4" "$EXP4" "session name = host_romanX_<5hex>_1"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# Scenario 5 — claude translation fails + hangul-romanize absent → raw basename (sanitized) fallback.
# The romanizer looks at $RP_DIR/bin/hangul-romanize, not the PATH mock (launcher L30).
# new_sandbox creates only the $RP_DIR/bin directory and lays down no file → [ -x ] fails → raw fallback.
# claude is present (so the local launch proceeds) but left with empty -p output.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
{
  printf '#!/bin/bash\n'
  printf '{ printf "%%s" "$(basename "$0")"; for a in "$@"; do printf "|%%s" "$a"; done; printf "\\n"; } >> "$MOCKLOG"\n'
  printf 'exit 0\n'
} > "$MOCKBIN/claude"; chmod +x "$MOCKBIN/claude"
HAN_DIR5="$SBX/한글폴더"; mkdir -p "$HAN_DIR5"
MOCK_HASSESSION=0 run_launcher --local "$HAN_DIR5"
GOT5="$(extract_session)"
# Fallback = raw basename "한글폴더" → after cut -c1-15 then [.:]→_ (Hangul is left intact).
EXP5="$(expect_name "$HAN_DIR5" "한글폴더")"

it "nonascii/raw-fallback"
assert_rc "$RP_RC" 0 "claude-failure + romanizer-absent → raw fallback succeeds"
assert_contains "$MLOG" "claude|" "claude -p attempted (empty output)"
assert_absent "$MLOG" "hangul-romanize|" "romanizer absent (RP_DIR/bin is empty)"
assert_eq "$GOT5" "$EXP5" "session name = host_한글폴더_<5hex>_1 (raw fallback)"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# Scenario 6 — determinism: same input dir path → identical session name even across two fresh sandboxes.
# (Even with an empty cache, the ASCII path is translation-free and deterministic, so it must match.)
# ───────────────────────────────────────────────────────────────────
DET_PATH=""   # use a fixed path so both sandboxes use the same dir path string
DET_BASENAME="detproj"

SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
DET_DIR_A="$SBX/$DET_BASENAME"; mkdir -p "$DET_DIR_A"
DET_PATH="$DET_DIR_A"   # the path includes SBX (random) — since we can't reuse the same SBX, the same path string is forced below
MOCK_HASSESSION=0 run_launcher --local "$DET_DIR_A"
DET_A="$(extract_session)"
cleanup_sandbox

# Second fresh sandbox — recreate the dir with the same absolute path string to reproduce.
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
mkdir -p "$DET_PATH"   # the previous SBX was cleaned up, but recreate with the same path string
MOCK_HASSESSION=0 run_launcher --local "$DET_PATH"
DET_B="$(extract_session)"

it "determinism/two-sandboxes"
assert_eq "$DET_B" "$DET_A" "same dir path → identical session name (two fresh sandboxes)"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# EQUIVALENCE — naming-scheme equivalence against the reference (claude-iterm-launch).
# On non-m1 hosts (gh-mac-m4, etc. here) the reference has AQUA="" so it uses plain tmux (ref line 245).
# So NAME is observable from `tmux new -s <NAME>`.
# The reference uses ~/.claude paths / a session-name cache / HROMANIZE → with HOME=$SBX, prepare mocks there.
# The reference does not read FOLDER_MAPS and computes the session name directly from PROJECT_DIR.
# ───────────────────────────────────────────────────────────────────
EQUIV_RAN=0
if [ -n "${REFERENCE_SRC:-}" ] && [ -f "${REFERENCE_SRC}" ]; then
  SBX_REMOTE_HOST="" new_sandbox
  make_all_mocks
  # Reference-specific paths: ~/.claude/{logs,session-names,bin}. The tmux/claude mocks are already in .local/bin.
  mkdir -p "$SBX/.claude/logs" "$SBX/.claude/session-names" "$SBX/.claude/bin"
  # The reference hangul-romanize is looked up in ~/.claude/bin → install it there too (irrelevant for this ASCII scenario).
  cp "$MOCKBIN/hangul-romanize" "$SBX/.claude/bin/hangul-romanize" 2>/dev/null || true
  EQ_DIR="$SBX/equivproj"; mkdir -p "$EQ_DIR"

  # New launcher local session name.
  MOCK_HASSESSION=0 run_launcher --local "$EQ_DIR"
  NEW_NAME="$(extract_session)"

  # Run the reference — forcing TARGET=2(local) takes no arg, so feed '2' on stdin.
  # run_reference supplies empty stdin, but if read fails it falls through to TARGET=1(remote).
  # The reference local branch is automatic only when LOCAL_HOST=gh-mac-m1 — our host needs '2' via read.
  # → invoke it directly and feed '2\n' on stdin.
  : > "$MOCKLOG"
  REF_OUT="$(printf '2\n' | bash "$REFERENCE_SRC" "$EQ_DIR" 2>"$SBX/ref.err")"; REF_RC=$?
  sleep 0.2
  REF_MLOG="$(cat "$MOCKLOG" 2>/dev/null)"
  # Reference plain tmux path: `tmux new -s <NAME> ...`  (tmux|new|-s|NAME)
  REF_NAME="$(printf '%s\n' "$REF_MLOG" | awk -F'|' '
    /^tmux\|/ && /\|new\|/ {
      for (i=1;i<=NF;i++) if ($i=="-s") { print $(i+1); exit }
    }')"
  EQUIV_RAN=1

  it "equivalence/reference-vs-new"
  # Both new and reference use "<host>_<readable15>_<hash5>_<N>" on the local plain-tmux path.
  # same dir → at the first session (_1) the full session name must match character for character.
  if [ -n "$REF_NAME" ]; then
    assert_eq "$NEW_NAME" "$REF_NAME" "same dir → same session name (host_slug_hash5_1) character-exact match"
  else
    # If the reference didn't reach the local branch (fell through to remote), tmux new isn't logged.
    # Even so, the new launcher's format correctness was verified above → fall back to a static-equivalence verdict.
    _fail "reference local tmux new not observed (ref_rc=$REF_RC) — falling back to static-equivalence verdict"
  fi
  cleanup_sandbox
fi

# Static equivalence: assert at the source level that the two _proj_base definitions use the same scheme.
# Both use name="$(_readable basename | cut -c1-15 | sed 's/-$//')" and
#        printf '%s_%s' name "$(...shasum -a 256 | cut -c1-5)".
it "equivalence/static-proj-base"
NEW_PB="$(sed -n '/^_proj_base() {/,/^}/p' "$LAUNCHER_SRC")"
REF_PB=""
[ -f "${REFERENCE_SRC:-/nonexist}" ] && REF_PB="$(sed -n '/^_proj_base() {/,/^}/p' "$REFERENCE_SRC")"
assert_contains "$NEW_PB" "cut -c1-15" "new _proj_base: readable capped at 15 chars"
assert_contains "$NEW_PB" "shasum -a 256 | cut -c1-5" "new _proj_base: 5hex path hash"
assert_contains "$NEW_PB" "%s_%s" "new _proj_base: underscore-separated name_hash"
if [ -n "$REF_PB" ]; then
  assert_contains "$REF_PB" "cut -c1-15" "reference _proj_base: readable capped at 15 chars"
  assert_contains "$REF_PB" "shasum -a 256 | cut -c1-5" "reference _proj_base: 5hex path hash"
  assert_contains "$REF_PB" "%s_%s" "reference _proj_base: underscore-separated name_hash"
fi

finish
