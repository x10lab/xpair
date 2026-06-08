#!/usr/bin/env bash
# t_02_mapping — map_to_host 경로 매핑 검증.
# map_to_host 는 내부 함수이므로 원격 setup 스크립트($SSH_CAPTURE)의
# "cd '<HOST_DIR>'" 줄로 간접 관측.
#
# NOTE: claude-iterm-launch(레퍼런스)에는 경로 매핑이 없었음 — 동일 경로 가정.
#       map_to_host 는 remote-pair-launch 의 신규 기능(의도적 divergence).
#       레퍼런스와의 동일성 비교 테스트는 불필요.
cd "$(dirname "$0")"; . ./lib.sh

# ────────────────────────────────────────────────────────────────────────────
# 시나리오 1: FOLDER_MAPS 미설정 → identity (HOST_DIR == PROJECT_DIR)
# ────────────────────────────────────────────────────────────────────────────
SBX_FOLDER_MAPS="" new_sandbox
CLIENT_DIR="$SBX/myproject"
mkdir -p "$CLIENT_DIR"
make_all_mocks
MOCK_DIRCHECK=__YES__ run_launcher --remote "$CLIENT_DIR"

it "mapping/identity-no-maps"
assert_rc "$RP_RC" 0 "no FOLDER_MAPS → remote launch 성공"
assert_contains "$(cat "$SSH_CAPTURE")" "cd '${CLIENT_DIR}'" \
  "HOST_DIR == CLIENT_DIR (identity mapping)"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 시나리오 2: 단일 맵 clientroot::hostroot → 하위경로 보존
#   FOLDER_MAPS="$SBX/proj::/host/proj"
#   입력: $SBX/proj/sub  →  기대: /host/proj/sub
# ────────────────────────────────────────────────────────────────────────────
# new_sandbox 를 한 번만 호출하고, 그 후 client.env 를 직접 패치한다.
new_sandbox
CLIENT_ROOT="$SBX/proj"
CLIENT_SUBDIR="$CLIENT_ROOT/sub"
mkdir -p "$CLIENT_SUBDIR"
# client.env 에 매핑 주입 (new_sandbox 가 FOLDER_MAPS="" 로 썼으므로 덮어씀)
printf 'REMOTE_HOST=test-host\nFOLDER_MAPS=%s::/host/proj\n' "$CLIENT_ROOT" > "$RP_DIR/client.env"
make_all_mocks
MOCK_DIRCHECK=__YES__ run_launcher --remote "$CLIENT_SUBDIR"

it "mapping/single-map-subpath"
assert_rc "$RP_RC" 0 "단일 맵 → remote launch 성공"
assert_contains "$(cat "$SSH_CAPTURE")" "cd '/host/proj/sub'" \
  "prefix 치환 후 subpath 보존 → /host/proj/sub"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 시나리오 3: longest-prefix 우선 — 겹치는 두 맵
#   FOLDER_MAPS="$SBX/a::/x;$SBX/a/b::/y"
#   입력: $SBX/a/b/c  →  기대: /y/c  (짧은 /a 아닌 긴 /a/b 가 이김)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
NESTED_DIR="$SBX/a/b/c"
mkdir -p "$NESTED_DIR"
# FOLDER_MAPS 에 세미콜론 포함 — 쉘이 ; 를 커맨드 구분자로 해석하지 않도록 따옴표로 감쌈
printf 'REMOTE_HOST=test-host\nFOLDER_MAPS="%s/a::/x;%s/a/b::/y"\n' "$SBX" "$SBX" > "$RP_DIR/client.env"
make_all_mocks
MOCK_DIRCHECK=__YES__ run_launcher --remote "$NESTED_DIR"

it "mapping/longest-prefix-wins"
assert_rc "$RP_RC" 0 "longest-prefix → remote launch 성공"
assert_contains "$(cat "$SSH_CAPTURE")" "cd '/y/c'" \
  "긴 prefix $SBX/a/b::/y 가 짧은 $SBX/a::/x 를 이김 → /y/c"

cleanup_sandbox

# ────────────────────────────────────────────────────────────────────────────
# 시나리오 4: '::' 없는 항목은 identity 매핑 (host == client)
#   FOLDER_MAPS="$SBX/plain" (separator 없음)
#   입력: $SBX/plain  →  기대: $SBX/plain (동일경로)
# ────────────────────────────────────────────────────────────────────────────
new_sandbox
PLAIN_DIR="$SBX/plain"
mkdir -p "$PLAIN_DIR"
printf 'REMOTE_HOST=test-host\nFOLDER_MAPS=%s\n' "$PLAIN_DIR" > "$RP_DIR/client.env"
make_all_mocks
MOCK_DIRCHECK=__YES__ run_launcher --remote "$PLAIN_DIR"

it "mapping/no-separator-identity"
assert_rc "$RP_RC" 0 "'::' 없는 항목 → remote launch 성공"
assert_contains "$(cat "$SSH_CAPTURE")" "cd '${PLAIN_DIR}'" \
  "'::' 없는 항목은 identity → HOST_DIR == CLIENT_DIR"

cleanup_sandbox

finish
