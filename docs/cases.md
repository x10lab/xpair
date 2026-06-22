# Userflow Case Expansion Log

## Rules

- 유저플로우는 Xpair 기준으로 작성한다.
- 코드 내부 entrypoint가 아니라 사용자가 Xpair를 켠 이후 할 수 있는 행동을 단위로 삼는다.
- ID 한 글자는 하나의 판단/분기다.
- `0`은 terminal 플래그다. ID가 `0`으로 끝나면 다음 depth는 없다.
- `000` 같은 패딩 ID는 만들지 않는다.
- 중간 prefix도 반드시 문서에 쓴다. leaf만 쓰지 않는다.
- 중간 prefix는 해당 depth까지의 공통 동작/상태를 설명하고, 하위 ID는 그 다음 분기만 설명한다.
- Xpair보다 XpairHost를 먼저 실행한 경우도 접근 가능한 사용자 flow로 본다.
- Host-first flow는 권한/엔진 완료 후 클라이언트 대기 상태로 갈 수 있고, 클라이언트가 없으면 대기/안내 상태에서 멈춘다.
- 각 에이전트는 최대 depth 3을 탐색하고, terminal 또는 route가 나오면 즉시 멈춘다.
- 각 wave의 모든 subagent가 끝나야 다음 wave를 시작한다.

## Step 1 - root

산출 파일: `docs/subagents/root.md`

### intermediate prefix

| ID | 내용 | 다음 |
|---|---|---|
| `1` | 사용자가 Xpair IDE 앱을 실행함 | `10`, `11`, `12`, `13` |
| `11` | Xpair IDE가 첫 실행 온보딩을 표시함 | `110`, `111`, `112` |
| `12` | Xpair IDE가 기존 설정으로 workbench를 표시함 | `121`, `122`, `123`, `124` |
| `13` | 사용자가 Xpair IDE 안에서 표면/기능을 선택함 | `130`, `131`, `132`, `133` |
| `2` | 사용자가 Finder Quick Action으로 Xpair를 실행함 | `20`, `21` |
| `21` | Finder Quick Action 입력이 실행 가능한 선택으로 들어옴 | `210`, `211`, `212` |
| `3` | 사용자가 `xpair` CLI를 실행함 | `30`, `31` |
| `31` | 사용자가 `xpair launch` 흐름으로 들어감 | `311`, `312`, `313`, `314` |
| `4` | 사용자가 Xpair보다 XpairHost를 먼저 실행하거나 조작함 | `40`, `41`, `42` |
| `41` | XpairHost가 먼저 열려 host onboarding이 표시됨 | `410`, `411`, `412` |
| `42` | XpairHost가 준비된 뒤 클라이언트 없이 대기하거나 메뉴를 조작함 | `421`, `422`, `423` |

### terminal / route

| ID | 내용 | 플래그 |
|---|---|---|
| `0` | 사용자가 Xpair를 실행하지 않음 | terminate |
| `10` | 사용자가 Xpair를 실행했지만 앱 실행 자체가 불가함 | terminate |
| `110` | 첫 실행 온보딩 창을 완료 전 닫음 | terminate |
| `130` | Xpair 범위 밖의 VSCodium 기본 표면에 접근 시도 | terminate |
| `20` | Finder Quick Action을 잘못된 선택/입력으로 실행 | terminate |
| `210` | Finder Quick Action을 GUI가 처리할 수 없는 unmapped 상태로 실행 | terminate |
| `30` | `xpair` CLI를 잘못된 명령/옵션/경로로 실행 | terminate |
| `40` | 사용자가 XpairHost를 실행하지 못함 | terminate |
| `410` | Host onboarding을 닫아 권한/설정을 완료하지 않음 | terminate |

### Step 2 실행 대상

| ID | 내용 | 파일 |
|---|---|---|
| `111` | 첫 실행 온보딩에서 사용자가 host discovery/setup 흐름으로 진행 | `docs/subagents/111.md` |
| `112` | 첫 실행 온보딩에서 사용자가 manual host/connect 흐름으로 진행 | `docs/subagents/112.md` |
| `121` | 이미 설정된 Xpair workbench를 열었지만 usable host가 없음 | `docs/subagents/121.md` |
| `122` | 이미 설정된 Xpair workbench를 열고 reachable host가 있으나 세션 없음 | `docs/subagents/122.md` |
| `123` | 이미 설정된 Xpair workbench를 열고 reachable host와 기존 세션이 있음 | `docs/subagents/123.md` |
| `124` | Xpair 안에서 setup again/force onboarding 흐름으로 진입 | `docs/subagents/124.md` |
| `131` | Xpair Sessions 표면을 사용자가 엶 | `docs/subagents/131.md` |
| `132` | Xpair Remote Desktop 표면을 사용자가 엶 | `docs/subagents/132.md` |
| `133` | Xpair Browser/Add Root/Settings 표면을 사용자가 엶 | `docs/subagents/133.md` |
| `211` | Finder Quick Action을 mapped folder에서 실행 | `docs/subagents/211.md` |
| `212` | Finder Quick Action을 stale mapping 또는 unreachable host 상태에서 실행 | `docs/subagents/212.md` |
| `311` | `xpair launch`를 local/self-host target으로 실행 | `docs/subagents/311.md` |
| `312` | `xpair launch`를 mapped remote target으로 실행 | `docs/subagents/312.md` |
| `313` | `xpair launch`를 unmapped folder에서 interactive mapping/create 흐름으로 실행 | `docs/subagents/313.md` |
| `314` | `xpair launch`에서 SSH/auth/host reachability 실패 흐름으로 진입 | `docs/subagents/314.md` |
| `411` | Host onboarding에서 권한/엔진 설정을 진행 | `docs/subagents/411.md` |
| `412` | Host onboarding에서 Connect/Done 단계까지 진행 | `docs/subagents/412.md` |
| `421` | Host가 준비된 상태에서 XpairHost 메뉴를 조작 | `docs/subagents/421.md` |
| `422` | Host 준비 후 사용자가 Xpair 클라이언트를 열어 연결 시도 | `docs/subagents/422.md` |
| `423` | Host가 준비됐지만 연결된 Xpair 클라이언트가 없음 | `docs/subagents/423.md` |

## Step 2 결과

완료 파일:

| ID | 파일 |
|---|---|
| `111` | `docs/subagents/111.md` |
| `112` | `docs/subagents/112.md` |
| `121` | `docs/subagents/121.md` |
| `122` | `docs/subagents/122.md` |
| `123` | `docs/subagents/123.md` |
| `124` | `docs/subagents/124.md` |
| `131` | `docs/subagents/131.md` |
| `132` | `docs/subagents/132.md` |
| `133` | `docs/subagents/133.md` |
| `211` | `docs/subagents/211.md` |
| `212` | `docs/subagents/212.md` |
| `311` | `docs/subagents/311.md` |
| `312` | `docs/subagents/312.md` |
| `313` | `docs/subagents/313.md` |
| `314` | `docs/subagents/314.md` |
| `411` | `docs/subagents/411.md` |
| `412` | `docs/subagents/412.md` |
| `421` | `docs/subagents/421.md` |
| `422` | `docs/subagents/422.md` |
| `423` | `docs/subagents/423.md` |

교정:

| 항목 | 조치 |
|---|---|
| `420` | `0` suffix terminal 규칙 위반이라 `423`으로 이동 |
| `31230` | non-terminal `0` suffix라 `31233`으로 이동 |
| 기타 `0` suffix route/continue | nonzero leaf ID로 재번호화 |

검증:

| 항목 | 결과 |
|---|---|
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |

## Step 3 Batch 4 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실제 실행 단위 | 10개 + 10개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `121531` | `docs/subagents/121531.md` |
| `121721` | `docs/subagents/121721.md` |
| `122311` | `docs/subagents/122311.md` |
| `122412` | `docs/subagents/122412.md` |
| `122511` | `docs/subagents/122511.md` |
| `123111` | `docs/subagents/123111.md` |
| `123411` | `docs/subagents/123411.md` |
| `123431` | `docs/subagents/123431.md` |
| `123432` | `docs/subagents/123432.md` |
| `123433` | `docs/subagents/123433.md` |
| `131111` | `docs/subagents/131111.md` |
| `131121` | `docs/subagents/131121.md` |
| `131211` | `docs/subagents/131211.md` |
| `131311` | `docs/subagents/131311.md` |
| `131621` | `docs/subagents/131621.md` |
| `131631` | `docs/subagents/131631.md` |
| `132122` | `docs/subagents/132122.md` |
| `132211` | `docs/subagents/132211.md` |
| `132311` | `docs/subagents/132311.md` |
| `132321` | `docs/subagents/132321.md` |

교정:

| 항목 | 조치 |
|---|---|
| `123411110` | `0` suffix terminal 규칙 위반이라 `123411116`으로 이동 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 20 |
| row 수 | 402 |
| next leaf 수 | 60 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |

## Step 3 Batch 5 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `132322` | `docs/subagents/132322.md` |
| `132331` | `docs/subagents/132331.md` |
| `132332` | `docs/subagents/132332.md` |
| `132532` | `docs/subagents/132532.md` |
| `132712` | `docs/subagents/132712.md` |
| `133111` | `docs/subagents/133111.md` |
| `133332` | `docs/subagents/133332.md` |
| `133413` | `docs/subagents/133413.md` |
| `133521` | `docs/subagents/133521.md` |
| `133533` | `docs/subagents/133533.md` |
| `211111` | `docs/subagents/211111.md` |
| `211211` | `docs/subagents/211211.md` |
| `211221` | `docs/subagents/211221.md` |
| `211222` | `docs/subagents/211222.md` |
| `211311` | `docs/subagents/211311.md` |
| `211412` | `docs/subagents/211412.md` |
| `211421` | `docs/subagents/211421.md` |
| `211422` | `docs/subagents/211422.md` |
| `211431` | `docs/subagents/211431.md` |
| `212512` | `docs/subagents/212512.md` |

교정:

| 항목 | 조치 |
|---|---|
| 없음 | batch 5 산출 후 규칙 위반 없음 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 20 |
| row 수 | 499 |
| next leaf 수 | 52 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |

## Step 3 Batch 6 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `312111` | `docs/subagents/312111.md` |
| `312211` | `docs/subagents/312211.md` |
| `312311` | `docs/subagents/312311.md` |
| `312321` | `docs/subagents/312321.md` |
| `312333` | `docs/subagents/312333.md` |
| `312411` | `docs/subagents/312411.md` |
| `312421` | `docs/subagents/312421.md` |
| `314413` | `docs/subagents/314413.md` |
| `411211` | `docs/subagents/411211.md` |
| `411213` | `docs/subagents/411213.md` |
| `411221` | `docs/subagents/411221.md` |
| `411223` | `docs/subagents/411223.md` |
| `411231` | `docs/subagents/411231.md` |
| `411241` | `docs/subagents/411241.md` |
| `411242` | `docs/subagents/411242.md` |
| `411332` | `docs/subagents/411332.md` |
| `411342` | `docs/subagents/411342.md` |
| `412121` | `docs/subagents/412121.md` |
| `412122` | `docs/subagents/412122.md` |
| `412123` | `docs/subagents/412123.md` |

교정:

| 항목 | 조치 |
|---|---|
| `41121110` | `0` suffix terminal 규칙 위반이라 `41121114`로 이동 |
| `411241110` | `0` suffix terminal 규칙 위반이라 `411241114`로 이동 |
| `411242` | `다음 실행 ID`를 numbered list에서 bullet list로 교정 |
| `411332` | `다음 실행 ID`를 numbered list에서 bullet list로 교정 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 20 |
| row 수 | 519 |
| next leaf 수 | 64 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |

## Step 3 Batch 3 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실제 실행 단위 | 10개 + 10개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `112145` | `docs/subagents/112145.md` |
| `112146` | `docs/subagents/112146.md` |
| `112221` | `docs/subagents/112221.md` |
| `112241` | `docs/subagents/112241.md` |
| `112242` | `docs/subagents/112242.md` |
| `112245` | `docs/subagents/112245.md` |
| `112246` | `docs/subagents/112246.md` |
| `112321` | `docs/subagents/112321.md` |
| `112341` | `docs/subagents/112341.md` |
| `112342` | `docs/subagents/112342.md` |
| `112345` | `docs/subagents/112345.md` |
| `112346` | `docs/subagents/112346.md` |
| `112421` | `docs/subagents/112421.md` |
| `112441` | `docs/subagents/112441.md` |
| `112442` | `docs/subagents/112442.md` |
| `112445` | `docs/subagents/112445.md` |
| `112446` | `docs/subagents/112446.md` |
| `121332` | `docs/subagents/121332.md` |
| `121341` | `docs/subagents/121341.md` |
| `121521` | `docs/subagents/121521.md` |

교정:

| 항목 | 조치 |
|---|---|
| 없음 | batch 3 산출 후 규칙 위반 없음 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 20 |
| row 수 | 509 |
| next leaf 수 | 62 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |

## Step 3 Batch 2 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `111128` | `docs/subagents/111128.md` |
| `111131` | `docs/subagents/111131.md` |
| `111132` | `docs/subagents/111132.md` |
| `111133` | `docs/subagents/111133.md` |
| `111134` | `docs/subagents/111134.md` |
| `111135` | `docs/subagents/111135.md` |
| `111136` | `docs/subagents/111136.md` |
| `111137` | `docs/subagents/111137.md` |
| `111138` | `docs/subagents/111138.md` |
| `111141` | `docs/subagents/111141.md` |
| `111142` | `docs/subagents/111142.md` |
| `111143` | `docs/subagents/111143.md` |
| `111144` | `docs/subagents/111144.md` |
| `111145` | `docs/subagents/111145.md` |
| `111146` | `docs/subagents/111146.md` |
| `111147` | `docs/subagents/111147.md` |
| `111148` | `docs/subagents/111148.md` |
| `112121` | `docs/subagents/112121.md` |
| `112141` | `docs/subagents/112141.md` |
| `112142` | `docs/subagents/112142.md` |

교정:

| 항목 | 조치 |
|---|---|
| `112121` | `다음 실행 ID`에 남은 비-leaf `11212111` 제거 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 20 |
| row 수 | 504 |
| next leaf 수 | 72 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |
| Step 3 leaf frontier | 133개 |

## Step 3 실행 대상

| ID | 파일 |
|---|---|
| `12211` | `docs/subagents/12211.md` |
| `31133` | `docs/subagents/31133.md` |
| `31134` | `docs/subagents/31134.md` |
| `31135` | `docs/subagents/31135.md` |
| `31141` | `docs/subagents/31141.md` |
| `31142` | `docs/subagents/31142.md` |
| `31143` | `docs/subagents/31143.md` |
| `42231` | `docs/subagents/42231.md` |
| `111111` | `docs/subagents/111111.md` |
| `111112` | `docs/subagents/111112.md` |
| `111113` | `docs/subagents/111113.md` |
| `111114` | `docs/subagents/111114.md` |
| `111115` | `docs/subagents/111115.md` |
| `111116` | `docs/subagents/111116.md` |
| `111117` | `docs/subagents/111117.md` |
| `111118` | `docs/subagents/111118.md` |
| `111121` | `docs/subagents/111121.md` |
| `111122` | `docs/subagents/111122.md` |
| `111123` | `docs/subagents/111123.md` |
| `111124` | `docs/subagents/111124.md` |
| `111125` | `docs/subagents/111125.md` |
| `111126` | `docs/subagents/111126.md` |
| `111127` | `docs/subagents/111127.md` |
| `111128` | `docs/subagents/111128.md` |
| `111131` | `docs/subagents/111131.md` |
| `111132` | `docs/subagents/111132.md` |
| `111133` | `docs/subagents/111133.md` |
| `111134` | `docs/subagents/111134.md` |
| `111135` | `docs/subagents/111135.md` |
| `111136` | `docs/subagents/111136.md` |
| `111137` | `docs/subagents/111137.md` |
| `111138` | `docs/subagents/111138.md` |
| `111141` | `docs/subagents/111141.md` |
| `111142` | `docs/subagents/111142.md` |
| `111143` | `docs/subagents/111143.md` |
| `111144` | `docs/subagents/111144.md` |
| `111145` | `docs/subagents/111145.md` |
| `111146` | `docs/subagents/111146.md` |
| `111147` | `docs/subagents/111147.md` |
| `111148` | `docs/subagents/111148.md` |
| `112121` | `docs/subagents/112121.md` |
| `112141` | `docs/subagents/112141.md` |
| `112142` | `docs/subagents/112142.md` |
| `112145` | `docs/subagents/112145.md` |
| `112146` | `docs/subagents/112146.md` |
| `112221` | `docs/subagents/112221.md` |
| `112241` | `docs/subagents/112241.md` |
| `112242` | `docs/subagents/112242.md` |
| `112245` | `docs/subagents/112245.md` |
| `112246` | `docs/subagents/112246.md` |
| `112321` | `docs/subagents/112321.md` |
| `112341` | `docs/subagents/112341.md` |
| `112342` | `docs/subagents/112342.md` |
| `112345` | `docs/subagents/112345.md` |
| `112346` | `docs/subagents/112346.md` |
| `112421` | `docs/subagents/112421.md` |
| `112441` | `docs/subagents/112441.md` |
| `112442` | `docs/subagents/112442.md` |
| `112445` | `docs/subagents/112445.md` |
| `112446` | `docs/subagents/112446.md` |
| `121332` | `docs/subagents/121332.md` |
| `121341` | `docs/subagents/121341.md` |
| `121521` | `docs/subagents/121521.md` |
| `121531` | `docs/subagents/121531.md` |
| `121721` | `docs/subagents/121721.md` |
| `122311` | `docs/subagents/122311.md` |
| `122412` | `docs/subagents/122412.md` |
| `122511` | `docs/subagents/122511.md` |
| `123111` | `docs/subagents/123111.md` |
| `123411` | `docs/subagents/123411.md` |
| `123431` | `docs/subagents/123431.md` |
| `123432` | `docs/subagents/123432.md` |
| `123433` | `docs/subagents/123433.md` |
| `131111` | `docs/subagents/131111.md` |
| `131121` | `docs/subagents/131121.md` |
| `131211` | `docs/subagents/131211.md` |
| `131311` | `docs/subagents/131311.md` |
| `131621` | `docs/subagents/131621.md` |
| `131631` | `docs/subagents/131631.md` |
| `132122` | `docs/subagents/132122.md` |
| `132211` | `docs/subagents/132211.md` |
| `132311` | `docs/subagents/132311.md` |
| `132321` | `docs/subagents/132321.md` |
| `132322` | `docs/subagents/132322.md` |
| `132331` | `docs/subagents/132331.md` |
| `132332` | `docs/subagents/132332.md` |
| `132532` | `docs/subagents/132532.md` |
| `132712` | `docs/subagents/132712.md` |
| `133111` | `docs/subagents/133111.md` |
| `133332` | `docs/subagents/133332.md` |
| `133413` | `docs/subagents/133413.md` |
| `133521` | `docs/subagents/133521.md` |
| `133533` | `docs/subagents/133533.md` |
| `211111` | `docs/subagents/211111.md` |
| `211211` | `docs/subagents/211211.md` |
| `211221` | `docs/subagents/211221.md` |
| `211222` | `docs/subagents/211222.md` |
| `211311` | `docs/subagents/211311.md` |
| `211412` | `docs/subagents/211412.md` |
| `211421` | `docs/subagents/211421.md` |
| `211422` | `docs/subagents/211422.md` |
| `211431` | `docs/subagents/211431.md` |
| `212512` | `docs/subagents/212512.md` |
| `312111` | `docs/subagents/312111.md` |
| `312211` | `docs/subagents/312211.md` |
| `312311` | `docs/subagents/312311.md` |
| `312321` | `docs/subagents/312321.md` |
| `312333` | `docs/subagents/312333.md` |
| `312411` | `docs/subagents/312411.md` |
| `312421` | `docs/subagents/312421.md` |
| `314413` | `docs/subagents/314413.md` |
| `411211` | `docs/subagents/411211.md` |
| `411213` | `docs/subagents/411213.md` |
| `411221` | `docs/subagents/411221.md` |
| `411223` | `docs/subagents/411223.md` |
| `411231` | `docs/subagents/411231.md` |
| `411241` | `docs/subagents/411241.md` |
| `411242` | `docs/subagents/411242.md` |
| `411332` | `docs/subagents/411332.md` |
| `411342` | `docs/subagents/411342.md` |
| `412121` | `docs/subagents/412121.md` |
| `412122` | `docs/subagents/412122.md` |
| `412123` | `docs/subagents/412123.md` |
| `412211` | `docs/subagents/412211.md` |
| `412213` | `docs/subagents/412213.md` |
| `412221` | `docs/subagents/412221.md` |
| `412222` | `docs/subagents/412222.md` |
| `412311` | `docs/subagents/412311.md` |
| `412313` | `docs/subagents/412313.md` |
| `422412` | `docs/subagents/422412.md` |
| `422422` | `docs/subagents/422422.md` |
| `422431` | `docs/subagents/422431.md` |
| `422511` | `docs/subagents/422511.md` |

## Step 3 Batch 1 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `12211` | `docs/subagents/12211.md` |
| `31141` | `docs/subagents/31141.md` |
| `31142` | `docs/subagents/31142.md` |
| `31143` | `docs/subagents/31143.md` |
| `42231` | `docs/subagents/42231.md` |
| `111111` | `docs/subagents/111111.md` |
| `111112` | `docs/subagents/111112.md` |
| `111113` | `docs/subagents/111113.md` |
| `111114` | `docs/subagents/111114.md` |
| `111115` | `docs/subagents/111115.md` |
| `111116` | `docs/subagents/111116.md` |
| `111117` | `docs/subagents/111117.md` |
| `111118` | `docs/subagents/111118.md` |
| `111121` | `docs/subagents/111121.md` |
| `111122` | `docs/subagents/111122.md` |
| `111123` | `docs/subagents/111123.md` |
| `111124` | `docs/subagents/111124.md` |
| `111125` | `docs/subagents/111125.md` |
| `111126` | `docs/subagents/111126.md` |
| `111127` | `docs/subagents/111127.md` |

교정:

| 항목 | 조치 |
|---|---|
| `31141310` | `0` suffix terminal 규칙 위반이라 `31141313`으로 이동 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 20 |
| row 수 | 495 |
| next leaf 수 | 94 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |

## Step 3 Batch 7 결과

정책:

| 항목 | 값 |
|---|---|
| 서브에이전트 동시 실행 상한 | 20개 |
| 실행 방식 | managed `task()` writing agents |
| Spark/opencode OS-level launcher | 사용하지 않음 |

완료 파일:

| ID | 파일 |
|---|---|
| `412211` | `docs/subagents/412211.md` |
| `412213` | `docs/subagents/412213.md` |
| `412221` | `docs/subagents/412221.md` |
| `412222` | `docs/subagents/412222.md` |
| `412311` | `docs/subagents/412311.md` |
| `412313` | `docs/subagents/412313.md` |
| `422412` | `docs/subagents/422412.md` |
| `422422` | `docs/subagents/422422.md` |
| `422431` | `docs/subagents/422431.md` |
| `422511` | `docs/subagents/422511.md` |
| `31133211` | `docs/subagents/31133211.md` |
| `31133311` | `docs/subagents/31133311.md` |
| `31134111` | `docs/subagents/31134111.md` |
| `31134311` | `docs/subagents/31134311.md` |
| `31134312` | `docs/subagents/31134312.md` |

교정:

| 항목 | 조치 |
|---|---|
| `31133211110` | `0` suffix terminal 규칙 위반이라 `31133211113`으로 이동 |

검증:

| 항목 | 결과 |
|---|---|
| 파일 수 | 15 |
| row 수 | 421 |
| next leaf 수 | 61 |
| invalid flag | 0 |
| `0` suffix non-terminal | 0 |
| `0` suffix descendant | 0 |
| Step 3 전체 frontier 파일 수 | 135 |
| Step 3 전체 row 수 | 3349 |
| Step 3 전체 next leaf 수 | 465 |
| Step 3 pending | 0 |

## Step 4 실행 대상

| ID | 파일 |
|---|---|
| `12211111` | `docs/subagents/12211111.md` |
| `12211121` | `docs/subagents/12211121.md` |
| `12211131` | `docs/subagents/12211131.md` |
| `12211311` | `docs/subagents/12211311.md` |
| `31141211` | `docs/subagents/31141211.md` |
| `31141311` | `docs/subagents/31141311.md` |
| `31142311` | `docs/subagents/31142311.md` |
| `31142312` | `docs/subagents/31142312.md` |
| `42231221` | `docs/subagents/42231221.md` |
| `42231521` | `docs/subagents/42231521.md` |
| `111111212` | `docs/subagents/111111212.md` |
| `111111312` | `docs/subagents/111111312.md` |
| `111111412` | `docs/subagents/111111412.md` |
| `111111511` | `docs/subagents/111111511.md` |
| `111111512` | `docs/subagents/111111512.md` |
| `111112111` | `docs/subagents/111112111.md` |
| `111112122` | `docs/subagents/111112122.md` |
| `111113131` | `docs/subagents/111113131.md` |
| `111114151` | `docs/subagents/111114151.md` |
| `111115131` | `docs/subagents/111115131.md` |
| `111115132` | `docs/subagents/111115132.md` |
| `111115133` | `docs/subagents/111115133.md` |
| `111115134` | `docs/subagents/111115134.md` |
| `11111551` | `docs/subagents/11111551.md` |
| `11111552` | `docs/subagents/11111552.md` |
| `111116141` | `docs/subagents/111116141.md` |
| `111116142` | `docs/subagents/111116142.md` |
| `111116144` | `docs/subagents/111116144.md` |
| `111116145` | `docs/subagents/111116145.md` |
| `111116146` | `docs/subagents/111116146.md` |
| `111117411` | `docs/subagents/111117411.md` |
| `111117412` | `docs/subagents/111117412.md` |
| `111117415` | `docs/subagents/111117415.md` |
| `111118211` | `docs/subagents/111118211.md` |
| `111118321` | `docs/subagents/111118321.md` |
| `111118441` | `docs/subagents/111118441.md` |
| `111121111` | `docs/subagents/111121111.md` |
| `111121112` | `docs/subagents/111121112.md` |
| `111121113` | `docs/subagents/111121113.md` |
| `111121121` | `docs/subagents/111121121.md` |
| `111121122` | `docs/subagents/111121122.md` |
| `111121123` | `docs/subagents/111121123.md` |
| `111121131` | `docs/subagents/111121131.md` |
| `111121132` | `docs/subagents/111121132.md` |
| `111121133` | `docs/subagents/111121133.md` |
| `111121211` | `docs/subagents/111121211.md` |
| `111121212` | `docs/subagents/111121212.md` |
| `111121213` | `docs/subagents/111121213.md` |
| `111121221` | `docs/subagents/111121221.md` |
| `111121222` | `docs/subagents/111121222.md` |
| `111121223` | `docs/subagents/111121223.md` |
| `111121231` | `docs/subagents/111121231.md` |
| `111121232` | `docs/subagents/111121232.md` |
| `111121233` | `docs/subagents/111121233.md` |
| `111121311` | `docs/subagents/111121311.md` |
| `111121312` | `docs/subagents/111121312.md` |
| `111121313` | `docs/subagents/111121313.md` |
| `111121321` | `docs/subagents/111121321.md` |
| `111121322` | `docs/subagents/111121322.md` |
| `111121323` | `docs/subagents/111121323.md` |
| `111121331` | `docs/subagents/111121331.md` |
| `111121411` | `docs/subagents/111121411.md` |
| `111121412` | `docs/subagents/111121412.md` |
| `111121413` | `docs/subagents/111121413.md` |
| `111121421` | `docs/subagents/111121421.md` |
| `111121422` | `docs/subagents/111121422.md` |
| `111121423` | `docs/subagents/111121423.md` |
| `111121542` | `docs/subagents/111121542.md` |
| `111122111` | `docs/subagents/111122111.md` |
| `111122112` | `docs/subagents/111122112.md` |
| `111122121` | `docs/subagents/111122121.md` |
| `111122122` | `docs/subagents/111122122.md` |
| `111122123` | `docs/subagents/111122123.md` |
| `111122212` | `docs/subagents/111122212.md` |
| `111122221` | `docs/subagents/111122221.md` |
| `111122222` | `docs/subagents/111122222.md` |
| `111122223` | `docs/subagents/111122223.md` |
| `111122231` | `docs/subagents/111122231.md` |
| `111122232` | `docs/subagents/111122232.md` |
| `111122233` | `docs/subagents/111122233.md` |
| `111125141` | `docs/subagents/111125141.md` |
| `111125142` | `docs/subagents/111125142.md` |
| `111125143` | `docs/subagents/111125143.md` |
| `111125145` | `docs/subagents/111125145.md` |
| `111125146` | `docs/subagents/111125146.md` |
| `111126131` | `docs/subagents/111126131.md` |
| `111126132` | `docs/subagents/111126132.md` |
| `111126133` | `docs/subagents/111126133.md` |
| `111126134` | `docs/subagents/111126134.md` |
| `111127122` | `docs/subagents/111127122.md` |
| `111127123` | `docs/subagents/111127123.md` |
| `11112721` | `docs/subagents/11112721.md` |
| `11112722` | `docs/subagents/11112722.md` |
| `11112723` | `docs/subagents/11112723.md` |
| `111128211` | `docs/subagents/111128211.md` |
| `111128321` | `docs/subagents/111128321.md` |
| `111128441` | `docs/subagents/111128441.md` |
| `111131111` | `docs/subagents/111131111.md` |
| `111132111` | `docs/subagents/111132111.md` |
| `111132121` | `docs/subagents/111132121.md` |
| `111132132` | `docs/subagents/111132132.md` |
| `111133131` | `docs/subagents/111133131.md` |
| `111134111` | `docs/subagents/111134111.md` |
| `111134112` | `docs/subagents/111134112.md` |
| `111134113` | `docs/subagents/111134113.md` |
| `111134121` | `docs/subagents/111134121.md` |
| `111134122` | `docs/subagents/111134122.md` |
| `111134123` | `docs/subagents/111134123.md` |
| `111134131` | `docs/subagents/111134131.md` |
| `111134132` | `docs/subagents/111134132.md` |
| `111134133` | `docs/subagents/111134133.md` |
| `111134212` | `docs/subagents/111134212.md` |
| `111134213` | `docs/subagents/111134213.md` |
| `111134221` | `docs/subagents/111134221.md` |
| `111134222` | `docs/subagents/111134222.md` |
| `111134223` | `docs/subagents/111134223.md` |
| `111134231` | `docs/subagents/111134231.md` |
| `111134232` | `docs/subagents/111134232.md` |
| `111134233` | `docs/subagents/111134233.md` |
| `111134312` | `docs/subagents/111134312.md` |
| `111135141` | `docs/subagents/111135141.md` |
| `111135142` | `docs/subagents/111135142.md` |
| `111135143` | `docs/subagents/111135143.md` |
| `111135145` | `docs/subagents/111135145.md` |
| `111135146` | `docs/subagents/111135146.md` |
| `11113611` | `docs/subagents/11113611.md` |
| `11113612` | `docs/subagents/11113612.md` |
| `111136131` | `docs/subagents/111136131.md` |
| `111137131` | `docs/subagents/111137131.md` |
| `11113721` | `docs/subagents/11113721.md` |
| `11113722` | `docs/subagents/11113722.md` |
| `11113725` | `docs/subagents/11113725.md` |
| `111138211` | `docs/subagents/111138211.md` |
| `111138321` | `docs/subagents/111138321.md` |
| `111138441` | `docs/subagents/111138441.md` |
| `111141151` | `docs/subagents/111141151.md` |
| `11114221` | `docs/subagents/11114221.md` |
| `111143131` | `docs/subagents/111143131.md` |
| `111144151` | `docs/subagents/111144151.md` |
| `111145131` | `docs/subagents/111145131.md` |
| `111145132` | `docs/subagents/111145132.md` |
| `111145133` | `docs/subagents/111145133.md` |
| `111145134` | `docs/subagents/111145134.md` |
| `11114551` | `docs/subagents/11114551.md` |
| `11114552` | `docs/subagents/11114552.md` |
| `111146141` | `docs/subagents/111146141.md` |
| `111146142` | `docs/subagents/111146142.md` |
| `111146144` | `docs/subagents/111146144.md` |
| `111146145` | `docs/subagents/111146145.md` |
| `111146146` | `docs/subagents/111146146.md` |
| `111147122` | `docs/subagents/111147122.md` |
| `111147123` | `docs/subagents/111147123.md` |
| `11114721` | `docs/subagents/11114721.md` |
| `11114722` | `docs/subagents/11114722.md` |
| `11114723` | `docs/subagents/11114723.md` |
| `111148111` | `docs/subagents/111148111.md` |
| `111148121` | `docs/subagents/111148121.md` |
| `111148131` | `docs/subagents/111148131.md` |
| `111148142` | `docs/subagents/111148142.md` |
| `111148151` | `docs/subagents/111148151.md` |
| `111148152` | `docs/subagents/111148152.md` |
| `112141114` | `docs/subagents/112141114.md` |
| `112141312` | `docs/subagents/112141312.md` |
| `11214163` | `docs/subagents/11214163.md` |
| `112142111` | `docs/subagents/112142111.md` |
| `112142212` | `docs/subagents/112142212.md` |
| `112145133` | `docs/subagents/112145133.md` |
| `11214553` | `docs/subagents/11214553.md` |
| `112146111` | `docs/subagents/112146111.md` |
| `112146112` | `docs/subagents/112146112.md` |
| `112146113` | `docs/subagents/112146113.md` |
| `112146121` | `docs/subagents/112146121.md` |
| `112146131` | `docs/subagents/112146131.md` |
| `112146141` | `docs/subagents/112146141.md` |
| `112146142` | `docs/subagents/112146142.md` |
| `11222133` | `docs/subagents/11222133.md` |
| `112241111` | `docs/subagents/112241111.md` |
| `112241151` | `docs/subagents/112241151.md` |
| `112242111` | `docs/subagents/112242111.md` |
| `112242212` | `docs/subagents/112242212.md` |
| `112245111` | `docs/subagents/112245111.md` |
| `112245112` | `docs/subagents/112245112.md` |
| `112245113` | `docs/subagents/112245113.md` |
| `112245121` | `docs/subagents/112245121.md` |
| `112245122` | `docs/subagents/112245122.md` |
| `112245123` | `docs/subagents/112245123.md` |
| `112245124` | `docs/subagents/112245124.md` |
| `112246211` | `docs/subagents/112246211.md` |
| `112246222` | `docs/subagents/112246222.md` |
| `112246232` | `docs/subagents/112246232.md` |
| `112321114` | `docs/subagents/112321114.md` |
| `112321312` | `docs/subagents/112321312.md` |
| `112321333` | `docs/subagents/112321333.md` |
| `11232163` | `docs/subagents/11232163.md` |
| `112341114` | `docs/subagents/112341114.md` |
| `112341312` | `docs/subagents/112341312.md` |
| `11234163` | `docs/subagents/11234163.md` |
| `112342111` | `docs/subagents/112342111.md` |
| `112342212` | `docs/subagents/112342212.md` |
| `112342312` | `docs/subagents/112342312.md` |
| `11234533` | `docs/subagents/11234533.md` |
| `11234563` | `docs/subagents/11234563.md` |
| `112346211` | `docs/subagents/112346211.md` |
| `112346222` | `docs/subagents/112346222.md` |
| `112346232` | `docs/subagents/112346232.md` |
| `112421114` | `docs/subagents/112421114.md` |
| `11242133` | `docs/subagents/11242133.md` |
| `112421412` | `docs/subagents/112421412.md` |
| `112421433` | `docs/subagents/112421433.md` |
| `11242173` | `docs/subagents/11242173.md` |
| `112441111` | `docs/subagents/112441111.md` |
| `112442111` | `docs/subagents/112442111.md` |
| `112442212` | `docs/subagents/112442212.md` |
| `112445111` | `docs/subagents/112445111.md` |
| `112445112` | `docs/subagents/112445112.md` |
| `112445113` | `docs/subagents/112445113.md` |
| `112445121` | `docs/subagents/112445121.md` |
| `112445122` | `docs/subagents/112445122.md` |
| `112445123` | `docs/subagents/112445123.md` |
| `112445124` | `docs/subagents/112445124.md` |
| `112446211` | `docs/subagents/112446211.md` |
| `112446222` | `docs/subagents/112446222.md` |
| `112446232` | `docs/subagents/112446232.md` |
| `121341111` | `docs/subagents/121341111.md` |
| `121341113` | `docs/subagents/121341113.md` |
| `121341131` | `docs/subagents/121341131.md` |
| `121341311` | `docs/subagents/121341311.md` |
| `121341313` | `docs/subagents/121341313.md` |
| `121531111` | `docs/subagents/121531111.md` |
| `121531113` | `docs/subagents/121531113.md` |
| `121531131` | `docs/subagents/121531131.md` |
| `121531311` | `docs/subagents/121531311.md` |
| `121531313` | `docs/subagents/121531313.md` |
| `121721111` | `docs/subagents/121721111.md` |
| `121721113` | `docs/subagents/121721113.md` |
| `121721131` | `docs/subagents/121721131.md` |
| `121721311` | `docs/subagents/121721311.md` |
| `121721313` | `docs/subagents/121721313.md` |
| `122311111` | `docs/subagents/122311111.md` |
| `122311112` | `docs/subagents/122311112.md` |
| `122311113` | `docs/subagents/122311113.md` |
| `122412111` | `docs/subagents/122412111.md` |
| `122412131` | `docs/subagents/122412131.md` |
| `122511111` | `docs/subagents/122511111.md` |
| `122511112` | `docs/subagents/122511112.md` |
| `123111111` | `docs/subagents/123111111.md` |
| `123111112` | `docs/subagents/123111112.md` |
| `123111113` | `docs/subagents/123111113.md` |
| `123111121` | `docs/subagents/123111121.md` |
| `123111123` | `docs/subagents/123111123.md` |
| `123111131` | `docs/subagents/123111131.md` |
| `123111212` | `docs/subagents/123111212.md` |
| `123411111` | `docs/subagents/123411111.md` |
| `123431111` | `docs/subagents/123431111.md` |
| `123432111` | `docs/subagents/123432111.md` |
| `123432121` | `docs/subagents/123432121.md` |
| `12343321` | `docs/subagents/12343321.md` |
| `12343322` | `docs/subagents/12343322.md` |
| `12343323` | `docs/subagents/12343323.md` |
| `131111111` | `docs/subagents/131111111.md` |
| `131111112` | `docs/subagents/131111112.md` |
| `131111121` | `docs/subagents/131111121.md` |
| `131121111` | `docs/subagents/131121111.md` |
| `131121121` | `docs/subagents/131121121.md` |
| `131121131` | `docs/subagents/131121131.md` |
| `131121211` | `docs/subagents/131121211.md` |
| `131121221` | `docs/subagents/131121221.md` |
| `131121511` | `docs/subagents/131121511.md` |
| `131121521` | `docs/subagents/131121521.md` |
| `131121523` | `docs/subagents/131121523.md` |
| `131211111` | `docs/subagents/131211111.md` |
| `131211112` | `docs/subagents/131211112.md` |
| `131211121` | `docs/subagents/131211121.md` |
| `131311111` | `docs/subagents/131311111.md` |
| `131311131` | `docs/subagents/131311131.md` |
| `131621111` | `docs/subagents/131621111.md` |
| `131621211` | `docs/subagents/131621211.md` |
| `131621221` | `docs/subagents/131621221.md` |
| `131621231` | `docs/subagents/131621231.md` |
| `131621311` | `docs/subagents/131621311.md` |
| `131621321` | `docs/subagents/131621321.md` |
| `131621431` | `docs/subagents/131621431.md` |
| `131631111` | `docs/subagents/131631111.md` |
| `13212213` | `docs/subagents/13212213.md` |
| `132211111` | `docs/subagents/132211111.md` |
| `132211133` | `docs/subagents/132211133.md` |
| `132311211` | `docs/subagents/132311211.md` |
| `132321111` | `docs/subagents/132321111.md` |
| `132322111` | `docs/subagents/132322111.md` |
| `13232233` | `docs/subagents/13232233.md` |
| `132331111` | `docs/subagents/132331111.md` |
| `132331121` | `docs/subagents/132331121.md` |
| `132332111` | `docs/subagents/132332111.md` |
| `132332121` | `docs/subagents/132332121.md` |
| `132532111` | `docs/subagents/132532111.md` |
| `132532121` | `docs/subagents/132532121.md` |
| `132712214` | `docs/subagents/132712214.md` |
| `132712324` | `docs/subagents/132712324.md` |
| `133111111` | `docs/subagents/133111111.md` |
| `133332111` | `docs/subagents/133332111.md` |
| `133332112` | `docs/subagents/133332112.md` |
| `133332141` | `docs/subagents/133332141.md` |
| `133332142` | `docs/subagents/133332142.md` |
| `133413121` | `docs/subagents/133413121.md` |
| `133413212` | `docs/subagents/133413212.md` |
| `133413322` | `docs/subagents/133413322.md` |
| `133521111` | `docs/subagents/133521111.md` |
| `133521121` | `docs/subagents/133521121.md` |
| `133521211` | `docs/subagents/133521211.md` |
| `133521331` | `docs/subagents/133521331.md` |
| `133533111` | `docs/subagents/133533111.md` |
| `133533141` | `docs/subagents/133533141.md` |
| `211111111` | `docs/subagents/211111111.md` |
| `211111121` | `docs/subagents/211111121.md` |
| `211111122` | `docs/subagents/211111122.md` |
| `211211111` | `docs/subagents/211211111.md` |
| `211211211` | `docs/subagents/211211211.md` |
| `211211311` | `docs/subagents/211211311.md` |
| `211211321` | `docs/subagents/211211321.md` |
| `211211322` | `docs/subagents/211211322.md` |
| `211211331` | `docs/subagents/211211331.md` |
| `211221111` | `docs/subagents/211221111.md` |
| `211221131` | `docs/subagents/211221131.md` |
| `211222111` | `docs/subagents/211222111.md` |
| `211222211` | `docs/subagents/211222211.md` |
| `211222221` | `docs/subagents/211222221.md` |
| `211311111` | `docs/subagents/211311111.md` |
| `211311121` | `docs/subagents/211311121.md` |
| `211412111` | `docs/subagents/211412111.md` |
| `211412121` | `docs/subagents/211412121.md` |
| `211421313` | `docs/subagents/211421313.md` |
| `211421321` | `docs/subagents/211421321.md` |
| `211421332` | `docs/subagents/211421332.md` |
| `211422111` | `docs/subagents/211422111.md` |
| `211422113` | `docs/subagents/211422113.md` |
| `211422131` | `docs/subagents/211422131.md` |
| `211422411` | `docs/subagents/211422411.md` |
| `211431111` | `docs/subagents/211431111.md` |
| `211431211` | `docs/subagents/211431211.md` |
| `211431221` | `docs/subagents/211431221.md` |
| `312111111` | `docs/subagents/312111111.md` |
| `312211111` | `docs/subagents/312211111.md` |
| `312211211` | `docs/subagents/312211211.md` |
| `312211311` | `docs/subagents/312211311.md` |
| `312311111` | `docs/subagents/312311111.md` |
| `312311211` | `docs/subagents/312311211.md` |
| `312311333` | `docs/subagents/312311333.md` |
| `312321111` | `docs/subagents/312321111.md` |
| `312321211` | `docs/subagents/312321211.md` |
| `312321313` | `docs/subagents/312321313.md` |
| `312321321` | `docs/subagents/312321321.md` |
| `312321332` | `docs/subagents/312321332.md` |
| `312333111` | `docs/subagents/312333111.md` |
| `312411112` | `docs/subagents/312411112.md` |
| `312411122` | `docs/subagents/312411122.md` |
| `312411131` | `docs/subagents/312411131.md` |
| `312421113` | `docs/subagents/312421113.md` |
| `312421123` | `docs/subagents/312421123.md` |
| `312421233` | `docs/subagents/312421233.md` |
| `312421313` | `docs/subagents/312421313.md` |
| `411211112` | `docs/subagents/411211112.md` |
| `411213112` | `docs/subagents/411213112.md` |
| `411213131` | `docs/subagents/411213131.md` |
| `411213132` | `docs/subagents/411213132.md` |
| `411213211` | `docs/subagents/411213211.md` |
| `411213412` | `docs/subagents/411213412.md` |
| `411213432` | `docs/subagents/411213432.md` |
| `411213511` | `docs/subagents/411213511.md` |
| `411213512` | `docs/subagents/411213512.md` |
| `411213522` | `docs/subagents/411213522.md` |
| `411221112` | `docs/subagents/411221112.md` |
| `411223113` | `docs/subagents/411223113.md` |
| `411223121` | `docs/subagents/411223121.md` |
| `411223122` | `docs/subagents/411223122.md` |
| `411223212` | `docs/subagents/411223212.md` |
| `411223221` | `docs/subagents/411223221.md` |
| `411223223` | `docs/subagents/411223223.md` |
| `411231112` | `docs/subagents/411231112.md` |
| `411231331` | `docs/subagents/411231331.md` |
| `411241111` | `docs/subagents/411241111.md` |
| `411242111` | `docs/subagents/411242111.md` |
| `411242112` | `docs/subagents/411242112.md` |
| `411332112` | `docs/subagents/411332112.md` |
| `411332122` | `docs/subagents/411332122.md` |
| `411332313` | `docs/subagents/411332313.md` |
| `411342112` | `docs/subagents/411342112.md` |
| `411342122` | `docs/subagents/411342122.md` |
| `411342132` | `docs/subagents/411342132.md` |
| `412121111` | `docs/subagents/412121111.md` |
| `412121123` | `docs/subagents/412121123.md` |
| `412121143` | `docs/subagents/412121143.md` |
| `412122111` | `docs/subagents/412122111.md` |
| `412122121` | `docs/subagents/412122121.md` |
| `412122411` | `docs/subagents/412122411.md` |
| `412122412` | `docs/subagents/412122412.md` |
| `412123111` | `docs/subagents/412123111.md` |
| `412123113` | `docs/subagents/412123113.md` |
| `412123211` | `docs/subagents/412123211.md` |
| `412123221` | `docs/subagents/412123221.md` |
| `412123223` | `docs/subagents/412123223.md` |
| `412123311` | `docs/subagents/412123311.md` |
| `412123313` | `docs/subagents/412123313.md` |
| `412123331` | `docs/subagents/412123331.md` |
| `412123333` | `docs/subagents/412123333.md` |
| `412211111` | `docs/subagents/412211111.md` |
| `412211121` | `docs/subagents/412211121.md` |
| `412211124` | `docs/subagents/412211124.md` |
| `412211133` | `docs/subagents/412211133.md` |
| `412211211` | `docs/subagents/412211211.md` |
| `412211213` | `docs/subagents/412211213.md` |
| `412211221` | `docs/subagents/412211221.md` |
| `412211231` | `docs/subagents/412211231.md` |
| `412213111` | `docs/subagents/412213111.md` |
| `412213131` | `docs/subagents/412213131.md` |
| `412213211` | `docs/subagents/412213211.md` |
| `412213213` | `docs/subagents/412213213.md` |
| `412213241` | `docs/subagents/412213241.md` |
| `412213242` | `docs/subagents/412213242.md` |
| `412213311` | `docs/subagents/412213311.md` |
| `412213331` | `docs/subagents/412213331.md` |
| `412221111` | `docs/subagents/412221111.md` |
| `412221211` | `docs/subagents/412221211.md` |
| `412221221` | `docs/subagents/412221221.md` |
| `412221231` | `docs/subagents/412221231.md` |
| `412222121` | `docs/subagents/412222121.md` |
| `412222211` | `docs/subagents/412222211.md` |
| `412222221` | `docs/subagents/412222221.md` |
| `412222231` | `docs/subagents/412222231.md` |
| `412311111` | `docs/subagents/412311111.md` |
| `412311211` | `docs/subagents/412311211.md` |
| `412311311` | `docs/subagents/412311311.md` |
| `412313113` | `docs/subagents/412313113.md` |
| `412313213` | `docs/subagents/412313213.md` |
| `412313313` | `docs/subagents/412313313.md` |
| `412313323` | `docs/subagents/412313323.md` |
| `422412111` | `docs/subagents/422412111.md` |
| `422412114` | `docs/subagents/422412114.md` |
| `422422111` | `docs/subagents/422422111.md` |
| `422422121` | `docs/subagents/422422121.md` |
| `422422133` | `docs/subagents/422422133.md` |
| `422431111` | `docs/subagents/422431111.md` |
| `422431133` | `docs/subagents/422431133.md` |
| `422511121` | `docs/subagents/422511121.md` |
| `422511422` | `docs/subagents/422511422.md` |
| `31133211111` | `docs/subagents/31133211111.md` |
| `31133211112` | `docs/subagents/31133211112.md` |
| `31133311111` | `docs/subagents/31133311111.md` |
| `31133311112` | `docs/subagents/31133311112.md` |
| `31133311211` | `docs/subagents/31133311211.md` |
| `31133311212` | `docs/subagents/31133311212.md` |
| `31134111111` | `docs/subagents/31134111111.md` |
| `31134111112` | `docs/subagents/31134111112.md` |
| `31134111121` | `docs/subagents/31134111121.md` |
| `31134311111` | `docs/subagents/31134311111.md` |
| `31134311112` | `docs/subagents/31134311112.md` |
| `31134312111` | `docs/subagents/31134312111.md` |
| `31134312112` | `docs/subagents/31134312112.md` |
| `31134312113` | `docs/subagents/31134312113.md` |
| `31134312121` | `docs/subagents/31134312121.md` |
| `31134312122` | `docs/subagents/31134312122.md` |
| `31134312211` | `docs/subagents/31134312211.md` |
| `31134312212` | `docs/subagents/31134312212.md` |
| `31134312221` | `docs/subagents/31134312221.md` |
| `31134312321` | `docs/subagents/31134312321.md` |
| `31134312322` | `docs/subagents/31134312322.md` |

## Step 4 Batch 1 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12211111`, `12211121`, `12211131`, `12211311`, `31141211`, `31141311`, `31142311`, `31142312`, `42231221`, `42231521`, `111111212`, `111111312`, `111111412`, `111111511`, `111111512`, `111112111`, `111112122`, `111113131`, `111114151`, `111115131` |
| 생성 파일 수 | 20 |
| row 수 | 290 |
| next leaf 수 | 29 |
| validation violations | 0 |
| 보정 | `31141311`, `111111212`, `111111312`, `111111412`, `111111512`의 leaf 목록/`0` suffix flag 보정 |

## Step 4 Batch 2 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111115132`, `111115133`, `111115134`, `11111551`, `11111552`, `111116141`, `111116142`, `111116144`, `111116145`, `111116146`, `111117411`, `111117412`, `111117415`, `111118211`, `111118321`, `111118441`, `111121111`, `111121112`, `111121113`, `111121121` |
| 생성 파일 수 | 20 |
| row 수 | 187 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 3 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111121122`, `111121123`, `111121131`, `111121132`, `111121133`, `111121211`, `111121212`, `111121213`, `111121221`, `111121222`, `111121223`, `111121231`, `111121232`, `111121233`, `111121311`, `111121312`, `111121313`, `111121321`, `111121322`, `111121323` |
| 생성 파일 수 | 20 |
| row 수 | 192 |
| next leaf 수 | 17 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 4 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111121331`, `111121411`, `111121412`, `111121413`, `111121421`, `111121422`, `111121423`, `111121542`, `111122111`, `111122112`, `111122121`, `111122122`, `111122123`, `111122212`, `111122221`, `111122222`, `111122223`, `111122231`, `111122232`, `111122233` |
| 생성 파일 수 | 20 |
| row 수 | 144 |
| next leaf 수 | 9 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 5 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111125141`, `111125142`, `111125143`, `111125145`, `111125146`, `111126131`, `111126132`, `111126133`, `111126134`, `111127122`, `111127123`, `11112721`, `11112722`, `11112723`, `111128211`, `111128321`, `111128441`, `111131111`, `111132111`, `111132121` |
| 생성 파일 수 | 20 |
| row 수 | 183 |
| next leaf 수 | 23 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 6 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111132132`, `111133131`, `111134111`, `111134112`, `111134113`, `111134121`, `111134122`, `111134123`, `111134131`, `111134132`, `111134133`, `111134212`, `111134213`, `111134221`, `111134222`, `111134223`, `111134231`, `111134232`, `111134233`, `111134312` |
| 생성 파일 수 | 20 |
| row 수 | 141 |
| next leaf 수 | 11 |
| validation violations | 0 |
| 보정 | `111134112`, `111134121`, `111134122`, `111134131`, `111134231`의 `0` suffix/leaf 목록 보정 |

## Step 4 Batch 7 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111135141`, `111135142`, `111135143`, `111135145`, `111135146`, `11113611`, `11113612`, `111136131`, `111137131`, `11113721`, `11113722`, `11113725`, `111138211`, `111138321`, `111138441`, `111141151`, `11114221`, `111143131`, `111144151`, `111145131` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 21 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 8 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111145132`, `111145133`, `111145134`, `11114551`, `11114552`, `111146141`, `111146142`, `111146144`, `111146145`, `111146146`, `111147122`, `111147123`, `11114721`, `11114722`, `11114723`, `111148111`, `111148121`, `111148131`, `111148142`, `111148151` |
| 생성 파일 수 | 20 |
| row 수 | 179 |
| next leaf 수 | 23 |
| validation violations | 0 |
| 보정 | `111148111`, `111148121`, `111148131`, `111148142`의 중간 next leaf 제거 |

## Step 4 Batch 9 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111148152`, `112141114`, `112141312`, `11214163`, `112142111`, `112142212`, `112145133`, `11214553`, `112146111`, `112146112`, `112146113`, `112146121`, `112146131`, `112146141`, `112146142`, `11222133`, `112241111`, `112241151`, `112242111`, `112242212` |
| 생성 파일 수 | 20 |
| row 수 | 237 |
| next leaf 수 | 35 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 10 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `112245111`, `112245112`, `112245113`, `112245121`, `112245122`, `112245123`, `112245124`, `112246211`, `112246222`, `112246232`, `112321114`, `112321312`, `112321333`, `11232163`, `112341114`, `112341312`, `11234163`, `112342111`, `112342212`, `112342312` |
| 생성 파일 수 | 20 |
| row 수 | 235 |
| next leaf 수 | 26 |
| validation violations | 0 |
| 보정 | `112245122`, `112245123`의 중간 next leaf 제거 |

## Step 4 Batch 11 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11234533`, `11234563`, `112346211`, `112346222`, `112346232`, `112421114`, `11242133`, `112421412`, `112421433`, `11242173`, `112441111`, `112442111`, `112442212`, `112445111`, `112445112`, `112445113`, `112445121`, `112445122`, `112445123`, `112445124` |
| 생성 파일 수 | 20 |
| row 수 | 235 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | `112445122`, `112445123`의 중간 next leaf 제거 |

## Step 4 Batch 12 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `112446211`, `112446222`, `112446232`, `121341111`, `121341113`, `121341131`, `121341311`, `121341313`, `121531111`, `121531113`, `121531131`, `121531311`, `121531313`, `121721111`, `121721113`, `121721131`, `121721311`, `121721313`, `122311111`, `122311112` |
| 생성 파일 수 | 20 |
| row 수 | 201 |
| next leaf 수 | 44 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 13 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `122311113`, `122412111`, `122412131`, `122511111`, `122511112`, `123111111`, `123111112`, `123111113`, `123111121`, `123111123`, `123111131`, `123111212`, `123411111`, `123431111`, `123432111`, `123432121`, `12343321`, `12343322`, `12343323`, `131111111` |
| 생성 파일 수 | 20 |
| row 수 | 167 |
| next leaf 수 | 34 |
| validation violations | 0 |
| 보정 | `123111111`, `123111113`, `123111121`, `131111111`의 `0` suffix continue ID 재번호화 |

## Step 4 Batch 14 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `131111112`, `131111121`, `131121111`, `131121121`, `131121131`, `131121211`, `131121221`, `131121511`, `131121521`, `131121523`, `131211111`, `131211112`, `131211121`, `131311111`, `131311131`, `131621111`, `131621211`, `131621221`, `131621231`, `131621311` |
| 생성 파일 수 | 20 |
| row 수 | 183 |
| next leaf 수 | 29 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 15 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `131621321`, `131621431`, `131631111`, `13212213`, `132211111`, `132211133`, `132311211`, `132321111`, `132322111`, `13232233`, `132331111`, `132331121`, `132332111`, `132332121`, `132532111`, `132532121`, `132712214`, `132712324`, `133111111`, `133332111` |
| 생성 파일 수 | 20 |
| row 수 | 194 |
| next leaf 수 | 15 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 16 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `133332112`, `133332141`, `133332142`, `133413121`, `133413212`, `133413322`, `133521111`, `133521121`, `133521211`, `133521331`, `133533111`, `133533141`, `211111111`, `211111121`, `211111122`, `211211111`, `211211211`, `211211311`, `211211321`, `211211322` |
| 생성 파일 수 | 20 |
| row 수 | 179 |
| next leaf 수 | 13 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 17 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `211211331`, `211221111`, `211221131`, `211222111`, `211222211`, `211222221`, `211311111`, `211311121`, `211412111`, `211412121`, `211421313`, `211421321`, `211421332`, `211422111`, `211422113`, `211422131`, `211422411`, `211431111`, `211431211`, `211431221` |
| 생성 파일 수 | 20 |
| row 수 | 161 |
| next leaf 수 | 5 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 18 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `312111111`, `312211111`, `312211211`, `312211311`, `312311111`, `312311211`, `312311333`, `312321111`, `312321211`, `312321313`, `312321321`, `312321332`, `312333111`, `312411112`, `312411122`, `312411131`, `312421113`, `312421123`, `312421233`, `312421313` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 10 |
| validation violations | 0 |
| 보정 | `31241112210`을 `31241112214`로 재번호화 |

## Step 4 Batch 19 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `411211112`, `411213112`, `411213131`, `411213132`, `411213211`, `411213412`, `411213432`, `411213511`, `411213512`, `411213522`, `411221112`, `411223113`, `411223121`, `411223122`, `411223212`, `411223221`, `411223223`, `411231112`, `411231331`, `411241111` |
| 생성 파일 수 | 20 |
| row 수 | 165 |
| next leaf 수 | 19 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 20 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `411242111`, `411242112`, `411332112`, `411332122`, `411332313`, `411342112`, `411342122`, `411342132`, `412121111`, `412121123`, `412121143`, `412122111`, `412122121`, `412122411`, `412122412`, `412123111`, `412123113`, `412123211`, `412123221`, `412123223` |
| 생성 파일 수 | 20 |
| row 수 | 205 |
| next leaf 수 | 12 |
| validation violations | 0 |
| 보정 | `411332122`, `411342122`, `411342132`, `412122411`의 stale next leaf 제거; `412121111` header 교정 |

## Step 4 Batch 21 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `412123311`, `412123313`, `412123331`, `412123333`, `412211111`, `412211121`, `412211124`, `412211133`, `412211211`, `412211213`, `412211221`, `412211231`, `412213111`, `412213131`, `412213211`, `412213213`, `412213241`, `412213242`, `412213311`, `412213331` |
| 생성 파일 수 | 20 |
| row 수 | 173 |
| next leaf 수 | 2 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 22 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `412221111`, `412221211`, `412221221`, `412221231`, `412222121`, `412222211`, `412222221`, `412222231`, `412311111`, `412311211`, `412311311`, `412313113`, `412313213`, `412313313`, `412313323`, `422412111`, `422412114`, `422422111`, `422422121`, `422422133` |
| 생성 파일 수 | 20 |
| row 수 | 162 |
| next leaf 수 | 1 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 23 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `422431111`, `422431133`, `422511121`, `422511422`, `31133211111`, `31133211112`, `31133311111`, `31133311112`, `31133311211`, `31133311212`, `31134111111`, `31134111112`, `31134111121`, `31134311111`, `31134311112`, `31134312111`, `31134312112`, `31134312113`, `31134312121`, `31134312122` |
| 생성 파일 수 | 20 |
| row 수 | 145 |
| next leaf 수 | 0 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 Batch 24 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `31134312211`, `31134312212`, `31134312221`, `31134312321`, `31134312322` |
| 생성 파일 수 | 5 |
| row 수 | 33 |
| next leaf 수 | 0 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 4 전체 검증 결과

| 항목 | 값 |
|---|---|
| 검증 파일 수 | 465 |
| row 수 | 4359 |
| next leaf 수 | 427 |
| unique next leaf 수 | 427 |
| validation violations | 0 |
| Step 5 실행 대상 | `/var/folders/gy/yt1tpc6x4jn0gknxdqky4xd00000gn/T/opencode/step5-frontier.txt` |

## Step 5 Batch 1 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12211111111`, `12211111121`, `12211121111`, `12211121211`, `12211131111`, `12211131113`, `12211311111`, `12211311112`, `12211311121`, `12211311131`, `12211311211`, `12211311231`, `31141211111`, `31141211112`, `3114231111`, `3114231211`, `3114231221`, `4223122111`, `4223152122`, `11111151111` |
| 생성 파일 수 | 20 |
| row 수 | 304 |
| next leaf 수 | 34 |
| validation violations | 0 |
| 보정 | `1221113111131` next leaf 추가; `4223122111`, `4223152122`, `11111151111`의 +3 depth 초과 row 제거 |

## Step 5 Batch 2 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11111211111`, `11111211142`, `11111212212`, `11111212222`, `11111313113`, `11111313123`, `11111415151`, `11111513111`, `11111513121`, `11111513221`, `11111513321`, `1111155111`, `1111155121`, `1111155211`, `1111155221`, `11111614111`, `11111614121`, `11111614211`, `11111614221`, `11111614421` |
| 생성 파일 수 | 20 |
| row 수 | 225 |
| next leaf 수 | 37 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 3 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11111614511`, `11111614521`, `11111614611`, `11111741111`, `11111741211`, `11111821111`, `11111832121`, `11112111122`, `111121112111`, `11112111322`, `11112112122`, `11112112311`, `11112112322`, `11112113111`, `11112113311`, `11112121122`, `111121212111`, `11112121322`, `11112122122`, `11112122311` |
| 생성 파일 수 | 20 |
| row 수 | 185 |
| next leaf 수 | 24 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 4 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11112122322`, `11112123111`, `11112123311`, `11112131122`, `11112131311`, `11112131322`, `11112132111`, `11112132311`, `11112141111`, `11112141311`, `11112142122`, `11112142311`, `11112142322`, `11112154242`, `11112211111`, `11112211211`, `11112221212`, `11112514211`, `11112514221`, `11112514311` |
| 생성 파일 수 | 20 |
| row 수 | 196 |
| next leaf 수 | 29 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 5 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11112514321`, `11112514511`, `11112514531`, `11112514611`, `11112514621`, `11112613111`, `11112613121`, `11112613221`, `11112613321`, `11112613411`, `11112712211`, `11112712221`, `1111272111`, `1111272121`, `1111272211`, `11112821111`, `11112832121`, `11113111111`, `11113211111`, `11113212111` |
| 생성 파일 수 | 20 |
| row 수 | 199 |
| next leaf 수 | 32 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 6 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11113213211`, `11113313113`, `11113411111`, `11113412211`, `11113413212`, `11113421221`, `11113422211`, `11113422231`, `11113423111`, `11113423221`, `11113431211`, `11113514211`, `11113514221`, `11113514311`, `11113514321`, `11113514511`, `11113514531`, `11113514611`, `11113514621`, `1111361122` |
| 생성 파일 수 | 20 |
| row 수 | 191 |
| next leaf 수 | 30 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 7 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111361211`, `1111361221`, `1111372111`, `1111372211`, `11113821111`, `11113832121`, `11114115111`, `1111422111`, `11114313113`, `11114415111`, `11114513111`, `11114513121`, `11114513221`, `11114513321`, `1111455111`, `1111455121`, `1111455211`, `1111455221`, `11114614111`, `11114614121` |
| 생성 파일 수 | 20 |
| row 수 | 208 |
| next leaf 수 | 30 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 8 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11114614211`, `11114614221`, `11114614421`, `11114614511`, `11114614521`, `11114614611`, `11114712211`, `11114712221`, `1111472111`, `1111472121`, `1111472211`, `11114811111`, `11114812111`, `11114813111`, `11114814211`, `11114815211`, `11114815212`, `11114815213`, `11114815221`, `11114815231` |
| 생성 파일 수 | 20 |
| row 수 | 193 |
| next leaf 수 | 34 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 9 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11114815232`, `11214111433`, `11214131233`, `1121416333`, `11214211111`, `11214211132`, `11214221211`, `11214221222`, `11214513311`, `1121455333`, `11214611111`, `11214611211`, `11214611311`, `11214612111`, `11214612112`, `11214613111`, `11214614111`, `11214614211`, `11214614212`, `11214614213` |
| 생성 파일 수 | 20 |
| row 수 | 221 |
| next leaf 수 | 34 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 10 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11214614221`, `11214614222`, `1122213333`, `11224111111`, `11224111133`, `11224115111`, `11224211111`, `11224211132`, `11224221211`, `11224221222`, `11224512111`, `11224512211`, `11224512213`, `11224512311`, `11224512313`, `11224512433`, `11224621111`, `11224621112`, `11224621113`, `11224622211` |
| 생성 파일 수 | 20 |
| row 수 | 233 |
| next leaf 수 | 43 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 11 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11224622213`, `11224622233`, `11224623211`, `11224623213`, `11224623233`, `11232111433`, `11232131233`, `11232133333`, `1123216333`, `11234111433`, `11234131233`, `1123416333`, `11234211111`, `11234221211`, `11234221222`, `11234231211`, `1123453333`, `1123456333`, `11234621111`, `11234621112` |
| 생성 파일 수 | 20 |
| row 수 | 225 |
| next leaf 수 | 28 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 12 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11234621113`, `11234622211`, `11234622213`, `11234622233`, `11234623211`, `11234623213`, `11234623233`, `11242111443`, `1124213343`, `11242141233`, `11242143343`, `1124217343`, `11244111111`, `11244111133`, `11244211111`, `11244221211`, `11244221222`, `11244512111`, `11244512211`, `11244512213` |
| 생성 파일 수 | 20 |
| row 수 | 228 |
| next leaf 수 | 34 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 13 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11244512311`, `11244512313`, `11244512433`, `11244621111`, `11244621112`, `11244621113`, `11244622211`, `11244622213`, `11244622233`, `11244623211`, `11244623213`, `11244623233`, `12134111111`, `12134111113`, `12134111311`, `12134111313`, `12134113111`, `12134113113`, `12134131111`, `12134131113` |
| 생성 파일 수 | 20 |
| row 수 | 206 |
| next leaf 수 | 38 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 14 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12134131311`, `12134131313`, `12153111111`, `12153111113`, `12153111311`, `12153111313`, `12153113111`, `12153113113`, `12153131111`, `12153131113`, `12153131311`, `12153131313`, `12172111111`, `12172111113`, `12172111311`, `12172111313`, `12172113111`, `12172113113`, `12172131111`, `12172131113` |
| 생성 파일 수 | 20 |
| row 수 | 188 |
| next leaf 수 | 40 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 15 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12172131311`, `12172131313`, `122311111111`, `122311111112`, `122311111113`, `122311112111`, `122311112112`, `122311113111`, `122311113112`, `122311113113`, `12241211112`, `12241213112`, `12251111213`, `12311111114`, `12311111111`, `12311111112`, `12311111113`, `12311111212`, `12311111213`, `12311111314` |
| 생성 파일 수 | 20 |
| row 수 | 176 |
| next leaf 수 | 44 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 16 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12311111311`, `12311111312`, `12311111313`, `12311112114`, `12311112111`, `12311112113`, `1231111212`, `12311112311`, `12311112312`, `12311112313`, `12341111111`, `12341111112`, `12343111111`, `12343211111`, `12343211112`, `12343212111`, `12343212112`, `13111111114`, `13111111111`, `13111111112` |
| 생성 파일 수 | 20 |
| row 수 | 182 |
| next leaf 수 | 39 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 17 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `13111111113`, `13111111211`, `13111111213`, `13111112114`, `13112111111`, `13112111112`, `13112111113`, `13112112111`, `13112112112`, `13112112113`, `1311211314`, `13112121114`, `13112122113`, `13112151111`, `13112152111`, `13112152114`, `13112152311`, `13112152312`, `13121111111`, `13121111113` |
| 생성 파일 수 | 20 |
| row 수 | 201 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 18 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `13121111114`, `1312111112`, `13121111212`, `13121111213`, `13121112114`, `13131111111`, `13131111112`, `13131111113`, `13131111114`, `13131113113`, `13162143111`, `13162143113`, `13162143114`, `13163111111`, `13221111113`, `13221113313`, `13233111111`, `13233112111`, `13233211111`, `13233212111` |
| 생성 파일 수 | 20 |
| row 수 | 194 |
| next leaf 수 | 21 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 19 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `13253212111`, `13271221414`, `13271232414`, `13311111111`, `13333211111`, `13333211211`, `13333214111`, `13333214211`, `13352111111`, `13352111114`, `13352112113`, `13352121113`, `13353311111`, `13353311114`, `13353314111`, `13353314114`, `21121132111`, `21121132211`, `21122221113`, `21141211113` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 20 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 20 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `21142132113`, `21142133212`, `21142211313`, `312311111131`, `312311333131`, `312321111131`, `312321321131`, `312321332121`, `31241111213`, `31241112212`, `312411131131`, `31242112312`, `312421313131`, `41121111212`, `41121311212`, `41121313212`, `41121321111`, `41121341213`, `41121343214`, `41121351112` |
| 생성 파일 수 | 20 |
| row 수 | 167 |
| next leaf 수 | 20 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 21 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `41121351213`, `41121352213`, `41122111212`, `41122311312`, `41122312112`, `41122312212`, `41122321212`, `41122322112`, `41122322312`, `41123111212`, `41123133112`, `41124111112`, `411242111122`, `41124211212`, `411332112132`, `411332313132`, `411342112142`, `412121143131`, `412122412122`, `412123111111` |
| 생성 파일 수 | 20 |
| row 수 | 163 |
| next leaf 수 | 21 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Batch 22 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `412123113131`, `412123211121`, `412123221121`, `412123223121`, `412211231141`, `412213241131`, `422422133131` |
| 생성 파일 수 | 7 |
| row 수 | 62 |
| next leaf 수 | 7 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 5 Aggregate 결과

| 항목 | 값 |
|---|---|
| frontier | `/var/folders/gy/yt1tpc6x4jn0gknxdqky4xd00000gn/T/opencode/step5-frontier.txt` |
| 생성 파일 수 | 427 |
| row 수 | 4331 |
| next leaf 수 | 666 |
| unique next leaf 수 | 666 |
| validation violations | 0 |
| 다음 frontier | `/var/folders/gy/yt1tpc6x4jn0gknxdqky4xd00000gn/T/opencode/step6-frontier.txt` |
| 첫 ID | `11111151111121` |
| 마지막 ID | `42242213313113` |

## Step 6 Batch 1 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11111151111121`, `1111121111111`, `1111121111112`, `1111121111142`, `1111121114212`, `1111121114222`, `1111121221212`, `1111121221222`, `1111121222212`, `1111121222222`, `1111131311313`, `1111131311323`, `1111131312313`, `1111131312323`, `1111141515151`, `1111151311111`, `1111151311121`, `1111151312112`, `1111151312121`, `1111151322121` |
| 생성 파일 수 | 20 |
| row 수 | 189 |
| next leaf 수 | 28 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 9개 제거 |

## Step 6 Batch 2 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111151332121`, `111115511111`, `111115511121`, `111115512111`, `111115512121`, `111115521111`, `111115521121`, `111115522111`, `111115522121`, `1111161411111`, `1111161411121`, `1111161412112`, `1111161412121`, `1111161421111`, `1111161421121`, `1111161422111`, `1111161422121`, `1111161442121`, `1111161451111`, `1111161451121` |
| 생성 파일 수 | 20 |
| row 수 | 186 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 4개 제거 |

## Step 6 Batch 3 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111161452111`, `1111161452121`, `1111161461111`, `1111161461121`, `1111174111111`, `1111174121111`, `1111182111111`, `1111183212121`, `1111211112222`, `1111211132222`, `1111211212222`, `1111211231111`, `1111211231122`, `1111211232212`, `1111211232221`, `1111211311111`, `1111211331111`, `1111212112222`, `1111212132222`, `1111212212222` |
| 생성 파일 수 | 20 |
| row 수 | 189 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 2개 제거 |

## Step 6 Batch 4 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111212231111`, `1111212231122`, `1111212232212`, `1111212232221`, `1111212311111`, `1111212331111`, `1111213112222`, `1111213131111`, `1111213131122`, `1111213132212`, `1111213132221`, `1111213211111`, `1111213231111`, `1111214111111`, `1111214131111`, `1111214212222`, `1111214231111`, `1111214231122`, `1111214232212`, `1111214232221` |
| 생성 파일 수 | 20 |
| row 수 | 202 |
| next leaf 수 | 32 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 6개 제거 |

## Step 6 Batch 5 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111215424242`, `1111221111111`, `1111221111112`, `1111221121111`, `1111222121212`, `1111251421111`, `1111251421121`, `1111251422112`, `1111251422121`, `1111251431111`, `1111251431121`, `1111251432111`, `1111251432121`, `1111251451111`, `1111251451131`, `1111251453111`, `1111251453131`, `1111251461111`, `1111251461121`, `1111251462111` |
| 생성 파일 수 | 20 |
| row 수 | 183 |
| next leaf 수 | 26 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 6 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111251462121`, `1111261311111`, `1111261311121`, `1111261312112`, `1111261312121`, `1111261322121`, `1111261332121`, `1111261341111`, `1111271221111`, `1111271221121`, `1111271222112`, `1111271222121`, `111127211111`, `111127211121`, `111127212111`, `111127212121`, `111127221111`, `1111282111111`, `1111283212121`, `1111311111111` |
| 생성 파일 수 | 20 |
| row 수 | 177 |
| next leaf 수 | 24 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 6개 제거 |

## Step 6 Batch 7 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111321111111`, `1111321111112`, `1111321211111`, `1111321321111`, `1111331311313`, `1111341111111`, `1111341221111`, `1111341321212`, `1111342122121`, `1111342221111`, `1111342221131`, `1111342223111`, `1111342223131`, `1111342311111`, `1111342322121`, `1111343121111`, `1111351421111`, `1111351421121`, `1111351422112`, `1111351422121` |
| 생성 파일 수 | 20 |
| row 수 | 175 |
| next leaf 수 | 24 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 8 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111351431111`, `1111351431121`, `1111351432111`, `1111351432121`, `1111351451111`, `1111351451131`, `1111351453111`, `1111351453131`, `1111351461111`, `1111351461121`, `1111351462111`, `1111351462121`, `111136112222`, `111136121111`, `111136121121`, `111136122112`, `111136122121`, `111137211111`, `111137221111`, `1111382111111` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 7개 제거 |

## Step 6 Batch 9 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111383212121`, `1111411511111`, `111142211111`, `1111431311313`, `1111441511111`, `1111451311111`, `1111451311121`, `1111451312112`, `1111451312121`, `1111451322121`, `1111451332121`, `111145511111`, `111145511121`, `111145512111`, `111145512121`, `111145521111`, `111145521121`, `111145522111`, `111145522121`, `1111461411111` |
| 생성 파일 수 | 20 |
| row 수 | 193 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 intermediate continue ID 1개 제거 |

## Step 6 Batch 10 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111461411121`, `1111461412112`, `1111461412121`, `1111461421111`, `1111461421121`, `1111461422111`, `1111461422121`, `1111461442121`, `1111461451111`, `1111461451121`, `1111461452111`, `1111461452121`, `1111461461111`, `1111461461121`, `1111471221111`, `1111471221121`, `1111471222112`, `1111471222121`, `111147211111`, `111147211121` |
| 생성 파일 수 | 20 |
| row 수 | 222 |
| next leaf 수 | 39 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 11 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111147212111`, `111147212121`, `111147221111`, `1111481111111`, `1111481211111`, `1111481311111`, `1111481421111`, `1111481521111`, `1111481521211`, `1111481521221`, `1111481521312`, `1111481521321`, `1111481521322`, `1111481522111`, `1111481523111`, `1111481523121`, `1111481523122`, `1111481523211`, `1111481523212`, `1111481523213` |
| 생성 파일 수 | 20 |
| row 수 | 197 |
| next leaf 수 | 47 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 12 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111481523221`, `1111481523222`, `1121411143333`, `1121413123333`, `112141633333`, `1121421111111`, `1121421111132`, `1121421113211`, `1121421113222`, `1121422121111`, `1121422121132`, `1121422122211`, `1121422122222`, `1121451331111`, `112145533333`, `1121461111111`, `1121461121111`, `1121461131111`, `1121461211111`, `1121461211112` |
| 생성 파일 수 | 20 |
| row 수 | 218 |
| next leaf 수 | 31 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 13 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1121461211221`, `1121461211222`, `1121461311111`, `1121461411111`, `1121461421111`, `1121461421211`, `1121461421212`, `1121461421221`, `1121461421321`, `1121461421322`, `1121461421323`, `1121461422111`, `1121461422112`, `1121461422113`, `1121461422121`, `1121461422122`, `1121461422123`, `1121461422211`, `1121461422212`, `1121461422213` |
| 생성 파일 수 | 20 |
| row 수 | 206 |
| next leaf 수 | 66 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 누락 leaf 8개 추가 |

## Step 6 Batch 14 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1121461422221`, `1121461422222`, `1121461422223`, `112221333333`, `1122411111111`, `1122411111133`, `1122411113333`, `1122411511111`, `1122421111111`, `1122421111132`, `1122421113211`, `1122421113222`, `1122422121111`, `1122422121132`, `1122422122211`, `1122422122222`, `1122451211111`, `1122451221111`, `1122451221311`, `1122451221313` |
| 생성 파일 수 | 20 |
| row 수 | 224 |
| next leaf 수 | 36 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 누락 leaf 1개 추가 |

## Step 6 Batch 15 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1122451221333`, `1122451231111`, `1122451231311`, `1122451231313`, `1122451243333`, `1122462111111`, `1122462111211`, `1122462111222`, `1122462111311`, `1122462111312`, `1122462111313`, `1122462111321`, `1122462111322`, `1122462221111`, `1122462221311`, `1122462221313`, `1122462221333`, `1122462223333`, `1122462321111`, `1122462321311` |
| 생성 파일 수 | 20 |
| row 수 | 205 |
| next leaf 수 | 39 |
| validation violations | 0 |
| 보정 | `다음 실행 ID`의 누락 leaf 3개 추가 |

## Step 6 Batch 16 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1122462321313`, `1122462321333`, `1122462323333`, `1123211143333`, `1123213123333`, `1123213333333`, `112321633333`, `1123411143333`, `1123413123333`, `112341633333`, `1123421111111`, `1123421111132`, `1123422121111`, `1123422121132`, `1123422122211`, `1123422122222`, `1123423121111`, `112345333333`, `112345633333`, `1123462111111` |
| 생성 파일 수 | 20 |
| row 수 | 231 |
| next leaf 수 | 28 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 17 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1123462111211`, `1123462111222`, `1123462111311`, `1123462111312`, `1123462111313`, `1123462111321`, `1123462111322`, `1123462221111`, `1123462221311`, `1123462221313`, `1123462221333`, `1123462223333`, `1123462321111`, `1123462321311`, `1123462321313`, `1123462321333`, `1123462323333`, `1124211144333`, `112421334333`, `1124214123333` |
| 생성 파일 수 | 20 |
| row 수 | 210 |
| next leaf 수 | 25 |
| validation violations | 0 |
| 보정 | `1123462111312`의 stale `다음 실행 ID` 1개 제거 |

## Step 6 Batch 18 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1124214334333`, `112421734333`, `1124411111111`, `1124411111133`, `1124411113333`, `1124421111111`, `1124421111132`, `1124422121111`, `1124422121132`, `1124422122211`, `1124422122222`, `1124451211111`, `1124451221111`, `1124451221311`, `1124451221313`, `1124451221333`, `1124451231111`, `1124451231311`, `1124451231313`, `1124451243333` |
| 생성 파일 수 | 20 |
| row 수 | 229 |
| next leaf 수 | 30 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 19 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1124462111111`, `1124462111211`, `1124462111222`, `1124462111311`, `1124462111312`, `1124462111313`, `1124462111321`, `1124462111322`, `1124462221111`, `1124462221311`, `1124462221313`, `1124462221333`, `1124462223333`, `1124462321111`, `1124462321311`, `1124462321313`, `1124462321333`, `1124462323333`, `1213411111111`, `1213411111113` |
| 생성 파일 수 | 20 |
| row 수 | 216 |
| next leaf 수 | 27 |
| validation violations | 0 |
| 보정 | `1213411111113`의 non-leaf `다음 실행 ID` 1개 제거 |

## Step 6 Batch 20 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1213411111311`, `1213411111313`, `1213411131111`, `1213411131113`, `1213411131311`, `1213411131313`, `1213411311111`, `1213411311113`, `1213411311311`, `1213411311313`, `1213413111111`, `1213413111113`, `1213413111311`, `1213413111313`, `1213413131111`, `1213413131113`, `1213413131311`, `1213413131313`, `1215311111111`, `1215311111113` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 40 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 21 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1215311111311`, `1215311111313`, `1215311131111`, `1215311131113`, `1215311131311`, `1215311131313`, `1215311311111`, `1215311311113`, `1215311311311`, `1215311311313`, `1215313111111`, `1215313111113`, `1215313111311`, `1215313111313`, `1215313131111`, `1215313131113`, `1215313131311`, `1215313131313`, `1217211111111`, `1217211111113` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 40 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 22 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1217211111311`, `1217211111313`, `1217211131111`, `1217211131113`, `1217211131311`, `1217211131313`, `1217211311111`, `1217211311113`, `1217211311311`, `1217211311313`, `1217213111111`, `1217213111113`, `1217213111311`, `1217213111313`, `1217213131111`, `1217213131113`, `1217213131311`, `1217213131313`, `12211111111111`, `12211111111121` |
| 생성 파일 수 | 20 |
| row 수 | 191 |
| next leaf 수 | 40 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 23 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12211111111311`, `12211111121111`, `12211111121211`, `12211121111111`, `12211121111113`, `12211121211111`, `12211131111111`, `12211131111131`, `1221113111131`, `12211131113111`, `12211311111111`, `12211311111221`, `12211311112111`, `12211311121111`, `12211311121211`, `12211311121212`, `12211311131111`, `12211311131121`, `12211311211111`, `12211311211211` |
| 생성 파일 수 | 20 |
| row 수 | 213 |
| next leaf 수 | 42 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 24 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12211311231111`, `12211311231211`, `12231111111111`, `12231111111112`, `12231111111113`, `12231111111211`, `12231111111212`, `12231111111213`, `12231111111322`, `12231111211111`, `12231111211112`, `12231111211113`, `12231111211211`, `12231111211212`, `12231111211213`, `12231111311111`, `12231111311112`, `12231111311113`, `12231111311211`, `12231111311212` |
| 생성 파일 수 | 20 |
| row 수 | 166 |
| next leaf 수 | 32 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 25 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `12231111311213`, `12231111311322`, `1224121111212`, `1224121111213`, `1224121311212`, `1224121311213`, `1225111121313`, `123111111114`, `1231111111211`, `1231111111213`, `123111111122`, `1231111111312`, `1231111111313`, `1231111111411`, `1231111111413`, `1231111121212`, `1231111121213`, `1231111121312`, `1231111121313`, `1231111131111` |
| 생성 파일 수 | 20 |
| row 수 | 172 |
| next leaf 수 | 28 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 26 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1231111131123`, `123111113122`, `1231111131313`, `1231111131411`, `1231111131412`, `1231111131413`, `123111121112`, `1231111211313`, `1231111211411`, `123111121211`, `12311112122`, `123111123112`, `1231111231212`, `1231111231313`, `1234111111111`, `1234111111112`, `1234111111113`, `123411111112`, `1234111111211`, `1234111111212` |
| 생성 파일 수 | 20 |
| row 수 | 176 |
| next leaf 수 | 16 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 27 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1234111111213`, `1234311111111`, `1234311111112`, `1234311111113`, `1234321111111`, `1234321111112`, `1234321111211`, `1234321111213`, `123432111122`, `1234321211111`, `1234321211112`, `1234321211211`, `1234321211213`, `123432121122`, `1311111111122`, `131111111114`, `1311111111211`, `1311111111213`, `131111111122`, `1311111111311` |
| 생성 파일 수 | 20 |
| row 수 | 184 |
| next leaf 수 | 25 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 28 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1311111111321`, `1311111111411`, `1311111111413`, `1311111121121`, `1311111121123`, `1311111121312`, `1311111121313`, `1311111121322`, `1311111211431`, `1311211111121`, `1311211111211`, `1311211111213`, `1311211111311`, `1311211111321`, `1311211211121`, `1311211211211`, `1311211211213`, `1311211211311`, `1311211211321`, `131121131441` |
| 생성 파일 수 | 20 |
| row 수 | 175 |
| next leaf 수 | 23 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 29 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1311212111441`, `1311212211321`, `1311215211121`, `1311215211441`, `1311215231121`, `1311215231221`, `1312111111121`, `1312111111313`, `1312111111441`, `131211111222`, `1312111121221`, `1312111121332`, `1312111211431`, `1313111111121`, `1313111111123`, `1313111111213`, `1313111111313`, `1313111111431`, `1313111311313`, `1316214311121` |
| 생성 파일 수 | 20 |
| row 수 | 173 |
| next leaf 수 | 21 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 30 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1316214311313`, `1316214311441`, `1316311111113`, `1322111111313`, `1322111331313`, `1323311111111`, `1323311211111`, `1323321111111`, `1323321211111`, `1325321211111`, `1327122141414`, `1327123241414`, `1331111111111`, `1333321111111`, `1333321121111`, `1333321411111`, `1333321421111`, `1335211111111`, `1335211111411`, `1335211111414` |
| 생성 파일 수 | 20 |
| row 수 | 193 |
| next leaf 수 | 21 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 31 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1335331111111`, `1335331111411`, `1335331111414`, `1335331411111`, `1335331411411`, `1335331411414`, `2112113211113`, `2112222111313`, `2114121111313`, `2114213211313`, `2114213321212`, `2114221131313`, `3114231111111`, `3114231111121`, `3114231111311`, `3114231211111`, `3114231211211`, `3114231221111`, `3114231221211`, `31231111113113` |
| 생성 파일 수 | 20 |
| row 수 | 171 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 32 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `31231133313113`, `31232111113113`, `31232132113113`, `31232133212112`, `3124111121313`, `3124111221212`, `31241113113113`, `3124211231212`, `31242131313113`, `4112111121212`, `4112131121212`, `4112131321212`, `4112132111111`, `4112134121313`, `4112134321414`, `4112135111212`, `4112135121313`, `4112135221313`, `4112211121212`, `4112231131212` |
| 생성 파일 수 | 20 |
| row 수 | 166 |
| next leaf 수 | 20 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 33 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `4112231211212`, `4112231221212`, `4112232121212`, `4112232211212`, `4112232231212`, `4112311121212`, `4112313311212`, `4112411111212`, `41124211112213`, `4112421121212`, `41133211213213`, `41133231313213`, `41134211214214`, `41212114313113`, `41212241212212`, `41212241212213`, `41212311111111`, `41212311313113`, `41212321112111`, `41212322112111` |
| 생성 파일 수 | 20 |
| row 수 | 167 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Batch 34 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `41212322312111`, `41221123114114`, `41221324113113`, `4223122111111`, `4223152122221`, `42242213313113` |
| 생성 파일 수 | 6 |
| row 수 | 53 |
| next leaf 수 | 5 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 6 Aggregate 결과

| 항목 | 값 |
|---|---|
| frontier 수 | 666 |
| 검증 파일 수 | 666 |
| row 수 | 6404 |
| next leaf 수 | 1007 |
| unique next leaf 수 | 1007 |
| validation violations | 0 |
| 다음 frontier | `/var/folders/gy/yt1tpc6x4jn0gknxdqky4xd00000gn/T/opencode/step7-frontier.txt` |

## Step 7 Batch 1 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `1111115111112112`, `111112111111111`, `111112111111114`, `111112111111213`, `111112111114212`, `111112111114222`, `111112111421212`, `111112111422212`, `111112111422222`, `111112122121212`, `111112122122212`, `111112122122222`, `111112122221212`, `111112122222212`, `111112122222222`, `111113131131313`, `111113131132313`, `111113131132323`, `111113131231313`, `111113131232313` |
| 생성 파일 수 | 20 |
| row 수 | 174 |
| next leaf 수 | 24 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 2 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111113131232323`, `111114151515151`, `111115131111111`, `111115131112112`, `111115131112121`, `111115131211212`, `111115131212111`, `111115132212121`, `111115133212121`, `11111551111111`, `11111551111121`, `11111551112111`, `11111551112121`, `11111551211111`, `11111551211121`, `11111551212111`, `11111551212121`, `11111552111111`, `11111552112111`, `11111552211111` |
| 생성 파일 수 | 20 |
| row 수 | 178 |
| next leaf 수 | 24 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 3 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11111552212111`, `111116141111111`, `111116141112112`, `111116141112121`, `111116141211212`, `111116141212111`, `111116142111111`, `111116142112111`, `111116142112121`, `111116142211111`, `111116142212111`, `111116144212121`, `111116145111111`, `111116145112111`, `111116145112121`, `111116145211111`, `111116145211121`, `111116145212111`, `111116145212121`, `111116146111111` |
| 생성 파일 수 | 20 |
| row 수 | 168 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 4 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111116146112111`, `111116146112121`, `111117411111111`, `111117412111111`, `111118211111111`, `111118321212111`, `111121111222222`, `111121113222222`, `111121121222222`, `111121123111111`, `111121123111122`, `111121123112212`, `111121123112221`, `111121123221212`, `111121123221221`, `111121123222111`, `111121123222122`, `111121131111111`, `111121133111111`, `111121211222222` |
| 생성 파일 수 | 20 |
| row 수 | 172 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 5 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111121213222222`, `111121221222222`, `111121223111111`, `111121223111122`, `111121223112212`, `111121223112221`, `111121223221212`, `111121223221221`, `111121223222111`, `111121223222122`, `111121231111111`, `111121233111111`, `111121311222222`, `111121313111111`, `111121313111122`, `111121313112212`, `111121313112221`, `111121313221212`, `111121313221221`, `111121313222111` |
| 생성 파일 수 | 20 |
| row 수 | 167 |
| next leaf 수 | 23 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 6 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111121313222122`, `111121321111111`, `111121323111111`, `111121411111111`, `111121413111111`, `111121421222222`, `111121423111111`, `111121423111122`, `111121423112212`, `111121423112221`, `111121423221212`, `111121423221221`, `111121423222111`, `111121423222122`, `111121542424242`, `111122111111111`, `111122111111211`, `111122112111111`, `111122212121212`, `111125142111111` |
| 생성 파일 수 | 20 |
| row 수 | 173 |
| next leaf 수 | 23 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 7 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111125142112112`, `111125142112121`, `111125142211212`, `111125142212111`, `111125143111111`, `111125143112111`, `111125143112121`, `111125143211111`, `111125143212111`, `111125143212121`, `111125145111111`, `111125145113111`, `111125145113131`, `111125145311111`, `111125145313111`, `111125145313131`, `111125146111111`, `111125146112111`, `111125146112121`, `111125146211111` |
| 생성 파일 수 | 20 |
| row 수 | 175 |
| next leaf 수 | 25 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 8 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111125146212111`, `111125146212121`, `111126131111111`, `111126131112112`, `111126131112121`, `111126131211212`, `111126131212111`, `111126132212121`, `111126133212121`, `111126134111111`, `111127122111111`, `111127122112112`, `111127122112121`, `111127122211212`, `111127122212111`, `11112721111111`, `11112721112111`, `11112721112121`, `11112721211111`, `11112721212111` |
| 생성 파일 수 | 20 |
| row 수 | 167 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 9 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11112722111111`, `111128211111111`, `111128321212111`, `111131111111111`, `111132111111111`, `111132111111121`, `111132111111211`, `111132121111111`, `111132132111111`, `111133131131313`, `111134111111111`, `111134122111111`, `111134132121212`, `111134212212121`, `111134222111111`, `111134222113111`, `111134222113131`, `111134222311111`, `111134222313111`, `111134222313131` |
| 생성 파일 수 | 20 |
| row 수 | 182 |
| next leaf 수 | 25 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 10 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111134231111111`, `111134232212121`, `111134312111111`, `111135142111111`, `111135142112112`, `111135142112121`, `111135142211212`, `111135142212111`, `111135143111111`, `111135143112111`, `111135143112121`, `111135143211111`, `111135143212111`, `111135143212121`, `111135145111111`, `111135145113111`, `111135145113131`, `111135145311111`, `111135145313111`, `111135145313131` |
| 생성 파일 수 | 20 |
| row 수 | 167 |
| next leaf 수 | 22 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 11 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111135146111111`, `111135146112111`, `111135146112121`, `111135146211111`, `111135146212111`, `111135146212121`, `11113611222222`, `11113612111111`, `11113612112112`, `11113612112121`, `11113612211212`, `11113612212111`, `11113721111111`, `11113722111111`, `111138211111111`, `111138321212111`, `111141151111111`, `11114221111111`, `111143131131313`, `111144151111111` |
| 생성 파일 수 | 20 |
| row 수 | 181 |
| next leaf 수 | 24 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 12 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111145131111111`, `111145131112112`, `111145131112121`, `111145131211212`, `111145131212111`, `111145132212121`, `111145133212121`, `11114551111111`, `11114551111121`, `11114551112111`, `11114551112121`, `11114551211111`, `11114551211121`, `11114551212111`, `11114551212121`, `11114552111111`, `11114552112111`, `11114552112121`, `11114552211111`, `11114552212111` |
| 생성 파일 수 | 20 |
| row 수 | 252 |
| next leaf 수 | 32 |
| validation violations | 0 |
| 보정 | `111145133212121`의 다음 실행 ID에서 non-leaf 항목 제거 |

## Step 7 Batch 13 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11114552212121`, `111146141111111`, `111146141112111`, `111146141112121`, `111146141211211`, `111146141211221`, `111146141212111`, `111146141212121`, `111146142111111`, `111146142111121`, `111146142112111`, `111146142112121`, `111146142211111`, `111146142211121`, `111146142212111`, `111146142212121`, `111146144212121`, `111146145111111`, `111146145111121`, `111146145112111` |
| 생성 파일 수 | 20 |
| row 수 | 293 |
| next leaf 수 | 41 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 14 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111146145112121`, `111146145211111`, `111146145211121`, `111146145212111`, `111146145212121`, `111146146111111`, `111146146111121`, `111146146112111`, `111146146112121`, `111147122111111`, `111147122111121`, `111147122112112`, `111147122112121`, `111147122211212`, `111147122211221`, `111147122212111`, `111147122212121`, `11114721111111`, `11114721111121`, `11114721112111` |
| 생성 파일 수 | 20 |
| row 수 | 336 |
| next leaf 수 | 48 |
| validation violations | 0 |
| 보정 | 없음 |

## Step 7 Batch 15 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `11114721112121`, `11114721211111`, `11114721211121`, `11114721212111`, `11114721212121`, `11114722111111`, `111148111111111`, `111148121111111`, `111148131111111`, `111148142111111`, `111148152111111`, `111148152121111`, `111148152121121`, `111148152122111`, `111148152122121`, `111148152131211`, `111148152131221`, `111148152131222`, `111148152132111`, `111148152132121` |
| 생성 파일 수 | 20 |
| row 수 | 339 |
| next leaf 수 | 51 |
| validation violations | 0 |
| 보정 | 표 pipe 형식, `다음 실행 ID` 목록 형식, `route to:` 플래그 형식 보정 |

## Step 7 Batch 16 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111148152132122`, `111148152132131`, `111148152132132`, `111148152132211`, `111148152132213`, `111148152211111`, `111148152311111`, `111148152311121`, `111148152311122`, `111148152312111`, `111148152312121`, `111148152312122`, `111148152312131`, `111148152312132`, `111148152312211`, `111148152312213`, `111148152321111`, `111148152321121`, `111148152321122`, `111148152321131` |
| 생성 파일 수 | 20 |
| row 수 | 379 |
| next leaf 수 | 82 |
| validation violations | 0 |
| 보정 | 표 pipe 형식, `다음 실행 ID` 목록 누락, malformed route/terminal 형식 보정 |

## Step 7 Batch 17 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `111148152321132`, `111148152321211`, `111148152321212`, `111148152321221`, `111148152321223`, `111148152321311`, `111148152321312`, `111148152321321`, `111148152322111`, `111148152322113`, `111148152322211`, `111148152322213`, `112141114333333`, `112141312333333`, `11214163333333`, `112142111111111`, `112142111111122`, `112142111113211`, `112142111113222`, `112142111321111` |
| 생성 파일 수 | 20 |
| row 수 | 255 |
| next leaf 수 | 42 |
| validation violations | 0 |
| 보정 | 표 pipe 형식, `route to:` 플래그 형식, `다음 실행 ID` 누락 항목 보정 |

## Step 7 Batch 18 결과

| 항목 | 값 |
|---|---|
| 실행 ID | `112142111321122`, `112142111322211`, `112142111322222`, `112142212111111`, `112142212111122`, `112142212113211`, `112142212113222`, `112142212221111`, `112142212221122`, `112142212222211`, `112142212222222`, `112145133111111`, `11214553333333`, `112146111111111`, `112146112111111`, `112146113111111`, `112146121111111`, `112146121111112`, `112146121111222`, `112146121122111` |
| 생성 파일 수 | 20 |
| row 수 | 229 |
| next leaf 수 | 33 |
| validation violations | 0 |
| 보정 | canonical table format, `다음 실행 ID` 목록, terminal/route descendant 규칙 보정 |
