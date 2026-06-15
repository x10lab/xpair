# RemotePair 요구사항

이 문서는 RemotePair 저장소의 **모든 Claude Code 세션**(로컬 laptop 5개 + 호스트 gh-mac-m1 4개, 그중 2개는 자동화 실행이라 사람 발화 없음)과 **2026-06-13 제품 비전 브레인스토밍**을 역추적해, 사용자가 실제로 요청·결정한 내용을 종합한 단일 스펙이다. 출처는 세션의 사람 발화이며, 추측은 배제했다. 신규 엔지니어가 이 문서만으로 M1~M6 로드맵을 구현할 수 있는 수준을 목표로 한다.

> 코드 동작 원리는 [architecture.md](architecture.md), 추후/보류 항목은 [future.md](future.md), 사용자용 설치/사용은 [README](../README.md). 본 문서는 "무엇을·왜·어떻게 검증"에 집중한다.

---

## 0. 제품 비전 / 불변식 (Invariants)

이 절은 모든 후속 요구사항이 위반해선 안 되는 상위 제약이다. 아래 불변식은 결정이 아니라 **설계 헌법**이다 — 신규 기능은 먼저 이 절과의 정합성부터 확인한다.

### 0.1 역할 분리 (저결합 헌법)
- **앱(`RemotePair.app`) = 권한 데몬만.** 책임은 정확히 셋이다: ① AX·SR(필요 시 FDA) grant를 designated requirement에 붙들고, ② patched tmux 서버(`tmux-aqua`)를 자기 자식으로 붙들어 권한을 상속시키고, ③ InputServer primitive(shot/click/key) 하나씩만 실행한다. 그 외 로직(설치/매핑/approve 판단/HTTP)은 앱에 **넣지 않는다**.
- **CLI(`remote-pair`) = 두뇌이자 SSOT.** 폴더 매핑·세션 결정·approve 좌표·재시도·온보딩 흐름을 전부 CLI가 결정한다. CLI엔 TCC/AX 코드가 없다(앱에 위임).
- **approve 경로**: `remote-pair approve`(CLI) → 트리거 파일 → 앱이 라우터(`remote-pair-approve-router.sh`)를 **자기 자식으로** 실행(권한 상속). claude/스킬은 "막히면 트리거"만 하고, 무엇을 어떻게 허용할지는 라우터가 정한다.
- **마법사·웹 브리지도 CLI 레이어다.** 온보딩 웹(§1 온보딩, architecture.md §9)은 `remote-pair web`이 띄우는 별도 python3 프로세스이며, **앱에는 HTTP/WebSocket 서버를 절대 넣지 않는다.** 검증: `host/app/*.swift`에 소켓/HTTP 리스너가 없어야 한다(현재 InputServer는 파일 채널만 사용).
- 왜: 권한 경계(앱)와 두뇌(CLI)를 분리해야 ① 앱을 최소 권한·최소 코드로 유지하고(공격면↓), ② CLI를 README 한 줄로 단일 설치하며(앱이 CLI를 강제 설치하지 않음), ③ GUI를 웹→네이티브로 바꿔도 권한 데몬을 안 건드린다.

### 0.2 상태의 단일 출처
- `~/.remote-pair`가 모든 런타임 상태(config/logs/rules/manifest)의 단일 출처. 기기 간 `~/.claude` 동기화에 의존하지 않는다. `~/.claude`엔 에이전트 정체성(approve skill·rules·hooks)만 둔다.
- 앱 생존 + AX/SR/FDA grant의 ground truth는 `~/.remote-pair/logs/status.json`(앱이 ~1초마다 기록). 에이전트·CLI·웹 브리지는 pgrep 추측 대신 이 파일을 읽는다.

### 0.3 GUI 시임(seam) 불변
- 프론트엔드는 **끝까지 웹**(HTML/CSS/JS). "앱"이란 네이티브 껍데기(WKWebView 또는 Electron) + 네이티브 브리지일 뿐이다. localhost 웹 → standalone 앱으로 가도 **바뀌는 건 브리지 구현뿐**이고, **JSON API 계약과 SPA는 불변**이다.
- 즉 `client/cli/web/`의 SPA와 `/api/*` 계약이 교체 가능한 시임(seam)이다. 검증: 브리지를 python3 → Swift WKWebView로 바꿔도 `index.html`·API 응답 스키마가 그대로여야 한다.

---

## 1. 기능 요구사항

### 배포 / 설치
- 오픈소스 self-signed 서명 문제를 **Homebrew Cask 배포**로 해결한다 — postflight로 quarantine를 제거해 self-signed라도 TCC grant가 동작.
- Apple Silicon 전용 **프리빌트 바이너리**를 제공해 사용자 직접 빌드를 없앤다. `tmux-aqua`는 앱 번들에 임베드(별도 바이너리·brew 의존 제거).
- **단일 명령 부트스트랩**(`curl … | bash`)으로 처음 쓰는 사람도 빌드 없이 설치.
- bootstrap은 glue(CLI·approve 규칙·skill)만 설치하고, host면 **brew cask로 앱까지 자동 설치**한다. brew가 없으면 안내 후 중단.
- **소스 빌드는 bootstrap에서 제거** → 메인테이너 전용(`host/build-*.sh`). (brew가 앱을 공급하므로)
- installer **role 분리**(host/client/both) + Finder Service Quick Action으로 client 1분 설치.
- 설치/제거 모두 **가역적**(manifest 추적). 웹 브리지·SPA 자산도 manifest에 기록돼 가역 제거된다(검증: `tests/t_10_install_reversibility.sh`).
- **CI(GitHub Actions)로 릴리스**: 각 브랜치에서 새 태그 푸시 → 빌드 → 성공 시 main 머지. 신규 코드만 릴리스. CI가 직접 수행(셀프호스티드 아님), p12는 gh secret(`SIGNING_P12_BASE64`/`_PASSWORD`).
- 릴리스 ad-hoc 서명 거부 가드 + cask `version`/`sha256` 자동 bump.
- 버전 정책: pre-1.0. **v0.5.0에서 리네임·cert 전환을 묶어 마이너 bump**(아래 §리네임 참조), 이후 패치는 +0.0.1.

### 리네임 / 정체성 통일 (M1, v0.5.0)
- **앱 표시명·번들 id를 완전 통일한다**: `RemotePairHost` → `RemotePair`, `com.x10lab.remote-pair-host` → `com.x10lab.remote-pair`.
  - 왜: 사용자에게 노출되는 이름(메뉴바·System Settings·cask)과 내부 식별자가 `*-host` 접미사로 갈라져 혼란. 단일 브랜드로 통일.
  - 검증: `shared/config.sh`의 `APP_NAME=RemotePair`·`BUNDLE_PREFIX=com.x10lab.remote-pair`(기본값), `host/app/Config.swift`의 `BUNDLE_ID` 폴백이 `com.x10lab.remote-pair`. (이미 적용됨 — §4 참조)
- **TCC 재grant는 1회로 묶는다**: designated requirement = identifier + leaf(cert)인데, bundle id 변경과 cert 전환(33849F → 898E32)을 **동시에** 하므로 두 변화가 한 번에 grant를 무효화한다 → v0.5.0 한 릴리스에서 **사용자 재grant 1회**로 끝낸다. 이후엔 grant 유지.
  - 검증: 업그레이드 후 `RemotePair`(새 이름)를 AX/SR ON → `launchctl kickstart -k gui/$(id -u)/com.x10lab.remote-pair` → `remote-pair status`가 `AX ✓ SR ✓`.
- **cask 토큰 전환**: `remote-pair-host` → `remote-pair`(신규 cask). 사용자 액션: `brew uninstall --cask remote-pair-host && brew install --cask remote-pair`.
  - 검증: `Casks/remote-pair.rb` 존재, `Casks/remote-pair-host.rb` 부재(이미 적용됨).
- **전환기 dual-id 프로빙**: client CLI는 새/옛 bundle id·앱 이름을 **둘 다** 프로빙해, 아직 마이그레이션 안 된 호스트도 status/doctor/host에서 false-negative가 안 나게 한다.
  - 검증: `client/cli/remote-pair`의 `LEGACY_BUNDLE`/`LEGACY_APP` 폴백, `tests/t_09_app_resolution.sh`의 dual-id 케이스.
- **소스 디렉터리 정리 완료**(이전 deferred): `host/RemotePairHost/`→`host/app/`, `client/*`→`client/cli/`, `rs/`→`host/rd/`, `ide/`→`client/ide/`로 역할×위치 재배치. 빌드 산출물·식별자엔 영향 없음(swiftc·tests·SoT 체크로 검증). Swift 코멘트의 `RemotePairHost` 표기는 무해해 잔류. → [docs/monorepo-structure.md](monorepo-structure.md).

### 권한 / TCC
- **AX·SR 필수, FDA 권장**(헤드리스 폴더 프롬프트가 세션을 멈추는 것 방지). FDA 권한을 실제로 쓰는 건 RemotePair 로직이 아니라 그 안의 `claude` 세션.
- **앱은 권한을 토글하지 못한다**(SIP + non-MDM Mac 제약). 앱/마법사는 `open`으로 System Settings 해당 창만 열고, 토글은 사용자가 물리 화면에서 직접 한다. 적용 여부는 `status.json`으로만 감지한다.
- TCC grant는 **안정 cert의 designated requirement(identifier + leaf)** 에 묶여 재빌드·업데이트에도 유지된다.
- 릴리스 바이너리가 **동일 cert**로 서명돼야 머신 간/업데이트 간 grant가 안 깨진다(= cask 배포의 핵심 근거). cert 백업: `~/Library/Application Support/RemotePair/signing.p12`.
- 권한 부여는 호스트 화면에서 1회 수동(SSH 불가) → 토글 후 `launchctl kickstart`.
- 마이크/미디어 등 불필요 권한 요청 최소화(자식 세션 탓이지 앱 탓 아님).

### Computer Use / 권한 상속
- `claude`가 **권한 가진 앱 서브트리(patched tmux-aqua)** 안에 있어야 AX/SR을 상속해 Computer Use가 동작.
- **InputServer primitive 채널**: CLI(두뇌, 권한 0)가 요청하고 앱(권한 경계)이 실행 — `shot`=screencapture / `click`=cliclick / `key`=osascript.
- 키 입력은 **osascript(System Events)로 통일** — cliclick 합성키가 Chrome 확장 팝업 등 웹 UI에 안 먹힘.
- `cliclick`(click primitive)은 번들 동봉 + 호스트 brew로 보장.

### approve 라우터
- 트리거는 `touch` 대신 **`remote-pair` CLI 호출**. approve 로직은 **claude skill**(`~/.claude/skills/approve`)로 존재.
- **적응형 폴링** — 트리거 직후 창이 아직 없어도(에이전트가 수 초 뒤 띄움) 대기 윈도우 동안 기다림.
- **검증 루프** — 클릭/키 후 닫혔는지 재확인, 실패 시 재시도. 단시간 재시도를 늘려 실패확률↓.
- **하이브리드 비전** — OCR 룰 우선, 미스 시 haiku 분류. **vision이 SPOF가 되면 안 됨**(claude 호출 실패 시 fallback 동작).
- approve **타입 인자** 전달(어떤 종류 승인인지 — `--type key:..|ocr:..`).
- **cmd+enter 먼저**(=항상 허용 → 창 재발 안 함), 실패 시 enter(cmd+enter 안 받는 모달 대응).
- Claude for Chrome **site-level permission block 우회** — 에이전트가 실패를 인지하면 fallback로 재시도.
- 에이전트 중심 + **스킬 기반 툴 선택**(하네스가 실패 시 approve 스킬을 안내).
- **persist 자동감지 로직은 넣지 않는다**(의도적 제외).
- 1Password 잠금 프롬프트는 bash tool fail 시 hook으로 처리. m1 기존 훅을 새 훅에 **정확히 동일하게** 반영.
- record(녹화) 시도 시 뜨는 창들도 한 번에 처리.

### 온보딩 마법사 (M1 첫 마일스톤)
**무엇**: `remote-pair web`이 띄우는 localhost 웹 마법사가 첫 설치를 끝까지 안내한다. 단계: ① 역할 선택(host/client/both) → ② 권한(AX/SR/FDA를 하나씩, 라이브 감지 + Next 스텝) → ③ TCC 재grant 안내(필요할 때만) → ④ SSH 점검 → ⑤ 폴더 매핑 → ⑥ Syncthing 헬스 → ⑦ 검증(doctor).
**왜**: 현재 온보딩이 CLI 프롬프트(`remote-pair onboard`)·물리 화면 권한 토글·SSH 키 셋업으로 흩어져 있어, 처음 쓰는 사람이 "다음에 뭘 하지"를 모른다. 웹 마법사가 라이브 상태를 보여주며 한 흐름으로 묶는다.

> **구현 상태(2026-06-13)**: 구현됨. `client/cli/remote-pair-web`(python3 stdlib 브리지)·`client/cli/web/`(SPA) 완성. architecture.md §9의 API 계약 전량 구현. 리네임·bundle id 통일(v0.5.0 계획/예정 — 현재 출하 정체성은 `RemotePairHost`/`com.x10lab.remote-pair-host` 유지). → architecture.md §9.

**어떻게 / 검증**:
- 브리지는 `client/cli/remote-pair-web`(python3 stdlib, 외부 의존 0). SPA는 `client/cli/web/`(빌드·npm 불필요).
- 브리지는 **얇은 HTTP↔CLI 어댑터**다: `remote-pair` CLI에 shell-out + `status.json` 읽기만 한다. **설치/권한/approve 로직을 재구현하지 않는다**(불변식 §0.1). 검증: `tests/test_remote_pair_web.py`(브리지 단위 테스트), 그리고 브리지 소스에 설치 로직 부재.
- 권한은 앱이 토글 못하므로(SIP), 마법사는 `POST /api/permissions/open {pane}`으로 **설정창만 연다**. 적용 여부는 `GET /api/status`(status.json)를 ~1.5초 폴링해 **앱 재시작 없이 ~2초 내** 반영.
- 재grant 필요 여부는 `GET /api/regrant`가 현재 bundle id를 신/구 비교해 판단한다.
- 보안: `127.0.0.1` 바인딩 + **per-run 토큰**(런타임 생성, argv 비전달 → shell history 누출 차단). 토큰 없는 요청 거부. 검증: `tests/t_09_app_resolution.sh`의 `web/execs-bridge-no-token`(브리지 argv에 `token=` 미포함).
- API 계약(역할/상태/권한열기/SSH점검/매핑/Syncthing/regrant)은 architecture.md §9에 명세. 이 JSON API가 GUI 시임(§0.3)이므로, 나중 WKWebView·code-server 임베드가 같은 계약을 재사용한다.

### 알림 포워딩 (M2 후속)
**무엇**: host(예: gh-mac-m1)에서 도는 Claude Code의 **완료/Stop/Ask-a-question** 알림과 **approve(승인유형)** 알림을 client(예: gh-mac-m4)로 전달한다. 알림 종류는 설정으로 토글한다.
**왜**: host는 헤드리스로 24/7 돌고 사용자는 client 앞에 앉아 있다. host에서 세션이 멈추거나(질문/승인 대기) 끝났을 때 client가 모르면 방치된다.
**어떻게 / 검증**:
- 현재 host엔 `remote-pair-approve-reminder` **훅만** 있고 client 포워딩은 없다 → **신규 Notification/Stop 훅**을 추가해야 한다(`~/.claude/settings.json`의 hooks). 검증: `remote-pair doctor`가 approve 훅을 보듯, 신규 훅 등록 여부도 점검 항목에 추가.
- 전달 채널은 저결합 원칙(§0.1)을 따라 CLI 레이어에서 처리(앱에 알림 서버를 넣지 않는다). 구체 전송 메커니즘(SSH back-channel / 푸시 / client 폴링)은 M2 설계에서 확정.
- 설정 토글은 client.env 또는 마법사 설정 화면에서 노출. 어떤 알림 종류(완료/Stop/질문/approve)를 켤지 사용자가 선택.

> **구현 상태(2026-06-13)**: 구현됨. `host/hooks/remote-pair-notify.sh`가 Stop/Notification 이벤트를 `~/.remote-pair/notifications/queue.jsonl`에 기록하고, 클라이언트 브리지 `/api/notifications`가 SSH 폴링으로 전달한다. `host/hooks/notify.conf.example`로 `ENABLED_TYPES` 필터 설정. → architecture.md §10-3.

### 세션 / launch
- **1:1 연결만** 지원(세션공유·멀티어태치 폐기). 충돌 시 1:1 방향으로.
- `remote-pair-launch`는 레퍼런스 `claude-iterm-launch`의 **충실한 1:1 포팅**(robustness 동작 복원).
- **폴더 매핑**: client 경로 → host 경로(외부 동기화로 내용 동일, 절대경로 다름). 기준 루트 `~/Spaces`.
- **결정적 세션 이름**(host 경로 기반 `<HOST>_…`) — 상태바로 머신 식별, 한글 경로 대화 오염 차단.
- **`_N` 넘버링**: `_1`에 클라이언트가 붙어 있으면 `_2` 새로, detached는 `attach -d`로 takeover.
- **resume 버그 수정**: exit 후 빈 대화가 붙는 문제 — `--resume` 폴백이 실패를 삼킴 + stale SID. remote-control/resume/tmux를 동일 id 기반으로. `--dangerously-skip-permissions` 추가.
- 다른 path의 새 세션이 기존 세션을 상속(pollute)하는 버그 수정.
- 고아(orphan) 소켓 세션 자동 감지·정리.
- onboarding을 fancy하게, iTerm2↔terminal을 CLI config로 전환 가능, 폴더매핑 모듈 재사용.
- 비대화 옵션(`--yes`/`RP_YES`) 제공.

### 파일 동기화 (Syncthing)
- **Syncthing 유지** + `doctor` 헬스체크 추가. RemotePair는 sync를 직접 구현하지 않고 Syncthing에 위임한다(저결합).
- **e2e 폴더 매핑 자동구성**(후순위): 현재는 사용자가 Syncthing 폴더를 수동 구성한다. → RemotePair가 **양쪽(host/client) Syncthing REST API로 폴더를 자동 추가 + `.stignore` 주입**해 폴더 매핑을 e2e로 셋업. 선택적으로 `~/.claude` 동기화도 같은 메커니즘으로(현재 git 백본 opt-in의 대체/보완).
- **제외 규칙은 유지**: `.git`(양쪽 git 상태가 달라 오인 커밋/푸시 위험)과 `.claude/projects/`(용량·프라이버시)는 동기화에서 제외. 작업트리만 동기화, `.git`은 기기-로컬.
- 검증: `remote-pair doctor`가 Syncthing 데몬(127.0.0.1:8384) 도달성을 healthy 판정에 포함. 라이선스: Syncthing MPL-2.0(consume·번들 자유).

### Remote Desktop (M5, 보류)
- **보류 상태**. v0 = 기존 screencapture/InputServer 채널 재사용 또는 macOS 내장 VNC(화면공유). v1 = WebRTC(ScreenCaptureKit + VideoToolbox HW 인코딩, Input Monitoring 권한 추가).
- 라이선스 주의: RustDesk는 AGPL-3.0이라 한 작업물로 묶으면 전염 → §올인원 오케스트레이션 규칙을 따른다.

> **구현 상태(2026-06-13)**: 스캐폴드. `client/cli/remote-pair-desktop`이 macOS Screen Sharing(VNC) arm's-length 런처(open/check/help 서브커맨드)를 구현하고, 브리지 `/api/desktop/open`이 이를 호출. 인-브라우저 스트리밍(WebRTC)은 스파이크 단계. → architecture.md §10-5.

### 올인원 오케스트레이션 (후순위)
**무엇**: RemotePair가 베스트 OSS를 **설치·구성·실행만** 시키는 "지휘자"가 된다. 소스는 안 건드리고 컴포넌트를 오케스트레이션한다(저결합 §0.1 유지).
- **Syncthing**(파일 sync, MPL-2.0), **Tailscale/WireGuard**(zero-config 도달성, BSD-3/MIT), **RustDesk**(Remote Desktop, AGPL-3.0).
**라이선스 매트릭스(중요)**: RemotePair는 Apache-2.0이고 Apache→AGPL은 단방향이라 —
- Syncthing(MPL-2.0)·Tailscale(BSD-3)·WireGuard(MIT): consume·번들 자유.
- **RustDesk(AGPL-3.0)**: 한 작업물로 묶으면 RemotePair 전체가 AGPL로 전염된다. → 반드시 **arm's-length 별도 프로세스**(사용자 설치 / 런타임 다운로드, 자기 배포물에 링크·포함 X)로 두어 mere-aggregation을 유지하거나, **macOS 화면공유(VNC) / ScreenCaptureKit-WebRTC(Apple, 라이선스 0)** 로 대체한다. 상용 배포 전 법률 확인.

### client
- `remote-pair ls`(host 세션 목록), `remote-pair launch <dir>`(폴더 매핑 해석 후 존재 분기).
- Finder Service "Launch Remote Pair"(폴더 우클릭).
- `remote-pair config`로 role(host/client/both) 변경 + **interactive 옵션** 제공.
- `remote-pair web`으로 온보딩 마법사 기동(브리지가 토큰 생성 + 127.0.0.1 URL 오픈).

### host 앱
- 메뉴바 UI: 권한 부여, 설정창, **tmux 세션 목록**(클릭 시 detach/kill 모달, attached/detached 현황), Restart tmux host, Repair install.
- 앱이 tmux 서버 생명주기 관리. **status.json**을 매 tick 기록(앱 생존 + AX/SR/FDA grant ground truth).
- **자기설치**(다운로드 .app 첫 실행) + 버전 스탬프 리소스 갱신(grant·LaunchAgent·host.env 보존). 단, **client 머신에서 호스트로 자기설치하거나 중복 인스턴스가 뜨지 않게** 가드(gh-mac-m4 사고 재발방지 — 검증: `Installer.swift` legacy-shed가 옛 LaunchAgent bootout + 옛 .app 제거).
- skills/rules/CLI 자기설치 **제거** — CLI/README 단일설치가 담당(결합도↓).
- **1:N**(호스트 하나에 여러 클라이언트) 지원하되 세션 자체는 1:1.
- 설치 시 SSH 키 연결 확인 및 미비 시 안내.
- `host-gui-access` 스킬: 활성화 조건을 SKILL.md에 명시, "단정하지 말 것" 주의.
- **앱은 HTTP/WebSocket 서버를 갖지 않는다**(불변식 §0.1) — 웹 마법사는 별도 CLI 프로세스.

### Web 셸 + 에디터 (M3·M4)
- **M3 — Web 셸 + 터미널**: 브라우저에서 호스트 세션을 다룬다. **code-server**를 임베드해 통합 터미널이 `tmux-aqua attach`로 호스트 세션에 붙고, Detach/Attach 탭 UX를 제공한다.
- **M4 — IDE 프론트엔드(RemotePair IDE)**: code-server 경로를 **피벗**해 **VSCodium 포크**(`remotepair-ide`, `~/Spaces/Work/Devs/Lang-Swift/remotepair-ide`)로 전환. 이유: Claude Code / Codex 익스텐션 호환성(마켓플레이스·Node API)을 위해 실제 VS Code / Electron 엔진이 필요했고, code-server의 web-only 환경으로는 불가. 백엔드(M1–M6 tmux-aqua·approve·sync·onboarding)는 재사용.
  - 번들 id: `com.x10lab.remotepair-ide`(앱 id 통합은 향후 deferred).
  - 전략: **"코드 유지, UI 숨김"** — upstream rebase 비용을 낮추기 위해 기여 코드를 unregister하지 않고 composite-bar 허용목록 + `when: ContextKeyExpr.false()` 패턴으로만 숨긴다.
  - dev-watch: `nvm node 22.22.1`, `buildConfig.useEsbuildTranspile=true`(dev 전용); `tsc --noEmit -p src/tsconfig.json --max-old-space-size=8192`가 타입 검증 기준.
- 왜 웹 셸: GUI 시임(§0.3)을 그대로 재사용 — 웹 마법사가 쓰는 JSON API/127.0.0.1 패턴 위에 셸·에디터를 얹어, 나중에 네이티브 껍데기로 포팅할 때 프론트가 불변.

> **구현 상태(2026-06-14)**:
> - **M3 터미널 탭**: 구현됨. `client/cli/web/`(xterm.js SPA)이 `/api/term/*`을 통해 SSH 경유 `capture-pane`/`send-keys`로 tmux-aqua 세션에 연결. alt-screen 한계(vim·htop 등 full-screen 앱은 그대로 캡처 안 됨)는 알려진 제약. → architecture.md §10-2.
> - **M4 IDE 프론트엔드**: **G001–G008 전부 구현·검증 완료**. VSCodium 포크(`remotepair-ide`)로 피벗. dev-CDP + 브랜드 빌드(m4, 7회) + 원격 E2E(gh-mac-m1 aqua tmux 소켓 → REMOTEPAIR_E2E_OK) 검증 완료. 남은 작업은 `vscode/src` 변경의 `patches/` 캡처(rebase-safety)뿐. 상세는 §1 IDE Frontend 참조. → `.omc/ultragoal/`

### IDE Frontend (RemotePair IDE) — M4 세부 사양

**포크 레포**: `~/Spaces/Work/Devs/Lang-Swift/remotepair-ide` (VSCodium 베이스).  
**번들 id**: `com.x10lab.remotepair-ide` (앱 id 통합은 deferred).  
**원칙**: 코드 보존(rebase 용이) + UI 숨김 전용(composite-bar 허용목록 / `when=false`). 코어 터미널 동작 코드는 **불변 — 절대 수정 금지**. 에지케이스 지뢰밭.

#### 구현 완료 (G001–G008 — dev-CDP + 브랜드 빌드 + 원격 E2E 검증)

**좌측 레일 (Text-only)**
- 컨테이너: Browser / Sessions / Settings 세 개만 허용(native 컨테이너들은 prune되어 코드는 유지, 레일에서 제거).
- 구현: `activitybarPart.ts`의 `ActivityBarCompositeBar.isRailAllowedContainer` 패턴 + 허용목록.

**Sessions 사이드바**
- 임베드된 `EditorPart`에 **네이티브 VS Code 수평 탭**으로 세션 표시(초기 iTerm2 둥근 pill → 사용자 피드백으로 네이티브 flat 탭으로 변경; `multiEditorTabsControl.css`의 pill override 블록 제거, 반응형 가로 스크롤 블록은 유지).
- **"+" 버튼**: Sessions 뷰 헤더 DOM에 직접 삽입한 커스텀 버튼(ViewTitle action이 이 컨테이너에 렌더되지 않아 DOM 직접 삽입으로 해결). 클릭 → 탭 내 세션 유형 picker 열림.
- **in-tab New Session picker**: `SessionPickerInput`(EditorInput) + `SessionPickerPane`(EditorPane)으로 구현. 탭 안에 4개 카드(Claude / Shell / Codex / Gemini) 렌더. 카드 선택 → 해당 세션 실행 → picker 탭 닫힘.
  - Shell: `terminalInstanceService.createInstance({}, TerminalLocation.Editor)`.
  - Claude: 임베드 그룹에 터미널 열고 `remote-pair launch` sendText.
  - Codex / Gemini: 터미널 + 각 CLI sendText.
- 터미널 포커스/입력: 호스팅 레이어의 `focus()` override로 해결. 코어 터미널 동작 미수정.
- 임베드 그룹 툴바(`+ ⌄ ⊟ ⋯`) CSS로 숨김(커스텀 "+" 와 중복 방지).

**숨겨진 네이티브 UI (코드 보존)**
- 하단 패널: Problems / Output / Debug / Terminal / Ports — `RemotePairPanelCompositeBar` 허용목록으로 숨김(`remotepair*` 컨테이너만 통과). 코드는 등록 유지(rebase-safe).
- CHAT / Build-with-Agent(Auxiliary Bar): `RemotePairAuxBarCompositeBar` 허용목록으로 숨김.
- Outline, Timeline: `when: ContextKeyExpr.false()` — 뷰 디스크립터에만 적용, 코드 유지.

**하단 Session Manager 패널**
- **세 개의 Panel 컨테이너 탭**(`remotepair.sessions.attached` / `.detached` / `.history`) — 네이티브 Problems/Output/Terminal처럼 하단 가로 탭으로 표시(라벨이 곧 카테고리; "세션 매니저" 단일 라벨 폐기). 공간 절약 위해 패널 기본 높이를 낮게(`layout.ts` `PANEL_SIZE`=90px + `panelPart` `preferredHeight`/`minimumHeight`).
- G003 허용목록(`remotepair*`)을 통과하는 유일한 패널 그룹.
  - Attached: 임베드 세션들이 `ITerminalService.instances`를 우회(Editor 위치 생성)하므로 `AttachedSessionsProvider`를 별도 구현해 sidebar가 직접 추적. 카드에 **활성 세션 outline 하이라이트**(`.remotepair-session-card-active`) + **닫기 X 버튼**(`.remotepair-session-card-close`; `AttachedSessionsProvider.close?`/`getActiveId?`).
  - Detached: `remote-pair ls` 기반 tmux-aqua 세션 목록(dev 환경 = 빈 상태). 클릭 → reattach: 임베드 그룹에 터미널 열고 `remote-pair attach <name>` sendText.
  - History: IStorageService(workspace scope)로 지난 세션명 유지.

#### 완료 (G005–G008, 브랜드 빌드)

| 항목 | 상태 | 비고 |
|---|---|---|
| G005 Browser 멀티루트 | ✅ 완료 | FOLDER_MAPS 모든 clientDir 멀티루트; per-folder "+"; [Add Mapping]; Search/Extensions 진입점 (`~` 확장·`existsSync`·`updateWorkspaceFolders` 반환 처리 포함) |
| G006 Host 버튼 | ✅ 완료 | status bar 좌측: 호스트명 + 도달성 아이콘; 클릭 → quickpick. 네이티브 "><" SSH 인디케이터 제거. 패키지앱(CDP :9444)에서 실제 호스트 `gh-mac-m1` 표시 검증 |
| G008 functional-test gate | ✅ 완료 | 36개 기능 인벤토리(`G008-functional-test-inventory.md`) 클릭 테스트 통과 |
| 브랜드 빌드 검증 | ✅ 완료 | m4에서 branded build 7회; 패키지앱 + 원격 E2E(gh-mac-m1 aqua tmux 소켓 → REMOTEPAIR_E2E_OK) 검증 |

#### future / deferred

| 항목 | 상태 | 비고 |
|---|---|---|
| patches/ 캡처 (rebase-safety) | ✅ 캡처·검증 완료 | `vscode/src` 변경(G001–G008, 23파일 +1747/−42)을 `patches/zz-remotepair-ide-frontend.patch`로 캡처. 별도 worktree에 base+42 재구성→git diff로 추출(undo_telemetry·announcement 노이즈 제외). **gold 검증**: 실제 prepare_vscode 순서(json→root패치(zz 마지막)→osx→announcement→telemetry)로 적용 시 작업트리와 0 diff. top repo(remotepair-ide master) 커밋만 남음 |
| RustDesk-protocol 사이드카 | future/low-priority | §1 Remote Desktop 참조 |
| 앱 id 통합 | deferred | `com.x10lab.remotepair-ide` → `com.x10lab.remote-pair` 통합은 후속 마일스톤 |

#### G009 — Browser UX 개편 (신규, in-progress, 2026-06-14)

권위 스펙: `remotepair-ide/.omc/specs/deep-interview-browser-multiroot-favorites-ux.md`. 네 컴포넌트:

- **C1 — 루트/매핑 추가 UX (mount-first)**: Browser 폴더 리스트 *아래* 오프셋 버튼 "Add Root/Mapping"(맵 없으면 빈 공간에 동일 버튼, new-folder와 구분되는 아이콘). 클릭 → 호스트 폴더 지정 → **mount-first**: `remote-pair mount`(SMB 기본=맥 내장·커널확장 불필요; SSHFS 옵션 — `docs/m-mount.md`, 런처 `client/cli/remote-pair-mount` 완성)로 마운트 → 마운트포인트(`~/.remote-pair/mounts/...`)를 FOLDER_MAP으로 가리켜 루트 추가. SMB/SSHFS는 실제 OS 마운트라 **Finder에도 자동 노출**. Syncthing 복사동기화는 **legacy**(`SYNC_BACKEND` 기본을 syncthing→mount). row-1 타이틀의 'Add Mapping' 제거(단일 진입점). Browser 루트 = FOLDER_MAPS clientDir만(실행 인자로 열린 비-매핑 워크스페이스 폴더는 표시 안 함).
- **C2 — Favorites 뷰**: Browser 컨테이너 하단에 별도 뷰(기존 Explorer의 OUTLINE/TIMELINE처럼). 폴더 별표 → Favorites 등록(workspace+global 영속). 항목/'+' 클릭 → 그 폴더에서 **새 Sessions 터미널 시작**(`openSessionInFolder` 재사용) = 빠른 세션 런처.
- **C3 — 폴더행 인라인 컨트롤**: 모든 폴더 행(루트+모든 하위폴더) 우측에 **호버 시** 별표(Favorite 토글) + '+'(여기서 새 세션). 파일 행엔 없음. `MenuId.ExplorerContext` group:'inline' + `ExplorerFolderContext`.
- **C4 — Browser = 메타-컨테이너 + 2행 헤더**: Browser는 Sessions와 동일한 *상위* 컨테이너로 하위 컨테이너(Explorer/Search/Extensions/…)를 담는다. **Row-1 버튼 = 하위 컨테이너 라우터**: 클릭 시 Browser 내부 콘텐츠만 교체(현행처럼 전체 창을 덮는 글로벌 뷰렛 이동 ❌, 같은 Browser 프레임 유지). Row-2 = 활성 하위 컨테이너 컨트롤(Explorer면 동적 루트-라벨[클릭한 하위폴더가 속한 루트] + 네이티브 새파일/새폴더/새로고침/접기). **최대 난도 항목** — Explorer/Search/Extensions를 한 컨테이너의 내부-라우팅 하위뷰로 중첩하는 방법을 아키텍트가 확정(후보: View로 등록 후 가시성 토글 / 커스텀 라우터로 각 뷰렛 pane을 Browser body에 호스팅[Sessions 임베드 EditorPart 패턴] / 통합 프레임 유지 composite-swap).

병행 수정(적용·dev 검증 완료, 다음 브랜드 빌드 대기):
- **터미널 키 입력/포커스**: `RemotePairTerminalSidebarView.focus()`가 `super.focus()`로 컨테이너에 포커스를 뺏던 것 제거 → xterm textarea 직접 포커스 + microtask 재확정(코어 터미널 불변).
- **우측 사이드바(secondary side bar) 레이아웃 제거**: `layout.ts setAuxiliaryBarHidden`에서 hidden 강제(그리드 공간 0, 코드·노드 보존).
- **Sessions '+' 중복 제거**: row-1 ViewTitle 액션만 유지, body 커스텀 버튼 제거.

**구현 상태 (2026-06-15):** C1–C4 전부 소스 구현·tsc 0 errors. C4는 dev CDP **스파이크 PASS** — Browser 메타-컨테이너 Row-1(Explorer/Search/Extensions) + 2행헤더 + Explorer↔Search 인-프레임 라우팅(호스팅 SearchView, 활성=Browser 유지, 에러 0). C4 라우터 메커니즘은 plan의 `moveViewsToContainer`(영속화·canToggleVisibility:false 블로커)를 피해, Browser 컨테이너에 RemotePair 소유 뷰(`remotepair.browser.search`)로 네이티브 SearchView를 비영속 호스팅(`remotePairBrowserRouter.ts`). Extensions in-frame은 v1 제외(스파이크 #2). 코어 수정은 explorerView.ts의 마킹된 below-list 푸터(C1)+Row-2 라벨(C4.2)뿐. 남은 것: 패키지 빌드 라이브 검증(C1 mount 풀흐름·C3 호버) + patches/ 재캡처.

#### IDE 프론트엔드 불변식
1. **코어 터미널 동작 코드 불변**: `xterm`, `TerminalInstance`, `TerminalProcessManager` 등 코어 파일은 절대 수정하지 않는다. 호스팅/임베딩 레이어와 새 contributor 파일만 건드린다.
2. **"코드 유지, UI 숨김"**: native 컨테이너 unregister 금지. composite-bar 허용목록 + `when=false`만 사용해 upstream rebase를 쉽게 유지한다.
3. **단일 열기 계약**: 모든 세션 오픈은 `openSession({kind, cmd, hostDir, sessionName})`을 통해 임베드된 `part.activeGroup`으로만, global editorService 우회 금지.
4. **tsc 클린**: 모든 커밋 전 `tsc --noEmit -p src/tsconfig.json --max-old-space-size=8192` (nvm node 22.22.1) 0 errors.
5. **dev-watch**: `buildConfig.useEsbuildTranspile=true`는 dev 전용 — production 빌드에 이 설정을 쓰지 않는다.

### README / 문서
- 아키텍처 다이어그램, 문제기반 Features, 설치 중심 구성, 깊은 TCC 내부는 본문에서 제거.
- **⚠️ 보안/책임 경고**: macOS 가드레일을 모두 풀기 때문에 부주의로 인한 손해는 전적으로 사용자 책임, as-is 무보증.
- 새 설치방법 반영, **한국어/영어 두 버전**.
- **폴더 매핑 다이어그램**(Google Drive/Syncthing/iCloud, 부모경로는 달라도 하위는 동일).
- 직역투 정정(Computer Use·headless 등 고유명사 영문 유지), 군더더기 제거.
- **Claude Code 붙여넣기 설치 프롬프트**(레포 URL만 — README를 직접 읽음). 한/영 모두 프롬프트는 영어.
- brew 없는 사용자 안내 + [brew.sh] 링크.
- 원격 로그인 섹션: 스크린샷 + Apple 가이드 링크(원격 로그인은 CLI·host 양쪽 설정 필요).
- SSH 키 기반 접근 절차(검증 중심으로 압축).
- 제목 위계: 호스트/클라이언트를 축으로, 하위 단계는 `####`.
- 사용방법 섹션(Finder 실행 스크린샷), 문제해결 & 버그 신고 섹션.
- **리네임 업그레이드 안내**(README·cask caveats): cask 토큰 전환 + AX/SR 재grant 1회. (이미 반영됨)
- `docs/`에 내부 로직 문서(architecture.md), 추후 항목(future.md), 본 requirements.md.

---

## 2. 비기능 요구사항 / 제약

- **Apple Silicon macOS 전용**, macOS Ventura+ (Sequoia 권장).
- 오픈소스 — 별도 배포 인프라 비용 없이 GitHub Releases 활용. 라이선스 **Apache-2.0**(AGPL 컴포넌트와 묶지 않음 — §올인원 라이선스 매트릭스).
- **`~/.remote-pair`가 상태의 단일 출처** — 기기 간 `~/.claude` 동기화 불요. RemotePair 자체 config은 `.claude` 밖 네임스페이스(기기별, sync 안 함).
- **낮은 결합도 / 높은 응집도**(§0.1 불변식): 앱 = 권한 데몬만, CLI = 두뇌(SSOT 겸 메인 인터페이스), 마법사/웹/셸 = CLI 레이어. CLI엔 TCC/AX 코드 없음(앱에 위임). 앱이 CLI를 강제 설치하지 않음. 앱에 네트워크 서버 없음.
- **GUI는 웹 우선, 네이티브는 껍데기**(§0.3) — JSON API 시임 고정, 브리지 구현만 교체 가능.
- 웹 브리지·SPA는 **빌드 툴체인·npm 의존 0**(python3 stdlib + 정적 자산). 외부 패키지 추가는 저결합·무의존 원칙 위반으로 간주.
- **`.git`은 Syncthing 동기화 제외**(`.stignore`) — 양쪽 git 상태가 달라 오인 커밋/푸시 위험. 작업트리만 동기화, `.git`은 기기-로컬.
- `.claude/projects/` 폴더는 `.gitignore` + git 히스토리 제거(용량·프라이버시) + Syncthing 제외.
- 추적가능 로깅(5MB 회전), 실패 시 일시정지.
- 보안: 웹 브리지는 loopback 전용 + per-run 토큰. 절대 외부 바인딩하지 않는다.
- 이 프로젝트 대화는 **한국어**. 직역투·군더더기 배제.

---

## 3. 결정 기록 (Decisions)

- **Homebrew Cask 배포 채택** — self-signed 코드서명 문제 회피 + 동일 cert 바이너리로 cross-cert grant 깨짐을 근본 해결.
- **소스 빌드를 bootstrap에서 제거**, 메인테이너 전용으로 분리(brew가 앱 공급).
- **bootstrap이 host면 brew cask까지 자동** 설치("cli가 다 해버리자").
- **1:1 연결만** — 세션공유 폐기. launch는 `claude-iterm-launch` 충실 포팅.
- **approve 키는 osascript** 통일(cliclick 합성키가 Chrome 확장 팝업에 안 먹힘).
- **persist 자동감지 로직 제외**(의도적).
- approve는 에이전트 중심 + 스킬 기반 툴 선택.
- RemotePair config는 자체 네임스페이스(`~/.remote-pair`), `.claude`는 에이전트 정체성(skill·rules·logs) 전용.
- **sync 기본 off**(동기화 없는 환경에서도 동작).
- `legacy/` 폴더 삭제.
- **세션 식별은 결정적 id 기반**(한글 경로 오염 차단) — uuid5/`--session-id` 방식은 철회.
- `claude` 실행에 `--dangerously-skip-permissions` 추가.
- **(2026-06-13) 정체성 통일** — `RemotePairHost`→`RemotePair`, `com.x10lab.remote-pair-host`→`com.x10lab.remote-pair`. cask 토큰도 `remote-pair`로 전환(신규 cask). 소스 디렉터리명은 deferred.
- **(2026-06-13) 서명 cert 전환을 리네임과 한 릴리스(v0.5.0)에 묶음** — 33849F → 898E32. bundle id 변경 + cert 변경이 동시이므로 designated requirement(identifier+leaf)가 한 번에 무효화되어, **재grant 1회**로 끝난다. 기존의 "릴리스는 m4(33849F)에서만 서명" 항목을 대체한다(CI 서명, p12는 gh secret). 이후 릴리스는 898E32로 일관 서명.
- **(2026-06-13) GUI는 웹 우선** — localhost 웹 마법사로 시작 → 나중에 네이티브 껍데기(WKWebView/Electron)로 포팅. 프론트는 끝까지 웹, JSON API가 교체 가능한 시임. 앱엔 네트워크 서버를 넣지 않음.
- **(2026-06-13) 에디터는 code-server 포크 vendoring** — 설정 우선, 안 되는 것만 surgical 패치(점진적, Cursor식). from-scratch 아님. Claude Code 익스텐션은 Open VSX.
- **(2026-06-14) M4 에디터를 VSCodium 포크(RemotePair IDE)로 피벗** — code-server 경로 폐기. Claude Code / Codex 익스텐션 호환성(Node API·마켓플레이스)이 실제 VS Code / Electron 엔진을 요구함. 백엔드(M1–M6)는 재사용. 전략: "코드 유지, UI 숨김"(composite-bar 허용목록 + `when=false`); 코어 터미널 동작 코드 불변(에지케이스 지뢰밭). 번들 id `com.x10lab.remotepair-ide`(앱 id 통합 deferred). dev-watch: nvm node 22.22.1 + `buildConfig.useEsbuildTranspile=true`(dev 전용).
- **(2026-06-13) 온보딩 마법사를 M1 첫 마일스톤으로** — 역할→권한→재grant→SSH→매핑→Syncthing→검증. 브리지는 얇은 HTTP↔CLI 어댑터(설치 로직 재구현 금지).
- **(2026-06-13) 올인원은 오케스트레이션만** — 베스트 OSS를 설치·구성·실행만. RustDesk(AGPL)는 arm's-length 별도 프로세스 또는 macOS VNC/WebRTC로 대체(전염 차단). 상용 배포 전 법률 확인.
- **(2026-06-14) 파일 접근 기본을 mount-first로 전환** — Browser 루트/매핑 추가는 기본적으로 호스트 폴더를 **마운트**(`remote-pair mount`, SMB 기본=맥 내장, SSHFS 옵션; `docs/m-mount.md`)하고 마운트포인트를 FOLDER_MAP으로 가리킨다. 단일 source-of-truth·무충돌·Finder 자동 노출. Syncthing 복사동기화는 **legacy**로 유지(`SYNC_BACKEND` 기본 syncthing→mount). 런처는 완성, config/wizard/doctor wiring은 follow-up. RustDesk 사이드카(§1)는 사용자 직접 진행으로 본 스코프 제외.
- **(2026-06-14) Browser는 메타-컨테이너** — Sessions와 대칭. Browser는 하위 컨테이너(Explorer/Search/Extensions/…)를 담는 상위 컨테이너이고 2행 헤더 Row-1이 하위뷰 라우터. 클릭 시 전체 창을 덮는 글로벌 뷰렛 이동이 아니라 Browser 내부 콘텐츠만 교체. 중첩 메커니즘은 아키텍트 확정(§1 G009).
- **(2026-06-13) Remote Desktop 보류** — v0 screencapture 채널/VNC, v1 WebRTC(ScreenCaptureKit+VideoToolbox, Input Monitoring 추가).
- 버전 정책: pre-1.0 유지. 리네임·cert 전환은 v0.5.0 마이너 bump로 처리, 이후 패치 +0.0.1.

---

## 4. 미해결 / 열린 항목 (Open issues)

### 해결됨
- ~~**brew cask appdir 불일치**~~ — Homebrew cask 기본 위치 `/Applications`에 맞춰 통일. `config.sh` `APP_PATH`·Updater·Installer 폴백·Permissions 안내·README를 모두 `/Applications`로 변경. 앱 자기설치 LaunchAgent는 `Bundle.main` 실제 경로를 써서 원래도 무관.
- ~~**메인테이너 문서 버전 표기 불일치**~~ — README "For maintainers"를 실제 릴리스/cask와 정합(현재 0.5.0). `host/build-host.sh`의 `VERSION` 단일 출처와 일치.
- ~~**정체성 통일(리네임 + bundle id + cask 토큰)**~~ — 코드/cask는 적용 완료: `config.sh` 기본값 `RemotePair`/`com.x10lab.remote-pair`, `Config.swift` `BUNDLE_ID` 폴백, `Installer.swift` legacy-shed, `client/cli/remote-pair` dual-id 프로빙, `Casks/remote-pair.rb`(옛 cask 부재). 남은 일은 사용자 마이그레이션 안내(README 반영됨)와 소스 디렉터리명 정리(deferred).
- ~~**cert 전환(33849F → 898E32)**~~ — 리네임과 v0.5.0에 묶어 처리(재grant 1회). `build-host.sh`가 v0.5.0~ 정체성 변경 + 재grant 필요를 명시.
- ~~**클라 머신 호스트 자기설치·중복 인스턴스**~~ — `Installer.swift` legacy-shed가 옛 LaunchAgent bootout + 옛 .app 제거로 두 메뉴바 인스턴스 차단(gh-mac-m4 사고 재발방지, 커밋 1ffb3bd).

### 열린 항목
- **4개 pre-existing 런처 테스트 실패** — `tests/run.sh` 결과 159 passed / 4 failed. 실패 항목: `t_04_target` `target/remote-host+--local→local`, `t_07_resilience` `s1/reach-fail-no-tailscale`·`s2/exit-node-set`, `t_06`(혹은 동치) `s4/dir-ssherr`. **근본 원인**: `--local` 강제 또는 원격 도달 실패로 로컬 폴백 경로를 탈 때, 머신에 RemotePair 호스트가 없으면(`ensure_local_host` 거짓) 런처가 `tmux-aqua new-session` 대신 **plain `tmux new`/`tmux attach`** 를 호출한다(`client/cli/remote-pair-launch:277-290`). 테스트는 `tmux-aqua`/`new-session`을 기대하므로 실패. 설계상 "tmux-aqua 없는 머신엔 computer-use 없음"이 의도지만, 테스트 기대와 어긋나므로 (a) 로컬 폴백도 tmux-aqua를 우선 시도하도록 런처를 고치거나 (b) 테스트 기대를 현재 설계에 맞추는 결정이 필요.
- **host hot-update 권한 상속 충돌 스파이크(M6 선행, ⚠️)** — 앱을 재시작해 무중단 업데이트하면 tmux 부모가 launchd로 reparent되어 AX 상속이 깨질 수 있다(`tmux-aqua`가 reparent를 막는 전제가 앱 교체 시 흔들림). M6 hot-update 구현 전에 **권한 상속이 유지되는지 스파이크**로 먼저 검증해야 한다.
- **RustDesk AGPL arm's-length 검증** — Remote Desktop에 RustDesk를 쓸 경우, 자기 배포물에 링크·포함되지 않고 별도 프로세스(사용자 설치/런타임 다운로드)로 분리됐는지 확인. 상용 배포 전 법률 자문.
- **code-server 포크 유지보수 비용** — 포크·vendoring + surgical 패치 모델은 업스트림 추종 비용이 든다. 패치 표면 최소화 + 업스트림 리베이스 전략을 M3 착수 시 확정.
- **알림 포워딩 훅 부재** — 현재 host엔 approve-reminder 훅만 있고 Notification/Stop 포워딩 훅이 없다(M2에서 추가).
- **glue 자동 업데이트** — cask가 .app만 자동 업데이트하고 approve 스킬·훅(glue)은 bootstrap 재실행이 필요. .app 번들 동봉 vs repo 재실행 모델 결정 대기. → [future.md](future.md).
- 메뉴바 "활성 세션 없음" 표시가 실제 세션 상태와 불일치(앱 미기동·status.json 부재 시 ground-truth 괴리).
- 클린설치 테스트(m1/m4)를 cron 예약으로 검증.

---

*출처: 세션 27d757a4 · 318aaabe · a26f7244 · afad7df4 · df30583d (로컬), 109edb94 · 644df73d (호스트). 4d6e9677 · a23aa692(호스트)는 approve/heartbeat 자동 실행 세션으로 사람 요구사항 없음. **2026-06-13 제품 비전 세션**(웹 UI 전환·정체성 통일·온보딩 마법사·알림 포워딩·올인원 오케스트레이션·로드맵 M1~M6)을 본 개정에 반영했다.*

---

## 5. 로드맵 (M1 → M6)

각 마일스톤은 위 요구사항을 묶은 출시 단위다. 의존 순서대로 나열.

| 마일스톤 | 범위 | 상태(2026-06-13) | 핵심 검증 | 참조 |
|---|---|---|---|---|
| **M1** | 온보딩 마법사 + 정체성 통일(리네임·bundle id·cask·cert, v0.5.0) | 마법사 구현됨; 리네임·cert 전환은 v0.5.0 예정(현재 정체성 `-host` 유지) | `remote-pair web` 마법사가 역할→권한→재grant→SSH→매핑→Syncthing→검증을 끝까지 안내. 재grant 1회 후 `status` = AX✓ SR✓. dual-id 프로빙 동작. | §1 온보딩·리네임, architecture.md §9 |
| **M2** | 알림 포워딩 | 구현됨 | host의 완료/Stop/질문/approve 알림이 client로 전달, 종류 토글. 신규 Notification/Stop 훅이 `doctor`에서 점검됨. | §1 알림 포워딩, architecture.md §10-3 |
| **M3** | Web 셸 + 터미널 | 구현됨(alt-screen 한계 있음) | xterm.js 터미널이 `capture-pane`/`send-keys` SSH 경유로 tmux-aqua 세션에 연결. Detach/Attach 탭. JSON API 시임 재사용. | §1 Web 셸, architecture.md §10-2 |
| **M4** | IDE 프론트엔드 (RemotePair IDE — VSCodium 포크) | **G001–G008 완료 + 브랜드 빌드·원격 E2E 검증** | 레일(Browser/Sessions/Settings), Sessions 임베드 EditorPart + 네이티브 탭 + in-tab picker(Claude/Shell/Codex/Gemini), 탭형 Session Manager(Attached/Detached/History, 활성 하이라이트+X), Host 버튼. 남은 작업: `patches/` 캡처(rebase-safety). | §1 IDE Frontend, `.omc/ultragoal/` |
| **M5** | Remote Desktop | 스캐폴드(VNC launcher 구현, WebRTC는 스파이크) | v0: macOS Screen Sharing arm's-length 런처. v1: WebRTC(ScreenCaptureKit+VideoToolbox, Input Monitoring). RustDesk 쓰면 arm's-length. | §1 Remote Desktop·올인원, architecture.md §10-5 |
| **M6** | host hot-update | 설계 확정, AX 상속 스파이크 대기 | 무중단 앱 업데이트(L1 glue 핫스왑 + L2 네이티브 재실행). **⚠️ 선행 스파이크 필수**: 앱 재시작 시 tmux 부모가 launchd로 바뀌어 AX 상속이 깨지는지 먼저 검증. | §4 hot-update 스파이크, architecture.md §11 |
