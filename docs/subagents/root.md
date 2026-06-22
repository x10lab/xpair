# root

| ID | 동작 | 예상 | 현행 | 플래그 |
|---|---|---|---|---|
| 0 | 사용자가 Xpair를 실행하지 않음 | 아무 앱 실행, CLI 호출, 권한 요청, 세션 생성도 발생하지 않음 | 동일 | terminate |
| 1 | 사용자가 Xpair IDE 앱을 실행함 | Xpair 앱 실행 결과에 따라 실행 실패, 첫 실행 온보딩, 기존 workbench, IDE 표면 선택으로 분기 | 하위 항목에서 검증 | continue |
| 10 | 사용자가 Xpair를 실행했지만 앱이 열리지 않음 | 사용자에게 실행 실패가 드러나고 flow 종료 | 미검증 | terminate |
| 11 | Xpair IDE가 첫 실행 온보딩을 표시함 | 사용자는 닫기, host discovery/setup 진행, manual host/connect 진행 중 하나로 분기 | 하위 항목에서 검증 | continue |
| 110 | 첫 실행 온보딩 창을 완료 전에 닫음 | 온보딩이 완료되지 않았으므로 Xpair workbench로 넘어가지 않음 | 현행은 이전 검토 기준 완료 전 close가 workbench로 이어질 가능성이 있음 | terminate |
| 111 | 첫 실행 온보딩에서 사용자가 host discovery/setup 흐름으로 진행 | host 탐색, 설치, 권한, 엔진, 매핑 단계로 이어짐 | 하위 파일에서 검증 | continue |
| 112 | 첫 실행 온보딩에서 사용자가 manual host/connect 흐름으로 진행 | 수동 host 입력과 SSH/host-app guard로 이어짐 | 하위 파일에서 검증 | continue |
| 12 | Xpair IDE가 기존 설정으로 workbench를 표시함 | usable host 유무와 session 상태, setup again 선택으로 분기 | 하위 항목에서 검증 | continue |
| 121 | 이미 설정된 Xpair workbench를 열었지만 usable host가 없음 | host 설정/재온보딩/오류 표시 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 122 | 이미 설정된 Xpair workbench를 열고 reachable host가 있으나 세션 없음 | 새 세션 생성 또는 화면/파일 표면 사용 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 123 | 이미 설정된 Xpair workbench를 열고 reachable host와 기존 세션이 있음 | 기존 세션 확인, attach, 새 세션 생성 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 124 | Xpair 안에서 setup again/force onboarding 흐름으로 진입 | 기존 세션 보존 안내 후 재온보딩으로 이어짐 | 하위 파일에서 검증 | continue |
| 13 | 사용자가 Xpair IDE 안에서 표면/기능을 선택함 | Xpair 범위 밖 표면은 차단하고 Xpair 표면은 해당 기능 flow로 이어짐 | 하위 항목에서 검증 | continue |
| 130 | Xpair 범위 밖의 VSCodium 기본 표면에 접근 시도 | 접근 불가로 차단하고 하위 탐색하지 않음 | 미검증 | terminate |
| 131 | 사용자가 Xpair Sessions 표면을 엶 | Attached/Detached/session action 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 132 | 사용자가 Xpair Remote Desktop 표면을 엶 | view-only RD 연결/새로고침/오류 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 133 | 사용자가 Xpair Browser/Add Root/Settings 표면을 엶 | 파일 root, mount, mapping, settings, logs 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 2 | 사용자가 Finder Quick Action으로 Xpair를 실행함 | 잘못된 선택이면 종료하고 실행 가능한 선택이면 mapped/stale 상태로 분기 | 하위 항목에서 검증 | continue |
| 20 | Finder Quick Action을 잘못된 선택/입력으로 실행 | 실행하지 않고 종료 | 미검증 | terminate |
| 21 | Finder Quick Action 입력이 실행 가능한 선택으로 들어옴 | GUI 처리 불가, mapped folder, stale/unreachable 상태로 분기 | 하위 항목에서 검증 | continue |
| 210 | Finder Quick Action을 GUI가 처리할 수 없는 unmapped 상태로 실행 | GUI에서 추가 입력을 받을 수 없으므로 종료 | 미검증 | terminate |
| 211 | Finder Quick Action을 mapped folder에서 실행 | 매핑된 host path의 세션 attach 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 212 | Finder Quick Action을 stale mapping 또는 unreachable host 상태에서 실행 | 오류/복구/route 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 3 | 사용자가 `xpair` CLI를 실행함 | 잘못된 명령이면 종료하고 `xpair launch`면 launch flow로 들어감 | 하위 항목에서 검증 | continue |
| 30 | `xpair` CLI를 잘못된 명령/옵션/경로로 실행 | 사용법/오류 출력 후 종료 | 미검증 | terminate |
| 31 | 사용자가 `xpair launch` 흐름으로 들어감 | local/self-host, mapped remote, unmapped interactive, SSH/auth 실패로 분기 | 하위 항목에서 검증 | continue |
| 311 | `xpair launch`를 local/self-host target으로 실행 | local tmux/session 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 312 | `xpair launch`를 mapped remote target으로 실행 | remote mosh/tmux/session 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 313 | `xpair launch`를 unmapped folder에서 interactive mapping/create 흐름으로 실행 | map 등록 또는 host dir 생성 선택 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 314 | `xpair launch`에서 SSH/auth/host reachability 실패 흐름으로 진입 | 실패 안내, local fallback, terminate 흐름으로 이어짐 | 하위 파일에서 검증 | continue |
| 4 | 사용자가 Xpair보다 XpairHost를 먼저 실행하거나 조작함 | Host-first도 접근 가능한 flow로 보고 권한/엔진/클라이언트 대기까지 추적 | 하위 항목에서 검증 | continue |
| 40 | 사용자가 XpairHost를 실행하지 못함 | 사용자에게 실행 실패가 드러나고 flow 종료 | 미검증 | terminate |
| 41 | XpairHost가 먼저 열려 host onboarding이 표시됨 | 권한, 엔진, Connect 단계로 이어질 수 있음 | 하위 항목에서 검증 | continue |
| 410 | Host onboarding을 닫아 권한/설정을 완료하지 않음 | 권한 미완료면 Host가 종료되거나 준비 상태로 넘어가지 않음 | 미검증 | terminate |
| 411 | Host onboarding에서 권한/엔진 설정을 진행 | AX/SR 권한과 엔진 설치/인증 guard를 통과해야 Connect 단계로 이동 | 하위 파일에서 검증 | continue |
| 412 | Host onboarding에서 Connect/Done 단계까지 진행 | 클라이언트가 없으면 “다른 Mac에서 Xpair를 열라”는 대기/안내 상태로 남음 | 하위 파일에서 검증 | continue |
| 42 | XpairHost가 준비된 뒤 클라이언트 없이 대기하거나 메뉴를 조작함 | 연결된 Xpair 클라이언트가 없으면 대기/상태 표시로 머무름 | 하위 항목에서 검증 | continue |
| 421 | Host가 준비된 상태에서 XpairHost 메뉴를 조작 | 메뉴에서 권한/Connect/Set up/업데이트/세션 상태를 조작 가능 | 하위 파일에서 검증 | continue |
| 422 | Host 준비 후 사용자가 Xpair 클라이언트를 열어 연결 시도 | Xpair 클라이언트 flow로 이어지고 Host는 connected client 상태를 표시 | 하위 파일에서 검증 | continue |
| 423 | Host가 준비됐지만 연결된 Xpair 클라이언트가 없음 | 클라이언트 없음 상태를 표시하고 Xpair 클라이언트 실행을 안내 | 하위 파일에서 검증 | continue |

다음 실행 ID
- 111
- 112
- 121
- 122
- 123
- 124
- 131
- 132
- 133
- 211
- 212
- 311
- 312
- 313
- 314
- 411
- 412
- 421
- 422
- 423
