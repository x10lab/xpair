## CONTRADICTS

- 없음. discovery 클러스터의 정규화된 예상 중 `docs/requirements.md`의 명시 요구와 직접 충돌한다고 판정할 수 있는 항목은 발견하지 못함.

## UNSPECIFIED

- 후보 card/row에서 `Set up`, `Connect`, `Reconnect`를 정확히 어떤 액션 세트로 노출하고 어떤 우선순위로 전환하는지: SSOT는 discovery 방향만 말하고 card/row 액션 모델은 명시하지 않음.
- Bonjour 후보와 Tailscale 후보가 card/list/row로 동시에 표시되는 방식, 먼저 표시되는 UI 순서, 후보별 선택 상태: LAN-first 원칙 외의 표시 세부는 SSOT에 없음.
- host 카드를 선택하지 않고 대기할 때 Discover 화면을 그대로 유지하고 진행하지 않는 idle 상태: SSOT에 명시 없음.
- scan 결과를 `설치 가능 host`, `실행 중 host`, `기존 host`, `no-host`로 나누는 정확한 분기 모델: SSOT에 명시 없음.
- `Retry scan`이 Bonjour와 Tailscale scan을 다시 시작하는 타이밍, wave, 중복 scan 방지 규칙: SSOT에 명시 없음.
- no-host 화면에서 `Retry`, manual fallback, 같은 Wi-Fi/Tailscale 안내를 어떤 조합으로 유지하는지: Tailscale/fallback 방향은 있으나 화면 구성은 명시 없음.
- `Enter manually`, `Connect over Internet`, manual host 입력 버튼과 라우팅 이름: SSOT에 명시 없음.
- manual host 입력 화면의 필드, Tailscale 안내, SSH 키 안내, `Check connection` 구성: SSOT에 명시 없음.
- 유효한 tailnet host일 때만 `Check connection`이 가능해지는 validation 상태: SSOT에 명시 없음.
- SSH probe 실패 시 `Couldn't reach host`, `Retry`, 주소/네트워크 안내를 표시하는 정확한 오류 화면: SSOT에 명시 없음.
- host key mismatch, rekeyed 안내, `known_hosts` 정리 요구, 신뢰 확인 전 설치 차단: SSOT에 명시 없음.
- Retry 후 같은 host 또는 수정된 host 기준으로 SSH/reachability를 다시 확인하는 세부 규칙: SSOT에 명시 없음.
- `Connect host`가 실행 중인 Host 연결 인증 흐름으로 이동한다는 구체 흐름명과 인증 단계: SSOT에 명시 없음.
- `Reconnect host`가 기존 SSH 키로 reachability를 확인한다는 구체 흐름: SSOT에 명시 없음.
- SSH 성공 후 `host app guard`, version guard, app 실행/Bonjour 광고 상태 확인으로 복귀하는 내부 guard 순서: SSOT에 명시 없음.
- host app guard 실패 뒤 재확인 버튼이 앱 실행과 Bonjour 광고 상태를 다시 확인한다는 동작: SSOT에 명시 없음.
- XpairHost 미설치 후보를 `Set up host`로 보고 계정/비밀번호 단계로 이동하는 구체 UI: SSOT에 명시 없음.
- Bonjour setup에서 macOS 계정명/비밀번호를 입력하고 발견 host 정보를 유지하는 화면: SSOT에 명시 없음.
- Tailscale setup에서 tailnet host 사용자명, 계정, 비밀번호, 설치 실행으로 분기하는 화면: SSOT에 명시 없음.
- SSH 비밀번호 인증 실패 시 오류와 재시도 안내를 표시하고 설치를 시작하지 않는 세부 처리: SSOT에 명시 없음.
- sudo 또는 원격 설치 권한 부족 시 권한 오류와 다른 계정 입력을 요구하는 처리: SSOT에 명시 없음.
- Homebrew, npm, 다운로드 권한, 파일 접근, 네트워크 문제가 원격 설치를 막을 때의 retry/대기/오류 모델: SSOT에 명시 없음.
- 원격 XpairHost 설치 진행 상태, status bar, 설치 완료/실패 상태 표시: SSOT에 명시 없음.
- bundled `xpair` CLI auto-install, retry status bar, 설치 실패 상태의 구체 UI: SSOT에는 CLI hard gate만 있고 설치 UI 세부는 없음.
- CLI 설치 완료 뒤 Discover scan이 자동 재개되는지, 사용자가 선택해야 하는지: SSOT에 명시 없음.
- CLI scan 실패와 별개로 manual host 입력을 허용하거나 CLI scan을 건너뛰는 정책: SSOT에 명시 없음.
- CLI 준비 전 manual 연결도 차단되는지 여부: CLI가 필요한 flow의 hard gate는 있으나 manual 연결이 어떤 의존을 갖는지는 SSOT에 없음.
- 뒤로 가기, 취소, 닫기 후 Discover 이전 상태로 돌아갈지 앱 종료로 끝날지의 정확한 navigation: SSOT에 명시 없음.
- 다른 host를 고르려 할 때 Discover 결과 목록, Discover 선택 흐름, manual 연결 선택 중 어디로 돌아가는지: SSOT에 명시 없음.
- 발견된 host 이름/주소를 수정하면 discovered-host 흐름을 벗어나 manual 검증으로 전환하는 규칙: SSOT에 명시 없음.
- host row 상세/보조 액션이 Xpair 연결에 필요한 정보만 표시한다는 제한: SSOT에 명시 없음.
- Tailscale 설치 안내를 열고 외부 설치, 미설치 유지, 설치됨-미실행, Ready 상태로 돌아오는 세부 상태 머신: SSOT에 명시 없음.
- Tailscale Ready/미설치/미실행 안내에서 SSH probe로 연결 판단을 진행한다는 구체 방식: SSOT에 명시 없음.
- Tailscale, 브라우저, OS 설정 등 Xpair 밖 표면 조작을 userflow에서 접근 불가로 차단한다는 정책: SSOT에 명시 없음.
- stale heartbeat나 poll 결과를 연결된 client로 보지 않고 대기하는 판단: SSOT에 명시 없음.
- client disconnect를 client 앱 종료나 네트워크 변화로만 발생시키고 별도 disconnect 조작을 접근 불가로 두는 정책: SSOT에 명시 없음.
- 저장된 host를 발견했을 때 Reconnect를 우선 제안하거나 삭제/무시 후 새 scan으로 돌아가는 정책: SSOT에 명시 없음.
- XpairHost를 먼저 실행한 host-first 상황을 client에서 특정 flow로 route하거나 대기시키는 세부 정책: §1.5는 Host 쪽 permission hold만 말함.
- 재설치 성공/실패, 같은 엔진 재설치, 중복 scan 방지 등 반복 설치 루프: SSOT에 명시 없음.
- telemetry/crash report ON/OFF 조합별 저장과 Discover 이동: §4가 crash report default를 open issue로 두며 exact consent persistence/next screen은 명시하지 않음.
- Welcome 다음 단계에서 동의 선택 후 host 탐색으로 이어지는 정확한 onboarding 순서: SSOT에 명시 없음.
- XpairHost 설치/네트워크/Tailscale/SSH/권한 help 안내의 내용과 노출 위치: SSOT에 명시 없음.
- `Retry`, `Next`, `Set up`, `Check connection`, `Connect`, `Reconnect` 같은 정확한 버튼 label: SSOT에 명시 없음.
- host 목록에서 이름, 주소, 식별 정보를 표시하는 카드/리스트 구성: SSOT에 명시 없음.
- tailnet 후보에서 MagicDNS, offline, SSH port 도달성까지 화면이 어떻게 분기하는지: SSOT는 tailnet topology 검증 필요만 말함.
- 네트워크를 고친 뒤 Retry하지 않으면 실패/no-host fallback을 유지한다는 상태 유지 규칙: SSOT에 명시 없음.
- 사용자가 계속 기다릴 때 다음 scan wave, 네트워크 회복, 실패, 계속 대기 중 하나로 재판정하는 루프: SSOT에 명시 없음.
- 외부 안내를 본 뒤 Connect 화면의 실패 상태와 Retry가 유지되는지: SSOT에 명시 없음.
- discovered host 연결 제출 중 host가 사라지면 같은 host 선택 상태에서 재시도 가능하게 하는지: SSOT에 명시 없음.
- Back으로 같은 Bonjour scan 결과 목록을 복원하는 history 동작: SSOT에 명시 없음.
- 한 개/여러 개 host 발견 시 단일 카드 또는 목록과 식별 정보를 표시하는 차이: SSOT에 명시 없음.
- 성공 상태에서 host/network/Tailscale 상태가 바뀐 뒤 현재 Connect 화면에서 다시 확인하거나 Next를 눌러야 하는지: SSOT에 명시 없음.

## BACKED

- LAN/Bonjour를 첫 discovery 경로로 scan한다.
  - Evidence: §1.4 (Q0382, Q0384) — "First connection should be LAN-first: scan the local network with Bonjour and offer to connect when another Mac is found."
- Bonjour에서 다른 Mac이 발견되면 연결을 제안할 수 있어야 한다.
  - Evidence: §1.4 (Q0382, Q0384) — "First connection should be LAN-first: scan the local network with Bonjour and offer to connect when another Mac is found."
- 같은 네트워크 Mac이 없으면 Tailscale 또는 다른 fallback으로 안내한다.
  - Evidence: §1.4 (Q0383, Q0384) — "If no same-network Mac is found, the product should naturally guide the user toward Tailscale or another fallback path."
- Tailscale은 prerequisite이 아니라 fallback이다.
  - Evidence: §1.4 (Q0383, Q0384) — "Tailscale is a fallback, not a prerequisite."
- tailnet/MagicDNS 같은 topology에서도 discovery가 실제로 동작하는지 검증해야 한다.
  - Evidence: §1.4 (Q0399) — "The product should verify that discovery actually works on the user's likely topology, including tailnet situations where MagicDNS may be off."
- `xpair` CLI가 필요한 flow 전에는 CLI availability가 hard gate이며, 설치하거나 명확히 block해야 한다.
  - Evidence: §1.3 (Q0533, Q0534, Q0536, Q0537) — "`xpair` CLI availability is a hard product requirement before flows that need it."
- Client onboarding은 IDE workbench 전에 별도 window로 나타나야 한다.
  - Evidence: §1.2 (Q0369, Q0421, Q0424, Q0426) — "Client onboarding appears before the IDE workbench."
- 필요한 setup이 완료되기 전에는 onboarding이 완료된 것으로 닫혀 IDE로 넘어가면 안 된다.
  - Evidence: §1.2 (Q0369, Q0402, Q0474) — "Client onboarding closes only after the necessary setup is complete, then the IDE opens into the intended working surface."
- Host onboarding은 존재해야 하며 permission/TCC flow를 담당한다.
  - Evidence: §1.2 (Q0441, Q0442, Q0443) — "Host onboarding must exist. It is responsible for getting the Host through the required permission/TCC flow."
- Host는 TCC가 해결되기 전 usable로 간주되면 안 된다.
  - Evidence: §1.5 (Q0443) — "If TCC is not resolved, the app should not proceed as though setup succeeded."
- XpairHost를 client보다 먼저 시작하는 상황은 가능하지만, 연결된 client가 없으면 Host onboarding은 permission step에 머무는 것이 기대된다.
  - Evidence: §1.5 (Q0543) — "Starting XpairHost before any client is acceptable, but with no connected client the Host onboarding is expected to hold at the permission step rather than report completion."
- client onboarding에서 host install/pairing을 다루는 방향은 roadmap에 있다.
  - Evidence: §5 (Q0382, Q0383, Q0384, Q0440, Q0515, Q0525) — "M2: Install and pairing - Xpair naming, role-aware install, LAN Bonjour discovery, Tailscale fallback, host install from client onboarding."
- onboarding은 telemetry opt-in 결정을 노출해야 한다.
  - Evidence: §1.12 (Q0448) — "Host should also be covered by Sentry/PostHog if telemetry is enabled, and onboarding must expose the opt-in decision."

Tally: BACKED=13 UNSPECIFIED=50 CONTRADICTS=0 (distinct 예상 considered: 63)
