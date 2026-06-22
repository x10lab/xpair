## CONTRADICTS

- FDA / Full Disk Access를 권장 권한으로 요청, poll, skip, 재시도, granted/pending 상태로 다루는 기대.
  Evidence: §1.5 Permissions / TCC (Q0025, Q0101, Q0245) says: "Avoid requesting unnecessary permissions." It also says: "When a grant is needed because a child session or screen component needs it, the document must say so explicitly." Conflict: requirements.md never identifies FDA / Full Disk Access as needed for XpairHost, so treating it as a recommended onboarding permission violates the explicit avoid-unnecessary-permissions rule.
- 클라이언트가 없을 때도 Host 권한/엔진 통과 후 Connect/Done 또는 host ready 대기 범위로 이동한다는 기대.
  Evidence: §1.5 Permissions / TCC (Q0543) says: "Starting XpairHost before any client is acceptable, but with no connected client the Host onboarding is expected to hold at the permission step rather than report completion." Conflict: the cluster expects no-client states to wait in Connect/Done or host ready after permissions/engine, not to hold at the permission step.

## UNSPECIFIED

- AX와 SR이 정확한 필수 권한 세트이고 둘 다 granted일 때만 gate가 풀린다는 구체 조건. requirements.md requires resolving required macOS permissions, but does not name AX/SR or define the exact gate formula.
- Accessibility / Screen Recording System Settings pane 열기, XpairHost 항목 찾기, 토글, 취소, 잘못된 pane 이동, 목록 검색/추가/재실행 같은 상세 조작.
- TCC poll의 granted/pending/rejected/missing 전이, poll 지연, macOS 재시작 안내, 상태 반영 타이밍.
- Next/Continue 버튼 활성/비활성, 같은 화면 유지, 진행 표시 유지, 특정 화면으로 돌아감 같은 UI 상태 세부 동작.
- Retry, 재확인, 권한 재시도 루프의 정확한 분기와 오류 문구.
- SSH/Tailscale SSH, sudo, 관리자 credential, 다운로드, known_hosts 정리, 설치 권한 검사, 다른 계정 입력 요구 등 host-install 세부 UX. §4 Open Issues says: "The six-digit / sign-in / host-install pairing UX is not fully specified."
- Host app guard, 버전 호환, host 경로, 실행 확인, 광고, watchdog, tmux host, screen sidecar, menu bar 항목 같은 구현 상태. §4 Open Issues says: "Implementation status must be sourced from a separate verification pass, not inferred from this requirements document."
- Engine ready/check/install/authentication 흐름과 권한 단계 이후 Engine 단계로 이동하는 정확한 순서. The SSOT only specifies selected agent/tool gates and engine choice placement, not these state transitions.
- 권한/engine 통과 뒤 프로젝트 선택, 세션 생성, 파일 접근 확인으로 이동하는 정확한 화면 전이.
- 권한 부족이나 파일 접근 부족 시 Retry를 표시하거나 권한 안내 화면으로 유지한다는 구체 UX.
- Xpair 클라이언트 연결, Connect/Done, 클라이언트 발견 여부, host ready 흐름의 세부 상태.
- Xpair 온보딩 범위 밖, 접근 불가, 무관한 Privacy 항목 조작 차단 같은 차단 라벨과 처리 방식.
- 창 닫기/취소/중단 시 "host 설치 없이 종료", "온보딩 완료 없이 종료", "FDA 상태 미확정" 등으로 기록하는 정확한 terminal state.
- 수동 remediation: System Settings 직접 열기, XpairHost 재실행, 앱 목록 재노출, 권한 pane 재시도, Xpair로 돌아와 Retry.

## BACKED

- Host가 macOS 권한을 보유하는 쪽이고 권한이 필요한 동작은 Host boundary 안에 있어야 한다는 기대.
  Evidence: §0.2 Host / Client Separation (Q0245, Q0337, Q0443) says: "Host is the permission-holding side." §0.3 Permission Boundary (Q0025, Q0101, Q0245) says: "Permission-needing behavior belongs on the Host side."
- Host onboarding에서 required permission/TCC flow를 처리해야 한다는 기대.
  Evidence: §1.2 First-Run Onboarding (Q0441, Q0442, Q0443) says: "Host onboarding must exist." It also says: "It is responsible for getting the Host through the required permission/TCC flow."
- TCC 또는 required macOS permission이 unresolved이면 setup success/usable 상태로 진행하지 않는다는 기대.
  Evidence: §1.5 Permissions / TCC (Q0443) says: "If TCC is not resolved, the app should not proceed as though setup succeeded."
- 권한 단계를 onboarding 안에서 이해 가능한 단계로 다루고, Settings/Permissions action이 관련 onboarding step을 다시 열 수 있다는 기대.
  Evidence: §1.5 Permissions / TCC (Q0183, Q0443, Q0473) says: "Permission steps should be broken into understandable onboarding steps." §1.2 First-Run Onboarding (Q0473, Q0493, Q0494) says: "Permissions and Settings actions should be able to reopen the relevant onboarding step."
- 필수 권한이 부족할 때 권한 안내나 재시도 상태를 유지하고 다음 usable 단계로 넘기지 않는다는 기대.
  Evidence: §1.5 Permissions / TCC (Q0443) says: "Host onboarding must resolve required macOS permissions before the Host is considered usable."
- Host-first / XpairHost-first 실행 자체는 가능하되 client 없이 완료로 보고하지 않는다는 기대.
  Evidence: §1.5 Permissions / TCC (Q0543) says: "Starting XpairHost before any client is acceptable."
- Screen sharing / Remote Desktop 같은 grant-bearing component가 permission boundary를 명시적으로 고려해야 한다는 기대.
  Evidence: §0.3 Permission Boundary (Q0346, Q0438, Q0474) says: "Screen sharing / Remote Desktop may require grant-bearing components."
- Host/Client 역할이 분리되어 있고 installer/onboarding이 역할별 책임을 고려해야 한다는 기대.
  Evidence: §0.2 Host / Client Separation (Q0343) says: "Xpair has two different app roles: Host and Client." §1.1 Install / Distribution (Q0021, Q0022, Q0343) says: "The installer must be role-aware."

Tally: BACKED=8 UNSPECIFIED=14 CONTRADICTS=2 (distinct 예상 considered: 24)
