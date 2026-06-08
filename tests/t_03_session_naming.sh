#!/usr/bin/env bash
# t_03_session_naming — 런처의 결정론적 세션명(_readable + _proj_base) 검증
# + 레퍼런스(claude-iterm-launch)와의 명명 스킴 동일성(equivalence) 비교.
#
# 관측: --local 경로(MOCK_HASSESSION=0 → aqua 서버 있음)에서 런처가 내는
#       `new-session -s <NAME>` 의 NAME 을 MLOG 에서 뽑아 검증.
# 세션명 = "<host>_<readable15>_<sha256(fullpath)[1-5]>"  ('.'/':' → '_').
cd "$(dirname "$0")"; . ./lib.sh

LOCAL_HOST="$(hostname -s)"

# MLOG 에서 런처가 만든 로컬 세션명 추출 (tmux-aqua|...|new-session|-d|-s|<NAME>|... 형태)
extract_session() {
  # "new-session|...|-s|<NAME>" 의 NAME 토큰을 뽑는다.
  printf '%s\n' "$MLOG" | awk -F'|' '
    /new-session/ {
      for (i=1;i<=NF;i++) if ($i=="-s") { print $(i+1); exit }
    }'
}

# 런처와 동일 규칙으로 기대 세션명을 계산 (검증용 독립 구현).
# readable: ASCII 면 그대로, 아니면 주어진 slug 사용. 그다음 cut -c1-15, trailing '-' 제거.
# base = "<readable15>_<sha5(fullpath)>", 최종 = "<host>_<base>" 의 [.:]→_.
expect_name() { # $1=fullpath  $2=readable(slug; ASCII basename 이면 생략 가능)
  local dir="$1" readable="$2" base name hash
  [ -z "$readable" ] && readable="$(basename "$dir")"
  name="$(printf '%s' "$readable" | cut -c1-15 | LC_ALL=C sed 's/-$//')"
  hash="$(printf '%s' "$dir" | shasum -a 256 | cut -c1-5)"
  base="${name}_${hash}"
  name="${LOCAL_HOST}_${base}_1"   # 첫 세션 → _1
  printf '%s' "$(printf '%s' "$name" | tr '.:' '__')"
}

# ───────────────────────────────────────────────────────────────────
# 시나리오 1 — ASCII basename → 번역 없이 그대로. claude/hangul-romanize 미호출.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
ASCII_DIR="$SBX/myproj"; mkdir -p "$ASCII_DIR"
MOCK_HASSESSION=0 run_launcher --local "$ASCII_DIR"
GOT1="$(extract_session)"
EXP1="$(expect_name "$ASCII_DIR" "myproj")"

it "ascii/verbatim-name"
assert_rc "$RP_RC" 0 "ascii local launch 성공"
assert_eq "$GOT1" "$EXP1" "세션명 = host_myproj_<5hex>_1"
assert_absent "$MLOG" "claude|" "ASCII 면 claude 번역 미호출"
assert_absent "$MLOG" "hangul-romanize|" "ASCII 면 음역 미호출"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# 시나리오 2 — 비ASCII basename + claude 존재 → claude 번역 슬러그 사용.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
HAN_DIR="$SBX/한글폴더"; mkdir -p "$HAN_DIR"
MOCK_HASSESSION=0 MOCK_CLAUDE_SLUG=myslug run_launcher --local "$HAN_DIR"
GOT2="$(extract_session)"
EXP2="$(expect_name "$HAN_DIR" "myslug")"

it "nonascii/claude-translate"
assert_rc "$RP_RC" 0 "비ASCII local launch 성공"
assert_contains "$MLOG" "claude|" "비ASCII 면 claude 번역 호출"
assert_contains "$GOT2" "myslug" "세션명에 claude 슬러그 포함"
assert_eq "$GOT2" "$EXP2" "세션명 = host_myslug_<5hex>_1"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# 시나리오 3 — 캐시 결정론: 같은 RP_DIR/같은 dir 2회 → 2번째는 claude 재호출 없음.
# new_sandbox 를 다시 부르지 않으므로 RP_DIR(=캐시) 가 그대로 유지된다.
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
HAN_DIR3="$SBX/한글폴더"; mkdir -p "$HAN_DIR3"
MOCK_HASSESSION=0 MOCK_CLAUDE_SLUG=cachedslug run_launcher --local "$HAN_DIR3"
RUN1_NAME="$(extract_session)"
it "nonascii/cache-first-call"
assert_contains "$MLOG" "claude|" "첫 호출은 claude 번역"
# 2번째 실행 — MOCKLOG 만 비우고 같은 샌드박스/RP_DIR 로 재실행(캐시 hit 기대).
: > "$MOCKLOG"
MOCK_HASSESSION=0 MOCK_CLAUDE_SLUG=cachedslug run_launcher --local "$HAN_DIR3"
RUN2_NAME="$(extract_session)"
it "nonascii/cache-hit-no-reclaude"
assert_absent "$MLOG" "claude|" "캐시 hit → claude 재호출 없음"
assert_eq "$RUN2_NAME" "$RUN1_NAME" "캐시로 세션명 안정(2회 동일)"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# 시나리오 4 — claude 번역 실패(빈 출력) + hangul-romanize 존재 → 음역 폴백.
# 주의: 로컬 launch 는 `command -v claude` 가 성공해야 진행한다(런처 L182, 실패 시 die 11).
#       즉 "바이너리는 있되 -p 번역이 빈값"인 상황을 만든다 — 그래야 _readable 이
#       음역 폴백으로 내려가고, new-session 까지 도달해 세션명을 관측할 수 있다.
#       (claude 진짜 부재는 원격 경로에서만 의미 — 이름은 로컬계산 후 원격에 주입되므로.)
# ───────────────────────────────────────────────────────────────────
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
# claude mock 을 "있지만 -p 출력 없음"으로 덮어쓴다(argv 로깅 유지).
{
  printf '#!/bin/bash\n'
  printf '{ printf "%%s" "$(basename "$0")"; for a in "$@"; do printf "|%%s" "$a"; done; printf "\\n"; } >> "$MOCKLOG"\n'
  printf 'exit 0\n'
} > "$MOCKBIN/claude"; chmod +x "$MOCKBIN/claude"
# 런처의 음역기는 PATH 가 아니라 $HROMANIZE=$RP_DIR/bin/hangul-romanize 를 본다(L30,L100).
# → 음역 폴백을 타게 하려면 그 위치에 실행파일을 깐다.
cp "$MOCKBIN/hangul-romanize" "$RP_DIR/bin/hangul-romanize"; chmod +x "$RP_DIR/bin/hangul-romanize"
HAN_DIR4="$SBX/한글폴더"; mkdir -p "$HAN_DIR4"
MOCK_HASSESSION=0 MOCK_HROMANIZE=romanX run_launcher --local "$HAN_DIR4"
GOT4="$(extract_session)"
EXP4="$(expect_name "$HAN_DIR4" "romanX")"

it "nonascii/hangul-fallback"
assert_rc "$RP_RC" 0 "claude 번역실패 음역 폴백 launch 성공"
assert_contains "$MLOG" "claude|" "claude -p 시도(있으나 빈출력)"
assert_contains "$GOT4" "romanX" "세션명에 음역 결과 포함"
assert_eq "$GOT4" "$EXP4" "세션명 = host_romanX_<5hex>_1"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# 시나리오 5 — claude 번역 실패 + hangul-romanize 부재 → 원본 basename(sanitized) 폴백.
# 음역기는 PATH mock 이 아니라 $RP_DIR/bin/hangul-romanize 를 본다(런처 L30).
# new_sandbox 는 $RP_DIR/bin 디렉터리만 만들고 파일은 안 깐다 → [ -x ] 실패 → 원본 폴백.
# claude 는 (로컬 launch 진행 위해) 있되 -p 빈출력으로 둔다.
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
# 폴백 = 원본 basename "한글폴더" → cut -c1-15 후 [.:]→_ (한글은 그대로 남음).
EXP5="$(expect_name "$HAN_DIR5" "한글폴더")"

it "nonascii/raw-fallback"
assert_rc "$RP_RC" 0 "claude실패+음역부재 → 원본 폴백 성공"
assert_contains "$MLOG" "claude|" "claude -p 시도(빈출력)"
assert_absent "$MLOG" "hangul-romanize|" "음역기 부재(RP_DIR/bin 비어있음)"
assert_eq "$GOT5" "$EXP5" "세션명 = host_한글폴더_<5hex>_1 (원본 폴백)"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# 시나리오 6 — 결정론: 같은 입력 dir 경로 → 신선한 샌드박스 2개에서도 동일 세션명.
# (캐시가 비어도 ASCII 경로는 번역 없이 결정론이라 동일해야 함.)
# ───────────────────────────────────────────────────────────────────
DET_PATH=""   # 두 샌드박스에서 동일한 dir 경로 문자열을 쓰려고 고정 경로 사용
DET_BASENAME="detproj"

SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
DET_DIR_A="$SBX/$DET_BASENAME"; mkdir -p "$DET_DIR_A"
DET_PATH="$DET_DIR_A"   # 경로엔 SBX(랜덤) 포함 — 같은 SBX 를 못 쓰므로 아래선 같은 경로 문자열을 강제 생성
MOCK_HASSESSION=0 run_launcher --local "$DET_DIR_A"
DET_A="$(extract_session)"
cleanup_sandbox

# 두 번째 신선한 샌드박스 — 동일한 절대경로 문자열로 dir 을 만들어 재현.
SBX_REMOTE_HOST="" new_sandbox
make_all_mocks
mkdir -p "$DET_PATH"   # 이전 SBX 는 cleanup 됐지만 동일 경로 문자열로 다시 생성
MOCK_HASSESSION=0 run_launcher --local "$DET_PATH"
DET_B="$(extract_session)"

it "determinism/two-sandboxes"
assert_eq "$DET_B" "$DET_A" "같은 dir 경로 → 동일 세션명(신선 샌드박스 2개)"
cleanup_sandbox

# ───────────────────────────────────────────────────────────────────
# EQUIVALENCE — 레퍼런스(claude-iterm-launch)와 명명 스킴 동일성.
# 레퍼런스는 non-m1 호스트(여기 gh-mac-m4 등)에선 AQUA="" 라 일반 tmux 를 쓴다(ref line 245).
# 따라서 `tmux new -s <NAME>` 에서 NAME 을 관측 가능.
# 레퍼런스는 ~/.claude 경로/세션-네임 캐시/HROMANIZE 를 쓴다 → HOME=$SBX 라 그쪽에 mock 준비.
# 레퍼런스는 FOLDER_MAPS 를 안 읽고 PROJECT_DIR 로 바로 세션명 계산.
# ───────────────────────────────────────────────────────────────────
EQUIV_RAN=0
if [ -n "${REFERENCE_SRC:-}" ] && [ -f "${REFERENCE_SRC}" ]; then
  SBX_REMOTE_HOST="" new_sandbox
  make_all_mocks
  # 레퍼런스 전용 경로: ~/.claude/{logs,session-names,bin}. tmux/claude mock 은 이미 .local/bin.
  mkdir -p "$SBX/.claude/logs" "$SBX/.claude/session-names" "$SBX/.claude/bin"
  # 레퍼런스 hangul-romanize 는 ~/.claude/bin 에서 찾음 → 거기에도 깔아 둠(이 시나리오는 ASCII 라 무관).
  cp "$MOCKBIN/hangul-romanize" "$SBX/.claude/bin/hangul-romanize" 2>/dev/null || true
  EQ_DIR="$SBX/equivproj"; mkdir -p "$EQ_DIR"

  # 신규 런처 로컬 세션명.
  MOCK_HASSESSION=0 run_launcher --local "$EQ_DIR"
  NEW_NAME="$(extract_session)"

  # 레퍼런스 실행 — TARGET=2(local) 강제는 인자가 없으므로 stdin 으로 '2' 입력.
  # run_reference 는 빈 stdin 을 주지만 read 가 실패하면 TARGET=1(remote) 로 빠진다.
  # 레퍼런스 로컬 분기는 LOCAL_HOST=gh-mac-m1 일 때만 자동 — 우리 호스트는 read 로 '2' 필요.
  # → 직접 호출하며 '2\n' 를 stdin 으로 준다.
  : > "$MOCKLOG"
  REF_OUT="$(printf '2\n' | bash "$REFERENCE_SRC" "$EQ_DIR" 2>"$SBX/ref.err")"; REF_RC=$?
  sleep 0.2
  REF_MLOG="$(cat "$MOCKLOG" 2>/dev/null)"
  # 레퍼런스 일반 tmux 경로: `tmux new -s <NAME> ...`  (tmux|new|-s|NAME)
  REF_NAME="$(printf '%s\n' "$REF_MLOG" | awk -F'|' '
    /^tmux\|/ && /\|new\|/ {
      for (i=1;i<=NF;i++) if ($i=="-s") { print $(i+1); exit }
    }')"
  EQUIV_RAN=1

  it "equivalence/reference-vs-new"
  # 신규/레퍼런스 둘 다 로컬 일반-tmux 경로에서 "<host>_<readable15>_<hash5>_<N>" 를 쓴다.
  # 동일 dir → 첫 세션(_1)에서 풀 세션명이 글자 그대로 일치해야 한다.
  if [ -n "$REF_NAME" ]; then
    assert_eq "$NEW_NAME" "$REF_NAME" "동일 dir → 동일 세션명(host_slug_hash5_1) 글자단위 일치"
  else
    # 레퍼런스가 로컬 분기로 못 갔으면(remote 로 빠짐) tmux new 가 안 찍힘.
    # 그래도 신규 런처의 format 정확성은 위에서 검증됨 → 정적 동일성으로 대체 판정.
    _fail "reference local tmux new 미관측 (ref_rc=$REF_RC) — 정적 동일성으로 대체 판정"
  fi
  cleanup_sandbox
fi

# 정적(static) 동일성: 두 _proj_base 정의가 동일 스킴인지 소스 레벨로 단언.
# 둘 다 name="$(_readable basename | cut -c1-15 | sed 's/-$//')" 와
#        printf '%s_%s' name "$(...shasum -a 256 | cut -c1-5)" 를 쓴다.
it "equivalence/static-proj-base"
NEW_PB="$(sed -n '/^_proj_base() {/,/^}/p' "$LAUNCHER_SRC")"
REF_PB=""
[ -f "${REFERENCE_SRC:-/nonexist}" ] && REF_PB="$(sed -n '/^_proj_base() {/,/^}/p' "$REFERENCE_SRC")"
assert_contains "$NEW_PB" "cut -c1-15" "신규 _proj_base: readable 15자 제한"
assert_contains "$NEW_PB" "shasum -a 256 | cut -c1-5" "신규 _proj_base: 5hex 경로해시"
assert_contains "$NEW_PB" "%s_%s" "신규 _proj_base: 언더바 구분 name_hash"
if [ -n "$REF_PB" ]; then
  assert_contains "$REF_PB" "cut -c1-15" "레퍼런스 _proj_base: readable 15자 제한"
  assert_contains "$REF_PB" "shasum -a 256 | cut -c1-5" "레퍼런스 _proj_base: 5hex 경로해시"
  assert_contains "$REF_PB" "%s_%s" "레퍼런스 _proj_base: 언더바 구분 name_hash"
fi

finish
